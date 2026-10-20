import { AppError, now, type PlanDraft, type PlanExecution, type TaskCard, type WorktreeInfo } from '@projectos/contracts'
import type { CoreServices } from '@projectos/application'
import { createArtifactRecord } from '@projectos/persistence'
import type { SqliteStore } from '@projectos/persistence'
import { WorktreeManager } from '@projectos/worktree'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { AgentRunner } from './agent-runner.js'
import type { Logger } from './logger.js'
import { QualityGateService, type QualityGateReport } from './quality-gate.js'

const SYSTEM_ACTOR = { kind: 'system' as const, id: 'orchestrator', name: '编排器' }

function execution(status: PlanExecution['status'], concurrency: number, previous?: PlanExecution | null): PlanExecution {
  return {
    status,
    concurrency,
    startedAt: previous?.startedAt ?? now(),
    updatedAt: now(),
    error: previous?.error ?? null,
    runIds: previous?.runIds ?? [],
    workspaceRef: previous?.workspaceRef ?? null,
    branch: previous?.branch ?? null,
    diffArtifactId: previous?.diffArtifactId ?? null,
    mergedAt: previous?.mergedAt ?? null,
    maxRetries: previous?.maxRetries ?? 2,
    retries: previous?.retries ?? {},
    nextAttemptAt: previous?.nextAttemptAt ?? {},
    retryForRun: previous?.retryForRun ?? {},
    requireWorktree: previous?.requireWorktree ?? false,
  }
}

export class OrchestrationScheduler {
  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly ticking = new Set<string>()
  private readonly qualityReports = new Map<string, QualityGateReport>()

  constructor(
    private readonly store: SqliteStore,
    private readonly services: CoreServices,
    private readonly runner: AgentRunner,
    private readonly logger: Logger,
    private readonly dataDir: string,
    private readonly qualityGate = new QualityGateService(),
    private readonly worktrees = new WorktreeManager(),
  ) {}

  private getPlan(planId: string): PlanDraft {
    const plan = this.store.read.getPlanRevision(planId)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    return plan
  }

  private saveExecution(plan: PlanDraft, next: PlanExecution): PlanDraft {
    const updated: PlanDraft = { ...plan, execution: next, updatedAt: now() }
    this.store.updatePlanRevision(updated)
    return updated
  }

  async start(
    planId: string,
    concurrency = 2,
    maxRetries = 2,
    allowOverBudget = false,
    requireWorktree = false,
  ): Promise<PlanDraft> {
    const plan = this.getPlan(planId)
    if (plan.status !== 'approved') throw new AppError('CONFLICT', '计划尚未批准，不能开始执行')
    const budget = this.store.read.getProjectBudget(plan.projectId)
    if (budget && budget.softLimit > 0 && !allowOverBudget) {
      const spent = this.store.read.summarizeAIUsage(plan.projectId).estimatedCost
      if (spent > budget.softLimit) {
        throw new AppError('BUDGET_EXCEEDED', `项目已用估算费用 ${spent.toFixed(4)} 超过软预算 ${budget.softLimit}，需确认后继续`)
      }
    }
    if (!plan.createdTaskIds.length) throw new AppError('CONFLICT', '计划没有已创建的任务')
    if (plan.execution?.status === 'running') throw new AppError('CONFLICT', '计划已经在执行中')
    const next = this.saveExecution(plan, {
      ...execution('running', concurrency, plan.execution),
      maxRetries: Math.max(0, Math.min(5, maxRetries)),
      requireWorktree: requireWorktree || Boolean(plan.execution?.requireWorktree),
    })
    try {
      await this.ensureWorkspace(next)
    } catch (error) {
      const failed = this.getPlan(next.id)
      this.saveExecution(failed, {
        ...failed.execution!,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        updatedAt: now(),
      })
      throw error
    }
    this.arm(next.id)
    void this.tick(next.id)
    return this.getPlan(next.id)
  }

  pause(planId: string): PlanDraft {
    const plan = this.getPlan(planId)
    if (plan.execution?.status !== 'running') throw new AppError('CONFLICT', '计划不在执行中')
    this.disarm(planId)
    return this.saveExecution(plan, { ...plan.execution, status: 'paused', updatedAt: now() })
  }

  resume(planId: string): PlanDraft {
    const plan = this.getPlan(planId)
    if (plan.execution?.status !== 'paused') throw new AppError('CONFLICT', '计划不在暂停状态')
    const next = this.saveExecution(plan, { ...plan.execution, status: 'running', error: null, updatedAt: now() })
    this.arm(planId)
    void this.tick(planId)
    return this.getPlan(next.id)
  }

