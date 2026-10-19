import { createHash } from 'node:crypto'
import {
  AppError,
  TASK_STATUSES,
  type Approval,
  type Artifact,
  type Run,
  type RunStatus,
  type Task,
  type TaskStatus,
  type ToolCall,
  newId,
  now,
} from '@projectos/contracts'
import {
  PROJECT_EVENT_TYPES,
  assertRunTransition,
} from '@projectos/domain'
import type { CoreServices } from '@projectos/application'
import { runAgentLoop, type AgentLoopResult, type ToolInvocation, type ToolOutcome } from '@projectos/agent-runtime'
import { buildContext } from '@projectos/context-engine'
import type { ChatMessage, LlmProvider, LlmToolDefinition, ToolCallRequest } from '@projectos/provider-interfaces'
import { formatSessionHistory } from '@projectos/session-manager'
import { selectSkills } from '@projectos/skills'
import {
  evaluateToolPolicy,
  redactObject,
  redactSecrets,
} from '@projectos/policy'
import { getToolDefinition, toolCatalogForAgent, toolCatalogPrompt } from '@projectos/tools'
import {
  getGitDiff,
  getGitStatus,
  listProjectAgentsFile,
  readTextFile,
  readWorkspaceTree,
  runApprovedCommand,
  writeTextFile,
} from '@projectos/workspace'
import type { SqliteStore } from '@projectos/persistence'
import type { RuntimeConfig } from './config.js'
import type { ProviderManager } from './provider-manager.js'
import type { RuntimeEventHub } from './events.js'
import type { Logger } from './logger.js'

export interface StartRunInput {
  projectId: string
  sessionId: string
  taskId?: string | null
  prompt: string
  actorName?: string
  messageId?: string
  inboxId?: string
  workspaceRoot?: string
}

export interface StartRunResult {
  runId: string
  messageId: string
}

interface ActiveRun {
  runId: string
  projectId: string
  sessionId: string
  agentId: string
  taskId: string | null
  workspaceRoot: string
  provider: LlmProvider
  connectionId: string | null
  modelId: string | null
  abort: AbortController
  lease: { token: number; expiresAt: number } | null
  attemptNo: number
  inboxId: string | null
  promptMessageId: string
  busy: boolean
  checkpointSeq: number
  inputTokens: number
  outputTokens: number
  lastAssistantText: string
  textStepId: string | null
  textBuffer: string
  lastTextFlushAt: number
  pendingApprovalId: string | null
  leaseTimer: NodeJS.Timeout | null
  startedAt: number
}

export class AgentRunner {  private readonly active = new Map<string, ActiveRun>()
  private readonly sessionIndex = new Map<string, string>()
  private aiConnections: import('./ai-connections.js').AIConnectionService | null = null

  constructor(
    private readonly config: RuntimeConfig,
    private readonly store: SqliteStore,
    private readonly services: CoreServices,
    private readonly provider: ProviderManager,
    private readonly hub: RuntimeEventHub,
    private readonly logger: Logger,
  ) {}

  setAIConnections(service: import('./ai-connections.js').AIConnectionService): void {
    this.aiConnections = service
  }

  isSessionBusy(sessionId: string): boolean {
    return this.sessionIndex.has(sessionId)
  }

  activeRunId(sessionId: string): string | null {
    return this.sessionIndex.get(sessionId) ?? null
  }

