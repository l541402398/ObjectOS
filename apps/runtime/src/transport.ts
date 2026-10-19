import { createInterface } from 'node:readline'
import {
  RuntimeFrameSchema,
  serializeError,
  type RuntimeEvent,
  type RuntimeEventFrame,
  type RuntimeHelloFrame,
  type RuntimePingFrame,
  type RuntimeRequestFrame,
  type RuntimeResponseFrame,
} from '@projectos/contracts'

export interface TransportHandlers {
  onRequest: (frame: RuntimeRequestFrame) => void
  onShutdown: () => void
}

export class RuntimeTransport {
  private readonly rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  private closed = false
  private started = false

  constructor(
    private readonly handlers: TransportHandlers,
    private readonly hello: Omit<RuntimeHelloFrame, 'kind'>,
  ) {}

  start(): void {
    this.started = true
    this.send({ kind: 'hello', ...this.hello })
    this.rl.on('line', (line) => this.handleLine(line))
    this.rl.on('close', () => this.handlers.onShutdown())
    process.stdin.on('error', () => this.handlers.onShutdown())
  }

  private handleLine(line: string): void {
    if (!line.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      process.stderr.write('runtime: received invalid JSON frame\n')
      return
    }
    const result = RuntimeFrameSchema.safeParse(parsed)
    if (!result.success) {
      const candidate = parsed as { kind?: string; id?: string }
      if (candidate && candidate.kind === 'request' && typeof candidate.id === 'string') {
        this.respond(candidate.id, false, undefined, serializeError(result.error))
      }
      return
    }
    const frame = result.data
    if (frame.kind === 'request') {
      this.handlers.onRequest(frame)
    } else if (frame.kind === 'ping') {
      this.send({
        kind: 'pong',
        id: frame.id,
        sentAt: frame.sentAt,
        receivedAt: Date.now(),
      })
    }
  }

  send(frame: RuntimeHelloFrame | RuntimeResponseFrame | RuntimeEventFrame | RuntimePingFrame | { kind: 'pong'; id: string; sentAt: number; receivedAt: number }): void {
    if (this.closed || !this.started) return
    try {
      process.stdout.write(`${JSON.stringify(frame)}\n`)
    } catch {
      this.closed = true
    }
  }

  respond(id: string, ok: boolean, result?: unknown, error?: unknown): void {
    this.send({
      kind: 'response',
      id,
      ok,
      ...(ok ? { result } : { error: serializeError(error) }),
    })
  }

  sendEvent(seq: number, event: RuntimeEvent): void {
    this.send({ kind: 'event', seq, event })
  }

  close(): void {
    this.closed = true
  }
}
