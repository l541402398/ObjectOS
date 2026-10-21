import { AppError, newId, now } from '@projectos/contracts'
import { createHash } from 'node:crypto'
import { join, isAbsolute, relative, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { WorktreeManager } from '@projectos/worktree'
import type { SqliteStore } from '@projectos/persistence'
import { RuntimeExecutionService } from './runtime-executor.js'
import { AcpClient, acpTextFromEvents } from './acp-client.js'

export class RuntimeRunService {
  constructor(
    private readonly store: SqliteStore,
    private readonly executor: RuntimeExecutionService,
    private readonly worktrees = new WorktreeManager(),
  ) {}

  private async runAcp(
    agent: { id: string; name: string; permissions: { files: boolean; shell: boolean; network: boolean } },
    project: { id: string; rootPath: string },
    profile: { id: string; name: string; executable: string | null; args: string[] },
    prompt: string,
    cwd: string,
  ) {
    if (!profile.executable) throw new AppError('BAD_REQUEST', 'ACP Runtime 未配置可执行路径')
    const timestamp = now()
    const sessionId = newId('ses')
    const runId = newId('run')
    this.store.createSession({ id: sessionId, projectId: project.id, agentId: agent.id, title: promptTitle(prompt), status: 'active', createdAt: timestamp, updatedAt: timestamp })
    this.store.appendMessage({ sessionId, role: 'user', content: prompt, runId, metadata: { runtimeProfileId: profile.id, protocol: 'acp' } })
    this.store.createRun({ id: runId, projectId: project.id, taskId: null, sessionId, agentId: agent.id, attempt: 1, status: 'running', error: null, summary: null, inputTokens: 0, outputTokens: 0, checkpointId: null, startedAt: timestamp, finishedAt: null, createdAt: timestamp })
    const toolCall = this.store.createToolCall({
      runId,
      toolName: 'runtime.acp',
      idempotencyKey: `${runId}:runtime.acp`,
      status: 'running',
      argsHash: createHash('sha256').update(`${profile.id}:${prompt}`).digest('hex'),
      args: { profileId: profile.id, protocol: 'acp', promptChars: prompt.length, cwd },
    })
    this.store.appendEvent(project.id, runId, 'run.started', { agentId: agent.id, runtimeProfileId: profile.id, protocol: 'acp' })
    const client = new AcpClient(profile.executable, profile.args, cwd)
    const rawEvents: unknown[] = []
    const off = client.onEvent((message) => rawEvents.push(message))
    const startedAt = Date.now()
    try {
      const session = await client.initialize(cwd)
      const result = await client.prompt(session.sessionId, prompt)
      const output = acpTextFromEvents(rawEvents) || 'Runtime 执行完成（ACP 未返回文本内容）'
      this.store.appendMessage({ sessionId, role: 'assistant', content: output.slice(0, 80_000), runId, metadata: { runtimeProfileId: profile.id, protocol: 'acp', acpSessionId: session.sessionId, events: rawEvents.length, result } })
      this.store.updateToolCall(toolCall.id, { status: 'completed', result: { output: output.slice(0, 20_000) }, finishedAt: now() })
      this.store.updateRun(runId, { status: 'completed', error: null, summary: output.slice(0, 20_000), finishedAt: now() })
      this.store.appendEvent(project.id, runId, 'run.completed', { agentId: agent.id, runtimeProfileId: profile.id, protocol: 'acp', events: rawEvents.length })
      return {
        sessionId, runId, profileId: profile.id, executionId: 'acp-' + runId, status: 'completed' as const,
        output, events: rawEvents.map((event) => ({ type: 'acp.session.update', text: JSON.stringify(event).slice(0, 4000) })),
        durationMs: Date.now() - startedAt, workspaceRef: null,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.updateToolCall(toolCall.id, { status: 'failed', error: message.slice(0, 8000), finishedAt: now() })
      this.store.appendMessage({ sessionId, role: 'assistant', content: message, runId, metadata: { runtimeProfileId: profile.id, protocol: 'acp', failed: true } })
      this.store.updateRun(runId, { status: 'failed', error: message.slice(0, 8000), summary: null, finishedAt: now() })
      this.store.appendEvent(project.id, runId, 'run.failed', { agentId: agent.id, runtimeProfileId: profile.id, protocol: 'acp', error: message.slice(0, 2000) })
      throw error
    } finally {
      off()
      client.dispose()
    }
  }

  async run(input: { agentId: string; projectId: string; prompt: string; cwd?: string }) {
    const agent = this.store.read.getAgentDefinition(input.agentId)
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')
    const project = this.store.read.getProject(input.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const cwd = resolve(input.cwd ?? project.rootPath)
    const rel = relative(project.rootPath, cwd)
    if (rel.startsWith('..') || isAbsolute(rel)) throw new AppError('WORKSPACE_OUTSIDE_ROOT', 'Runtime 工作目录必须位于项目根目录内')
    if (profileRequiresShell(agent, this.store.read.listRuntimeProfiles())) {
      throw new AppError('APPROVAL_REQUIRED', '该 Runtime 需要 Shell 权限，请先在 Agent 权限中启用 Shell')
    }
    const budget = this.store.read.getProjectBudget(input.projectId)
    if (budget && budget.softLimit > 0) {
      const spent = this.store.read.summarizeAIUsage(input.projectId).estimatedCost
      if (spent > budget.softLimit) throw new AppError('BUDGET_EXCEEDED', '项目已超过软预算，Runtime 执行被拒绝')
    }
    const profiles = this.store.read.listRuntimeProfiles()
    const profileId = agent.primaryRuntimeProfileId ?? agent.runtimeProfileIds[0]
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) throw new AppError('BAD_REQUEST', 'Agent 未绑定 Runtime')
    if (profile.protocol === 'acp') return this.runAcp(agent, project, profile, input.prompt, cwd)
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
    const toolCall = this.store.createToolCall({
      runId,
      toolName: 'runtime.execute',
      idempotencyKey: `${runId}:runtime.execute`,
      status: 'running',
      argsHash: createHash('sha256').update(`${profile.id}:${input.prompt}`).digest('hex'),
      args: { profileId: profile.id, protocol: profile.protocol, promptChars: input.prompt.length, cwd },
    })
    let workspaceRef: string | null = null
    let executionCwd = cwd
    if (profile.capabilities.worktree && existsSync(join(project.rootPath, '.git'))) {
      const worktreePath = join(project.rootPath, '.projectos', 'runtime-worktrees', runId)
      const worktree = await this.worktrees.create(project.rootPath, worktreePath, 'projectos/runtime-' + runId)
      workspaceRef = worktree.path
      executionCwd = worktree.path
    }
    let result: Awaited<ReturnType<RuntimeExecutionService['execute']>>
    try {
      result = await this.executor.execute(profile.id, input.prompt, executionCwd)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.updateToolCall(toolCall.id, { status: 'failed', error: message.slice(0, 8000), finishedAt: now() })
      this.store.updateRun(runId, { status: 'failed', error: message.slice(0, 8000), finishedAt: now() })
      this.store.appendEvent(input.projectId, runId, 'run.failed', { agentId: agent.id, runtimeProfileId: profile.id, error: message.slice(0, 2000) })
      throw error
    }
    result.output = redact(result.output)
    result.events = result.events.map((event) => ({ ...event, text: redact(event.text) }))
    const status = result.status === 'completed' ? 'completed' : 'failed'
    this.store.updateToolCall(toolCall.id, {
      status: status === 'completed' ? 'completed' : 'failed',
      result: { output: result.output.slice(0, 20_000) },
      error: status === 'completed' ? null : result.output.slice(-8000),
      finishedAt: now(),
    })
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
    return { sessionId, runId, profileId: profile.id, ...result, workspaceRef }
  }
}

function profileRequiresShell(agent: { permissions: { shell: boolean }; runtimeProfileIds: string[] }, profiles: Array<{ id: string; protocol: string }>): boolean {
  if (agent.permissions.shell) return false
  return profiles.some((profile) => agent.runtimeProfileIds.includes(profile.id) && profile.protocol === 'cli')
}

function redact(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, 'sk-***')
    .replace(/Bearer\\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
    .replace(/(api[_-]?key\\s*[=:]\\s*)[^\\s]+/gi, '***')
}

function promptTitle(prompt: string): string {
  const first = prompt.trim().split(/\r?\n/)[0] ?? 'Runtime run'
  return first.slice(0, 120)
}