  async startRun(input: StartRunInput): Promise<StartRunResult> {
    const project = this.store.read.getProject(input.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const session = this.store.read.getSession(input.sessionId)
    if (!session || session.projectId !== project.id) throw new AppError('NOT_FOUND', '会话不存在')
    if (session.status === 'archived') throw new AppError('CONFLICT', '会话已归档')
    if (this.sessionIndex.has(session.id) || this.store.read.getActiveRunForSession(session.id)) {
      throw new AppError('CONFLICT', '该会话已有运行中的 Agent，请等待完成或取消')
    }
    const agent = this.store.read.getAgent(session.agentId)
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')
    let task: Task | null = null
    if (input.taskId) {
      task = this.store.read.getTask(input.taskId)
      if (!task || task.projectId !== project.id) throw new AppError('NOT_FOUND', '任务不存在')
      if (task.status === 'done' || task.status === 'cancelled') {
        throw new AppError('CONFLICT', '已完成或已取消的任务不能重新启动 Agent 运行')
      }
    }
    if (!input.messageId) {
      const message = this.store.appendMessage({
        sessionId: session.id,
        role: 'user',
        content: input.prompt,
        metadata: task ? { taskId: task.id } : {},
      })
      input.messageId = message.id
    }
    const promptMessage = this.store.getMessageById(input.messageId)
    if (!promptMessage) throw new AppError('NOT_FOUND', '触发消息不存在')
    const routed = this.aiConnections?.resolveForRun({
      projectId: project.id,
      agentId: agent.id,
      agentRole: agent.role,
      taskId: task?.id ?? null,
    }) ?? null
    const provider = this.provider.createProvider(routed?.connectionId, routed?.modelId)
    const timestamp = now()
    const runId = newId('run')
    const attemptNo = task ? this.store.nextAttemptNo(task.id) : 1
    let createdRun: Run | null = null
    this.store.transaction(() => {
      const run: Run = {
        id: runId,
        projectId: project.id,
        taskId: task?.id ?? null,
        sessionId: session.id,
        agentId: agent.id,
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
      }
      this.store.createRun(run)
      this.store.appendRunStep({
        runId,
        kind: 'status',
        title: '运行开始',
        payload: { status: 'running', sessionId: session.id, agentId: agent.id, taskId: task?.id ?? null },
      })
      this.store.appendRunStep({
        runId,
        kind: 'context',
        title: '上下文快照',
        payload: {
          promptMessageId: input.messageId,
          inboxId: input.inboxId ?? null,
          workspaceRoot: input.workspaceRoot ?? project.rootPath,
        },
      })
      if (task) {
        this.store.createAttempt({
          id: newId('att'),
          taskId: task.id,
          attemptNo,
          agentId: agent.id,
          runId,
          status: 'running',
        })
        let current = task
        if (current.assigneeAgentId !== agent.id) {
          current = this.store.updateTask(current.id, current.version, { assigneeAgentId: agent.id })
        }
        if (current.status === 'blocked') {
          current = this.store.moveTask(current.id, current.version, 'ready')
        }
        if (current.status === 'backlog') {
          current = this.store.moveTask(current.id, current.version, 'ready')
        }
        if (current.status !== 'running') {
          current = this.store.moveTask(current.id, current.version, 'running')
        }
      }
      this.store.appendEvent(project.id, runId, PROJECT_EVENT_TYPES.runStarted, {
        title: task?.title ?? session.title,
        status: 'running',
        runId,
        sessionId: session.id,
        taskId: task?.id ?? null,
        actorName: agent.name,
      })
      createdRun = run
    })
    if (!createdRun) throw new AppError('INTERNAL', '运行创建失败')
    let lease: { token: number; expiresAt: number } | null = null
    if (task) {
      try {
        lease = this.store.acquireTaskLease(task.id, `run:${runId}`, 30 * 60 * 1000)
      } catch (error) {
        this.store.updateRun(runId, {
          status: 'failed',
          error: error instanceof Error ? error.message : '无法获取任务租约',
          finishedAt: now(),
        })
        throw error
      }
    }
    const state: ActiveRun = {
      runId,
      projectId: project.id,
      sessionId: session.id,
      agentId: agent.id,
      taskId: task?.id ?? null,
      workspaceRoot: input.workspaceRoot ?? project.rootPath,
      provider,
      connectionId: routed?.connectionId ?? null,
      modelId: routed?.modelId ?? null,
      abort: new AbortController(),
      lease,
      attemptNo,
      inboxId: input.inboxId ?? null,
      promptMessageId: promptMessage.id,
      busy: false,
      checkpointSeq: 0,
      inputTokens: 0,
      outputTokens: 0,
      lastAssistantText: '',
      textStepId: null,
      textBuffer: '',
      lastTextFlushAt: 0,
      pendingApprovalId: null,
      leaseTimer: null,
      startedAt: timestamp,
    }
    this.active.set(runId, state)
    this.sessionIndex.set(session.id, runId)
    if (lease && task) {
      state.leaseTimer = setInterval(() => {
        try {
          this.store.renewTaskLease(task.id, `run:${runId}`, lease!.token, 30 * 60 * 1000)
          lease!.expiresAt = now() + 30 * 60 * 1000
        } catch (error) {
          this.logger.warn({ err: error, runId }, 'lost task lease')
        }
      }, 120_000)
      state.leaseTimer.unref?.()
    }
    if (input.inboxId) {
      try {
        this.store.updateInboxStatus(input.inboxId, 'accepted')
      } catch (error) {
        this.logger.warn({ err: error, inboxId: input.inboxId }, 'failed to mark inbox accepted')
      }
    }
    void this.execute(state).catch((error) => {
      this.logger.error({ err: error, runId }, 'agent run crashed')
      void this.failRun(state, error instanceof Error ? error.message : String(error)).catch((nested) => {
        this.logger.error({ err: nested, runId }, 'failed to finalize crashed run')
      })
    })
    return { runId, messageId: promptMessage.id }
  }

  private async buildMessages(state: ActiveRun, resume: boolean): Promise<{ messages: ChatMessage[]; tools: LlmToolDefinition[]; system: string }> {
    const run = this.store.read.getRun(state.runId)
    if (!run) throw new AppError('NOT_FOUND', '运行不存在')
    const project = this.store.read.getProject(state.projectId)
    const session = this.store.read.getSession(state.sessionId)
    if (!project || !session) throw new AppError('NOT_FOUND', '项目或会话不存在')
    const task = state.taskId ? this.store.read.getTask(state.taskId) : null
    const agent = this.store.read.getAgent(state.agentId)
    if (!agent) throw new AppError('NOT_FOUND', 'Agent 不存在')
    const requirements = this.store.read.listRequirements(project.id)
    const decisions = this.store.read.listDecisions(project.id)
    const artifacts = this.store.read.listArtifacts(project.id, task?.id ?? null)
    const knowledge = this.store.read.listKnowledge(project.id)
    const agentsFile = listProjectAgentsFile(project.rootPath)
    const skills = selectSkills({ task, agent }).map((selection) => ({
      id: selection.skill.id,
      name: selection.skill.name,
      description: selection.skill.description,
      prompt: selection.skill.prompt,
    }))
    const handoffs = this.store.read.listHandoffViews(project.id)
    const handoff = task
      ? handoffs.find((entry) => entry.taskId === task.id && entry.status === 'accepted')
      : undefined
    const context = buildContext({
      project,
      task,
      agent,
      requirements,
      decisions,
      artifacts: task ? artifacts : artifacts.slice(0, 8),
      knowledge,
      agentsFile,
      skills,
      handoffSummary: handoff?.summary ?? null,
    })
    const tools = toolCatalogForAgent(agent.capabilities)
    const system = `${context.system}\n\n## 可用工具\n${toolCatalogPrompt(agent.capabilities)}\n`
    if (!resume) {
      this.store.appendRunStep({
        runId: run.id,
        kind: 'context',
        title: '上下文组装完成',
        payload: {
          chars: context.chars,
          truncated: context.truncated,
          sources: context.sources,
          skillIds: skills.map((skill) => skill.id),
        },
      })
      this.store.appendRunStep({
        runId: run.id,
        kind: 'context',
        title: '触发消息',
        payload: { promptMessageId: state.promptMessageId },
      })
    }
    const allMessages = this.store.read.getMessages(session.id, 400)
    const promptIndex = allMessages.findIndex((message) => message.id === state.promptMessageId)
    const prior = promptIndex >= 0 ? allMessages.slice(0, promptIndex + 1) : allMessages.filter((message) => message.createdAt <= run.createdAt)
    const history = formatSessionHistory(prior, 30).map((message) => ({
      role: message.role,
      content: message.content,
    })) as ChatMessage[]
    if (history.length === 0) {
      const prompt = this.store.getMessageById(state.promptMessageId)
      history.push({ role: 'user', content: prompt?.content ?? '请开始执行当前任务。' })
    }
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history]
    const steps = this.store.read.getRunSteps(run.id)
    const hasPersistedTurns = steps.some(
      (step) =>
        (step.kind === 'text' && step.payload.final === true) ||
        step.kind === 'tool_result',
    )
    if (resume || run.status === 'waiting_approval' || hasPersistedTurns) {
      messages.push(...this.reconstructTranscript(run.id))
    }
    return { messages, tools, system }
  }

