import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { now, type PlanDraft, type ProjectJourney, type JourneyStage } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import type { ActionCenter, ProjectAutonomySettings } from './action-center.js'
import { planReviewEvidence, planTestEvidence } from './review-evidence-runtime.js'
import type { PlanGrantService } from './plan-grant.js'

/**
 * ADR-0053 — ProjectJourneyProjection.
 *
 * The journey bar must answer "where am I / what is the system doing / who owns the next move" on
 * every page, so this projection derives all nine stages from persisted facts:
 *   - project + git readiness (a repository without a commit is a known first-run state, ADR-0050);
 *   - requirements;
 *   - the selected plan revision (active execution > newest approved > newest draft) with its lineage;
 *   - the plan approval and the execution grant (valid / expired / revoked / missing);
 *   - the real runs (running / waiting approval / paused / failed) and pending approvals;
 *   - trusted test evidence (ADR-0047), current review evidence (ADR-0025) and the delivery record.
 *
 * It never infers success from a plan's status, a task count or execution existence.
 */

function gitHasCommit(rootPath: string): boolean | null {
  if (!existsSync(join(rootPath, '.git'))) return null
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: rootPath, encoding: 'utf8', stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

function selectPlan(store: SqliteStore, projectId: string): { plan: PlanDraft | null; kind: ProjectJourney['selection']['kind']; reason: string } {
  const plans = store.read
    .listAllPlanRevisions()
    .filter((plan) => plan.projectId === projectId && plan.status !== 'rejected' && plan.status !== 'superseded')
  const executing = plans
    .filter((plan) => ['running', 'paused', 'failed'].includes(plan.execution?.status ?? ''))
    .sort((a, b) => b.revision - a.revision)[0]
  if (executing) {
    return { plan: executing, kind: 'executing', reason: `正在跟踪第 ${executing.revision} 版计划的执行（${executing.execution?.status}）` }
  }
  const approved = plans.filter((plan) => plan.status === 'approved').sort((a, b) => b.revision - a.revision)[0]
  if (approved) return { plan: approved, kind: 'approved', reason: `当前批准的是第 ${approved.revision} 版` }
  const draft = plans.filter((plan) => plan.status === 'draft').sort((a, b) => b.revision - a.revision)[0]
  if (draft) return { plan: draft, kind: 'draft', reason: `第 ${draft.revision} 版计划等待审核` }
  return { plan: null, kind: 'none', reason: '还没有计划' }
}

export function projectJourney(input: {
  store: SqliteStore
  actions: ActionCenter
  grants: PlanGrantService
  projectId: string | null
}): ProjectJourney {
  const { store, actions } = input
  const allProjects = store.read.listProjects()
  const projectId =
    input.projectId ??
    (() => {
      const withRunning = store.read
        .listAllPlanRevisions()
        .filter((plan) => plan.execution?.status === 'running')
        .sort((a, b) => (b.execution?.updatedAt ?? 0) - (a.execution?.updatedAt ?? 0))[0]
      const recentWithRunning = withRunning ? allProjects.find((project) => project.id === withRunning.projectId) : null
      if (recentWithRunning) return recentWithRunning.id
      const sorted = [...allProjects].sort((a, b) => b.updatedAt - a.updatedAt)
      return sorted[0]?.id ?? null
    })()

  const runningProjectIds = new Set(
    store.read
      .listAllPlanRevisions()
      .filter((plan) => plan.execution?.status === 'running')
      .map((plan) => plan.projectId),
  )
  const background = {
    runningProjects: runningProjectIds.size,
    pendingApprovals: allProjects.reduce((total, project) => total + actions.items(project.id).filter((item) => !item.stale && item.kind === 'tool_approval').length, 0),
  }

  if (!projectId) {
    return {
      projectId: null,
      projectName: '',
      goal: '',
      projectStage: '',
      selection: { kind: 'none', planId: null, revision: null, reason: '尚未选择项目' },
      stages: [],
      nextAction: {
        owner: 'user',
        label: '创建或打开一个项目',
        detail: '选择一个本地文件夹作为项目工作区，AI 才能开始规划。',
        route: '/',
        objectId: null,
      },
      blockers: [],
      background,
      updatedAt: now(),
    }
  }

  const project = store.read.getProject(projectId)
  if (!project) throw new Error(`项目不存在：${projectId}`)
  const policy: ProjectAutonomySettings = actions.autonomySettings(projectId)
  const { plan, kind, reason } = selectPlan(store, projectId)
  const execution = plan?.execution ?? null
  const requirements = store.read
    .listRequirements(projectId)
    .filter((requirement) => requirement.status !== 'cancelled' && requirement.status !== 'implemented')
    .sort((a, b) => b.createdAt - a.createdAt)
  const requirement = requirements[0] ?? null
  const grant = plan ? input.grants.get(plan.id) : null
  const grantActive = Boolean(grant?.valid && grant.status === 'active')
  const testEvidence = plan ? planTestEvidence(store, plan) : null
  const reviewEvidence = plan ? planReviewEvidence(store, plan) : null
  const humanItems = actions.items(projectId)
  const toolApproval =
    humanItems.find((item) => item.kind === 'tool_approval' && !item.stale) ??
    // A pending approval whose TTL passed is hidden as stale, but the run is still parked on it.
    (execution?.status === 'paused' || execution?.status === 'failed' ? (humanItems.find((item) => item.kind === 'tool_approval') ?? null) : null)
  const approvalRef = toolApproval?.approvalId ?? toolApproval?.id ?? null
  const approvalExpired = Boolean(toolApproval?.stale)
  const commit = gitHasCommit(project.rootPath)

  const tasks = plan ? plan.createdTaskIds.map((taskId) => store.read.getTaskCard(taskId)).filter((card): card is NonNullable<typeof card> => Boolean(card)) : []
  const activeRun = (() => {
    for (const card of tasks) {
      const run = store.read.getActiveRunForTask(card.id)
      if (run) return { run, card }
    }
    return null
  })()
  const workRoute = `/projects/${projectId}/work`
  const planRoute = `/projects/${projectId}/orchestration${plan ? `?plan=${plan.id}` : ''}`
  const runsRoute = `/projects/${projectId}/runs`
  const approvalsRoute = `/projects/${projectId}/approvals`
  const versionsRoute = `/projects/${projectId}/versions`
  const releasesRoute = `/projects/${projectId}/releases`

  const stages: JourneyStage[] = []
  const push = (stage: JourneyStage): void => {
    stages.push(stage)
  }

  // 1) 项目准备
  push({
    key: 'setup',
    label: '项目准备',
    state: commit === false && !execution?.workspaceRef ? 'active' : 'done',
    owner: commit === false && !execution?.workspaceRef ? 'ai' : 'system',
    detail:
      commit === null
        ? '非 Git 项目：计划直接在该目录执行，不会创建隔离 Worktree'
        : commit === false && !execution?.workspaceRef
          ? '目录是空 Git 仓库：首次启动会自动建立基线提交（不覆盖已有文件）'
          : `项目工作区就绪（${project.rootPath}）`,
    requirements: ['项目目录可用', '隔离 Worktree 有可用的基线提交'],
    satisfied: [commit === null ? '非 Git 项目无需基线提交' : commit || execution?.workspaceRef ? '基线提交存在' : '启动时将自动建立基线提交'],
    objects: {},
    entry: null,
  })

  // 2) 需求
  push({
    key: 'requirement',
    label: '需求',
    state: requirement ? 'done' : 'active',
    owner: requirement ? 'none' : 'user',
    detail: requirement ? `已提交需求：${requirement.title}` : '还没有需求：写下你要完成的目标',
    requirements: ['至少一条需求'],
    satisfied: requirement ? [`需求「${requirement.title.slice(0, 60)}」`] : [],
    objects: {},
    entry: { label: requirement ? '查看/新增需求' : '提交需求', route: workRoute },
  })

  // 3) 计划
  const planDraft = kind === 'draft'
  const planExists = Boolean(plan)
  push({
    key: 'plan',
    label: '计划',
    state: planExists ? 'done' : requirement ? 'active' : 'pending',
    owner: planExists ? 'none' : requirement ? 'ai' : 'user',
    detail: planExists
      ? `第 ${plan!.revision} 版计划（${plan!.tasks.length} 个任务）`
      : requirement
        ? policy.mode === 'autonomous'
          ? 'AI 会在自主模式下生成计划草案'
          : '等待生成计划草案'
        : '先提交需求',
    requirements: ['计划草案包含可执行任务与依赖'],
    satisfied: planExists ? [`任务 ${plan!.tasks.length} 个`] : [],
    objects: plan ? { planId: plan.id, revision: plan.revision } : {},
    entry: { label: planExists ? '查看计划' : '生成计划', route: planRoute },
  })

  // 4) 审核（计划审批）
  push({
    key: 'review',
    label: '审核',
    state: !plan ? 'pending' : planDraft ? 'active' : 'done',
    owner: planDraft ? 'user' : 'none',
    detail: !plan ? '还没有可审核的计划' : planDraft ? '等待你审核并批准计划' : `计划已批准（第 ${plan.revision} 版）`,
    requirements: ['计划已批准'],
    satisfied: planDraft ? [] : plan ? [`批准于 ${new Date(plan.approvedAt ?? plan.updatedAt).toLocaleString('zh-CN')}`] : [],
    objects: plan ? { planId: plan.id, revision: plan.revision } : {},
    entry: planDraft ? { label: '审核计划', route: planRoute } : null,
  })

  // 5) 授权
  push({
    key: 'grant',
    label: '授权',
    state: !plan || planDraft ? 'pending' : grantActive ? 'done' : 'blocked',
    owner: !plan || planDraft ? 'none' : grantActive ? 'none' : 'user',
    detail: !plan || planDraft
      ? '批准计划后再授权执行'
      : grantActive
        ? `执行授权有效（最多 ${grant!.maxRuns} 次启动 / ${grant!.maxToolCalls} 次工具调用，${new Date(grant!.expiresAt).toLocaleString('zh-CN')} 前有效）`
        : grant
          ? `授权不可用（${grant.status === 'revoked' ? '已撤销' : grant.status === 'expired' ? '已过期' : '已失效'}）：需要重新授权`
          : '计划已批准，但还没有执行授权',
    requirements: ['存在有效且覆盖当前 revision 的执行授权'],
    satisfied: grantActive ? ['授权有效'] : [],
    objects: grant ? { planId: plan!.id, grantId: grant.id } : plan ? { planId: plan.id } : {},
    entry: plan && !planDraft ? { label: grantActive ? '查看授权' : '授权执行', route: planRoute } : null,
  })

  // 6) 执行
  const waitingApproval = toolApproval ?? null
  push({
    key: 'execute',
    label: '执行',
    state: !execution
      ? grantActive
        ? 'active'
        : 'pending'
      : execution.status === 'running'
        ? waitingApproval
          ? 'blocked'
          : 'active'
        : execution.status === 'completed'
          ? 'done'
          : 'blocked',
    owner: !execution ? (grantActive ? 'ai' : 'user') : waitingApproval ? 'user' : execution.status === 'running' ? 'ai' : execution.status === 'completed' ? 'none' : 'ai',
    detail: !execution
      ? grantActive
        ? policy.autoStartPlans
          ? '已授权，产品会自动开始执行'
          : '已授权，等待开始执行'
        : '尚未开始执行'
      : waitingApproval
        ? approvalExpired
          ? `执行停在一条已过期的审批上（${approvalRef}）；该审批不能继续，需要重新发起`
          : `执行暂停：等待你批准一次工具调用（审批 ${approvalRef}）`
        : execution.status === 'running'
          ? activeRun
            ? `${activeRun.card.assigneeAgentId ? 'Agent' : '执行者'} 正在处理「${activeRun.card.title.slice(0, 40)}」`
            : '正在执行计划'
          : execution.status === 'completed'
            ? '计划执行完成'
            : execution.status === 'paused'
              ? `执行已暂停：${execution.error?.slice(0, 120) ?? '等待恢复'}`
              : `执行失败：${execution.error?.slice(0, 160) ?? '原因未知'}`,
    requirements: ['所有任务执行完成'],
    satisfied: execution?.status === 'completed' ? ['计划执行完成'] : [],
    objects: {
      ...(plan ? { planId: plan.id } : {}),
      ...(activeRun ? { taskId: activeRun.card.id, runId: activeRun.run.id } : {}),
      ...(waitingApproval ? { approvalId: approvalRef ?? undefined } : {}),
    },
    entry: waitingApproval
      ? { label: approvalExpired ? '重新发起审批' : '处理审批', route: `/projects/${projectId}/approvals?approval=${approvalRef}` }
      : execution
        ? { label: '查看运行', route: runsRoute }
        : null,
  })

  // 7) 验证（真实测试证据）
  const verifyState = testEvidence?.state ?? 'unverified'
  // A pause caused by stale evidence means the last write came after the last test run: the stage
  // cannot be "passed" even if an older trusted run exists (ADR-0047), and a human must re-verify.
  const staleEvidencePause = execution?.status === 'paused' && /测试证据已过期/.test(execution.error ?? '')
  push({
    key: 'verify',
    label: '验证',
    state: staleEvidencePause
      ? 'blocked'
      : verifyState === 'passed'
        ? 'done'
        : verifyState === 'failed'
          ? 'blocked'
          : verifyState === 'stale'
            ? 'blocked'
            : execution?.status === 'running'
              ? 'active'
              : 'pending',
    owner: staleEvidencePause ? 'user' : verifyState === 'passed' ? 'none' : verifyState === 'failed' || verifyState === 'stale' ? 'ai' : execution?.status === 'running' ? 'ai' : 'none',
    detail: staleEvidencePause
      ? `验证证据已过期：最后一次修改晚于最后一次通过的测试，需要重新验证（${execution?.error?.slice(0, 140) ?? ''}）`
      : verifyState === 'passed'
        ? `当前代码真实验证通过：${testEvidence?.lastSuccess?.command ?? '已记录的验证命令'}（exit 0）`
        : verifyState === 'failed'
          ? `真实测试未通过：${testEvidence?.lastFailure?.command ?? ''}（exit ${testEvidence?.lastFailure?.exitCode ?? '?'}）`
          : verifyState === 'stale'
            ? `测试证据已过期：${testEvidence?.reasons.join('；') || '不描述当前内容'}`
            : '还没有带真实退出码的验证记录',
    requirements: ['当前内容存在 exit 0 的真实测试/检查记录'],
    satisfied: verifyState === 'passed' ? ['验证通过'] : [],
    objects: plan ? { planId: plan.id } : {},
    entry: { label: '查看验证记录', route: runsRoute },
  })

  // 8) 审查（当前内容）
  const reviewApproved = Boolean(reviewEvidence?.approved)
  const reviewCurrent = reviewEvidence?.current.length ?? 0
  push({
    key: 'code-review',
    label: '审查',
    state: reviewApproved ? 'done' : reviewCurrent > 0 ? 'blocked' : reviewEvidence && reviewEvidence.historical.length > 0 ? 'blocked' : 'pending',
    owner: reviewApproved ? 'none' : 'ai',
    detail: reviewApproved
      ? '当前内容已通过审查'
      : reviewCurrent > 0
        ? `当前审查结论：${reviewEvidence?.verdict ?? '未通过'}`
        : reviewEvidence && reviewEvidence.historical.length > 0
          ? '旧审查针对已变化的内容，需要复审'
          : '还没有针对当前内容的审查',
    requirements: ['当前内容存在通过的 ReviewSnapshot'],
    satisfied: reviewApproved ? ['审查通过'] : [],
    objects: plan ? { planId: plan.id } : {},
    entry: { label: '查看审查任务', route: runsRoute },
  })

  // 9) 交付
  const delivery = execution?.deliveryStatus ?? 'none'
  push({
    key: 'delivery',
    label: '交付',
    state: delivery === 'verified' ? 'done' : delivery === 'merged_verification_failed' ? 'blocked' : delivery === 'merged' ? 'active' : execution?.status === 'completed' ? 'blocked' : 'pending',
    owner: delivery === 'verified' ? 'none' : policy.autoDeliver ? 'ai' : 'user',
    detail:
      delivery === 'verified'
        ? `已合并 ${execution?.mergeCommit?.slice(0, 10) ?? ''} 并通过合并后验证`
        : delivery === 'merged_verification_failed'
          ? `已合并 ${execution?.mergeCommit?.slice(0, 10) ?? ''}，但合并后验证失败：${execution?.deliveryError ?? ''}`
          : delivery === 'merged'
            ? '已合并，等待合并后验证'
            : execution?.status === 'completed'
              ? policy.autoDeliver
                ? '计划已完成，产品会在条件满足后自动交付'
                : '计划已完成，等待你确认交付'
              : '尚未进入交付',
    requirements: ['真实合并提交', '合并后验证通过', '交付证据工件'],
    satisfied: delivery === 'verified' ? ['合并后验证通过'] : delivery === 'merged' ? ['已合并'] : [],
    objects: {
      ...(plan ? { planId: plan.id } : {}),
      ...(execution?.mergeCommit ? { mergeCommit: execution.mergeCommit } : {}),
      ...(execution?.deliveryEvidenceId ? { evidenceId: execution.deliveryEvidenceId } : {}),
      ...(plan?.versionId ? { versionId: plan.versionId } : {}),
    },
    entry: { label: delivery === 'verified' ? '查看交付证据' : '查看交付', route: plan?.versionId ? versionsRoute : releasesRoute },
  })

  // Next action: the earliest stage that is blocked or active decides, so the bar never says
  // "无需操作" while something is waiting for the user.
  const blockers = stages.filter((stage) => stage.state === 'blocked').map((stage) => `${stage.label}：${stage.detail}`)
  // `setup` never blocks: an unborn repository is handled automatically at start (ADR-0050), so it
  // must not hijack "what should happen next" while the user is waiting for planning.
  const actionable = stages.filter((stage) => stage.key !== 'setup')
  const nextStage =
    actionable.find((stage) => stage.state === 'blocked') ??
    [...actionable].reverse().find((stage) => stage.state === 'active') ??
    null
  const nextAction: ProjectJourney['nextAction'] = (() => {
    if (delivery === 'verified') {
      return { owner: 'none', label: '已完成交付并验证', detail: `合并提交 ${execution?.mergeCommit?.slice(0, 10) ?? ''}`, route: plan?.versionId ? versionsRoute : releasesRoute, objectId: execution?.deliveryEvidenceId ?? null }
    }
    if (execution?.status === 'running' && !waitingApproval) {
      return { owner: 'ai', label: 'AI 正在执行，无需你操作', detail: activeRun ? `正在处理「${activeRun.card.title.slice(0, 40)}」` : '计划正在运行', route: runsRoute, objectId: activeRun?.run.id ?? null }
    }
    if (waitingApproval) {
      return {
        owner: 'user',
        label: approvalExpired ? '审批已过期，需要重新发起' : '等待你批准一次工具调用',
        detail: approvalExpired
          ? `审批 ${approvalRef} 已过期，运行停在这里；重新开始或让 AI 重新申请授权`
          : `审批 ${approvalRef}：${waitingApproval.title}`,
        route: `/projects/${projectId}/approvals?approval=${approvalRef}`,
        objectId: approvalRef,
      }
    }
    if (planDraft) {
      return { owner: 'user', label: '等待你审核计划', detail: `第 ${plan!.revision} 版计划：${plan!.goal.slice(0, 80)}`, route: planRoute, objectId: plan!.id }
    }
    if (plan && !grantActive && plan.status === 'approved') {
      return {
        owner: 'user',
        label: grant ? '执行授权已失效，需要重新授权' : '需要授权执行',
        detail: grant ? `${grant.status}：重新签发后 AI 才能开始` : '批准计划不会启动 Agent；先授权范围与预算',
        route: planRoute,
        objectId: grant?.id ?? plan.id,
      }
    }
    if (staleEvidencePause) {
      return {
        owner: 'user',
        label: '验证证据已过期，需要重新验证',
        detail: execution?.error?.slice(0, 200) ?? '最后一次修改晚于最后一次测试',
        route: runsRoute,
        objectId: plan?.id ?? null,
      }
    }
    if (execution?.status === 'failed' || execution?.status === 'paused') {
      const error = execution.error ?? ''
      // A missing model/provider is not something the AI can fix by replanning: the user owns it.
      const needsModel = /Provider|API Key|模型连接|尚未配置模型|PROVIDER_NOT_CONFIGURED/i.test(error)
      if (needsModel) {
        return {
          owner: 'user',
          label: '执行受阻：尚未配置模型连接',
          detail: `${error.slice(0, 180)}（在设置 → AI 连接中填写后回到这里继续）`,
          route: '/?settings=ai-connections',
          objectId: null,
        }
      }
      return {
        owner: 'ai',
        label: execution.status === 'paused' ? '执行暂停，等待恢复' : '执行失败，AI 将诊断并修复',
        detail: execution.error?.slice(0, 200) ?? '查看运行审计获取真实原因',
        route: runsRoute,
        objectId: plan?.id ?? null,
      }
    }
    if (testEvidence?.state === 'failed' || testEvidence?.state === 'stale') {
      return {
        owner: policy.autoApplyReplans ? 'ai' : 'user',
        label: policy.autoApplyReplans ? 'AI 正在重新规划修复' : '测试未通过，需要处理',
        detail: testEvidence.reasons.join('；').slice(0, 200),
        route: runsRoute,
        objectId: plan?.id ?? null,
      }
    }
    if (reviewEvidence && !reviewApproved && (reviewCurrent > 0 || reviewEvidence.historical.length > 0)) {
      return { owner: 'ai', label: 'AI 将重新审查当前内容', detail: '内容已变化，旧审查不再有效', route: runsRoute, objectId: plan?.id ?? null }
    }
    if (nextStage?.owner === 'ai') {
      return { owner: 'ai', label: nextStage.detail, detail: '产品会继续处理', route: nextStage.entry?.route ?? null, objectId: null }
    }
    if (nextStage?.owner === 'user') {
      return { owner: 'user', label: nextStage.detail, detail: nextStage.label, route: nextStage.entry?.route ?? null, objectId: null }
    }
    if (!requirement) {
      return { owner: 'user', label: '提交你的第一个需求', detail: '写下你要完成的目标，AI 才能开始规划', route: workRoute, objectId: null }
    }
    if (!planExists) {
      return {
        owner: policy.mode === 'autonomous' ? 'ai' : 'user',
        label: policy.mode === 'autonomous' ? 'AI 正在生成计划草案' : '生成计划草案',
        detail: '计划是后续审核与执行的前提',
        route: planRoute,
        objectId: null,
      }
    }
    return { owner: 'none', label: '暂无需要处理的事项', detail: nextStage?.detail ?? '所有阶段都已满足', route: null, objectId: null }
  })()

  return {
    projectId,
    projectName: project.name,
    goal: plan?.goal ?? requirement?.title ?? '',
    projectStage: project.currentStage,
    selection: { kind, planId: plan?.id ?? null, revision: plan?.revision ?? null, reason },
    stages,
    nextAction,
    blockers,
    background,
    updatedAt: now(),
  }
}
