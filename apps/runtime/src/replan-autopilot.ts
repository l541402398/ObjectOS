import { execFileSync } from 'node:child_process'
import type { PlanDraft, PlannedTask, ReplanProposalView } from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import {
  evaluateReplanAuthorization,
  type ReplanAuthorization,
  type ReplanEnvelope,
  type ReplanRequirements,
} from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import type { OrchestrationService } from './orchestration.js'
import type { OrchestrationScheduler } from './orchestrator.js'
import type { PlanGrantService } from './plan-grant.js'
import type { ReplanService } from './replan-service.js'
import type { ActionCenter, ProjectAutonomySettings } from './action-center.js'
import type { LifecycleService } from './lifecycle.js'
import type { TaskContractPreflightService } from './task-contract-preflight.js'
import { describeGaps } from './task-contract-preflight.js'
import { failingVerifications, planReviewEvidence } from './review-evidence-runtime.js'
import { recollectForReview } from './review-snapshot-collector.js'
import { reviewRecordProvenance } from '@projectos/application'
import type { Logger } from './logger.js'

/**
 * ADR-0026 — the product's own autonomy pipeline.
 *
 * ProjectOS already owns every capability needed to finish a piece of work: the Replanner produces
 * revisions, the Grant system defines what is authorized, the Scheduler starts Runs, the Worktree
 * manager merges. What was missing is the step that *decides and does* — previously an E2E script
 * called `replan.apply`, `plans.approve`, `plans.grant.issue`, `orchestration.start` and
 * `worktrees.merge` in sequence, so "autonomy" was scripted, not product behaviour.
 *
 * This pipeline closes it, strictly inside the user's authorization:
 *
 *   1. An approved plan with an active grant is started by the product (policy: autoStartPlans).
 *   2. A revision proposed by the Replanner is preflighted, compared against the live grant
 *      envelope, and applied + started only when it fits (policy: autoApplyReplans). Anything
 *      wider goes to the user with the exact delta.
 *   3. A plan paused while waiting for an approval resumes itself when the approval lands.
 *   4. A completed plan is delivered by the product when every delivery condition holds
 *      (policy: autoDeliver, opt-in).
 *
 * It never issues a human grant, never fakes a plan approval basis, never widens scope, and it
 * records every decision as a business event so the report can separate product actions from
 * script actions.
 */

export type AutonomyOutcomeKind =
  | 'plan.auto-started'
  | 'replan.auto-applied'
  | 'replan.awaiting-approval'
  | 'replan.blocked'
  | 'plan.auto-resumed'
  | 'plan.auto-delivered'
  | 'delivery.blocked'
  | 'contract.rejected'
  | 'nothing'

export interface AutonomyOutcome {
  kind: AutonomyOutcomeKind
  projectId: string
  planId: string | null
  proposalId?: string | null
  reasons: string[]
  diffs?: string[]
}

const APPROVAL_WAIT_MARKER = '等待审批'

export class ReplanAutopilot {
  private readonly inFlight = new Set<string>()

  constructor(
    private readonly store: SqliteStore,
    private readonly replans: ReplanService,
    private readonly orchestration: OrchestrationService,
    private readonly grants: PlanGrantService,
    private readonly scheduler: OrchestrationScheduler,
    private readonly actions: ActionCenter,
    private readonly preflight: TaskContractPreflightService,
    private readonly lifecycle: LifecycleService,
    private readonly logger: Logger,
  ) {}

  /** Records an autonomous decision as a durable business event. */
  private record(projectId: string, aggregateId: string, type: string, payload: Record<string, unknown>): void {
    try {
      this.store.appendEvent(projectId, aggregateId, type, payload)
    } catch (error) {
      this.logger.warn({ err: error, projectId, type }, 'failed to record autonomy decision')
    }
  }

