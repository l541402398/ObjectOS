import crossSpawn from 'cross-spawn'
import { createHash } from 'node:crypto'
import { AppError, newId, now, type ExternalAgentRunInput } from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import type { CoreServices } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import type { Logger } from './logger.js'
import { listExternalAgents } from './external-agents.js'

const SYSTEM_ACTOR = { kind: 'system' as const, id: 'external-agent', name: '外部 Agent' }
const LEASE_TTL_MS = 30 * 60 * 1000

/** Environment keys a read-only external harness may need. Never pass provider secrets. */
const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'HOSTNAME',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'OS',
] as const

function safeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key]
    if (value) env[key] = value
  }
  return env
}

interface ActiveExternalRun {
  child: ReturnType<typeof crossSpawn>
  store: SqliteStore
  runId: string
  projectId: string
  taskId: string | null
  toolCallId: string
  lease: { token: number; expiresAt: number } | null
  slot: { token: number; expiresAt: number } | null
  agentId: string
}

function claudeArgs(prompt: string, allowWrite: boolean): string[] {
  return [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    allowWrite ? 'acceptEdits' : 'plan',
    '--allowedTools',
    allowWrite ? 'Read,Edit,Write,Glob,Grep' : 'Read,Glob,Grep',
    '--',
    prompt,
  ]
}

export function externalCommand(adapterId: 'claude-code' | 'codex', prompt: string, allowWrite: boolean): string[] {
  if (adapterId === 'claude-code') return claudeArgs(prompt, allowWrite)
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    allowWrite ? 'workspace-write' : 'read-only',
    '--',
    prompt,
  ]
}

export function assertExternalWriteAllowed(allowWrite: boolean): void {
  if (!allowWrite) return
  // Phase 0 safety gate: external CLI write mode needs a run-level approval
  // before it may mutate a Worktree. Until that approval path is wired, keep
  // the safe read-only capability and fail closed for writes.
  throw new AppError('POLICY_DENIED', '外部 Agent 写模式在 Phase 0 已禁用（缺少运行级审批）；只读模式仍可用')
}

export class ExternalAgentRunner {
  private readonly active = new Map<string, ActiveExternalRun>()

  constructor(
    private readonly store: SqliteStore,
    private readonly services: CoreServices,
    private readonly logger: Logger,
  ) {}