  async cancel(planId: string): Promise<PlanDraft> {
    const plan = this.getPlan(planId)
    if (!plan.execution || !['running', 'paused'].includes(plan.execution.status)) {
      throw new AppError('CONFLICT', '计划没有可取消的执行')
    }
    this.disarm(planId)
    for (const taskId of plan.createdTaskIds) {
      const active = this.store.read.getActiveRunForTask(taskId)
      if (active) {
        try {
          await this.runner.cancel(active.id)
        } catch (error) {
          this.logger.warn({ err: error, taskId }, 'failed to cancel orchestrated run')
        }
      }
    }
    const cancelled = this.saveExecution(plan, { ...plan.execution, status: 'cancelled', updatedAt: now() })
    return cancelled
  }

  async info(planId: string): Promise<WorktreeInfo> {
    const plan = this.getPlan(planId)
    const execution = plan.execution
    const available = Boolean(
      execution?.branch && execution.workspaceRef && existsSync(execution.workspaceRef),
    )
    let diff = ''
    if (available && execution?.workspaceRef) {
      try {
        diff = await this.worktrees.diff(execution.workspaceRef)
      } catch (error) {
        diff = `无法读取 diff：${error instanceof Error ? error.message : String(error)}`
      }
    }
    return {
      planId,
      available,
      branch: execution?.branch ?? null,
      workspaceRef: execution?.workspaceRef ?? null,
      status: execution?.status ?? null,
      diff,
      diffArtifactId: execution?.diffArtifactId ?? null,
      mergedAt: execution?.mergedAt ?? null,
    }
  }

