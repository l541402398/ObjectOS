import { now, type PlanDraft } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import { failingVerifications, planReviewEvidence } from './review-evidence-runtime.js'
import type { ActionCenter, ProjectAutonomySettings } from './action-center.js'
import type { PlanGrantService } from './plan-grant.js'

/**
 * ADR-0031 — one goal-driven status instead of "tasks are 100%, project is not delivered".
 *
 * The work center used to make the user assemble the truth from several menus: task progress, plan
 * execution, review tasks, version gates, delivery. Worse, it could show "all tasks done" next to a
 * plan that was paused, and it could ask the user to do something the product was about to do itself.
 *
 * This read model derives, from persisted facts only, the five states a user actually needs:
 * execution, verification, review, delivery, and who owns the next action. It never invents a state:
 * everything maps to a real row (execution status, failing verification exit codes, review resolver
 * output, deliveryStatus/mergeCommit, action-center items).
 */

export type GoalVerificationState = 'unknown' | 'passing' | 'failing'
export type GoalReviewState = 'none' | 'stale' | 'current_negative' | 'approved'
export type GoalDeliveryState = 'none' | 'blocked' | 'merged' | 'verified' | 'merged_verification_failed'

export interface GoalStatusView {
  projectId: string
  planId: string | null
  revision: number | null
  goal: string
  execution: { status: string; error: string | null; updatedAt: number | null } | null
  verification: { state: GoalVerificationState; failing: string[]; detail: string }
  review: { state: GoalReviewState; fingerprint: string | null; detail: string }
  delivery: {
    state: GoalDeliveryState
    mergedAt: number | null
    mergeCommit: string | null
    evidenceId: string | null
    detail: string
  }
  /** Who does what next. `product` means the user must not be given a todo. */
  nextAction: { owner: 'product' | 'human' | 'none'; title: string; detail: string }
  /** Items the product will handle itself (never rendered as user todos). */
  productSteps: Array<{ title: string; detail: string }>
  /** Real human decisions, each with the exact object to open. */
  humanDecisions: Array<{ id: string; kind: string; title: string; reason: string; route: string }>
  policy: { mode: string; autoStartPlans: boolean; autoApplyReplans: boolean; autoDeliver: boolean; maxAutoReplans: number }
}

function latestPlan(store: SqliteStore, projectId: string): PlanDraft | null {
  const plans = store.read
    .listAllPlanRevisions()
    .filter((plan) => plan.projectId === projectId && plan.status === 'approved')
    .sort((a, b) => b.revision - a.revision)
  return plans[0] ?? null
}