  /**
   * Starts a plan through the same grant reservation path as the IPC start, so an autonomous
   * start consumes the user's budget exactly once and cannot bypass `assertStartAllowed`.
   * Duplicate passes reuse the reservation instead of burning another Run quota.
   */
  private async startThroughGrant(plan: PlanDraft): Promise<void> {
    const grant = this.grants.assertStartAllowed(plan)
    const reserved = this.grants.reserveStart(plan, grant, `autonomy:${plan.id}:r${plan.revision}`)
    if (!reserved) throw new Error('启动预留失败：授权配额不可用')
    try {
      await this.scheduler.start(
        plan.id,
        plan.execution?.concurrency ?? 2,
        plan.execution?.maxRetries ?? 2,
        false,
        plan.execution?.requireWorktree ?? false,
        plan.execution?.allowedPaths ?? ['.'],
        plan.execution?.maxEvidenceRetries ?? 1,
      )
    } catch (error) {
      // Settle honestly: only a real side effect consumes the reservation.
      this.grants.settleStartFailure(reserved.reservation.id, plan.id, error instanceof Error ? error.message : String(error))
      throw error
    }
    const started = this.store.read.getPlanRevision(plan.id)
    if (started) this.grants.markStartSucceeded(reserved.reservation.id, started)
  }

  policy(projectId: string): ProjectAutonomySettings {
    return this.actions.autonomySettings(projectId)
  }

  /**
   * One autonomous pass for a project. Fire-and-forget friendly: callers (event hub,
   * coordinator tick) must never block on it, and a duplicate call is dropped.
   */
  advance(projectId: string): void {
    if (this.inFlight.has(projectId)) return
    this.inFlight.add(projectId)
    void this.runPass(projectId)
      .catch((error) => {
        this.logger.warn({ err: error, projectId }, 'autonomy pipeline pass failed')
      })
      .finally(() => this.inFlight.delete(projectId))
  }

  /** Runs one pass synchronously-awaited; exposed for tests and diagnostics. */
  async runPass(projectId: string): Promise<AutonomyOutcome[]> {    const outcomes: AutonomyOutcome[] = []
    const policy = this.policy(projectId)
    if (policy.mode !== 'autonomous') return outcomes

    outcomes.push(...(await this.resumeApprovalPaused(projectId, policy)))
    if (policy.autoStartPlans) outcomes.push(...(await this.autoStartApproved(projectId, policy)))
    outcomes.push(...(await this.autoApplyReplans(projectId, policy)))
    this.recordReviewEvidence(projectId)
    if (policy.autoDeliver) outcomes.push(...(await this.autoDeliverCompleted(projectId, policy)))
    return outcomes
  }

  // ---------------------------------------------------------------- approval resume

  /**
   * A plan paused because it was waiting for an approval resumes as soon as that approval is
   * decided — no chat message, no button. This is the other half of the approval-park fix.
   */
  private async resumeApprovalPaused(
    projectId: string,
    policy: ProjectAutonomySettings,
  ): Promise<AutonomyOutcome[]> {
    const outcomes: AutonomyOutcome[] = []
    for (const plan of this.store.read.listAllPlanRevisions()) {
      if (plan.projectId !== projectId) continue
      if (plan.execution?.status !== 'paused') continue
      if (!(plan.execution.error ?? '').includes(APPROVAL_WAIT_MARKER)) continue
      const pending = this.pendingApprovalForPlan(plan)
      if (pending) continue
      try {
        this.scheduler.resume(plan.id)
        this.record(projectId, plan.id, PROJECT_EVENT_TYPES.planStatusChanged, {
          planId: plan.id,
          revision: plan.revision,
          from: 'paused',
          to: 'running',
          reason: 'approval.settled',
          authorizedBy: 'policy',
          policy: 'autoStartPlans',
        })
        outcomes.push({
          kind: 'plan.auto-resumed',
          projectId,
          planId: plan.id,
          reasons: ['等待审批的计划在审批落定后自动恢复'],
        })
      } catch (error) {
        this.logger.warn({ err: error, planId: plan.id }, 'failed to auto-resume plan after approval')
      }
    }
    void policy
    return outcomes
  }

