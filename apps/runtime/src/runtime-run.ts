import { AppError, newId, now } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import { RuntimeExecutionService } from './runtime-executor.js'

export class RuntimeRunService {
  constructor(
    private readonly store: SqliteStore,
    private readonly executor: RuntimeExecutionService,
  ) {}

  async run(input: { agentId: string; projectId: string; prompt: string; cwd?: string }) {
    const agent = this.store.read.getAgentDefinition(input.agentId)
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')
    if (!this.store.read.getProject(input.projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    const profiles = this.store.read.listRuntimeProfiles()
    const profileId = agent.primaryRuntimeProfileId ?? agent.runtimeProfileIds[0]
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) throw new AppError('BAD_REQUEST', 'Agent 未绑定 Runtime')
    if (profile.protocol === 'native') throw new AppError('BAD_REQUEST', 'Native Runtime 走内置 AgentRunner，请使用 Agent 工作台')
    const timestamp = now()
    const sessionId = newId('ses')
    const runId = newId('run')
    this.store.createSession({
      id: sessionId, projectId: input.projectId, agentId: agent.id,
      title: promptTitle(input.prompt), status: 'active', createdAt: timestamp, updatedAt: timestamp,
    })
    this.store.appendMessage({ sessionId, role: 'user', content: input.prompt, runId, metadata: { runtimeProfileId: profile.id } })
    this.store.createRun({
      id: runId, projectId: input.projectId, taskId: null, sessionId, agentId: agent.id,
      attempt: 1, status: 'running', error: null, summary: null, inputTokens: 0, outputTokens: 0,
      checkpointId: null, startedAt: timestamp, finishedAt: null, createdAt: timestamp,
    })
    this.store.appendEvent(input.projectId, runId, 'run.started', { agentId: agent.id, runtimeProfileId: profile.id, profile: profile.name })
    const result = await this.executor.execute(profile.id, input.prompt, input.cwd)
    const status = result.status === 'completed' ? 'completed' : 'failed'
    this.store.appendMessage({
      sessionId, role: 'assistant', content: result.output.slice(0, 80_000), runId,
      metadata: { runtimeProfileId: profile.id, executionId: result.executionId, events: result.events.length },
    })
    this.store.updateRun(runId, {
      status, error: status === 'failed' ? result.output.slice(-8000) : null,
      summary: result.output.slice(0, 20_000), finishedAt: now(),
    })
    this.store.appendEvent(input.projectId, runId, status === 'completed' ? 'run.completed' : 'run.failed', {
      agentId: agent.id, runtimeProfileId: profile.id, executionStatus: result.status, durationMs: result.durationMs,
    })
    return { sessionId, runId, profileId: profile.id, ...result }
  }
}

function promptTitle(prompt: string): string {
  const first = prompt.trim().split(/\r?\n/)[0] ?? 'Runtime run'
  return first.slice(0, 120)
}
