import { loadRuntimeConfig } from './config.js'
import { createLogger } from './logger.js'
import { createWorkspaceAdapter } from './workspace-adapter.js'
import { RuntimeTransport } from './transport.js'
import { RuntimeEventHub } from './events.js'
import { ProviderManager } from './provider-manager.js'
import { SqliteStore } from '@projectos/persistence'
import { CoreServices } from '@projectos/application'
import { AgentRunner } from './agent-runner.js'
import { RuntimeDispatcher } from './dispatcher.js'
import { serializeError } from '@projectos/contracts'

async function main(): Promise<void> {
  const config = loadRuntimeConfig()
  const logger = createLogger(config.logDir)
  const startedAt = Date.now()
  let shuttingDown = false
  let transport: RuntimeTransport | null = null
  let hub: RuntimeEventHub | null = null

  const store = new SqliteStore({
    filePath: config.dbPath,
    logger: (message) => logger.info(message),
    onEvents: (events) => hub?.publishCommitted(events),
  })

  hub = new RuntimeEventHub(
    {
      sendEvent: (seq, event) => transport?.sendEvent(seq, event),
    },
    store,
    logger,
  )
  const eventHub = hub

  const provider = new ProviderManager(config.provider)
  const workspace = createWorkspaceAdapter()
  const services = new CoreServices(store, workspace)
  const runner = new AgentRunner(config, store, services, provider, eventHub, logger)

  const shutdown = (): void => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('runtime shutting down')
    try {
      runner.shutdown()
      dispatcher.shutdownOrchestrations()
    } catch (error) {
      logger.warn({ err: error }, 'failed to abort active runs')
    }
    try {
      store.close()
    } catch (error) {
      logger.warn({ err: error }, 'failed to close store')
    }
    transport?.close()
    setTimeout(() => process.exit(0), 60)
  }

  const dispatcher = new RuntimeDispatcher({
    config,
    store,
    services,
    runner,
    provider,
    hub: eventHub,
    logger,
    startedAt,
    shutdown,
  })
  transport = new RuntimeTransport(
    {
      onRequest: (frame) => {
        void (async () => {
          try {
            const result = await dispatcher.dispatch(frame.method, frame.input)
            transport?.respond(frame.id, true, result)
          } catch (error) {
            const serialized = serializeError(error)
            if (serialized.code === 'INTERNAL') {
              logger.error({ err: error, method: frame.method }, 'runtime request failed')
            } else {
              logger.warn({ code: serialized.code, method: frame.method, message: serialized.message }, 'runtime request rejected')
            }
            transport?.respond(frame.id, false, undefined, error)
          }
        })()
      },
      onShutdown: shutdown,
    },
    {
      protocolVersion: 1,
      runtimeVersion: config.runtimeVersion,
      pid: process.pid,
      startedAt,
    },
  )

  runner.recoverInterruptedRuns()
  dispatcher.recoverOrchestrations()

  if (config.seedDemo) {
    try {
      const result = await dispatcher.dispatch('demo.seed', { force: false })
      logger.info({ result }, 'demo project seeded')
    } catch (error) {
      logger.warn({ err: error }, 'failed to seed demo project')
    }
  }

  transport.start()

  const interval = setInterval(() => {
    if (shuttingDown) return
    logger.debug({ activeRuns: store.read.countActiveRuns() }, 'runtime heartbeat')
  }, 30_000)
  interval.unref()

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
  process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'uncaught exception')
  })
  process.on('unhandledRejection', (error) => {
    logger.error({ err: error }, 'unhandled rejection')
  })
}

void main().catch((error) => {
  process.stderr.write(`runtime failed to start: ${error instanceof Error ? error.stack : String(error)}\n`)
  process.exit(1)
})
