import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'
import { AppError } from '@projectos/contracts'

interface Pending { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }

export class AcpClient {
  private readonly child: ChildProcess
  private readonly pending = new Map<number, Pending>()
  private seq = 0
  private readonly listeners = new Set<(message: unknown) => void>()
  private disposed = false

  constructor(executable: string, args: string[], cwd: string) {
    this.child = spawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false })
    const reader = createInterface({ input: this.child.stdout! })
    reader.on('line', (line) => this.onLine(line))
    this.child.stderr?.on('data', () => undefined)
    this.child.on('error', (error) => this.failAll(error))
    this.child.on('close', () => this.failAll(new Error('ACP 进程已退出')))
  }

  private onLine(line: string): void {
    let message: { id?: number; result?: unknown; error?: { message?: string } }
    try { message = JSON.parse(line) as typeof message } catch { return }
    if (typeof message.id !== 'number') {
      for (const listener of this.listeners) listener(message)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new Error(message.error.message ?? 'ACP 请求失败'))
    else pending.resolve(message.result)
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  onEvent(listener: (message: unknown) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  request<T>(method: string, params: unknown, timeoutMs = 20_000): Promise<T> {
    if (this.disposed) return Promise.reject(new AppError('RUNTIME_UNAVAILABLE', 'ACP 客户端已关闭'))
    const id = ++this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new AppError('TIMEOUT', `ACP ${method} 超时`))
      }, timeoutMs)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.child.stdin?.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }

  async initialize(cwd: string): Promise<{ protocolVersion?: number; agentInfo?: unknown; capabilities?: unknown; sessionId: string }> {
    const init = await this.request<{ protocolVersion?: number; agentInfo?: unknown; capabilities?: unknown }>('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: false }, terminal: false },
    })
    const session = await this.request<{ sessionId: string }>('session/new', { cwd, mcpServers: [] })
    return { ...init, sessionId: session.sessionId }
  }

  async authenticate(methodId: string): Promise<unknown> {
    return this.request('authenticate', { methodId })
  }

  async setModel(sessionId: string, modelId: string): Promise<unknown> {
    return this.request('session/set_model', { sessionId, modelId })
  }

  async prompt(sessionId: string, text: string): Promise<unknown> {
    return this.request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] }, 120_000)
  }

  dispose(): void {
    this.disposed = true
    this.failAll(new Error('ACP 客户端已关闭'))
    this.child.kill()
  }
}



