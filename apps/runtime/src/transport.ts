import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import {
  RuntimeFrameSchema,
  AppError,
  KnowledgeHostInputSchema,
  type KnowledgeHostInput,
  type KnowledgeHostOutput,
  type RuntimeFrame,
  serializeError,
  type RuntimeEvent,
  type RuntimeHelloFrame,
  type RuntimeRequestFrame,
} from '@projectos/contracts'

export interface TransportHandlers {
  onRequest: (frame: RuntimeRequestFrame) => void
  onShutdown: () => void
}

export class RuntimeTransport {
  private readonly rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  private closed = false
  private started = false
  private readonly knowledgeRequests = new Map<string, { resolve: (value: KnowledgeHostOutput) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

  requestKnowledge(input: KnowledgeHostInput): Promise<KnowledgeHostOutput> {
    input = KnowledgeHostInputSchema.parse(input)
    if (!this.started || this.closed || this.knowledgeRequests.size >= 16) return Promise.reject(new AppError('RUNTIME_UNAVAILABLE', '组织资料通道暂时不可用'))
    return new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => { this.knowledgeRequests.delete(id); reject(new AppError('TIMEOUT', '组织资料校验超时，请恢复连接后重试')) }, 12_000)
      this.knowledgeRequests.set(id, { resolve, reject, timer })
      this.send({ kind: 'knowledge_request', id, input })
    })
  }

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
    if (frame.kind === 'knowledge_response') {
      const pending = this.knowledgeRequests.get(frame.id)
      if (!pending) return
      clearTimeout(pending.timer); this.knowledgeRequests.delete(frame.id)
      if (frame.ok && frame.result) pending.resolve(frame.result)
      else pending.reject(new AppError('POLICY_DENIED', '组织资料授权已失效或服务不可用，请检查账号、项目与资料状态'))
    } else if (frame.kind === 'request') {
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

  send(frame: RuntimeFrame): void {
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
    for (const pending of this.knowledgeRequests.values()) { clearTimeout(pending.timer); pending.reject(new AppError('RUNTIME_UNAVAILABLE', '组织资料通道已关闭')) }
    this.knowledgeRequests.clear()
  }
}