  private pendingApprovalForPlan(plan: PlanDraft): string | null {
    for (const taskId of plan.createdTaskIds) {
      const run = this.store.read.getActiveRunForTask(taskId)
      if (!run) continue
      const row = this.store.db
        .prepare("SELECT id FROM approvals WHERE run_id = ? AND status = 'pending' LIMIT 1")
        .get(run.id) as { id: string } | undefined
      if (row) return String(row.id)
    }
    return null
  }

  // ---------------------------------------------------------------- auto start

  private async autoStartApproved(
    projectId: string,
    policy: ProjectAutonomySettings,
  ): Promise<AutonomyOutcome[]> {
    const outcomes: AutonomyOutcome[] = []
    const candidates = this.store.read
      .listAllPlanRevisions()
      .filter((plan) => plan.projectId === projectId && plan.status === 'approved')
      .filter((plan) => !plan.execution || !['running', 'paused', 'completed'].includes(plan.execution.status))
      .sort((a, b) => b.revision - a.revision)
    for (const plan of candidates) {
      // Only a real, currently valid grant may start a Run tree.
      let grant: ReturnType<PlanGrantService['get']> = null
      try {
        grant = this.grants.get(plan.id)
      } catch {
        continue
      }
      if (!grant || !grant.valid || grant.status !== 'active' || !grant.canStart) continue
      const preflight = this.preflight.preflightPlan(plan)
      // A broken task tree is never "started anyway". Gaps that only the Planner can fix
      // (assignment, capability, tool, contract mapping) block an autonomous start exactly
      // like fatal ones; the fix belongs to a replan, not to a Runtime failure mid-run.
      const blocking = preflight.tasks.flatMap((item) =>
        item.gaps.filter(
          (gap) =>
            gap.severity === 'fatal' ||
            ['unassigned', 'agent-not-in-project', 'agent-disabled', 'missing-capability', 'missing-tool', 'unknown-work-type'].includes(
              gap.code,
            ),
        ),
      )
      if (blocking.length > 0) {
        outcomes.push({
          kind: 'contract.rejected',
          projectId,
          planId: plan.id,
          reasons: [`任务契约预检未通过：${describeGaps(blocking)}`],
        })
        this.record(projectId, plan.id, PROJECT_EVENT_TYPES.custom, {
          kind: 'plan.contract.rejected',
          planId: plan.id,
          gaps: blocking,
        })
        continue
      }
      try {
        await this.startThroughGrant(plan)
        this.record(projectId, plan.id, PROJECT_EVENT_TYPES.planStatusChanged, {
          planId: plan.id,
          revision: plan.revision,
          from: 'approved',
          to: 'running',
          reason: 'policy.autoStart',
          authorizedBy: 'policy',
          policy: 'autoStartPlans',
        })
        outcomes.push({
          kind: 'plan.auto-started',
          projectId,
          planId: plan.id,
          reasons: [`计划已有有效授权 ${grant.id}，由产品直接开始执行`],
        })
      } catch (error) {
        this.logger.warn({ err: error, planId: plan.id }, 'auto start failed')
      }
    }
    void policy
    return outcomes
  }

  // ---------------------------------------------------------------- replan

  /** The envelope a revision must fit in: the live grant of the source plan. */
  private envelopeFor(planId: string): { envelope: ReplanEnvelope | null; grantId: string | null } {
    const grant = this.grants.get(planId)
    if (!grant) return { envelope: null, grantId: null }
    return {
      grantId: grant.id,
      envelope: {
        grantId: grant.id,
        actions: grant.actions,
        allowedPaths: grant.allowedPaths,
        allowedAgentIds: grant.allowedAgentIds,
        remainingRuns: Math.max(0, grant.maxRuns - grant.usedRuns - grant.reservedRuns),
        remainingToolCalls: Math.max(0, grant.maxToolCalls - grant.usedToolCalls),
        expiresAt: grant.expiresAt,
        allowOverBudget: grant.allowOverBudget,
      },
    }
  }

