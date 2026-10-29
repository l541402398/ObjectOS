import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import {
  AppError,
  RuntimeFrameSchema,
  type ProviderRuntimeConfig,
  type RuntimeEvent,
  type RuntimeFrame,
  type RuntimeStatus,
  type SerializedAppError,
} from '@projectos/contracts'
import type { MainLogger } from './logger.js'

export interface RuntimeSupervisorOptions {
  entryPath: string
  dataDir: string
  providerConfig: () => ProviderRuntimeConfig
  onEvent: (seq: number, event: RuntimeEvent) => void
  onStatus: (status: RuntimeStatus) => void
  logger: MainLogger
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timer: NodeJS.Timeout
}

/**
 * ADR-0064 — a busy runtime must not be killed as if it were dead.
 *
 * A real first-run delivery attempt was interrupted by
 * `runtime heartbeat missed; restarting` → `killing runtime {reason: "heartbeat timeout"}` while the
 * runtime was working through git/diff/sqlite work. One slow pong (12s) is not a hang: the supervisor
 * now tolerates a missed pong (especially with requests in flight) and only restarts after two in a row.
 */
export function shouldRestartOnMissedPong(input: { missed: number; pendingRequests: number }): boolean {
  if (input.missed <= 0) return false
  if (input.missed >= 2) return true
  return false
}

