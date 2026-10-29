import { now, type PlanDraft, type TaskCard } from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import type { CoreServices } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import { failingVerifications, planReviewEvidence } from './review-evidence-runtime.js'
import { recollectForReview } from './review-snapshot-collector.js'
import type { PlanGrantService } from './plan-grant.js'
import type { OrchestrationScheduler } from './orchestrator.js'
import type { Logger } from './logger.js'

/**
 * ADR-0028 — a code change invalidates the review, so the product must arrange the *re-review*.
 *
 * The real Phase 2.8.7 chain stopped here:
 *
 *   test fails → replan → developer fixes → test passes → old review is stale
 *   → "current content has no review" → paused → (a whole new plan revision was the only way out)
 *
 * That is wrong: re-review is a normal verification step of the *same* work, not new planning.
 * This coordinator reuses the plan's existing review task, the existing task/Run/Artifact
 * machinery and the existing scheduler:
 *
 *   - it never fabricates a Review Artifact or a verdict;
 *   - it never overwrites the old review (the old Artifact stays as audit history);
 *   - it only uses legal task transitions (`done → review → blocked → ready`), recorded as
 *     `task.moved` events, and never writes the database directly;
 *   - it is idempotent per (task, content fingerprint): the same content is never re-reviewed twice;
 *   - when the plan has no review task, it reports `needs-replan` and lets the Replanner add one.
 */

export type ReReviewOutcomeKind = 'scheduled' | 'in-progress' | 'not-needed' | 'needs-replan' | 'blocked'

export interface ReReviewOutcome {
  kind: ReReviewOutcomeKind
  planId: string
  taskId: string | null
  /** Content fingerprint the re-review is about. */
  fingerprint: string | null
  reasons: string[]
}

/** Persisted on the plan execution so a crash between the moves cannot lose the intent. */
interface ReReviewMarker {
  taskId: string
  fingerprint: string
  requestedAt: number
}

const REVIEW_ROLES = /^(reviewer|review|审查|评审)$/i

function isReviewTask(card: TaskCard, plannedRole: string | null): boolean {
  if (plannedRole && REVIEW_ROLES.test(plannedRole.trim())) return true
  return card.labels.some((label) => REVIEW_ROLES.test(label.trim()))
}

export class ReviewCoordinator {
  constructor(
    private readonly store: SqliteStore,
    private readonly services: CoreServices,
    private readonly grants: PlanGrantService,
    private readonly scheduler: OrchestrationScheduler,
    private readonly logger: Logger,
  ) {}

  /** All plans of a project that may need an automatic re-review. */
  reconcileProject(projectId: string): ReReviewOutcome[] {
    const outcomes: ReReviewOutcome[] = []
    for (const plan of this.store.read.listAllPlanRevisions()) {
      if (plan.projectId !== projectId) continue
      const status = plan.execution?.status
      if (!plan.execution || status === 'cancelled') continue
      if (status !== 'paused' && status !== 'running') continue
      const outcome = this.reconcilePlan(plan)
      if (outcome && outcome.kind !== 'not-needed') outcomes.push(outcome)
    }
    return outcomes
  }