  private requirementsFor(proposal: ReplanProposalView, source: PlanDraft): ReplanRequirements {
    const agentsRequired = [
      ...new Set(
        proposal.proposedTasks
          .map((task) => task.agentId)
          .filter((agentId): agentId is string => typeof agentId === 'string' && agentId.length > 0),
      ),
    ]
    const tasksToRun = Math.max(1, proposal.diff.added.length + proposal.diff.modified.length)
    return {
      agentsRequired,
      // Plans do not declare write paths; the grant still enforces paths at tool level. A
      // revision that needs a path outside the grant is stopped there, not silently allowed.
      pathsRequired: [],
      tasksToRun,
      startsNeeded: 1,
      toolCallsNeeded: Math.max(1, tasksToRun * 6),
      downgradeNotes: this.preflight.downgradeNotes(source, proposal.proposedTasks),
    }
  }

  /** The exact authorization decision for one proposal. Read-only; used by the UI too. */
  evaluateProposal(proposalId: string): {
    authorization: ReplanAuthorization
    requirements: ReplanRequirements
    envelopeGrantId: string | null
    preflightGaps: string[]
  } {
    const proposal = this.replans.get(proposalId)
    const source = this.orchestration.getPlan(proposal.planId)
    const { envelope, grantId } = this.envelopeFor(source.id)
    const policy = this.policy(source.projectId)
    const autoReplansUsed = this.autoReplansUsed(source.projectId)
    const budget = this.store.read.getProjectBudget(source.projectId)
    const spent = this.store.read.summarizeAIUsage(source.projectId).estimatedCost
    const requirements = this.requirementsFor(proposal, source)
    const authorization = evaluateReplanAuthorization({
      policy: {
        mode: policy.mode,
        autoApplyReplans: policy.autoApplyReplans,
        maxAutoReplans: policy.maxAutoReplans,
        autoReplansUsed,
      },
      envelope,
      requirements,
      projectBudget: budget ? { softLimit: budget.softLimit, spent } : null,
      now: Date.now(),
    })
    const preflight = this.preflight.preflightPlan(source, proposal.proposedTasks as PlannedTask[], null)
    const preflightGaps = preflight.tasks.flatMap((task) =>
      task.gaps.map((gap) => `${task.key}: ${gap.message}`),
    )
    return { authorization, requirements, envelopeGrantId: grantId, preflightGaps }
  }

  /**
   * Exact count of policy-authorized revisions for this project in the last 24h.
   *
   * This MUST be a query, not `listEventViews(projectId, 500)`: a bounded window of the newest
   * events silently forgets older applies as unrelated events churn, so the cap never triggers.
   * A real run produced 21 policy applies against a cap of 3 because of exactly that window.
   */
  private autoReplansUsed(projectId: string): number {
    const since = Date.now() - 24 * 60 * 60 * 1000
    const row = this.store.db
      .prepare(
        "SELECT COUNT(*) AS value FROM project_events WHERE project_id = ? AND event_type = 'plan.replan.applied' AND json_extract(payload_json, '$.authorizedBy') = 'policy' AND created_at >= ?",
      )
      .get(projectId, since) as { value: number } | undefined
    const count = Number(row?.value ?? 0)
    if (count > 0) return count
    // Fallback for stores that cannot evaluate the JSON path (defensive, still unbounded).
    const events = this.store.db
      .prepare("SELECT payload_json FROM project_events WHERE project_id = ? AND event_type = 'plan.replan.applied' AND created_at >= ?")
      .all(projectId, since) as Array<{ payload_json: string }>
    return events.filter((event) => {
      try {
        return JSON.parse(event.payload_json).authorizedBy === 'policy'
      } catch {
        return false
      }
    }).length
  }