  private reconstructTranscript(runId: string): ChatMessage[] {
    const steps = this.store.read.getRunSteps(runId)
    const messages: ChatMessage[] = []
    for (const step of steps) {
      if (step.kind === 'text' && step.payload.final === true) {
        const content = typeof step.payload.content === 'string' ? step.payload.content : ''
        const rawCalls = Array.isArray(step.payload.toolCalls) ? step.payload.toolCalls : []
        const toolCalls: ToolCallRequest[] = rawCalls
          .filter((call): call is Record<string, unknown> => Boolean(call) && typeof call === 'object')
          .map((call) => ({
            id: String(call.id ?? ''),
            name: String(call.name ?? ''),
            arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.args ?? {}),
          }))
          .filter((call) => call.id && call.name)
        messages.push({
          role: 'assistant',
          content,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        })
      } else if (step.kind === 'tool_result') {
        const callId = typeof step.payload.callId === 'string' ? step.payload.callId : ''
        const content = typeof step.payload.content === 'string' ? step.payload.content : ''
        if (callId) messages.push({ role: 'tool', toolCallId: callId, content })
      }
    }
    return messages
  }

  private async execute(state: ActiveRun): Promise<void> {
    if (state.busy) return
    state.busy = true
    try {
      const built = await this.buildMessages(state, this.store.read.getRun(state.runId)?.status === 'waiting_approval')
      const result = await runAgentLoop({
        provider: state.provider,
        tools: built.tools,
        messages: built.messages,
        signal: state.abort.signal,
        maxSteps: 8,
        onTextDelta: (text) => this.onTextDelta(state, text),
        onAssistantTurn: (turn) => this.onAssistantTurn(state, turn),
        onToolResult: (invocation, outcome) => this.onToolResult(state, invocation, outcome),
        onUsage: (usage) => {
          state.inputTokens += usage.inputTokens ?? 0
          state.outputTokens += usage.outputTokens ?? 0
        },
        executeTool: (invocation) => this.executeTool(state, invocation),
      })
      await this.applyLoopResult(state, result)
    } finally {
      state.busy = false
    }
  }

  private async applyLoopResult(state: ActiveRun, result: AgentLoopResult): Promise<void> {
    state.inputTokens = Math.max(state.inputTokens, result.inputTokens ?? 0)
    state.outputTokens = Math.max(state.outputTokens, result.outputTokens ?? 0)
    if (result.status === 'waiting_approval') {
      state.pendingApprovalId = result.approvalId ?? null
      this.store.updateRun(state.runId, {
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
      })
      return
    }
    if (result.status === 'completed') {
      const summary = (state.lastAssistantText || result.text || 'Agent 完成了本轮执行。').trim().slice(0, 20_000)
      this.transitionRun(state, 'verifying', { summary, inputTokens: state.inputTokens, outputTokens: state.outputTokens })
      this.store.appendRunStep({
        runId: state.runId,
        kind: 'status',
        title: '执行完成',
        payload: { summary, steps: result.steps },
      })
      this.transitionRun(state, 'completed', {
        summary,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        finishedAt: now(),
      })
      this.tryMoveTask(state.taskId, 'review')
      if (state.inboxId) {
        try {
          this.store.updateInboxStatus(state.inboxId, 'completed')
        } catch (error) {
          this.logger.warn({ err: error }, 'failed to complete inbox')
        }
      }
      this.cleanup(state, 'completed')
      return
    }
    if (result.status === 'cancelled') {
      this.store.appendRunStep({
        runId: state.runId,
        kind: 'status',
        title: '运行已取消',
        payload: {},
      })
      this.transitionRun(state, 'cancelled', {
        error: '用户取消了运行',
        finishedAt: now(),
      })
      this.tryMoveTask(state.taskId, 'ready')
      if (state.inboxId) {
        try {
          this.store.updateInboxStatus(state.inboxId, 'failed', { error: '运行已取消' })
        } catch {
          // ignore
        }
      }
      this.store.updateTaskAttemptStatus(state.runId, 'cancelled')
      this.cleanup(state, 'cancelled')
      return
    }
    await this.failRun(state, result.error ?? 'Agent 运行失败')
  }

  private async failRun(state: ActiveRun, message: string): Promise<void> {
    const error = redactSecrets(message).slice(0, 8000)
    this.store.appendRunStep({
      runId: state.runId,
      kind: 'error',
      title: '运行失败',
      payload: { error },
    })
    this.store.updateRun(state.runId, {
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
    })
    this.transitionRun(state, 'failed', {
      error,
      finishedAt: now(),
      inputTokens: state.inputTokens,
      outputTokens: state.outputTokens,
    })
    this.tryMoveTask(state.taskId, 'blocked', `Agent 运行失败：${error}`)
    if (state.inboxId) {
      try {
        this.store.updateInboxStatus(state.inboxId, 'failed', { error })
      } catch {
        // ignore
      }
    }
    this.store.updateTaskAttemptStatus(state.runId, 'failed')
    this.cleanup(state, 'failed')
  }

  private cleanup(state: ActiveRun, status: RunStatus): void {
    const price =
      state.connectionId && state.modelId
        ? this.store.read.getAIModelPrice(state.connectionId, state.modelId)
        : null
    const estimatedCost = price
      ? (state.inputTokens / 1_000_000) * price.inputPerMillion +
        (state.outputTokens / 1_000_000) * price.outputPerMillion
      : null
    try {
      this.store.recordAIUsage({
        id: newId('usg'),
        runId: state.runId,
        connectionId: state.connectionId,
        modelId: state.modelId,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        usageSource: state.inputTokens || state.outputTokens ? 'provider' : 'unknown',
        estimatedCost,
        currency: price?.currency ?? null,
        createdAt: now(),
      })
    } catch (error) {
      this.logger.warn({ err: error, runId: state.runId }, 'failed to record AI usage')
    }
    if (state.leaseTimer) clearInterval(state.leaseTimer)
    if (state.lease && state.taskId) {
      try {
        this.store.releaseTaskLease(state.taskId, `run:${state.runId}`, state.lease.token)
      } catch (error) {
        this.logger.warn({ err: error }, 'failed to release lease')
      }
    }
    this.active.delete(state.runId)
    this.sessionIndex.delete(state.sessionId)
    this.logger.info({ runId: state.runId, status }, 'agent run finished')
  }

  private transitionRun(
    state: ActiveRun,
    status: RunStatus,
    patch: {
      error?: string | null
      summary?: string | null
      inputTokens?: number
      outputTokens?: number
      finishedAt?: number | null
    } = {},
  ): void {
    const run = this.store.read.getRun(state.runId)
    if (!run) return
    if (run.status === status) return
    assertRunTransition(run.status, status)
    this.store.updateRun(state.runId, { status, ...patch })
    this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.runStatusChanged, {
      status,
      runId: state.runId,
      sessionId: state.sessionId,
      taskId: state.taskId,
      actorName: this.store.read.getAgent(state.agentId)?.name ?? 'Agent',
    })
    this.store.appendRunStep({
      runId: state.runId,
      kind: 'status',
      title: `状态：${status}`,
      payload: { status },
    })
  }

  private async onTextDelta(state: ActiveRun, text: string): Promise<void> {
    state.textBuffer += text
    const timestamp = now()
    if (!state.textStepId) {
      const step = this.store.appendRunStep({
        runId: state.runId,
        kind: 'text',
        status: 'streaming',
        title: 'Agent 输出',
        payload: { content: state.textBuffer, final: false },
      })
      state.textStepId = step.id
      this.hub.publish({
        type: 'run.step',
        projectId: state.projectId,
        runId: state.runId,
        stepId: step.id,
        kind: 'text',
      })
      state.lastTextFlushAt = timestamp
    } else if (timestamp - state.lastTextFlushAt > 250) {
      this.store.updateRunStep(state.textStepId, {
        payload: { content: state.textBuffer, final: false },
      })
      state.lastTextFlushAt = timestamp
    }
    this.hub.publish({
      type: 'run.delta',
      projectId: state.projectId,
      runId: state.runId,
      sessionId: state.sessionId,
      text,
      stepSeq: 0,
    })
  }

  private async onAssistantTurn(
    state: ActiveRun,
    turn: { content: string; toolCalls: ToolCallRequest[] },
  ): Promise<void> {
    const payload = {
      content: turn.content,
      toolCalls: turn.toolCalls,
      final: true,
      role: 'assistant',
    }
    if (state.textStepId) {
      this.store.updateRunStep(state.textStepId, { payload, status: 'completed' })
      this.hub.publish({
        type: 'run.step',
        projectId: state.projectId,
        runId: state.runId,
        stepId: state.textStepId,
        kind: 'text',
      })
    } else if (turn.content.trim() || turn.toolCalls.length > 0) {
      const step = this.store.appendRunStep({
        runId: state.runId,
        kind: 'text',
        title: 'Agent 输出',
        payload,
      })
      this.hub.publish({
        type: 'run.step',
        projectId: state.projectId,
        runId: state.runId,
        stepId: step.id,
        kind: 'text',
      })
    }
    state.textStepId = null
    state.textBuffer = ''
    if (turn.content.trim()) {
      state.lastAssistantText = turn.content.trim()
      this.store.appendMessage({
        sessionId: state.sessionId,
        role: 'assistant',
        content: turn.content,
        runId: state.runId,
        metadata: { agentId: state.agentId },
      })
    }
    state.checkpointSeq += 1
    const checkpointId = newId('ckp')
    try {
      this.store.createCheckpoint({
        id: checkpointId,
        runId: state.runId,
        seq: state.checkpointSeq,
        schemaVersion: 1,
        state: {
          status: 'running',
          turn: state.checkpointSeq,
          provider: state.provider.id,
          sessionId: state.sessionId,
          taskId: state.taskId,
        },
      })
      this.store.updateRun(state.runId, {
        checkpointId,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
      })
    } catch (error) {
      this.logger.warn({ err: error, runId: state.runId }, 'failed to write checkpoint')
    }
  }

  private async onToolResult(state: ActiveRun, invocation: ToolInvocation, outcome: ToolOutcome): Promise<void> {
    if (outcome.status === 'paused') return
    const ok = outcome.status === 'completed'
    const content = ok
      ? JSON.stringify(outcome.result ?? null).slice(0, 60_000)
      : JSON.stringify({ ok: false, error: outcome.error }).slice(0, 60_000)
    const step = this.store.appendRunStep({
      runId: state.runId,
      kind: 'tool_result',
      title: `工具结果：${invocation.name}`,
      payload: {
        callId: invocation.callId,
        name: invocation.name,
        ok,
        content,
      },
    })
    this.hub.publish({
      type: 'run.step',
      projectId: state.projectId,
      runId: state.runId,
      stepId: step.id,
      kind: 'tool_result',
    })
  }

  private async executeTool(state: ActiveRun, invocation: ToolInvocation): Promise<ToolOutcome> {
    const definition = getToolDefinition(invocation.name)
    const project = this.store.read.getProject(state.projectId)
    if (!definition || !project) {
      return { status: 'denied', error: `未知工具：${invocation.name}` }
    }
    const policy = evaluateToolPolicy({
      rootPath: state.workspaceRoot,
      toolName: invocation.name,
      args: invocation.args,
    })
    const idempotencyKey = `${state.runId}:${invocation.callId}`
    let toolCall: ToolCall
    try {
      toolCall = this.store.createToolCall({
        runId: state.runId,
        toolName: invocation.name,
        idempotencyKey,
        status: 'proposed',
        argsHash: hashArgs(invocation.args),
        args: invocation.args,
      })
    } catch (error) {
      return { status: 'failed', error: error instanceof Error ? error.message : '工具调用记录失败' }
    }
    this.store.appendRunStep({
      runId: state.runId,
      kind: 'tool_request',
      title: `工具请求：${invocation.name}`,
      payload: {
        toolCallId: toolCall.id,
        callId: invocation.callId,
        name: invocation.name,
        args: redactObject(invocation.args),
        risk: policy.risk,
        policy: policy.decision,
      },
    })
    if (policy.decision === 'deny') {
      this.store.updateToolCall(toolCall.id, { status: 'denied', error: policy.reason })
      this.store.appendRunStep({
        runId: state.runId,
        kind: 'tool_result',
        title: `工具被拒绝：${invocation.name}`,
        payload: { callId: invocation.callId, name: invocation.name, ok: false, content: JSON.stringify({ error: policy.reason }) },
      })
      this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.toolFailed, {
        runId: state.runId,
        toolName: invocation.name,
        error: policy.reason,
      })
      return { status: 'denied', error: policy.reason }
    }
    if (policy.decision === 'require_approval') {
      this.store.updateToolCall(toolCall.id, { status: 'waiting_approval' })
      const approval = this.store.createApproval({
        projectId: state.projectId,
        runId: state.runId,
        toolCallId: toolCall.id,
        title: `授权 ${invocation.name}`,
        detail: approvalDetail(invocation),
        request: {
          toolName: invocation.name,
          args: redactObject(invocation.args),
          risk: policy.risk,
          reason: policy.reason,
        },
        expiresAt: now() + 30 * 60 * 1000,
      })
      state.pendingApprovalId = approval.id
      this.transitionRun(state, 'waiting_approval')
      this.store.appendRunStep({
        runId: state.runId,
        kind: 'approval',
        title: `等待授权：${invocation.name}`,
        status: 'waiting',
        payload: { approvalId: approval.id, toolCallId: toolCall.id, toolName: invocation.name },
      })
      this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.approvalRequested, {
        approvalId: approval.id,
        runId: state.runId,
        sessionId: state.sessionId,
        toolName: invocation.name,
        taskId: state.taskId,
      })
      return { status: 'paused', approvalId: approval.id }
    }
    this.store.updateToolCall(toolCall.id, { status: 'running', startedAt: now() })
    try {
      const result = await this.executeToolHandler(state, invocation)
      this.store.updateToolCall(toolCall.id, {
        status: 'completed',
        result,
        finishedAt: now(),
      })
      this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.toolCompleted, {
        runId: state.runId,
        toolName: invocation.name,
        toolCallId: toolCall.id,
      })
      return { status: 'completed', result }
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 8000)
      this.store.updateToolCall(toolCall.id, {
        status: 'failed',
        error: message,
        finishedAt: now(),
      })
      this.store.appendEvent(state.projectId, state.runId, PROJECT_EVENT_TYPES.toolFailed, {
        runId: state.runId,
        toolName: invocation.name,
        toolCallId: toolCall.id,
        error: message,
      })
      return { status: 'failed', error: message }
    }
  }

  private async executeToolHandler(state: ActiveRun, invocation: ToolInvocation): Promise<unknown> {
    const project = this.store.read.getProject(state.projectId)
    const session = this.store.read.getSession(state.sessionId)
    const agent = this.store.read.getAgent(state.agentId)
    if (!project || !session || !agent) throw new AppError('NOT_FOUND', '运行上下文已失效')
    const definition = getToolDefinition(invocation.name)
    if (!definition) throw new AppError('NOT_FOUND', `未知工具：${invocation.name}`)
    const actor = { kind: 'agent' as const, id: agent.id, name: agent.name }
    const args = invocation.args
    const taskId =
      typeof args.taskId === 'string' && args.taskId
        ? args.taskId
        : state.taskId
    switch (invocation.name) {
      case 'list_directory': {
        const subPath = typeof args.path === 'string' ? args.path.replace(/^\.\/?/, '').replace(/\/$/, '') : ''
        const entries = readWorkspaceTree(state.workspaceRoot, { maxDepth: 5, maxEntries: 500 })
        const filtered = subPath
          ? entries.filter((entry) => entry.path === subPath || entry.path.startsWith(`${subPath}/`))
          : entries
        return {
          root: state.workspaceRoot,
          entries: filtered.slice(0, 300).map((entry) => `${entry.type === 'directory' ? '📁' : '📄'} ${entry.path}`),
          truncated: filtered.length > 300,
        }
      }
      case 'read_file': {
        const path = requiredString(args, 'path')
        return readTextFile(state.workspaceRoot, path)
      }
      case 'write_file': {
        const path = requiredString(args, 'path')
        const content = requiredString(args, 'content', { allowEmpty: true })
        const result = writeTextFile(state.workspaceRoot, path, content)
        return { ok: true, ...result }
      }
      case 'git_status':
        return await getGitStatus(state.workspaceRoot)
      case 'git_diff':
        return await getGitDiff(state.workspaceRoot, typeof args.path === 'string' ? args.path : undefined)
      case 'run_command': {
        const command = requiredString(args, 'command')
        const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 30_000
        return await runApprovedCommand(state.workspaceRoot, command, timeoutMs)
      }
      case 'run_tests': {
        const command = typeof args.command === 'string' && args.command.trim() ? args.command.trim() : 'pnpm test'
        return await runApprovedCommand(state.workspaceRoot, command, 120_000)
      }
      case 'list_tasks': {
        const tasks = this.store.read.listTasks(project.id)
        const filter = typeof args.status === 'string' ? args.status : null
        const filtered = filter ? tasks.filter((task) => task.status === filter) : tasks
        return filtered.slice(0, 100).map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          priority: task.priority,
          acceptanceCriteria: task.acceptanceCriteria,
        }))
      }
      case 'create_task': {
        const acceptance = stringArray(args, 'acceptanceCriteria')
        if (acceptance.length === 0) throw new AppError('BAD_REQUEST', '验收标准不能为空')
        const card = this.services.tasks.create(
          {
            projectId: project.id,
            title: requiredString(args, 'title'),
            description: typeof args.description === 'string' ? args.description : '',
            priority: priorityArg(args.priority),
            acceptanceCriteria: acceptance,
            labels: [],
            assigneeAgentId: typeof args.assigneeAgentId === 'string' ? args.assigneeAgentId : agent.id,
            milestoneId: null,
            dependsOn: Array.isArray(args.dependsOn) ? args.dependsOn.filter((value): value is string => typeof value === 'string') : [],
            dueAt: null,
          },
          actor,
        )
        return { taskId: card.id, title: card.title, status: card.status }
      }
      case 'update_task_status': {
        if (!taskId) throw new AppError('BAD_REQUEST', '当前运行没有关联任务')
        const task = this.store.read.getTask(taskId)
        if (!task) throw new AppError('NOT_FOUND', '任务不存在')
        const status = taskStatusArg(args.status)
        const note = typeof args.note === 'string' ? args.note : undefined
        const card = this.services.tasks.move(
          { taskId: task.id, to: status, expectedVersion: task.version, note },
          actor,
        )
        return { taskId: card.id, status: card.status }
      }
      case 'create_requirement': {
        const requirement = this.services.projects.createRequirement(
          {
            projectId: project.id,
            title: requiredString(args, 'title'),
            body: typeof args.body === 'string' ? args.body : '',
            acceptanceCriteria: Array.isArray(args.acceptanceCriteria)
              ? args.acceptanceCriteria.filter((value): value is string => typeof value === 'string')
              : [],
            source: 'agent',
          },
          actor,
        )
        return { requirementId: requirement.id, title: requirement.title }
      }
      case 'create_milestone': {
        const milestone = this.services.projects.createMilestone(
          {
            projectId: project.id,
            title: requiredString(args, 'title'),
            description: typeof args.description === 'string' ? args.description : '',
            dueAt: typeof args.dueAt === 'number' ? args.dueAt : null,
          },
          actor,
        )
        return { milestoneId: milestone.id, title: milestone.title }
      }
      case 'record_decision': {
        const status = args.status === 'accepted' ? 'accepted' : 'proposed'
        const decision = this.services.projects.createDecision(
          {
            projectId: project.id,
            title: requiredString(args, 'title'),
            body: typeof args.body === 'string' ? args.body : '',
            status,
          },
          actor,
        )
        return { decisionId: decision.id, title: decision.title, status: decision.status }
      }
      case 'create_artifact': {
        const kindArg = typeof args.kind === 'string' ? args.kind : 'document'
        const artifact = this.services.projects.createArtifact(
          {
            projectId: project.id,
            taskId: state.taskId,
            runId: state.runId,
            kind: kindArg as Artifact['kind'],
            title: requiredString(args, 'title'),
            body: typeof args.body === 'string' ? args.body : '',
            uri: typeof args.uri === 'string' ? args.uri : null,
          },
          actor,
        )
        return { artifactId: artifact.id, title: artifact.title }
      }
      case 'search_knowledge': {
        const query = requiredString(args, 'query').toLowerCase()
        const entries = this.store.read.listKnowledge(project.id)
        return entries
          .filter((entry) => `${entry.title}\n${entry.body}`.toLowerCase().includes(query))
          .slice(0, 8)
          .map((entry) => ({ id: entry.id, title: entry.title, body: entry.body.slice(0, 4000) }))
      }
      case 'send_agent_message': {
        const result = this.services.collaboration.send(
          {
            projectId: project.id,
            fromSessionId: session.id,
            toSessionId: requiredString(args, 'toSessionId'),
            type: (typeof args.type === 'string' ? args.type : 'agent.message') as never,
            body: requiredString(args, 'body'),
            taskId: state.taskId,
            wake: false,
          },
          actor,
        )
        return { inboxId: result.inbox.id, status: result.inbox.status, created: result.created }
      }
      case 'handoff_task': {
        const handoff = this.services.collaboration.requestHandoff(
          {
            taskId: taskId ?? '',
            toAgentId: requiredString(args, 'toAgentId'),
            summary: requiredString(args, 'summary'),
            sessionId: session.id,
          },
          actor,
        )
        return { handoffId: handoff.id, status: handoff.status, toAgentName: handoff.toAgentName }
      }
      default:
        throw new AppError('NOT_IMPLEMENTED', `工具尚未实现：${invocation.name}`)
    }
  }

  async decideApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
    note = '',
  ): Promise<Approval> {
    const approval = this.store.getApprovalById(approvalId)
    if (!approval) throw new AppError('NOT_FOUND', '授权请求不存在')
    if (approval.status !== 'pending') throw new AppError('CONFLICT', '授权请求已被处理')
    if (decision === 'approved' && !this.provider.isConfigured()) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        '模型 Provider 尚未配置，无法在批准后继续运行。请先配置模型，或拒绝该授权。',
      )
    }
    const run = this.store.read.getRun(approval.runId)
    if (!run) throw new AppError('NOT_FOUND', '运行不存在')
    const toolCall = approval.toolCallId ? this.store.read.getToolCalls(run.id).find((call) => call.id === approval.toolCallId) : null
    if (decision === 'rejected' && !this.provider.isConfigured()) {
      const activeState = this.active.get(run.id)
      const decided = this.store.transaction(() => {
        const value = this.store.decideApproval(approvalId, decision, note || '用户拒绝了该操作')
        this.store.appendEvent(run.projectId, approvalId, PROJECT_EVENT_TYPES.approvalDecided, {
          decision,
          runId: run.id,
          sessionId: run.sessionId,
        })
        if (toolCall) {
          this.store.updateToolCall(toolCall.id, {
            status: 'denied',
            error: note || '用户拒绝了该操作',
            finishedAt: now(),
          })
          this.store.appendRunStep({
            runId: run.id,
            kind: 'tool_result',
            title: `用户拒绝：${toolCall.toolName}`,
            payload: {
              callId: toolCall.idempotencyKey.split(':').pop() ?? toolCall.id,
              name: toolCall.toolName,
              ok: false,
              content: JSON.stringify({ ok: false, error: note || '用户拒绝了该操作', denied: true }),
            },
          })
        }
        this.store.updateRun(run.id, {
          status: 'cancelled',
          error: '用户拒绝了工具调用；模型 Provider 未配置，运行未继续。',
          finishedAt: now(),
        })
        this.store.appendEvent(run.projectId, run.id, PROJECT_EVENT_TYPES.runStatusChanged, {
          status: 'cancelled',
          runId: run.id,
          sessionId: run.sessionId,
        })
        return value
      })
      this.tryMoveTask(run.taskId, 'ready')
      this.store.updateTaskAttemptStatus(run.id, 'cancelled')
      if (activeState) this.cleanup(activeState, 'cancelled')
      return decided
    }
    const updated = this.store.transaction(() => {
      const decided = this.store.decideApproval(approvalId, decision, note)
      this.store.appendEvent(run.projectId, approvalId, PROJECT_EVENT_TYPES.approvalDecided, {
        decision,
        runId: run.id,
        sessionId: run.sessionId,
      })
      return decided
    })
    if (!toolCall) {
      await this.failRun(await this.requireState(run.id), '授权关联的工具调用不存在')
      return updated
    }
    const state = await this.requireState(run.id)
    if (decision === 'rejected') {
      this.store.updateToolCall(toolCall.id, {
        status: 'denied',
        error: note || '用户拒绝了该操作',
        finishedAt: now(),
      })
      const step = this.store.appendRunStep({
        runId: run.id,
        kind: 'tool_result',
        title: `用户拒绝：${toolCall.toolName}`,
        payload: {
          callId: toolCall.idempotencyKey.split(':').pop() ?? toolCall.id,
          name: toolCall.toolName,
          ok: false,
          content: JSON.stringify({ ok: false, error: note || '用户拒绝了该操作', denied: true }),
        },
      })
      this.hub.publish({ type: 'run.step', projectId: run.projectId, runId: run.id, stepId: step.id, kind: 'tool_result' })
      this.transitionRun(state, 'running')
      void this.execute(state).catch((error) => this.failRun(state, String(error)))
      return updated
    }
    state.pendingApprovalId = null
    this.transitionRun(state, 'running')
    this.store.updateToolCall(toolCall.id, { status: 'running', startedAt: now() })
    let outcome: ToolOutcome
    try {
      const invocation: ToolInvocation = {
        callId: toolCall.idempotencyKey.split(':').pop() ?? toolCall.id,
        name: toolCall.toolName,
        args: toolCall.args,
        rawArguments: JSON.stringify(toolCall.args),
      }
      const result = await this.executeToolHandler(state, invocation)
      this.store.updateToolCall(toolCall.id, { status: 'completed', result, finishedAt: now() })
      outcome = { status: 'completed', result }
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 8000)
      this.store.updateToolCall(toolCall.id, { status: 'failed', error: message, finishedAt: now() })
      outcome = { status: 'failed', error: message }
    }
    await this.onToolResult(state, {
      callId: toolCall.idempotencyKey.split(':').pop() ?? toolCall.id,
      name: toolCall.toolName,
      args: toolCall.args,
      rawArguments: '',
    }, outcome)
    void this.execute(state).catch((error) => this.failRun(state, String(error)))
    return updated
  }

  private async requireState(runId: string): Promise<ActiveRun> {
    const existing = this.active.get(runId)
    if (existing) return existing
    const run = this.store.read.getRun(runId)
    if (!run) throw new AppError('NOT_FOUND', '运行不存在')
    const agent = this.store.read.getAgent(run.agentId)
    const routed = agent
      ? this.aiConnections?.resolveForRun({
          projectId: run.projectId,
          agentId: agent.id,
          agentRole: agent.role,
          taskId: run.taskId,
        }) ?? null
      : null
    const provider = this.provider.createProvider(routed?.connectionId, routed?.modelId)
    const project = this.store.read.getProject(run.projectId)
    const workspaceStep = this.store.read
      .getRunSteps(run.id)
      .find((step) => typeof step.payload.workspaceRoot === 'string')
    const workspaceRoot =
      (workspaceStep?.payload.workspaceRoot as string | undefined) ?? project?.rootPath ?? process.cwd()
    const state: ActiveRun = {
      runId,
      projectId: run.projectId,
      sessionId: run.sessionId,
      agentId: run.agentId,
      taskId: run.taskId,
      workspaceRoot,
      provider,
      connectionId: routed?.connectionId ?? null,
      modelId: routed?.modelId ?? null,
      abort: new AbortController(),
      lease: null,
      attemptNo: run.attempt,
      inboxId: null,
      promptMessageId: this.findPromptMessageId(run),
      busy: false,
      checkpointSeq: 0,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      lastAssistantText: run.summary ?? '',
      textStepId: null,
      textBuffer: '',
      lastTextFlushAt: 0,
      pendingApprovalId: null,
      leaseTimer: null,
      startedAt: run.startedAt ?? run.createdAt,
    }
    this.active.set(runId, state)
    this.sessionIndex.set(run.sessionId, runId)
    return state
  }

  private findPromptMessageId(run: Run): string {
    const steps = this.store.read.getRunSteps(run.id)
    for (const step of steps) {
      if (typeof step.payload.promptMessageId === 'string') return step.payload.promptMessageId
    }
    const messages = this.store.read.getMessages(run.sessionId, 400)
    const candidate = [...messages].reverse().find((message) => message.role === 'user' && message.createdAt <= run.createdAt)
    return candidate?.id ?? ''
  }

  async cancel(runId: string): Promise<void> {
    const state = this.active.get(runId)
    if (state) {
      state.abort.abort()
      const run = this.store.read.getRun(runId)
      if (run && (run.status === 'waiting_approval' || run.status === 'running')) {
        if (run.status === 'waiting_approval') {
          this.store.cancelPendingApprovals(runId, '用户取消了运行')
          this.transitionRun(state, 'cancelled', { error: '用户取消了运行', finishedAt: now() })
          this.tryMoveTask(state.taskId, 'ready')
          this.store.updateTaskAttemptStatus(runId, 'cancelled')
          this.cleanup(state, 'cancelled')
        }
      }
      return
    }
    const run = this.store.read.getRun(runId)
    if (!run) throw new AppError('NOT_FOUND', '运行不存在')
    if (['completed', 'failed', 'cancelled'].includes(run.status)) return
    this.store.cancelPendingApprovals(runId, '用户取消了运行')
    this.store.updateRun(runId, { status: 'cancelled', error: '用户取消了运行', finishedAt: now() })
    this.store.appendEvent(run.projectId, runId, PROJECT_EVENT_TYPES.runStatusChanged, {
      status: 'cancelled',
      runId,
      sessionId: run.sessionId,
    })
    this.tryMoveTask(run.taskId, 'ready')
    this.store.updateTaskAttemptStatus(runId, 'cancelled')
  }

  async resumeInbox(inboxId: string): Promise<{ runId: string | null; warning: string | null }> {
    if (!this.provider.isConfigured()) {
      return { runId: null, warning: '尚未配置模型 Provider，消息已持久化但无法唤醒 Agent' }
    }
    const item = this.store.read.getInbox(inboxId)
    if (!item) throw new AppError('NOT_FOUND', '收件箱条目不存在')
    if (item.status === 'completed') return { runId: null, warning: '该消息已处理完成' }
    const session = this.store.read.getSession(item.recipientSessionId)
    if (!session) throw new AppError('NOT_FOUND', '接收方会话不存在')
    if (this.sessionIndex.has(session.id)) {
      return { runId: null, warning: '接收方 Agent 正在运行，消息已排队' }
    }
    const message = this.store.getMessageById(item.messageId)
    if (!message) throw new AppError('NOT_FOUND', '消息不存在')
    const result = await this.startRun({
      projectId: item.projectId,
      sessionId: item.recipientSessionId,
      taskId: item.envelope.taskId ?? null,
      prompt: message.content,
      messageId: message.id,
      inboxId: item.id,
    })
    return { runId: result.runId, warning: null }
  }

  async wakeInbox(inboxId: string): Promise<{ runId: string | null; warning: string | null }> {
    return this.resumeInbox(inboxId)
  }

  private tryMoveTask(taskId: string | null, to: TaskStatus, note?: string): void {
    if (!taskId) return
    try {
      const task = this.store.read.getTask(taskId)
      if (!task || task.status === to) return
      if (to === 'review' && task.status !== 'running') return
      if (to === 'blocked' && task.status === 'done') return
      if (to === 'ready' && !['running', 'blocked'].includes(task.status)) return
      this.store.moveTask(task.id, task.version, to)
      this.store.appendEvent(task.projectId, task.id, PROJECT_EVENT_TYPES.taskMoved, {
        taskTitle: task.title,
        status: to,
        note: note ?? null,
        actorName: 'ProjectOS',
      })
    } catch (error) {
      this.logger.warn({ err: error, taskId, to }, 'failed to move task after run')
    }
  }

  recoverInterruptedRuns(): void {
    const interrupted = this.store.read.listUnfinishedRuns(200)
    for (const run of interrupted) {
      if (run.status === 'waiting_approval') {
        this.logger.info({ runId: run.id }, 'run is waiting for approval; keep it resumable')
        continue
      }
      try {
        this.store.transaction(() => {
          this.store.updateRun(run.id, {
            status: 'needs_reconciliation',
            error: 'Runtime 在执行期间退出，外部副作用状态未知；不会自动重试，请人工核对后重新运行。',
            finishedAt: now(),
          })
          this.store.appendEvent(run.projectId, run.id, PROJECT_EVENT_TYPES.runStatusChanged, {
            status: 'needs_reconciliation',
            runId: run.id,
            sessionId: run.sessionId,
          })
          this.store.cancelPendingApprovals(run.id, 'Runtime 重启，未完成审批已失效')
          this.store.updateTaskAttemptStatus(run.id, 'needs_reconciliation')
        })
        this.tryMoveTask(run.taskId, 'blocked', 'Runtime 重启，执行状态待人工核对')
      } catch (error) {
        this.logger.warn({ err: error, runId: run.id }, 'failed to reconcile interrupted run')
      }
    }
  }

  shutdown(): void {
    for (const state of this.active.values()) {
      state.abort.abort()
      if (state.leaseTimer) clearInterval(state.leaseTimer)
    }
    this.active.clear()
    this.sessionIndex.clear()
  }
}

function hashArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(stableStringify(args)).digest('hex')
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

function requiredString(
  args: Record<string, unknown>,
  key: string,
  options: { allowEmpty?: boolean } = {},
): string {
  const value = args[key]
  if (typeof value !== 'string' || (!options.allowEmpty && value.trim() === '')) {
    throw new AppError('BAD_REQUEST', `参数 ${key} 必须是非空字符串`)
  }
  return value
}

function stringArray(args: Record<string, unknown>, key: string): string[] {
  const value = args[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

function priorityArg(value: unknown): 1 | 2 | 3 | 4 {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : 3
}

function taskStatusArg(value: unknown): TaskStatus {
  if (typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)) {
    return value as TaskStatus
  }
  throw new AppError('BAD_REQUEST', `未知任务状态：${String(value)}`)
}

function approvalDetail(invocation: ToolInvocation): string {
  if (invocation.name === 'write_file') {
    const path = typeof invocation.args.path === 'string' ? invocation.args.path : '(未知路径)'
    const content = typeof invocation.args.content === 'string' ? invocation.args.content : ''
    return `Agent 请求写入文件：${path}\n\n内容长度：${content.length} 字符\n\n预览：\n${content.slice(0, 1200)}`
  }
  if (invocation.name === 'run_command' || invocation.name === 'run_tests') {
    return `Agent 请求执行命令：\n\n${String(invocation.args.command ?? '(未提供)')}`
  }
  return `Agent 请求执行 ${invocation.name}。`
}