  async merge(planId: string): Promise<WorktreeInfo> {
    const plan = this.getPlan(planId)
    const execution = plan.execution
    if (!execution?.branch || !execution.workspaceRef) throw new AppError('CONFLICT', '该计划没有可合并的 Worktree')
    if (execution.status !== 'completed') throw new AppError('CONFLICT', '只有完成且通过质量门禁的计划可以合并')
    if (execution.mergedAt) throw new AppError('CONFLICT', '该 Worktree 已合并')
    const project = this.store.read.getProject(plan.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const result = await this.worktrees.merge(
      project.rootPath,
      execution.branch,
      `Merge ProjectOS plan ${plan.id}: ${plan.goal.slice(0, 120)}`,
    )
    if (!result.ok) throw new AppError('CONFLICT', result.message || '合并失败')
    this.saveExecution(plan, { ...execution, mergedAt: now(), updatedAt: now() })
    return this.info(planId)
  }

  async discard(planId: string): Promise<void> {
    const plan = this.getPlan(planId)
    const execution = plan.execution
    if (!execution?.workspaceRef) throw new AppError('CONFLICT', '该计划没有 Worktree')
    if (execution.status === 'running') throw new AppError('CONFLICT', '运行中的计划不能丢弃 Worktree')
    const project = this.store.read.getProject(plan.projectId)
    if (project) await this.worktrees.remove(project.rootPath, execution.workspaceRef)
    this.saveExecution(plan, { ...execution, workspaceRef: null, branch: null, updatedAt: now() })
  }

  recover(): void {
    const plans = this.store.read.listAllPlanRevisions()
    for (const plan of plans) {
      if (plan.execution?.status !== 'running') continue
      this.arm(plan.id)
      void this.tick(plan.id)
    }
  }

  shutdown(): void {
    for (const timer of this.timers.values()) clearInterval(timer)
    this.timers.clear()
  }

  private arm(planId: string): void {
    this.disarm(planId)
    const timer = setInterval(() => void this.tick(planId), 2_500)
    timer.unref?.()
    this.timers.set(planId, timer)
  }

  private disarm(planId: string): void {
    const timer = this.timers.get(planId)
    if (timer) clearInterval(timer)
    this.timers.delete(planId)
  }

  private async ensureWorkspace(plan: PlanDraft): Promise<string> {
    const project = this.store.read.getProject(plan.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    if (plan.execution?.workspaceRef && existsSync(plan.execution.workspaceRef)) {
      return plan.execution.workspaceRef
    }
    const worktreePath = join(this.dataDir, 'worktrees', plan.projectId, plan.id)
    const branch = `projectos/plan-${plan.id}`
    try {
      const ref = await this.worktrees.create(project.rootPath, worktreePath, branch)
      const current = plan.execution ?? execution('running', 2)
      this.saveExecution(plan, {
        ...current,
        workspaceRef: ref.path,
        branch: ref.branch,
        updatedAt: now(),
      })
      return ref.path
    } catch (error) {
      // A Git project must never fall back to writing the main workspace; only non-Git V1.3 plans may.
      if (plan.execution?.requireWorktree || existsSync(join(project.rootPath, '.git'))) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new AppError('CONFLICT', `无法创建隔离 Worktree，已停止执行：${reason}`)
      }
      this.logger.warn({ err: error, planId: plan.id }, 'non-git project; using project root')
      return project.rootPath
    }
  }

  private async tick(planId: string): Promise<void> {
    if (this.ticking.has(planId)) return
    this.ticking.add(planId)
    try {
      let plan = this.getPlan(planId)
      if (plan.execution?.status !== 'running') {
        this.disarm(planId)
        return
      }
      const cards = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
      if (cards.length === 0) throw new AppError('CONFLICT', '计划任务不存在')
      const workspaceRoot = await this.ensureWorkspace(plan)

      for (const card of cards) {
        const latest = this.store.read.getLatestRunForTask(card.id)
        if (latest?.status === 'needs_reconciliation') {
          // Side effects are unknown: never replay automatically, wait for a human to reconcile the run.
          this.saveExecution(plan, {
            ...plan.execution!,
            status: 'paused',
            error: `运行 ${latest.id} 待人工核对，核对后再继续`,
            updatedAt: now(),
          })
          this.disarm(planId)
          return
        }
        if (latest?.status === 'failed') {
          const retries = plan.execution?.retries ?? {}
          const used = retries[card.id] ?? 0
          const nextAt = plan.execution?.nextAttemptAt[card.id] ?? 0
          const scheduledFor = plan.execution?.retryForRun[card.id]
          if (scheduledFor === latest.id) {
            if (nextAt > now()) continue
            // Backoff elapsed: task promotion below starts the next attempt.
          } else {
            if (used >= (plan.execution?.maxRetries ?? 2)) {
              const next = { ...plan.execution!, status: 'failed' as const, error: latest.error ?? '任务执行失败（重试已用尽）', updatedAt: now() }
              this.saveExecution(plan, next)
              this.disarm(planId)
              return
            }
            const delay = Math.min(30_000, 2_000 * 2 ** used)
            plan = this.saveExecution(plan, {
              ...plan.execution!,
              retries: { ...retries, [card.id]: used + 1 },
              nextAttemptAt: { ...(plan.execution?.nextAttemptAt ?? {}), [card.id]: now() + delay },
              retryForRun: { ...(plan.execution?.retryForRun ?? {}), [card.id]: latest.id },
              error: `任务失败，${Math.round(delay / 1000)}s 后重试（${used + 1}/${plan.execution?.maxRetries ?? 2}）`,
              updatedAt: now(),
            })
            continue
          }
        }
      }

      let changed = false
      for (const card of cards) {
        if (card.status !== 'review') continue
        const role = card.labels.find((label) => ['architect', 'developer', 'reviewer', 'tester'].includes(label))
        if (role === 'developer' || role === 'tester') {
          let report = this.qualityReports.get(card.id)
          if (!report) {
            const project = this.store.read.getProject(plan.projectId)
            if (!project) throw new AppError('NOT_FOUND', '项目不存在')
            report = await this.qualityGate.run(workspaceRoot)
            this.qualityReports.set(card.id, report)
            this.store.createArtifact(
              createArtifactRecord({
                projectId: plan.projectId,
                taskId: card.id,
                kind: 'test-report',
                title: `质量门禁 · ${card.title}`,
                body: [
                  `结果：${report.passed ? 'passed' : 'failed'}${report.skipped ? '（未配置检查脚本）' : ''}`,
                  ...report.checks.map(
                    (check) =>
                      `## ${check.name} · ${check.status} · exit ${check.exitCode ?? '—'}\n$ ${check.command}\n${check.output.slice(-6000)}`,
                  ),
                ].join('\n\n'),
                verified: report.passed,
              }),
            )
          }
          if (!report.passed) {
            try {
              this.services.tasks.move(
                { taskId: card.id, expectedVersion: card.version, to: 'blocked', note: '质量门禁未通过' },
                SYSTEM_ACTOR,
              )
            } catch (error) {
              this.logger.warn({ err: error, taskId: card.id }, 'failed to block task after quality gate')
            }
            this.saveExecution(plan, {
              ...plan.execution!,
              status: 'failed',
              error: `质量门禁未通过：${report.checks.filter((check) => check.status === 'failed' || check.status === 'error').map((check) => check.name).join(', ')}`,
              updatedAt: now(),
            })
            this.disarm(planId)
            return
          }
        }
        try {
          this.services.tasks.move(
            { taskId: card.id, expectedVersion: card.version, to: 'done', note: '编排器自动验收通过' },
            SYSTEM_ACTOR,
          )
          changed = true
        } catch (error) {
          this.logger.warn({ err: error, taskId: card.id }, 'failed to auto-complete reviewed task')
        }
      }

      plan = this.getPlan(planId)
      const refreshed = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
      if (refreshed.every((card) => card.status === 'done')) {
        let completedExecution: PlanExecution = { ...plan.execution!, status: 'completed', error: null, updatedAt: now() }
        if (completedExecution.branch && completedExecution.workspaceRef && !completedExecution.diffArtifactId) {
          try {
            const diff = await this.worktrees.diff(completedExecution.workspaceRef)
            const artifact = this.store.createArtifact(
              createArtifactRecord({
                projectId: plan.projectId,
                kind: 'diff',
                title: `编排 Diff · ${plan.goal.slice(0, 80)}`,
                body: diff,
                uri: completedExecution.branch,
              }),
            )
            completedExecution = { ...completedExecution, diffArtifactId: artifact.id }
          } catch (error) {
            this.logger.warn({ err: error, planId }, 'failed to create orchestration diff artifact')
          }
        }
        this.saveExecution(plan, completedExecution)
        this.disarm(planId)
        return
      }

      for (const card of refreshed) {
        const retryAt = plan.execution?.nextAttemptAt[card.id] ?? 0
        const latest = this.store.read.getLatestRunForTask(card.id)
        const retryReady =
          card.status === 'blocked' &&
          latest?.status === 'failed' &&
          retryAt > 0 &&
          now() >= retryAt
        if ((card.status !== 'backlog' && !retryReady) || card.blockedBy.length > 0) continue
        try {
          this.services.tasks.move(
            { taskId: card.id, expectedVersion: card.version, to: 'ready' },
            SYSTEM_ACTOR,
          )
          changed = true
        } catch (error) {
          this.logger.warn({ err: error, taskId: card.id }, 'failed to promote orchestrated task')
        }
      }

      plan = this.getPlan(planId)
      const currentExecution = plan.execution
      if (!currentExecution) throw new AppError('CONFLICT', '计划缺少执行状态')
      const ready = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
        .filter((card) => card.status === 'ready' && !this.store.read.getActiveRunForTask(card.id))
        .sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt)

      const active = plan.createdTaskIds
        .map((taskId) => this.store.read.getTaskCard(taskId))
        .filter((card): card is TaskCard => Boolean(card))
        .filter((card) => card.status === 'running').length
      const slots = Math.max(0, currentExecution.concurrency - active)
      const runIds = [...currentExecution.runIds]
      for (const card of ready.slice(0, slots)) {
        if (!card.assigneeAgentId) {
          this.logger.warn({ taskId: card.id }, 'orchestrated task has no assignee')
          continue
        }
        try {
          const session = this.services.sessions.create(
            {
              projectId: plan.projectId,
              agentId: card.assigneeAgentId,
              title: `编排 · ${card.title}`.slice(0, 240),
            },
            SYSTEM_ACTOR,
          )
          const result = await this.runner.startRun({
            projectId: plan.projectId,
            sessionId: session.id,
            taskId: card.id,
            workspaceRoot,
            prompt: [
              `执行计划任务：${card.title}`,
              card.description || '',
              card.acceptanceCriteria.length ? `验收标准：\n- ${card.acceptanceCriteria.join('\n- ')}` : '',
              '请使用工具完成实际工作并创建必要的交付物。完成后如任务仍未进入 review，请调用 update_task_status 将其标记为完成；编排器会进行自动验收。',
            ]
              .filter(Boolean)
              .join('\n\n'),
          })
          runIds.push(result.runId)
          changed = true
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          this.logger.warn({ err: error, taskId: card.id }, 'orchestrated run failed to start')
          this.saveExecution(plan, { ...currentExecution, status: 'failed', error: message, runIds, updatedAt: now() })
          this.disarm(planId)
          return
        }
      }

      if (changed || runIds.length !== currentExecution.runIds.length) {
        this.saveExecution(plan, { ...currentExecution, status: 'running', runIds, updatedAt: now() })
      }
    } catch (error) {
      this.logger.error({ err: error, planId }, 'orchestration tick failed')
      try {
        const plan = this.getPlan(planId)
        if (plan.execution?.status === 'running') {
          this.saveExecution(plan, {
            ...plan.execution,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            updatedAt: now(),
          })
        }
      } catch {
        // plan may have been removed
      }
      this.disarm(planId)
    } finally {
      this.ticking.delete(planId)
    }
  }
}

