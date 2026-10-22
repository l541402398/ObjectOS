import {
  AppError,
  type PlanGeneration,
  type PlannedTask,
  type RuntimeSettings,
} from '@projectos/contracts'
import {
  buildPlannerRepairPrompt,
  buildPlannerUserPrompt,
  parsePlannerResponse,
  PLANNER_PROMPT_VERSION,
  planSystemPrompt,
  PlannerValidationError,
} from '@projectos/planning'
import { estimateTokens } from '@projectos/context-engine'
import { redactSecrets } from '@projectos/policy'
import type { ChatMessage } from '@projectos/provider-interfaces'
import type { SqliteStore } from '@projectos/persistence'
import type { Logger } from './logger.js'
import { buildPlannerContext, PLANNER_CONTEXT_BUDGET } from './planner-context.js'
import type { PlannerModelSource, PlannerModelTarget } from './planner-provider.js'

export interface PlannerAttemptUsage {
  projectId: string
  planId: string
  revision: number
  requestId: string
  attempt: number
  connectionId: string | null
  modelId: string
  inputTokens: number | null
  outputTokens: number | null
  outcome: 'valid' | 'invalid' | 'error'
}

export interface PlannerServiceOptions {
  store: SqliteStore
  modelSource: PlannerModelSource
  logger?: Pick<Logger, 'info' | 'warn'>
  /** Called for every model attempt, including correction attempts. */
  onAttemptUsage?: (usage: PlannerAttemptUsage) => void
  /** Per-attempt model timeout. Bounded by the IPC timeout. */
  timeoutMs?: number
  /** Number of *repair* attempts after the first invalid answer. 1 = two calls max. */
  maxRepairAttempts?: number
  contextChars?: number
  maxOutputTokens?: number
  maxOutputChars?: number
  /** Dynamically loaded from Settings; applies to the next generation. */
  runtimeSettings?: () => RuntimeSettings
}

export interface PlannerGenerateInput {
  projectId: string
  goal: string
  revision: number
  /** Allocated before generation so failed attempts can be audited safely. */
  planId: string
  requestId: string
  maxTasks?: number
  allowOverBudget?: boolean
}

export interface PlannerGenerateResult {
  tasks: PlannedTask[]
  assumptions: string[]
  risks: string[]
  reason: string
  generation: PlanGeneration
}

export interface PlannerRevisionInput {
  projectId: string
  planId: string
  revision: number
  requestId: string
  maxTasks: number
  allowOverBudget: boolean
  system: string
  user: string
  promptVersion: string
  contextChars: number
  contextSources: PlanGeneration['contextSources']
  warnings: string[]
}

interface ModelAnswer {
  text: string
  finishReason: string
  inputTokens: number | null
  outputTokens: number | null
}

const DEFAULTS = {
  timeoutMs: 75_000,
  maxRepairAttempts: 1,
  // A 7-layer plan can easily exceed 4k completion tokens once the provider
  // streams verbose task descriptions. Truncation used to produce an
  // unterminated JSON object and looked like a model "format" failure.
  maxOutputTokens: 12_288,
  maxOutputChars: 200_000,
}

function sanitizeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return redactSecrets(message).slice(0, 4_000)
}

export class PlannerService {
  private readonly timeoutMs: number
  private readonly maxRepairAttempts: number
  private readonly contextChars: number
  private readonly maxOutputTokens: number
  private readonly maxOutputChars: number

  constructor(private readonly options: PlannerServiceOptions) {
    this.timeoutMs = Math.max(100, options.timeoutMs ?? DEFAULTS.timeoutMs)
    this.maxRepairAttempts = Math.max(0, Math.min(2, options.maxRepairAttempts ?? DEFAULTS.maxRepairAttempts))
    this.contextChars = Math.max(2_000, options.contextChars ?? PLANNER_CONTEXT_BUDGET)
    this.maxOutputTokens = Math.max(256, Math.min(16_384, options.maxOutputTokens ?? DEFAULTS.maxOutputTokens))
    this.maxOutputChars = Math.max(4_000, options.maxOutputChars ?? DEFAULTS.maxOutputChars)
  }