  private async autoApplyReplans(
    projectId: string,
    policy: ProjectAutonomySettings,
  ): Promise<AutonomyOutcome[]> {
    const outcomes: AutonomyOutcome[] = []
    const proposals = this.replans
      .list(projectId)
      .filter((proposal) => proposal.status === 'proposed')
      .sort((a, b) => a.createdAt - b.createdAt)
    for (const proposal of proposals) {
      let evaluation: ReturnType<ReplanAutopilot['evaluateProposal']>
      try {
        evaluation = this.evaluateProposal(proposal.id)
      } catch (error) {
        this.logger.warn({ err: error, proposalId: proposal.id }, 'failed to evaluate replan proposal')
        continue
      }
      const { authorization, preflightGaps } = evaluation
      if (authorization.decision === 'blocked') {
        outcomes.push({
          kind: 'replan.blocked',
          projectId,
          planId: proposal.planId,
          proposalId: proposal.id,
          reasons: authorization.reasons,
          diffs: authorization.diffs,
        })
        this.record(projectId, proposal.planId, PROJECT_EVENT_TYPES.custom, {
          kind: 'plan.replan.authorization',
          proposalId: proposal.id,
          decision: 'blocked',
          reasons: authorization.reasons,
          diffs: authorization.diffs,
        })
        continue
      }
      if (preflightGaps.length > 0) {
        outcomes.push({
          kind: 'contract.rejected',
          projectId,
          planId: proposal.planId,
          proposalId: proposal.id,
          reasons: [`修订任务契约不可履约：${preflightGaps.join('；')}`],
        })
        this.record(projectId, proposal.planId, PROJECT_EVENT_TYPES.custom, {
          kind: 'plan.replan.contractRejected',
          proposalId: proposal.id,
          gaps: preflightGaps,
        })
        continue
      }
      if (authorization.decision === 'require-approval') {
        outcomes.push({
          kind: 'replan.awaiting-approval',
          projectId,
          planId: proposal.planId,
          proposalId: proposal.id,
          reasons: authorization.reasons,
          diffs: authorization.diffs,
        })
        // Idempotent: the Action Center derives the item from the proposal itself, so only
        // the decision is recorded here, once per proposal+decision.
        this.record(projectId, proposal.planId, PROJECT_EVENT_TYPES.custom, {
          kind: 'plan.replan.authorization',
          proposalId: proposal.id,
          decision: 'require-approval',
          reasons: authorization.reasons,
          diffs: authorization.diffs,
        })
        continue
      }
      try {
        const applied = await this.applyProposal(proposal.id, 'policy', authorization.reasons)
        outcomes.push({
          kind: 'replan.auto-applied',
          projectId,
          planId: proposal.planId,
          proposalId: proposal.id,
          reasons: authorization.reasons,
          diffs: authorization.diffs,
        })
        this.logger.info(
          { projectId, proposalId: proposal.id, revisedPlanId: applied.planId },
          'revision applied and started by autonomy policy inside the granted envelope',
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.record(projectId, proposal.planId, PROJECT_EVENT_TYPES.custom, {
          kind: 'plan.replan.applyFailed',
          proposalId: proposal.id,
          error: message.slice(0, 2000),
        })
        outcomes.push({
          kind: 'replan.blocked',
          projectId,
          planId: proposal.planId,
          proposalId: proposal.id,
          reasons: [`自动应用修订失败：${message}`],
        })
      }
    }
    void policy
    return outcomes
  }

  /**
   * Applies a proposal through the existing services, then approves, derives the grant from the
   * user's grant and starts the scheduler. `basis: 'user'` is used when a human explicitly
   * approved an out-of-envelope revision in the Action Center.
   */
  async applyProposal(
    proposalId: string,
    basis: 'policy' | 'user',
    reasons: string[],
  ): Promise<{ planId: string; revision: number; grantId: string }> {
    const proposal = this.replans.get(proposalId)
    const source = this.orchestration.getPlan(proposal.planId)
    // Capture the envelope BEFORE the revision supersedes the source plan: supersession
    // revokes the old grant by design, and the derived grant inherits these frozen bounds.
    const { envelope } = this.envelopeFor(source.id)
    if (!envelope) throw new Error('源计划没有可继承的执行授权，必须由用户重新授权')

    const applied = this.replans.applyAuthorized(proposalId, {
      kind: basis,
      reasons: reasons.length > 0 ? reasons : [basis === 'policy' ? '授权范围内自动应用' : '用户批准应用'],
    })
    let approved: { plan: PlanDraft; taskIds: string[] }
    try {
      approved = this.orchestration.approvePlan(applied.plan.id)
    } catch (error) {
      // The proposal is already applied, so this must be visible and actionable rather than an
      // orphaned draft revision. Nothing is retried automatically.
      this.record(source.projectId, applied.plan.id, PROJECT_EVENT_TYPES.custom, {
        kind: 'plan.replan.applyFailed',
        proposalId,
        appliedPlanId: applied.plan.id,
        stage: 'approvePlan',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    this.record(source.projectId, approved.plan.id, PROJECT_EVENT_TYPES.planStatusChanged, {
      planId: approved.plan.id,
      revision: approved.plan.revision,
      from: 'draft',
      to: 'approved',
      reason: basis === 'policy' ? 'policy.within-grant' : 'user.approvedScopeDelta',
      authorizedBy: basis,
      sourcePlanId: source.id,
      proposalId,
    })
    const grant = this.grants.deriveReplanGrant({
      plan: approved.plan,
      sourceGrant: {
        id: envelope.grantId,
        actions: envelope.actions,
        allowedPaths: envelope.allowedPaths,
        allowedAgentIds: envelope.allowedAgentIds,
        maxRuns: envelope.remainingRuns,
        maxToolCalls: envelope.remainingToolCalls,
        expiresAt: envelope.expiresAt,
        allowOverBudget: envelope.allowOverBudget,
      },
      note:
        basis === 'policy'
          ? `授权范围内自动应用修订（提案 ${proposalId}，源计划 r${source.revision}）`
          : `用户批准范围差异后应用修订（提案 ${proposalId}，源计划 r${source.revision}）`,
    })
    await this.startThroughGrant(approved.plan)
    return { planId: approved.plan.id, revision: approved.plan.revision, grantId: grant.id }
  }

  /** Explicit human approval of an out-of-envelope revision (Action Center). */
  async approveProposal(proposalId: string, reasons: string[]): Promise<{ planId: string; grantId: string }> {
    const applied = await this.applyProposal(proposalId, 'user', reasons)
    return { planId: applied.planId, grantId: applied.grantId }
  }

  // ---------------------------------------------------------------- gate evidence

  /**
   * A version gate asks for `review_record` evidence, but nothing in the product produced it, so
   * a real, current, approving review could never unblock the gate. This records that evidence
   * *from* the real review artifact: no verdict is invented, and the provenance binds the record
   * to the plan revision and content fingerprint so a later change invalidates it (ADR-0025).
   */
  private recordReviewEvidence(projectId: string): void {
    const completed = this.store.read
      .listAllPlanRevisions()
      .filter((plan) => plan.projectId === projectId && plan.versionId)
      .filter((plan) => plan.execution?.status === 'completed')
    for (const plan of completed) {
      const resolution = planReviewEvidence(this.store, plan)
      if (!resolution.approved) continue
      const approved = resolution.current.find((item) => item.verdict === 'approved')
      if (!approved) continue
      const taskIds = plan.createdTaskIds
      const artifact = taskIds
        .flatMap((taskId) => this.store.read.listArtifacts(plan.projectId, taskId))
        .find((item) => item.id === approved.id)
      if (!artifact) continue
      const metadata = (artifact.metadata ?? {}) as Record<string, unknown>
      const root = plan.execution?.workspaceRef ?? null
      const snapshot = root ? recollectForReview(root, metadata) : null
      if (!snapshot) continue
      const binding = {
        reviewArtifactId: artifact.id,
        planId: plan.id,
        planRevision: plan.revision,
        snapshotFingerprint: snapshot.fingerprint,
        verdict: 'approved' as const,
        reviewedRevision: snapshot.baselineCommit,
      }
      const existing = this.store.db
        .prepare("SELECT id FROM evidence WHERE project_id = ? AND evidence_type = 'review_record' AND provenance_json LIKE ?")
        .get(plan.projectId, `%${artifact.id}%`) as { id: string } | undefined
      if (existing) continue
      const evidence = this.lifecycle.recordEvidence({
        projectId: plan.projectId,
        subjectType: 'version',
        subjectId: plan.versionId!,
        evidenceType: 'review_record',
        verificationStatus: 'passed',
        assurance: 'source_observed',
        title: `审查通过 · ${approved.title}`.slice(0, 240),
        summary: `计划 r${plan.revision} 的当前内容已通过审查（快照 ${snapshot.fingerprint.slice(0, 8)}）`,
        provenance: reviewRecordProvenance(binding),
      })
      this.record(projectId, plan.id, PROJECT_EVENT_TYPES.custom, {
        kind: 'plan.reviewEvidenceRecorded',
        planId: plan.id,
        revision: plan.revision,
        evidenceId: evidence.id,
        reviewArtifactId: artifact.id,
        snapshotFingerprint: snapshot.fingerprint,
      })
    }
  }

  // ---------------------------------------------------------------- delivery

  /**
   * Automatic delivery is deliberately strict: review must be current and approving, checks must
   * be green, the diff must stay inside the granted paths, the target branch must be unchanged,
   * and the main workspace must be clean. Anything else is reported, never forced.
   */
  private async autoDeliverCompleted(
    projectId: string,
    policy: ProjectAutonomySettings,
  ): Promise<AutonomyOutcome[]> {
    const outcomes: AutonomyOutcome[] = []
    const completed = this.store.read
      .listAllPlanRevisions()
      .filter((plan) => plan.projectId === projectId)
      .filter((plan) => plan.execution?.status === 'completed' && !plan.execution.mergedAt)
      .filter((plan) => Boolean(plan.execution?.branch && plan.execution.workspaceRef))
    for (const plan of completed) {
      const blocked: string[] = []
      const review = planReviewEvidence(this.store, plan)
      if (!review.performed) blocked.push('没有审查 Artifact')
      else if (!review.approved) blocked.push(`审查未通过：${review.reasons.join('；')}`)
      const failing = failingVerifications(this.store, plan)
      if (failing.length > 0) {
        blocked.push(`仍有未通过的验证：${failing.map((item) => `${item.command.slice(0, 60)}(exit ${item.exitCode})`).join('、')}`)
      }
      const info = await this.scheduler.info(plan.id).catch(() => null)
      if (!info?.available) blocked.push('Worktree 不可用')
      const outside = (info?.files ?? []).filter((file) => file.sensitive || !file.allowed)
      if (outside.length > 0) {
        blocked.push(`Worktree 包含敏感或越权文件：${outside.map((file) => file.path).join('、')}`)
      }
      if (plan.execution?.baseBranch) {
        const project = this.store.read.getProject(plan.projectId)
        const current = project ? currentBranch(project.rootPath) : null
        if (current && current !== plan.execution.baseBranch) {
          blocked.push(`目标分支已从 ${plan.execution.baseBranch} 变为 ${current}`)
        }
      }
      if (blocked.length > 0) {
        outcomes.push({
          kind: 'delivery.blocked',
          projectId,
          planId: plan.id,
          reasons: blocked,
        })
        this.record(projectId, plan.id, PROJECT_EVENT_TYPES.custom, {
          kind: 'plan.delivery.blocked',
          planId: plan.id,
          reasons: blocked,
          policy: 'autoDeliver',
        })
        continue
      }
      try {
        const merged = await this.scheduler.merge(plan.id)
        this.record(projectId, plan.id, PROJECT_EVENT_TYPES.custom, {
          kind: 'plan.autoDelivered',
          planId: plan.id,
          branch: plan.execution?.branch,
          baseBranch: plan.execution?.baseBranch ?? null,
          mergedAt: merged.mergedAt,
          reviewFingerprint: review.current[0]?.id ?? null,
          authorizedBy: 'policy',
          policy: 'autoDeliver',
        })
        outcomes.push({
          kind: 'plan.auto-delivered',
          projectId,
          planId: plan.id,
          reasons: ['全部交付条件成立，产品自动合并到目标分支'],
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        outcomes.push({ kind: 'delivery.blocked', projectId, planId: plan.id, reasons: [message] })
      }
    }
    void policy
    return outcomes
  }
}

function currentBranch(rootPath: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: rootPath, encoding: 'utf8' }).trim() || null
  } catch {
    return null
  }
}


