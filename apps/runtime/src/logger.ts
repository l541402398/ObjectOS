import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import pino from 'pino'

export function createLogger(logDir: string) {
  mkdirSync(logDir, { recursive: true })
  const streams = pino.multistream([
    { stream: process.stderr },
    { stream: pino.destination({ dest: join(logDir, 'runtime.log'), sync: false, mkdir: true }) },
  ])
  return pino(
    {
      level: process.env.PROJECTOS_LOG_LEVEL ?? 'info',
      base: { pid: process.pid, service: 'projectos-runtime' },
      redact: {
        paths: [
          'apiKey',
          '*.apiKey',
          'authorization',
          '*.authorization',
          'headers.authorization',
          '*.headers.authorization',
        ],
        censor: '••••••••',
      },
    },
    streams,
  )
}

export type Logger = ReturnType<typeof createLogger>