  /** Decides (and if allowed, schedules) a re-review for one plan. */
  reconcilePlan(plan: PlanDraft): ReReviewOutcome | null {
    const base: ReReviewOutcome = { kind: 'not-needed', planId: plan.id, taskId: null, fingerprint: null, reasons: [] }

    // Something is still executing: let it finish before judging the evidence.
    const activeRuns = plan.createdTaskIds
      .map((taskId) => this.store.read.getActiveRunForTask(taskId))
      .filter((run): run is NonNullable<typeof run> => Boolean(run))
    if (activeRuns.length > 0) return { ...base, kind: 'in-progress', reasons: ['仍有活动 Run，暂不安排复审'] }

    const resolution = planReviewEvidence(this.store, plan)
    if (resolution.approved) return { ...base, reasons: ['当前内容已有通过的审查'] }
    if (resolution.current.length > 0) {
      // A current, non-approving review exists: that is a fix request, i.e. the Replanner's job.
      return { ...base, reasons: [`当前审查结论为 ${resolution.verdict}，应进入修复而不是复审`] }
    }

    const root = plan.execution?.workspaceRef
    if (!root) return { ...base, kind: 'needs-replan', reasons: ['计划没有工作区，无法重新采集审查快照'] }

    // Only review *passing* code. A failing suite must be fixed first.
    const failing = failingVerifications(this.store, plan)
    if (failing.length > 0) {
      return {
        ...base,
        kind: 'needs-replan',
        reasons: [`仍有未通过的验证：${failing.map((item) => `${item.command.slice(0, 60)}(exit ${item.exitCode})`).join('、')}`],
      }
    }

    // Which review task can we reuse?
    const plannedByTaskId = new Map<string, string>()
    for (const planned of plan.tasks) {
      const taskId = plan.createdTaskIds[plan.tasks.indexOf(planned)]
      if (taskId) plannedByTaskId.set(taskId, planned.role)
    }
    const cards = plan.createdTaskIds
      .map((taskId) => this.store.read.getTaskCard(taskId))
      .filter((card): card is TaskCard => Boolean(card))
    const reviewCards = cards.filter((card) => isReviewTask(card, plannedByTaskId.get(card.id) ?? null))
    if (reviewCards.length === 0) {
      return { ...base, kind: 'needs-replan', reasons: ['原计划没有可复用的审查任务'] }
    }

    // The scope comes from the review's own previous Artifact: without one we cannot know what to
    // re-check, and inventing a scope would be worse than asking the Replanner for one.
    let chosen: { card: TaskCard; fingerprint: string; staleArtifactIds: string[]; reviewedObjects: string[] } | null = null
    for (const card of reviewCards) {
      const artifacts = this.store.read
        .listArtifacts(plan.projectId, card.id)
        .filter((artifact) => (artifact.metadata as Record<string, unknown> | null)?.artifactType === 'review')
        .sort((a, b) => b.createdAt - a.createdAt)
      const latest = artifacts[0]
      if (!latest) continue
      const metadata = (latest.metadata ?? {}) as Record<string, unknown>
      const snapshot = recollectForReview(root, metadata)
      if (!snapshot) continue
      chosen = {
        card,
        fingerprint: snapshot.fingerprint,
        staleArtifactIds: artifacts.map((artifact) => artifact.id),
        reviewedObjects: Array.isArray(metadata.reviewedObjects)
          ? metadata.reviewedObjects.filter((item): item is string => typeof item === 'string')
          : [],
      }
      break
    }
    if (!chosen) {
      return { ...base, kind: 'needs-replan', reasons: ['审查任务缺少可复核的旧审查范围（reviewedObjects/scope）'] }
    }

    // Idempotency: the same content fingerprint is never re-reviewed twice.
    const mark = this.reReviewMarker(plan)
    if (mark && mark.taskId === chosen.card.id && mark.fingerprint === chosen.fingerprint) {
      return {
        ...base,
        kind: 'in-progress',
        taskId: chosen.card.id,
        fingerprint: chosen.fingerprint,
        reasons: ['同一内容指纹的复审已经安排，等待其完成'],
      }
    }
    const latestRun = this.store.read.getLatestRunForTask(chosen.card.id)
    if (latestRun && ['created', 'queued', 'running', 'waiting_approval', 'waiting_tool', 'verifying'].includes(latestRun.status)) {
      return {
        ...base,
        kind: 'in-progress',
        taskId: chosen.card.id,
        fingerprint: chosen.fingerprint,
        reasons: [`审查任务已有进行中的 Run（${latestRun.id}）`],
      }
    }

    // Authorization: a re-review runs a real Agent Run, so the grant must allow it.
    const grant = this.grants.get(plan.id)
    if (!grant || !grant.valid || grant.status !== 'active') {
      return {
        ...base,
        kind: 'blocked',
        taskId: chosen.card.id,
        fingerprint: chosen.fingerprint,
        reasons: ['计划执行授权无效或已撤销，不能自动启动复审'],
      }
    }
    if (chosen.card.assigneeAgentId && !grant.allowedAgentIds.includes(chosen.card.assigneeAgentId)) {
      return {
        ...base,
        kind: 'blocked',
        taskId: chosen.card.id,
        fingerprint: chosen.fingerprint,
        reasons: [`复审 Agent ${chosen.card.assigneeAgentId} 不在执行授权范围内`],
      }
    }

    try {
      this.reopenForReview(plan, chosen.card, chosen.fingerprint)
    } catch (error) {
      this.logger.warn({ err: error, planId: plan.id, taskId: chosen.card.id }, 'failed to reopen review task')
      return {
        ...base,
        kind: 'blocked',
        taskId: chosen.card.id,
        fingerprint: chosen.fingerprint,
        reasons: [`无法将审查任务合法地重新排队：${error instanceof Error ? error.message : String(error)}`],
      }
    }

    this.store.appendEvent(plan.projectId, plan.id, 'plan.review.reopened', {
      planId: plan.id,
      taskId: chosen.card.id,
      replyOf: chosen.staleArtifactIds[0] ?? null,
      staleArtifactIds: chosen.staleArtifactIds,
      reviewedObjects: chosen.reviewedObjects,
      fingerprint: chosen.fingerprint,
      reason: '内容已变化，旧审查失效，复用原计划审查任务重新审查当前内容',
      authorizedBy: 'policy',
      policy: 'autoReview',
    })
    this.logger.info(
      { planId: plan.id, taskId: chosen.card.id, fingerprint: chosen.fingerprint.slice(0, 12) },
      'scheduled autonomous re-review of the current content',
    )
    return {
      kind: 'scheduled',
      planId: plan.id,
      taskId: chosen.card.id,
      fingerprint: chosen.fingerprint,
      reasons: ['旧的审查快照与当前内容不一致，已复用原审查任务安排复审'],
    }
  }

