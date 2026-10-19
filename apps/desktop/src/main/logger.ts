import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export interface MainLogger {
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
  filePath: string
}

export function createMainLogger(dataDir: string): MainLogger {
  const logDir = join(dataDir, 'logs')
  mkdirSync(logDir, { recursive: true })
  const filePath = join(logDir, 'desktop.log')
  const write = (level: string, message: string, meta?: unknown): void => {
    const line = `${new Date().toISOString()} [${level}] ${message}${
      meta === undefined ? '' : ` ${safeJson(meta)}`
    }\n`
    try {
      appendFileSync(filePath, line, 'utf8')
    } catch {
      // logging must never break the app
    }
    if (level === 'error') process.stderr.write(line)
  }
  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    filePath,
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