  async execute(input: ExternalAgentRunInput): Promise<{ runId: string; sessionId: string; adapterId: 'claude-code' | 'codex'; readOnly: boolean }> {
    const project = this.store.read.getProject(input.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    assertExternalWriteAllowed(input.allowWrite)
    const installations = await listExternalAgents()
    const installation = installations.find((item) => item.adapterId === input.adapterId)
    if (!installation?.installed) throw new AppError('CONFLICT', `${input.adapterId} 未安装或不可用`)
    if (input.adapterId === 'codex') {
      // Codex CLI compatibility is implemented against `codex exec --json`; it is not
      // exercised in this environment because the CLI is absent.
    }
    if (!input.allowWrite) {
      // read-only is enforced by Claude's plan permission mode and the read-only tool allowlist.
    }
    let workspaceRoot = project.rootPath
    if (input.planId) {
      const plan = this.store.read.getPlanRevision(input.planId)
      if (!plan || plan.projectId !== project.id) throw new AppError('NOT_FOUND', '计划不存在')
      if (plan.execution?.workspaceRef) workspaceRoot = plan.execution.workspaceRef
    }
    if (input.allowWrite && !input.planId) {
      throw new AppError('CONFLICT', '写模式必须绑定已创建的隔离 Worktree 计划')
    }
    if (input.allowWrite && workspaceRoot === project.rootPath) {
      throw new AppError('CONFLICT', '该计划尚未创建 Worktree，拒绝在主工作区启用写模式')
    }
    const agents = this.services.projects.listAgents(project.id)
    const agent = agents.find((item) => item.agent.role === '开发工程师') ?? agents[0]
    if (!agent) throw new AppError('NOT_FOUND', '缺少可用的 Agent')
    const session = this.services.sessions.create(
      { projectId: project.id, agentId: agent.agent.id, title: `外部 Agent · ${input.adapterId}`.slice(0, 240) },
      SYSTEM_ACTOR,
    )
    const runId = newId('run')
    const timestamp = now()
    const task = input.taskId ? this.store.read.getTask(input.taskId) : null
    if (input.taskId) {
      if (!task || task.projectId !== project.id) throw new AppError('NOT_FOUND', '任务不存在')
      if (task.status === 'done' || task.status === 'cancelled') {
        throw new AppError('CONFLICT', '已完成或已取消的任务不能启动外部 Agent')
      }
      if (this.store.read.getActiveRunForTask(task.id)) {
        throw new AppError('CONFLICT', '该任务已有运行中的 Agent')
      }
      if (task.status === 'running') throw new AppError('CONFLICT', '任务已经在运行，请先核对运行状态')
      const card = this.store.read.getTaskCard(task.id)
      if (!card) throw new AppError('NOT_FOUND', '任务不存在')
      if (card.blockedBy.length > 0) throw new AppError('CONFLICT', '存在未完成的依赖任务，无法启动外部 Agent')
    }
    const lease = task ? this.store.acquireTaskLease(task.id, `run:${runId}`, LEASE_TTL_MS) : null
    let slot: { token: number; expiresAt: number } | null = null
    try {
      slot = this.store.acquireAgentExecutionSlot(agent.agent.id, runId, LEASE_TTL_MS)
    } catch (error) {
      if (lease && task) {
        try { this.store.releaseTaskLease(task.id, `run:${runId}`, lease.token) } catch { /* ignore */ }
      }
      throw error
    }
    const attemptNo = task ? this.store.nextAttemptNo(task.id) : 1
    let toolCallId = ''
    try {
      this.store.transaction(() => {
        this.store.createRun({
          id: runId,
          projectId: project.id,
          taskId: input.taskId ?? null,
          sessionId: session.id,
          agentId: agent.agent.id,
          attempt: attemptNo,
          status: 'running',
          error: null,
          summary: null,
          inputTokens: 0,
          outputTokens: 0,
          checkpointId: null,
          startedAt: timestamp,
          finishedAt: null,
          createdAt: timestamp,
        })
        const toolCall = this.store.createToolCall({
          runId,
          toolName: `external.${input.adapterId}`,
          idempotencyKey: `${runId}:external`,
          status: 'running',
          argsHash: createHash('sha256').update(`${input.adapterId}:${input.prompt}`).digest('hex'),
          args: {
            adapterId: input.adapterId,
            allowWrite: input.allowWrite,
            planId: input.planId ?? null,
            promptChars: input.prompt.length,
            workspaceRoot,
          },
        })
        toolCallId = toolCall.id
        if (task) {
          this.store.createAttempt({
            id: newId('att'),
            taskId: task.id,
            attemptNo,
            agentId: agent.agent.id,
            runId,
            status: 'running',
          })
          let current = task
          if (current.status === 'backlog' || current.status === 'blocked') {
            this.services.tasks.move(
              { taskId: current.id, expectedVersion: current.version, to: 'ready' },
              SYSTEM_ACTOR,
            )
            current = this.store.read.getTask(current.id) ?? current
          }
          if (current.status !== 'running') {
            this.services.tasks.move(
              { taskId: current.id, expectedVersion: current.version, to: 'running' },
              SYSTEM_ACTOR,
            )
          }
        }
        this.store.appendRunStep({
          runId,
          kind: 'context',
          title: '外部 Agent 上下文',
          payload: {
            adapterId: input.adapterId,
            executable: installation.executablePath,
            workspaceRoot,
            readOnly: !input.allowWrite,
            planId: input.planId ?? null,
          },
        })
        this.store.appendEvent(project.id, runId, PROJECT_EVENT_TYPES.runStarted, {
          title: `外部 Agent · ${input.adapterId}`,
          status: 'running',
          runId,
          sessionId: session.id,
          taskId: input.taskId ?? null,
          actorName: installation.name,
        })
      })
    } catch (error) {
      if (lease && task) {
        try { this.store.releaseTaskLease(task.id, `run:${runId}`, lease.token) } catch { /* ignore */ }
      }
      if (slot) {
        try { this.store.releaseAgentExecutionSlot(agent.agent.id, runId, slot.token) } catch { /* ignore */ }
      }
      throw error
    }

    const args = externalCommand(input.adapterId, input.prompt, input.allowWrite)
    const child = crossSpawn(installation.executablePath ?? input.adapterId, args, {
      cwd: workspaceRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: safeEnvironment(),
    })
    this.active.set(runId, {
      child,
      store: this.store,
      runId,
      projectId: project.id,
      taskId: input.taskId ?? null,
      toolCallId,
      lease,
      slot,
      agentId: agent.agent.id,
    })
    let output = ''
    let outputStepId: string | null = null
    let stderr = ''
    const append = (chunk: string): void => {
      if (!chunk) return
      output = `${output}${chunk}`.slice(-200_000)
      if (!outputStepId) {
        const step = this.store.appendRunStep({
          runId,
          kind: 'text',
          title: '外部 Agent 输出',
          status: 'streaming',
          payload: { text: output },
        })
        outputStepId = step.id
      } else {
        this.store.updateRunStep(outputStepId, { payload: { text: output }, status: 'streaming' })
      }
    }
    let buffer = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) {
          try {
            const event = JSON.parse(line) as Record<string, unknown>
            if (event.type === 'assistant') {
              const message = event.message as Record<string, unknown> | undefined
              const content = message?.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  const record = block as Record<string, unknown>
                  if (record.type === 'text' && typeof record.text === 'string') append(`${record.text}\n`)
                }
              }
            } else if (event.type === 'result' && typeof event.result === 'string') {
              append(`${event.result}\n`)
            } else if (event.type === 'system' && typeof event.subtype === 'string') {
              append(`[system] ${event.subtype}\n`)
            }
          } catch {
            append(`${line}\n`)
          }
        }
        index = buffer.indexOf('\n')
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-40_000)
    })

    child.on('error', (error) => {
      this.finish(runId, 'failed', error.message, outputStepId)
    })
    child.on('close', (code) => {
      if (!this.active.has(runId)) return
      if (code === 0) this.finish(runId, 'completed', output.trim().slice(-20_000) || '外部 Agent 完成', outputStepId)
      else this.finish(runId, 'failed', (stderr.trim() || `外部 Agent 退出码 ${code}`).slice(0, 20_000), outputStepId)
    })

    return { runId, sessionId: session.id, adapterId: input.adapterId, readOnly: !input.allowWrite }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.active.get(runId)
    if (!active) throw new AppError('NOT_FOUND', '外部 Agent 运行不存在或已结束')
    try {
      active.child.kill()
    } catch {
      // ignore
    }
    const run = this.store.read.getRun(runId)
    if (run && !['completed', 'failed', 'cancelled'].includes(run.status)) {
      this.store.updateToolCall(active.toolCallId, { status: 'failed', error: '用户取消外部 Agent', finishedAt: now() })
      this.store.updateRun(runId, { status: 'cancelled', error: '用户取消', finishedAt: now() })
      this.store.appendRunStep({ runId, kind: 'status', title: '外部 Agent 已取消' })
      this.store.appendEvent(active.projectId, runId, PROJECT_EVENT_TYPES.runStatusChanged, {
        status: 'cancelled',
        runId,
      })
      this.store.updateTaskAttemptStatus(runId, 'cancelled')
    }
    this.releaseLeaseAndSlot(active)
    this.active.delete(runId)
  }

  private releaseLeaseAndSlot(active: ActiveExternalRun): void {
    if (active.taskId && active.lease) {
      try { this.store.releaseTaskLease(active.taskId, `run:${active.runId}`, active.lease.token) } catch { /* ignore */ }
    }
    if (active.slot) {
      try { this.store.releaseAgentExecutionSlot(active.agentId, active.runId, active.slot.token) } catch { /* ignore */ }
    }
  }

  private finish(runId: string, status: 'completed' | 'failed', summary: string, stepId: string | null): void {
    const active = this.active.get(runId)
    if (!active) return
    this.active.delete(runId)
    if (stepId) this.store.updateRunStep(stepId, { status: status === 'completed' ? 'completed' : 'failed', payload: { text: summary } })
    this.store.updateToolCall(active.toolCallId, {
      status: status === 'completed' ? 'completed' : 'failed',
      result: { summary: summary.slice(0, 20_000) },
      error: status === 'failed' ? summary : null,
      finishedAt: now(),
    })
    this.store.updateRun(runId, {
      status,
      summary,
      error: status === 'failed' ? summary : null,
      finishedAt: now(),
    })
    this.store.updateTaskAttemptStatus(runId, status)
    this.releaseLeaseAndSlot(active)
    this.store.appendRunStep({
      runId,
      kind: 'status',
      title: status === 'completed' ? '外部 Agent 完成' : '外部 Agent 失败',
    })
    this.store.appendEvent(active.projectId, runId, PROJECT_EVENT_TYPES.runStatusChanged, {
      status,
      runId,
      summary,
    })
    if (active.taskId) {
      const task = this.store.read.getTask(active.taskId)
      const target = status === 'completed' ? 'review' : 'blocked'
      if (task && task.status === 'running') {
        try {
          this.services.tasks.move(
            { taskId: task.id, expectedVersion: task.version, to: target },
            SYSTEM_ACTOR,
          )
        } catch (error) {
          this.logger.warn({ err: error, taskId: task.id, target }, 'failed to move external task after finish')
        }
      }
    }
  }
}
