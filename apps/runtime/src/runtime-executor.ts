import { spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import crossSpawn from 'cross-spawn'
import { AppError, newId, type ProviderRuntimeConfig, type RuntimeProfile } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

export interface StopReceipt {
  executionId: string
  pid: number | null
  outcome: 'confirmed' | 'unknown'
  detail?: string
}

export interface FrozenRuntimeRequest {
  profileId: string
  profileName: string
  protocol: RuntimeProfile['protocol']
  executable: string
  args: string[]
  cwd: string
  prompt: string
  promptHash: string
  requestHash: string
  deadlineAt: number | null
}

interface ActiveExecution {
  child: ChildProcess
  cancelled: boolean
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function killTree(executionId: string, child: ChildProcess): StopReceipt {
  if (!child.pid || child.exitCode !== null) {
    return { executionId, pid: child.pid ?? null, outcome: 'confirmed' }
  }
  if (process.platform === 'win32') {
    const res = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    const confirmed = res.status === 0 || child.exitCode !== null || child.killed
    return {
      executionId,
      pid: child.pid,
      outcome: confirmed ? 'confirmed' : 'unknown',
      detail: confirmed ? undefined : `taskkill exited with ${res.status ?? 'null'}`,
    }
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
    return { executionId, pid: child.pid, outcome: 'confirmed' }
  } catch {
    try {
      const killed = child.kill('SIGKILL')
      return {
        executionId,
        pid: child.pid,
        outcome: killed || child.exitCode !== null ? 'confirmed' : 'unknown',
      }
    } catch (error) {
      return {
        executionId,
        pid: child.pid,
        outcome: child.exitCode !== null ? 'confirmed' : 'unknown',
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

export class RuntimeExecutionService {
  private readonly active = new Map<string, ActiveExecution>()

  constructor(
    private readonly store: SqliteStore,
    private readonly credentials?: () => ProviderRuntimeConfig,
  ) {}

  freezeRequest(
    profile: RuntimeProfile,
    prompt: string,
    cwd?: string,
    deadlineAt?: number | null,
  ): FrozenRuntimeRequest {
    if (profile.protocol === 'native') {
      throw new AppError('BAD_REQUEST', 'ProjectOS Native 由内置 AgentRunner 执行，不走 CLI Adapter')
    }
    if (!profile.executable) {
      throw new AppError('BAD_REQUEST', 'Runtime 未配置可执行路径')
    }
    const resolvedCwd = cwd || process.cwd()
    const frozenArgs = [...profile.args]
    const promptHash = sha256(prompt)
    const requestHash = sha256(
      JSON.stringify({
        profileId: profile.id,
        protocol: profile.protocol,
        executable: profile.executable,
        args: frozenArgs,
        cwd: resolvedCwd,
        promptHash,
      }),
    )
    return {
      profileId: profile.id,
      profileName: profile.name,
      protocol: profile.protocol,
      executable: profile.executable,
      args: frozenArgs,
      cwd: resolvedCwd,
      prompt,
      promptHash,
      requestHash,
      deadlineAt: deadlineAt ?? null,
    }
  }

  assertFrozenIntegrity(request: FrozenRuntimeRequest): void {
    if (request.deadlineAt !== null && Date.now() >= request.deadlineAt) {
      throw new AppError('CONFLICT', '运行截止时间（deadline）在等待审批期间已到期，已取消本次 CLI Runtime 启动')
    }
    const current = this.store.read.listRuntimeProfiles().find((item) => item.id === request.profileId)
    if (!current) {
      throw new AppError('CONFLICT', 'CLI Runtime 在审批期间已被删除，拒绝继续执行')
    }
    const currentCheck = this.freezeRequest(current, request.prompt, request.cwd, request.deadlineAt)
    if (currentCheck.requestHash !== request.requestHash) {
      throw new AppError(
        'CONFLICT',
        'CLI Runtime 的可执行路径、参数或协议在审批期间已被修改，原审批已失效，请重新发起审批',
      )
    }
  }

  async executeFrozen(request: FrozenRuntimeRequest, onStart?: (executionId: string) => void) {
    this.assertFrozenIntegrity(request)
    return this.spawnAndCollect(
      request.executable,
      [...request.args, request.prompt],
      request.cwd,
      request.deadlineAt,
      onStart,
    )
  }

  async execute(
    profileId: string,
    prompt: string,
    cwd?: string,
    onStart?: (executionId: string) => void,
    deadlineAt?: number | null,
  ) {
    const profile = this.store.read.listRuntimeProfiles().find((item) => item.id === profileId)
    if (!profile) throw new AppError('NOT_FOUND', 'Runtime 不存在')
    const frozen = this.freezeRequest(profile, prompt, cwd, deadlineAt)
    return this.spawnAndCollect(
      frozen.executable,
      [...frozen.args, frozen.prompt],
      frozen.cwd,
      frozen.deadlineAt,
      onStart,
    )
  }

  private async spawnAndCollect(
    executable: string,
    args: string[],
    cwd: string,
    deadlineAt: number | null,
    onStart?: (executionId: string) => void,
  ) {
    const executionId = newId('exe')
    const startedAt = Date.now()
    const timeoutMs =
      deadlineAt !== null ? Math.max(1_000, Math.min(2_147_483_647, deadlineAt - startedAt)) : 120_000
    const child = crossSpawn(executable, args, {
      cwd,
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      // CLI Harnesses such as OpenCode wait for stdin EOF in `run` mode. Never
      // hand them an open pipe, or a real Harness would hang until the timeout.
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !key.startsWith('ELECTRON_') && key !== 'NODE_OPTIONS'),
        ),
        ...this.secretEnvironment(),
      },
    })
    const state: ActiveExecution = { child, cancelled: false }
    this.active.set(executionId, state)
    onStart?.(executionId)
    let output = ''
    const events: Array<{ type: string; text: string }> = []
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      killTree(executionId, child)
    }, timeoutMs)
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
      child.on('error', (error) => {
        output += '\n' + error.message
        resolve('failed')
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        this.active.delete(executionId)
        if (code !== 0 && !output.trim()) output += `\n[exit ${code ?? 'null'}]`
        if (state.cancelled) resolve('cancelled')
        else if (timedOut) resolve('timeout')
        else resolve(code === 0 ? 'completed' : 'failed')
      })
    })
    return { executionId, status, output: output.slice(0, 80_000), events: events.slice(-500), durationMs: Date.now() - startedAt }
  }

  secretEnvironment(): Record<string, string> {
    const config = this.credentials?.()
    if (!config?.apiKey) return {}
    const baseUrl = config.baseUrl.toLowerCase()
    const provider = config.provider.toLowerCase()
    const env: Record<string, string> = {}
    if (baseUrl.includes('deepseek') || provider.includes('deepseek')) env.DEEPSEEK_API_KEY = config.apiKey
    if (baseUrl.includes('anthropic') || provider.includes('anthropic') || config.protocol === 'anthropic-messages') env.ANTHROPIC_API_KEY = config.apiKey
    if (baseUrl.includes('generativelanguage') || provider.includes('gemini') || provider.includes('google')) env.GEMINI_API_KEY = config.apiKey
    if (baseUrl.includes('dashscope') || provider.includes('qwen') || provider.includes('dashscope')) env.DASHSCOPE_API_KEY = config.apiKey
    if (config.protocol === 'openai-chat' || config.protocol === 'openai-responses') {
      env.OPENAI_API_KEY = config.apiKey
      env.OPENAI_BASE_URL = config.baseUrl
    }
    return env
  }

  cancel(executionId: string): StopReceipt {
    const state = this.active.get(executionId)
    if (!state) throw new AppError('NOT_FOUND', '执行不存在或已结束')
    state.cancelled = true
    return killTree(executionId, state.child)
  }

  cancelIfActive(executionId: string): StopReceipt {
    const state = this.active.get(executionId)
    if (!state) return { executionId, pid: null, outcome: 'confirmed' }
    state.cancelled = true
    return killTree(executionId, state.child)
  }
}

function line(text: string): string {
  return text.trim().split(/\r?\n/).slice(-1)[0] ?? ''
}