  /** Enforce the project soft budget before a paid call is made. */
  private assertBudget(projectId: string, allowOverBudget: boolean): void {
    const budget = this.options.store.read.getProjectBudget(projectId)
    if (!budget || budget.softLimit <= 0) return
    const spent = this.options.store.read.summarizeAIUsage(projectId).estimatedCost
    if (spent > budget.softLimit && !allowOverBudget) {
      throw new AppError(
        'BUDGET_EXCEEDED',
        `项目 AI 软预算已超出（已记录 ${spent.toFixed(4)} / 上限 ${budget.softLimit} ${budget.currency}）。继续 AI 规划需要显式确认，或改用本地规则。`,
        { details: { spent, softLimit: budget.softLimit, currency: budget.currency } },
      )
    }
  }

  async generate(input: PlannerGenerateInput): Promise<PlannerGenerateResult> {
    const startedAt = Date.now()
    const project = this.options.store.read.getProject(input.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const goal = input.goal.trim()
    if (goal.length < 3) throw new AppError('BAD_REQUEST', '计划目标至少需要 3 个字符')
    const settings = this.options.runtimeSettings?.()
    const maxTasks = Math.max(1, Math.min(settings?.plannerMaxTasks ?? 20, input.maxTasks ?? 12))
    this.assertBudget(input.projectId, Boolean(input.allowOverBudget))

    // Fail fast when no real connection/model is available, before building a
    // large context that cannot be used.
    const target = this.options.modelSource.resolve()
    const context = buildPlannerContext({
      store: this.options.store,
      projectId: input.projectId,
      goal,
      budgetChars: this.contextChars,
    })
    if (context.chars === 0) {
      // Defensive only; buildPlannerContext always returns project metadata.
      throw new AppError('PROVIDER_ERROR', '没有构建出可用的规划上下文')
    }

    const system = planSystemPrompt()
    const user = buildPlannerUserPrompt({
      goal,
      revision: input.revision,
      context: context.text,
      maxTasks,
    })
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ]
    const estimatedInputTokens = estimateTokens(`${system}\n${user}`)
    const maxAttempts = 1 + this.maxRepairAttempts
    let attempts = 0
    let lastIssues: string[] = []
    let inputTokens = 0
    let outputTokens = 0
    let warningFromFinish: string | null = null
    const recordAttempt = (attempt: number, answer: ModelAnswer, outcome: PlannerAttemptUsage['outcome']): void => {
      this.options.onAttemptUsage?.({
        projectId: input.projectId,
        planId: input.planId,
        revision: input.revision,
        requestId: input.requestId,
        attempt,
        connectionId: target.connectionId,
        modelId: target.model,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        outcome,
      })
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt
      let answer: ModelAnswer
      try {
        answer = await this.callModel(target, messages)
      } catch (error) {
        if (!(error instanceof PlannerValidationError)) throw error
        lastIssues = error.issues
        if (attempt >= maxAttempts) break
        messages.push({ role: 'user', content: buildPlannerRepairPrompt(error.issues, maxTasks) })
        continue
      }
      if (answer.inputTokens !== null) inputTokens += answer.inputTokens
      if (answer.outputTokens !== null) outputTokens += answer.outputTokens
      warningFromFinish = answer.finishReason === 'length'
        ? '模型输出可能达到长度上限；已按完整 JSON 校验，必要时进行有界纠错。'
        : null
      try {
        const parsed = parsePlannerResponse(answer.text, { maxTasks })
        const warnings = [
          ...context.warnings,
          ...parsed.warnings,
          ...(warningFromFinish ? [warningFromFinish] : []),
          ...(attempts > 1 ? [`首次模型输出未通过校验，已进行一次有界纠错（共 ${attempts} 次调用）。`] : []),
        ]
        const generation: PlanGeneration = {
          mode: 'provider',
          promptVersion: PLANNER_PROMPT_VERSION,
          connectionId: target.connectionId,
          connectionName: target.connectionName,
          model: target.model,
          protocol: target.protocol,
          attempts,
          durationMs: Math.max(0, Date.now() - startedAt),
          maxTasks,
          contextChars: context.chars,
          estimatedInputTokens,
          inputTokens: inputTokens > 0 ? inputTokens : null,
          outputTokens: outputTokens > 0 ? outputTokens : null,
          fallbackReason: null,
          warnings: [...new Set(warnings)].slice(0, 30),
          contextSources: context.sources,
        }
        recordAttempt(attempt, answer, 'valid')
        this.options.logger?.info(
          {
            projectId: input.projectId,
            model: target.model,
            connectionName: target.connectionName,
            tasks: parsed.tasks.length,
            attempts,
            durationMs: generation.durationMs,
          },
          'AI planner generated a validated draft',
        )
        return {
          tasks: parsed.tasks,
          assumptions: parsed.assumptions,
          risks: parsed.risks,
          reason: parsed.reason,
          generation,
        }
      } catch (error) {
        if (!(error instanceof PlannerValidationError)) {
          recordAttempt(attempt, answer, 'error')
          throw error
        }
        recordAttempt(attempt, answer, 'invalid')
        lastIssues = error.issues
        if (attempt >= maxAttempts) break
        // Keep the previous answer (bounded) so the model can correct concrete
        // field-level mistakes instead of re-planning blindly.
        messages.push({ role: 'assistant', content: answer.text.slice(0, 6_000) })
        const repair = buildPlannerRepairPrompt(error.issues, maxTasks)
        messages.push({
          role: 'user',
          content: warningFromFinish
            ? `${warningFromFinish}\n请这次只输出完整、闭合的 JSON；压缩任务说明，不要重复解释。\n${repair}`
            : repair,
        })
      }
    }

    this.options.logger?.warn(
      { projectId: input.projectId, model: target.model, attempts, issues: lastIssues.slice(0, 5) },
      'AI planner output failed validation after bounded repair',
    )
    throw new AppError(
      'PROVIDER_ERROR',
      `AI 生成的计划未通过校验（已尝试 ${attempts} 次）：${lastIssues.slice(0, 4).join('；') || '输出为空或不是合法 JSON'}`,
      {
        details: {
          stage: 'plan-validation',
          attempts,
          issues: lastIssues.slice(0, 12),
          model: target.model,
          connectionName: target.connectionName,
          durationMs: Math.max(0, Date.now() - startedAt),
        },
        retryable: false,
      },
    )
  }

