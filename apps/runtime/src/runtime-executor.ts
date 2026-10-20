import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { AppError, newId } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

interface ActiveExecution {
  child: ChildProcess
  cancelled: boolean
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
  }
}

export class RuntimeExecutionService {
  private readonly active = new Map<string, ActiveExecution>()

  constructor(private readonly store: SqliteStore) {}

  async execute(profileId: string, prompt: string, cwd?: string) {
    const profile = this.store.read.listRuntimeProfiles().find((item) => item.id === profileId)
    if (!profile) throw new AppError('NOT_FOUND', 'Runtime 不存在')
    if (profile.protocol === 'native') throw new AppError('BAD_REQUEST', 'ProjectOS Native 由内置 AgentRunner 执行，不走 CLI Adapter')
    if (!profile.executable) throw new AppError('BAD_REQUEST', 'Runtime 未配置可执行路径')
    const executionId = newId('exe')
    const startedAt = Date.now()
    const args = [...profile.args, prompt]
    const child = spawn(profile.executable, args, {
      cwd: cwd || process.cwd(),
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    })
    const state: ActiveExecution = { child, cancelled: false }
    this.active.set(executionId, state)
    let output = ''
    const events: Array<{ type: string; text: string }> = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
    }, 120_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      output += text
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        try {
          const parsed = JSON.parse(line) as { type?: string; text?: string; message?: string }
          events.push({ type: parsed.type ?? 'event', text: parsed.text ?? parsed.message ?? line })
        } catch {
          events.push({ type: 'message.delta', text: line })
        }
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      output += text
      events.push({ type: 'stderr', text: line(text) })
    })
    const status = await new Promise<'completed' | 'failed' | 'cancelled' | 'timeout'>((resolve) => {
      child.on('error', () => resolve('failed'))
      child.on('close', (code) => {
        clearTimeout(timer)
        this.active.delete(executionId)
        if (state.cancelled) resolve('cancelled')
        else if (timedOut) resolve('timeout')
        else resolve(code === 0 ? 'completed' : 'failed')
      })
    })
    return { executionId, status, output: output.slice(0, 80_000), events: events.slice(-500), durationMs: Date.now() - startedAt }
  }

  cancel(executionId: string): void {
    const state = this.active.get(executionId)
    if (!state) throw new AppError('NOT_FOUND', '执行不存在或已结束')
    state.cancelled = true
    killTree(state.child)
  }
}

function line(text: string): string {
  return text.trim().split(/\r?\n/).slice(-1)[0] ?? ''
}

