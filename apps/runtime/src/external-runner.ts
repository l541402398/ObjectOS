import crossSpawn from 'cross-spawn'
import { AppError, newId, now, type ExternalAgentRunInput } from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import type { CoreServices } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import type { Logger } from './logger.js'
import { listExternalAgents } from './external-agents.js'

const SYSTEM_ACTOR = { kind: 'system' as const, id: 'external-agent', name: '外部 Agent' }

interface ActiveExternalRun {
  child: ReturnType<typeof crossSpawn>
  store: SqliteStore
  runId: string
  projectId: string
  taskId: string | null
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
    this.store.transaction(() => {
      this.store.createRun({
        id: runId,
        projectId: project.id,
        taskId: input.taskId ?? null,
        sessionId: session.id,
        agentId: agent.agent.id,
        attempt: input.taskId ? this.store.nextAttemptNo(input.taskId) : 1,
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
    if (input.taskId) {
      const task = this.store.read.getTask(input.taskId)
      if (task && task.projectId === project.id && task.status === 'backlog') {
        try {
          this.services.tasks.move(
            { taskId: task.id, expectedVersion: task.version, to: 'ready' },
            SYSTEM_ACTOR,
          )
        } catch (error) {
          this.logger.warn({ err: error, taskId: task.id }, 'failed to ready external task')
        }
      }
    }

    const args = externalCommand(input.adapterId, input.prompt, input.allowWrite)
    const child = crossSpawn(installation.executablePath ?? input.adapterId, args, {
      cwd: workspaceRoot,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    this.active.set(runId, { child, store: this.store, runId, projectId: project.id, taskId: input.taskId ?? null })
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
      this.store.updateRun(runId, { status: 'cancelled', error: '用户取消', finishedAt: now() })
      this.store.appendRunStep({ runId, kind: 'status', title: '外部 Agent 已取消' })
      this.store.appendEvent(active.projectId, runId, PROJECT_EVENT_TYPES.runStatusChanged, {
        status: 'cancelled',
        runId,
      })
    }
    this.active.delete(runId)
  }

  private finish(runId: string, status: 'completed' | 'failed', summary: string, stepId: string | null): void {
    const active = this.active.get(runId)
    if (!active) return
    this.active.delete(runId)
    if (stepId) this.store.updateRunStep(stepId, { status: status === 'completed' ? 'completed' : 'failed', payload: { text: summary } })
    this.store.updateRun(runId, {
      status,
      summary,
      error: status === 'failed' ? summary : null,
      finishedAt: now(),
    })
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
    if (status === 'completed' && active.taskId) {
      const task = this.store.read.getTask(active.taskId)
      if (task && task.status === 'running') {
        try {
          this.services.tasks.move(
            { taskId: task.id, expectedVersion: task.version, to: 'review' },
            SYSTEM_ACTOR,
          )
        } catch (error) {
          this.logger.warn({ err: error, taskId: task.id }, 'failed to move external task to review')
        }
      }
    }
  }
}