export function goalStatusOf(input: {
  store: SqliteStore
  actions: ActionCenter
  grants: PlanGrantService
  projectId: string
}): GoalStatusView {
  const { store, projectId } = input
  const plan = latestPlan(store, projectId)
  const policy: ProjectAutonomySettings = input.actions.autonomySettings(projectId)
  const humanItems = input.actions.items(projectId).filter((item) => !item.stale)

  if (!plan) {
    return {
      projectId,
      planId: null,
      revision: null,
      goal: '',
      execution: null,
      verification: { state: 'unknown', failing: [], detail: '尚未有计划' },
      review: { state: 'none', fingerprint: null, detail: '尚未有审查' },
      delivery: { state: 'none', mergedAt: null, mergeCommit: null, evidenceId: null, detail: '尚未交付' },
      nextAction: {
        owner: humanItems.length > 0 ? 'human' : 'none',
        title: '提交目标并批准计划',
        detail: 'AI 会生成计划；批准并授权后由产品自主执行。',
      },
      productSteps: [],
      humanDecisions: humanItems.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        reason: item.reason,
        route: item.route,
      })),
      policy: { ...policy },
    }
  }

  const execution = plan.execution ?? null
  const failing = failingVerifications(store, plan)
  const resolution = planReviewEvidence(store, plan)
  const deliveryStatus = (execution?.deliveryStatus ?? 'none') as GoalDeliveryState

  const reviewState: GoalReviewState =
    resolution.approved
      ? 'approved'
      : resolution.current.length > 0
        ? 'current_negative'
        : resolution.historical.length > 0
          ? 'stale'
          : 'none'
  const approvedReview = resolution.current.find((item) => item.verdict === 'approved')
  const reviewFingerprint = approvedReview
    ? (() => {
        const artifact = plan.createdTaskIds
          .flatMap((taskId) => store.read.listArtifacts(plan.projectId, taskId))
          .find((item) => item.id === approvedReview.id)
        const snapshot = (artifact?.metadata as Record<string, unknown> | null)?.reviewSnapshot as
          | { fingerprint?: unknown }
          | undefined
        return typeof snapshot?.fingerprint === 'string' ? snapshot.fingerprint : null
      })()
    : null

  const verificationState: GoalVerificationState = failing.length > 0 ? 'failing' : execution ? 'passing' : 'unknown'
  const verificationDetail =
    failing.length > 0
      ? `真实验证未通过：${failing.map((item) => `${item.command.slice(0, 60)}(exit ${item.exitCode})`).join('、')}`
      : execution
        ? '最近一次记录的检查没有失败退出码'
        : '尚未执行'

  const deliveryDetail =
    deliveryStatus === 'verified'
      ? `已合并 ${execution?.mergeCommit?.slice(0, 10) ?? ''} 并通过合并后验证`
      : deliveryStatus === 'merged_verification_failed'
        ? `已合并 ${execution?.mergeCommit?.slice(0, 10) ?? ''}，但合并后验证失败：${execution?.deliveryError ?? ''}`
        : deliveryStatus === 'merged'
          ? `已合并 ${execution?.mergeCommit?.slice(0, 10) ?? ''}，等待合并后验证`
          : execution?.status === 'completed'
            ? '计划已完成，等待满足交付条件'
            : '尚未交付'

  const grant = (() => {
    try {
      return input.grants.get(plan.id)
    } catch {
      return null
    }
  })()
  const grantValid = Boolean(grant?.valid && grant.status === 'active')
  const hasActiveRun = plan.createdTaskIds.some((taskId) => Boolean(store.read.getActiveRunForTask(taskId)))

  // What will the product do by itself? Only claim it when the policy and the live facts allow it.
  const productSteps: Array<{ title: string; detail: string }> = []
  if (execution?.status === 'paused' && policy.autoStartPlans && grantValid && !hasActiveRun) {
    productSteps.push({
      title: '恢复执行',
      detail: (execution.error ?? '').includes('等待审批') ? '审批已落定，产品会自动恢复' : '产品会按授权自动恢复',
    })
  }
  if (reviewState === 'stale' && failing.length === 0 && policy.autoApplyReplans && grantValid) {
    productSteps.push({ title: '自动复审当前内容', detail: '代码已变化，产品会复用原审查任务复审，而不是新建计划' })
  }
  if (execution?.status === 'completed' && reviewState !== 'approved' && policy.autoApplyReplans && grantValid) {
    productSteps.push({ title: '安排复审', detail: '交付前需要针对当前内容的审查，产品会自行安排' })
  }
  if (execution?.status === 'completed' && reviewState === 'approved' && deliveryStatus === 'none' && policy.autoDeliver) {
    productSteps.push({ title: '自动交付', detail: '产品会在全部交付条件成立后合并并做合并后验证' })
  }

  // Human decisions: only items that genuinely need the user.
  const actionableKinds = new Set(['tool_approval', 'task_acceptance', 'delivery_approval', 'deployment_reconciliation', 'run_failure', 'replan_scope', 'plan_delivery'])
  const humanDecisions = humanItems
    .filter((item) => actionableKinds.has(item.kind))
    // A proposal the product can apply inside the grant is not a user todo.
    .filter((item) => !(item.kind === 'replan_scope' && policy.autoApplyReplans && policy.mode === 'autonomous'))
    // Delivery the product is allowed (and about) to do is not a user todo either.
    .filter((item) => !(item.kind === 'plan_delivery' && policy.autoDeliver && policy.mode === 'autonomous'))
    .map((item) => ({ id: item.id, kind: item.kind, title: item.title, reason: item.reason, route: item.route }))

  const nextAction: GoalStatusView['nextAction'] =
    humanDecisions.length > 0 && humanDecisions.some((item) => ['tool_approval', 'delivery_approval', 'deployment_reconciliation', 'replan_scope'].includes(item.kind))
      ? { owner: 'human', title: humanDecisions[0]!.title, detail: humanDecisions[0]!.reason }
      : productSteps.length > 0
        ? { owner: 'product', title: productSteps[0]!.title, detail: productSteps[0]!.detail }
        : { owner: 'none', title: '无需操作', detail: '当前没有需要处理的事项' }

  return {
    projectId,
    planId: plan.id,
    revision: plan.revision,
    goal: plan.goal,
    execution: execution
      ? { status: execution.status, error: execution.error ?? null, updatedAt: execution.updatedAt ?? null }
      : null,
    verification: { state: verificationState, failing: failing.map((item) => `${item.command} (exit ${item.exitCode})`), detail: verificationDetail },
    review: {
      state: reviewState,
      fingerprint: reviewFingerprint,
      detail:
        reviewState === 'approved'
          ? `当前内容已通过审查（${reviewFingerprint?.slice(0, 8) ?? 'fingerprint n/a'}）`
          : reviewState === 'stale'
            ? '旧审查针对的是已变化的内容，需要复审'
            : reviewState === 'current_negative'
              ? `当前审查结论：${resolution.verdict}`
              : '尚无针对当前内容的审查',
    },
    delivery: {
      state: deliveryStatus,
      mergedAt: execution?.mergedAt ?? null,
      mergeCommit: execution?.mergeCommit ?? null,
      evidenceId: execution?.deliveryEvidenceId ?? null,
      detail: deliveryDetail,
    },
    nextAction,
    productSteps,
    humanDecisions,
    policy: {
      mode: policy.mode,
      autoStartPlans: policy.autoStartPlans,
      autoApplyReplans: policy.autoApplyReplans,
      autoDeliver: policy.autoDeliver,
      maxAutoReplans: policy.maxAutoReplans,
    },
  }
}

export function goalStatusTimestamp(): number {
  return now()
}