  /**
   * Replan call: same provider, budget, timeout, usage and bounded-repair path as
   * the Planner, but with an explicit revision prompt and execution facts.
   */
  async generateRevision(input: PlannerRevisionInput): Promise<PlannerGenerateResult> {
    const startedAt = Date.now()
    const project = this.options.store.read.getProject(input.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const settings = this.options.runtimeSettings?.()
    const maxTasks = Math.max(1, Math.min(settings?.plannerMaxTasks ?? 20, input.maxTasks))
    this.assertBudget(input.projectId, input.allowOverBudget)
    const target = this.options.modelSource.resolve()
    const messages: ChatMessage[] = [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ]
    const estimatedInputTokens = estimateTokens(`${input.system}\n${input.user}`)
    const maxAttempts = 1 + this.maxRepairAttempts
    let attempts = 0
    let lastIssues: string[] = []
    let inputTokens = 0
    let outputTokens = 0
    let warningFromFinish: string | null = null
    const recordAttempt = (attempt: number, answer: ModelAnswer, outcome: PlannerAttemptUsage['outcome']): void => {
      this.options.onAttemptUsage?.({
        projectId: input.projectId,
        planId: input.planId,
        revision: input.revision,
        requestId: input.requestId,
        attempt,
        connectionId: target.connectionId,
        modelId: target.model,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        outcome,
      })
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt
      let answer: ModelAnswer
      try {
        answer = await this.callModel(target, messages)
      } catch (error) {
        if (!(error instanceof PlannerValidationError)) throw error
        lastIssues = error.issues
        if (attempt >= maxAttempts) break
        messages.push({ role: 'user', content: buildPlannerRepairPrompt(error.issues, maxTasks) })
        continue
      }
      if (answer.inputTokens !== null) inputTokens += answer.inputTokens
      if (answer.outputTokens !== null) outputTokens += answer.outputTokens
      warningFromFinish = answer.finishReason === 'length'
        ? '模型输出可能达到长度上限；已按完整 JSON 校验，必要时进行有界纠错。'
        : null
      try {
        const parsed = parsePlannerResponse(answer.text, { maxTasks })
        const warnings = [
          ...input.warnings,
          ...parsed.warnings,
          ...(warningFromFinish ? [warningFromFinish] : []),
          ...(attempts > 1 ? [`修订提案首次输出未通过校验，已进行一次有界纠错（共 ${attempts} 次调用）。`] : []),
        ]
        const generation: PlanGeneration = {
          mode: 'provider',
          promptVersion: input.promptVersion,
          connectionId: target.connectionId,
          connectionName: target.connectionName,
          model: target.model,
          protocol: target.protocol,
          attempts,
          durationMs: Math.max(0, Date.now() - startedAt),
          maxTasks,
          contextChars: input.contextChars,
          estimatedInputTokens,
          inputTokens: inputTokens > 0 ? inputTokens : null,
          outputTokens: outputTokens > 0 ? outputTokens : null,
          fallbackReason: null,
          warnings: [...new Set(warnings)].slice(0, 30),
          contextSources: input.contextSources,
        }
        recordAttempt(attempt, answer, 'valid')
        return {
          tasks: parsed.tasks,
          assumptions: parsed.assumptions,
          risks: parsed.risks,
          reason: parsed.reason,
          generation,
        }
      } catch (error) {
        if (!(error instanceof PlannerValidationError)) {
          recordAttempt(attempt, answer, 'error')
          throw error
        }
        recordAttempt(attempt, answer, 'invalid')
        lastIssues = error.issues
        if (attempt >= maxAttempts) break
        messages.push({ role: 'assistant', content: answer.text.slice(0, 6_000) })
        const repair = buildPlannerRepairPrompt(error.issues, maxTasks)
        messages.push({
          role: 'user',
          content: warningFromFinish
            ? `${warningFromFinish}\n请这次只输出完整、闭合的 JSON；压缩任务说明，不要重复解释。\n${repair}`
            : repair,
        })
      }
    }

    throw new AppError(
      'PROVIDER_ERROR',
      `AI 修订计划未通过校验（已尝试 ${attempts} 次）：${lastIssues.slice(0, 4).join('；') || '输出为空或不是合法 JSON'}`,
      {
        details: {
          stage: 'replan-validation',
          attempts,
          issues: lastIssues.slice(0, 12),
          model: target.model,
          connectionName: target.connectionName,
          durationMs: Math.max(0, Date.now() - startedAt),
        },
        retryable: false,
      },
    )
  }

  private async callModel(target: PlannerModelTarget, messages: ChatMessage[]): Promise<ModelAnswer> {
    const settings = this.options.runtimeSettings?.()
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, settings?.plannerTimeoutMs ?? this.timeoutMs)
    let text = ''
    let finishReason = 'stop'
    let inputTokens: number | null = null
    let outputTokens: number | null = null
    try {
      for await (const event of target.provider.stream(
        {
          messages,
          tools: [],
          temperature: 0.2,
          maxTokens: settings?.plannerMaxOutputTokens ?? this.maxOutputTokens,
        },
        controller.signal,
      )) {
        if (event.type === 'text.delta') {
          text += event.text
          if (text.length > this.maxOutputChars) {
            controller.abort()
            throw new AppError('PROVIDER_ERROR', `模型输出超过 ${this.maxOutputChars} 字符预算，已中止本次规划`)
          }
        } else if (event.type === 'usage') {
          if (typeof event.inputTokens === 'number') inputTokens = event.inputTokens
          if (typeof event.outputTokens === 'number') outputTokens = event.outputTokens
        } else if (event.type === 'done') {
          finishReason = event.finishReason
        } else if (event.type === 'tool.call') {
          throw new AppError('PROVIDER_ERROR', '规划模型返回了工具调用；AI Planner 只接受 JSON 计划文本，不会执行工具。')
        }
      }
    } catch (error) {
      if (timedOut) {
        throw new AppError('TIMEOUT', `规划模型调用超时（${this.timeoutMs}ms）`, { retryable: true })
      }
      if (error instanceof AppError) {
        throw new AppError(error.code, sanitizeMessage(error), { details: error.details, retryable: error.retryable })
      }
      throw new AppError('PROVIDER_ERROR', sanitizeMessage(error), { retryable: true })
    } finally {
      clearTimeout(timer)
    }
    if (!text.trim()) {
      throw new PlannerValidationError(['模型没有返回文本输出'])
    }
    return { text, finishReason, inputTokens, outputTokens }
  }
}