export class RuntimeSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null
  private status: RuntimeStatus = {
    status: 'starting',
    pid: null,
    restartCount: 0,
    message: null,
    since: Date.now(),
  }
  private readonly pending = new Map<string, PendingRequest>()
  private handshakeTimer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private pongTimer: NodeJS.Timeout | null = null
  private restartTimer: NodeJS.Timeout | null = null
  private stabilityTimer: NodeJS.Timeout | null = null
  private stopping = false
  private readonly failures: number[] = []
  private providerReady: Promise<void> | null = null
  private missedPongs = 0

  constructor(private readonly options: RuntimeSupervisorOptions) {}

  getStatus(): RuntimeStatus {
    return { ...this.status }
  }

  isReady(): boolean {
    return this.status.status === 'ready'
  }

  start(): void {
    if (this.child) return
    this.spawnRuntime()
  }

  private spawnRuntime(): void {
    if (this.stopping) return
    if (!existsSync(this.options.entryPath)) {
      this.setStatus('failed', `Runtime bundle 不存在：${this.options.entryPath}。请先运行 pnpm build:runtime。`)
      return
    }
    this.missedPongs = 0
    this.setStatus('starting', null, this.status.restartCount)
    this.options.logger.info('starting runtime', { entryPath: this.options.entryPath })
    const child = spawn(process.execPath, [this.options.entryPath], {
      cwd: this.options.dataDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PROJECTOS_DATA_DIR: this.options.dataDir,
        PROJECTOS_LOG_LEVEL: process.env.PROJECTOS_LOG_LEVEL ?? 'info',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.child = child
    this.handshakeTimer = setTimeout(() => {
      this.options.logger.error('runtime handshake timed out')
      this.killChild('handshake timeout')
    }, 15_000)

    const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity })
    stdout.on('line', (line) => this.handleLine(line))
    const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity })
    stderr.on('line', (line) => {
      if (!line.trim()) return
      if (line.includes('"level":50') || line.includes('"level":60')) {
        this.options.logger.error(`runtime: ${line}`)
      } else if (line.includes('"level":40')) {
        this.options.logger.warn(`runtime: ${line}`)
      } else if (process.env.PROJECTOS_RUNTIME_LOG_STDERR === '1') {
        this.options.logger.info(`runtime: ${line}`)
      }
    })
    child.on('error', (error) => {
      this.options.logger.error('runtime process error', { error: error.message })
    })
    child.on('exit', (code, signal) => this.handleExit(code, signal))
  }

  private handleLine(line: string): void {
    if (!line.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.options.logger.warn(`runtime emitted non-JSON stdout: ${line.slice(0, 300)}`)
      return
    }
    const result = RuntimeFrameSchema.safeParse(parsed)
    if (!result.success) {
      this.options.logger.warn('runtime emitted invalid frame', { issues: result.error.issues.slice(0, 3) })
      return
    }
    this.handleFrame(result.data)
  }

  private handleFrame(frame: RuntimeFrame): void {
    if (frame.kind === 'hello') {
      if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
      if (frame.protocolVersion !== 1) {
        this.setStatus('failed', `Runtime 协议版本不匹配：${frame.protocolVersion}`)
        this.killChild('protocol mismatch')
        return
      }
      this.setStatus('ready', null, this.status.restartCount, frame.pid)
      this.options.logger.info('runtime ready', { pid: frame.pid, runtimeVersion: frame.runtimeVersion })
      this.providerReady = this.configureProvider().finally(() => {
        this.providerReady = null
      })
      this.startHeartbeat()
      if (this.stabilityTimer) clearTimeout(this.stabilityTimer)
      this.stabilityTimer = setTimeout(() => {
        this.failures.length = 0
        if (this.status.status === 'ready') this.status.restartCount = 0
      }, 60_000)
      return
    }
    if (frame.kind === 'response') {
      const pending = this.pending.get(frame.id)
      if (!pending) return
      this.pending.delete(frame.id)
      clearTimeout(pending.timer)
      if (frame.ok) {
        pending.resolve(frame.result)
      } else {
        const serialized = frame.error as SerializedAppError | undefined
        const error = new AppError(
          (serialized?.code as never) ?? 'INTERNAL',
          serialized?.message ?? 'Runtime 请求失败',
          { details: serialized?.details, retryable: serialized?.retryable },
        )
        pending.reject(error)
      }
      return
    }
    if (frame.kind === 'event') {
      try {
        this.options.onEvent(frame.seq, frame.event)
      } catch (error) {
        this.options.logger.warn('failed to forward runtime event', { error: String(error) })
      }
      return
    }
    if (frame.kind === 'pong') {
      if (this.pongTimer) clearTimeout(this.pongTimer)
      this.pongTimer = null
      this.missedPongs = 0
    }
  }

  private async configureProvider(): Promise<void> {
    try {
      await this.request('runtime.provider.configure', this.options.providerConfig(), 10_000)
    } catch (error) {
      this.options.logger.warn('failed to configure runtime provider', { error: String(error) })
    }
  }

  request<T = unknown>(method: string, input: unknown, timeoutMs = 30_000): Promise<T> {
    if (!this.child || this.status.status !== 'ready') {
      return Promise.reject(new AppError('RUNTIME_UNAVAILABLE', 'Runtime 尚未就绪'))
    }
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AppError('TIMEOUT', `Runtime 请求超时：${method}`, { retryable: true }))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      })
      try {
        this.child!.stdin.write(`${JSON.stringify({ kind: 'request', id, method, input })}\n`)
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new AppError('RUNTIME_UNAVAILABLE', '无法写入 Runtime 进程'))
      }
    })
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = setInterval(() => {
      if (!this.child || this.stopping) return
      try {
        this.child.stdin.write(
          `${JSON.stringify({ kind: 'ping', id: randomUUID(), sentAt: Date.now() })}\n`,
        )
      } catch {
        this.killChild('heartbeat write failed')
        return
      }
      if (this.pongTimer) clearTimeout(this.pongTimer)
      this.pongTimer = setTimeout(() => {
        this.pongTimer = null
        this.missedPongs += 1
        const pendingRequests = this.pending.size
        if (shouldRestartOnMissedPong({ missed: this.missedPongs, pendingRequests })) {
          this.options.logger.warn('runtime heartbeat missed twice; restarting', {
            missed: this.missedPongs,
            pendingRequests,
          })
          this.killChild('heartbeat timeout')
          return
        }
        this.options.logger.warn('runtime heartbeat slow; extending grace', {
          missed: this.missedPongs,
          pendingRequests,
        })
      }, 12_000)
    }, 15_000)
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const wasChild = this.child
    this.child = null
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    if (this.stabilityTimer) clearTimeout(this.stabilityTimer)
    this.missedPongs = 0
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(new AppError('RUNTIME_UNAVAILABLE', 'Runtime 进程已退出', { retryable: true }))
      this.pending.delete(id)
    }
    this.options.logger.warn('runtime exited', { code, signal, pid: wasChild?.pid })
    if (this.stopping) {
      this.setStatus('stopped', 'Runtime 已停止', this.status.restartCount, null)
      return
    }
    const timestamp = Date.now()
    this.failures.push(timestamp)
    while (this.failures.length > 0 && timestamp - (this.failures[0] ?? 0) > 60_000) this.failures.shift()
    const restartCount = this.status.restartCount + 1
    if (this.failures.length > 5) {
      this.setStatus('failed', 'Runtime 在 60 秒内连续失败 5 次，已停止自动重启。', restartCount, null)
      return
    }
    const delay = Math.min(1_000 * 2 ** (this.failures.length - 1), 12_000)
    this.setStatus(
      'restarting',
      `Runtime 已退出（${code ?? signal ?? 'unknown'}），${Math.round(delay / 1000)} 秒后重启`,
      restartCount,
      null,
    )
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.spawnRuntime()
    }, delay)
  }

  private killChild(reason: string): void {
    this.options.logger.warn('killing runtime', { reason })
    try {
      this.child?.kill()
    } catch {
      // ignore
    }
  }

  async waitForReady(timeoutMs = 20_000): Promise<void> {
    if (this.isReady()) {
      if (this.providerReady) await this.providerReady
      return
    }
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (this.isReady()) {
        if (this.providerReady) await this.providerReady
        return
      }
      const current: RuntimeStatus['status'] = this.status.status
      if (current === 'failed' || current === 'stopped') {
        throw new AppError('RUNTIME_UNAVAILABLE', this.status.message ?? 'Runtime 不可用', {
          retryable: true,
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    throw new AppError('RUNTIME_UNAVAILABLE', this.status.message ?? '等待 Runtime 启动超时', {
      retryable: true,
    })
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    if (this.pongTimer) clearTimeout(this.pongTimer)
    if (this.handshakeTimer) clearTimeout(this.handshakeTimer)
    if (!this.child) {
      this.setStatus('stopped', 'Runtime 已停止', this.status.restartCount, null)
      return
    }
    const child = this.child
    try {
      child.stdin.write(
        `${JSON.stringify({
          kind: 'request',
          id: randomUUID(),
          method: 'runtime.shutdown',
          input: {},
        })}\n`,
      )
    } catch {
      // ignore
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill()
        } catch {
          // ignore
        }
        resolve()
      }, 2_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    this.child = null
    this.setStatus('stopped', 'Runtime 已停止', this.status.restartCount, null)
  }

  restart(): void {
    this.failures.length = 0
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    if (this.child) {
      this.killChild('manual restart')
      return
    }
    this.setStatus('starting', '手动重启 Runtime', this.status.restartCount, null)
    this.spawnRuntime()
  }

  private setStatus(
    status: RuntimeStatus['status'],
    message: string | null = null,
    restartCount = this.status.restartCount,
    pid: number | null = this.status.pid,
  ): void {
    this.status = {
      status,
      pid,
      restartCount,
      message,
      since: Date.now(),
    }
    try {
      this.options.onStatus(this.getStatus())
    } catch (error) {
      this.options.logger.warn('failed to publish runtime status', { error: String(error) })
    }
  }
}