  /**
   * Legal reopen: `done → review → blocked → ready`, all synchronously so no scheduler tick can
   * observe the intermediate `review` state and re-complete the task with the stale evidence.
   * Every step is a recorded `task.moved` event.
   */
  private reopenForReview(plan: PlanDraft, card: TaskCard, fingerprint: string): void {
    const marker: ReReviewMarker = { taskId: card.id, fingerprint, requestedAt: now() }
    this.store.updatePlanRevision({
      ...plan,
      execution: { ...plan.execution!, reReview: marker },
      updatedAt: now(),
    })
    const actor = { kind: 'system' as const, id: 'review-coordinator', name: '复审协调器' }
    let current = card
    const note = '内容变化导致旧审查失效，重新排队复审（复用原任务）'
    if (current.status === 'done') {
      current = this.services.tasks.move({ taskId: current.id, expectedVersion: current.version, to: 'review', note }, actor)
    }
    if (current.status === 'review') {
      current = this.services.tasks.move({ taskId: current.id, expectedVersion: current.version, to: 'blocked', note }, actor)
    }
    if (current.status === 'blocked' || current.status === 'backlog') {
      current = this.services.tasks.move({ taskId: current.id, expectedVersion: current.version, to: 'ready', note }, actor)
    }
    // Re-arm the scheduler: a paused plan must resume for the re-review Run to start.
    if (plan.execution?.status === 'paused') {
      this.scheduler.resume(plan.id)
    } else {
      this.scheduler.nudgeProject(plan.projectId)
    }
  }

  private reReviewMarker(plan: PlanDraft): ReReviewMarker | null {
    const raw = (plan.execution as unknown as { reReview?: unknown } | null)?.reReview
    if (!raw || typeof raw !== 'object') return null
    const record = raw as Record<string, unknown>
    if (typeof record.taskId !== 'string' || typeof record.fingerprint !== 'string') return null
    return {
      taskId: record.taskId,
      fingerprint: record.fingerprint,
      requestedAt: typeof record.requestedAt === 'number' ? record.requestedAt : 0,
    }
  }

  /** Clears the marker once the task is complete again (called by the scheduler after completion). */
  clearMarker(planId: string, taskId: string): void {
    const plan = this.store.read.getPlanRevision(planId)
    if (!plan?.execution) return
    const raw = (plan.execution as unknown as { reReview?: unknown }).reReview
    if (!raw || typeof raw !== 'object') return
    if ((raw as ReReviewMarker).taskId !== taskId) return
    this.store.updatePlanRevision({
      ...plan,
      execution: { ...plan.execution, reReview: null },
      updatedAt: now(),
    })
    this.store.appendEvent(plan.projectId, planId, PROJECT_EVENT_TYPES.taskCompleted, {
      taskId,
      reason: 're-review completed on the current content',
    })
  }
}
