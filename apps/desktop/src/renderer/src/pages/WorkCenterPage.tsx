import { useProductDialogs } from '../next-ui/overlay/ProductDialogs'
import { FormDialog } from '../next-ui/overlay/FormDialog'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { NextStepPanel } from '../components/NextStepPanel'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Input } from 'antd'
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  PlusOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type { PlanDraft } from '@projectos/contracts'
import {
  AgentAvatar,
  EmptyState,
  ErrorState,
  LoadingBlock,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
  toneForStatus,
} from '@projectos/ui'
import {
  qk,
  useAgents,
  useApprovals,
  useArtifacts,
  useLifecycle,
  usePlanGrant,
  usePlans,
  useProjectOverview,
  useRuns,
  useTaskBoard,
} from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'
import { runStatusLabel, stageLabel, taskStatusLabel } from '../lib/labels'
import './work-center.css'

const PLAN_STATUS_LABELS: Record<string, string> = {
  draft: '待审核',
  approved: '已批准',
  rejected: '已拒绝',
  superseded: '已被替代',
}

const PLAN_TONES: Record<string, 'neutral' | 'warning' | 'success' | 'danger' | 'info'> = {
  draft: 'warning',
  approved: 'success',
  rejected: 'danger',
  superseded: 'neutral',
}

const GOAL_VERIFICATION_LABELS: Record<string, string> = {
  unverified: '尚未验证',
  verifying: '验证中',
  failed: '验证未通过',
  passed: '当前代码验证通过',
  stale: '证据已过期',
}

const GOAL_REVIEW_LABELS: Record<string, string> = {
  none: '尚无审查',
  stale: '需要复审',
  current_negative: '审查未通过',
  approved: '已通过',
}

const GOAL_DELIVERY_LABELS: Record<string, string> = {
  none: '尚未交付',
  blocked: '等待交付条件',
  merged: '已合并，待验证',
  verified: '已验证交付',
  merged_verification_failed: '已合并但验证失败',
}

type GoalStateTone = 'neutral' | 'active' | 'success' | 'warning' | 'danger'

function GoalState({
  label,
  value,
  tone,
  detail,
  onOpen,
}: {
  label: string
  value: string
  tone: GoalStateTone
  detail: string
  href?: string
  onOpen?: () => void
}): React.JSX.Element {
  return (
    <div className={`wc-goal-state wc-goal-state-${tone}`}>
      <span className="wc-goal-state-label">{label}</span>
      <strong className="wc-goal-state-value">{value}</strong>
      {detail ? <span className="wc-goal-state-detail">{detail}</span> : null}
      {onOpen ? (
        <button type="button" className="wc-goal-state-link" onClick={onOpen}>
          打开对象
        </button>
      ) : null}
    </div>
  )
}

const EXECUTION_LABELS: Record<string, string> = {
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const APPROVAL_LABELS: Record<string, string> = {
  pending: '待处理',
  approved: '已批准',
  rejected: '已拒绝',
  expired: '已过期',
  cancelled: '已取消',
}

const VERSION_PHASE_LABELS: Record<string, string> = {
  planned: '已计划',
  discovery: '需求发现',
  build: '开发中',
  verify: '验证中',
  release_candidate: '候选发布',
  released: '已发布',
  maintenance: '维护中',
  retired: '已退役',
}

function firstUnfinished(plan: PlanDraft | null): string | null {
  if (!plan) return '生成计划'
  if (plan.status === 'draft') return '审核并批准计划'
  if (plan.status === 'rejected') return '重新生成或修订计划'
  if (plan.status === 'superseded') return '查看新版本计划'
  if (!plan.execution) return '授权执行'
  if (plan.execution.status === 'paused') return '处理暂停原因'
  if (plan.execution.status === 'failed') return '查看失败原因并重规划'
  if (plan.execution.status === 'completed') return '查看成果与知识'
  return '等待 Agent 执行'
}

export default function WorkCenterPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const modal = useProductDialogs()
  const overview = useProjectOverview(projectId)
  const plans = usePlans(projectId)
  const board = useTaskBoard(projectId)
  const runs = useRuns(projectId, 30)
  const approvals = useApprovals(projectId)
  const artifacts = useArtifacts(projectId)
  const agents = useAgents(projectId)
  const lifecycle = useLifecycle(projectId)
  // ADR-0031: the primary status is derived by the runtime from persisted facts, so the page
  // cannot show "tasks 100%" next to an undelivered goal, and it cannot turn work the product is
  // about to do itself into a user todo.
  const goalStatus = useQuery({
    queryKey: ['work', 'goalStatus', projectId],
    queryFn: () => window.projectos.work.goalStatus(projectId),
    enabled: Boolean(projectId),
    refetchInterval: 4_000,
  })

  const [goal, setGoal] = useState('')
  const [requirementOpen, setRequirementOpen] = useState(() => search.get('intent') === 'requirement')
  useEffect(() => { if (search.get('intent') === 'requirement') { setRequirementOpen(true); setSearch((current) => { const next = new URLSearchParams(current); next.delete('intent'); return next }, { replace: true }) } }, [search, setSearch])
  const [requirementTitle, setRequirementTitle] = useState('')
  const [requirementBody, setRequirementBody] = useState('')
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null)

  const planList = plans.data?.plans ?? []
  const activePlan = planList[0] ?? null
  const grant = usePlanGrant(activePlan?.id, Boolean(activePlan))
  const tasks = useMemo(() => board.data?.tasks ?? [], [board.data])
  const planTasks = useMemo(() => {
    if (!activePlan) return []
    return activePlan.createdTaskIds
      .map((id) => tasks.find((task) => task.id === id))
      .filter((task): task is NonNullable<typeof task> => Boolean(task))
  }, [activePlan, tasks])
  const pendingApprovals = (approvals.data?.approvals ?? []).filter((item) => item.status === 'pending')
  const reviewTasks = tasks.filter((task) => task.status === 'review')
  const failedRuns = (runs.data?.runs ?? []).filter((run) =>
    ['failed', 'needs_reconciliation', 'timed_out'].includes(run.status),
  )
  const recentArtifacts = (artifacts.data?.artifacts ?? []).slice(0, 6)
  const activeAgents = (agents.data?.agents ?? []).filter((agent) => agent.status !== 'offline')
  const workingAgents = activeAgents.filter((agent) => agent.status === 'working')
  const stats = overview.data?.stats
  const requirements = useMemo(() => overview.data?.requirements ?? [], [overview.data])
  const activeVersion = useMemo(() => {
    const versions = lifecycle.data?.versions ?? []
    const focusId = lifecycle.data?.focus?.subjectType === 'version' ? lifecycle.data?.focus?.subjectId : null
    return versions.find((item) => item.id === focusId) ?? versions.find((item) => item.isDefault) ?? versions[0] ?? null
  }, [lifecycle.data])
  const activeIteration = useMemo(() => {
    const iterations = lifecycle.data?.iterations ?? []
    return iterations.find((item) => item.versionId === activeVersion?.id && item.status === 'active') ??
      iterations.find((item) => item.versionId === activeVersion?.id) ??
      null
  }, [activeVersion?.id, lifecycle.data])

  useEffect(() => {
    if (!goal && requirements[0]?.title) setGoal(requirements[0].title)
  }, [goal, requirements])

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.plans(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.board(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.overview(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.runs(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.approvals(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.artifacts(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.bootstrap }),
      ...(activePlan ? [queryClient.invalidateQueries({ queryKey: qk.planGrant(activePlan.id) })] : []),
    ])
  }

  const generate = useMutation({
    mutationFn: (mode: 'ai' | 'local') =>
      window.projectos.plans.generate(projectId, goal.trim(), {
        mode,
        maxTasks: 10,
        allowRuleFallback: mode === 'local',
      }),
    onSuccess: async (plan) => {
      setGoal('')
      if (activeVersion) {
        await window.projectos.plans.update({ planId: plan.id, versionId: activeVersion.id, iterationId: activeIteration?.id ?? null })
      }
      await invalidate()
      message.success(plan.generatedBy === 'provider' ? 'AI 计划已生成，进入审核' : '规则草案已生成，进入审核')
      navigate(`/projects/${projectId}/orchestration?plan=${plan.id}`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const approve = useMutation({
    mutationFn: (plan: PlanDraft) => window.projectos.plans.approve(plan.id),
    onSuccess: async () => {
      await invalidate()
      message.success('计划已批准；执行仍需单独授权')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const issueGrant = useMutation({
    mutationFn: (plan: PlanDraft) =>
      window.projectos.plans.grant.issue({
        planId: plan.id,
        actions: ['plan.start', 'workspace-write'],
        allowedPaths: ['.'],
        maxRuns: 1,
        maxToolCalls: 80,
        ttlHours: 24,
        confirm: true,
        note: '研发工作中心授权执行',
      }),
    onSuccess: async () => {
      await invalidate()
      message.success('已授权执行；现在可以启动')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const start = useMutation({
    mutationFn: (plan: PlanDraft) =>
      window.projectos.orchestration.start(plan.id, 2, 2, false, grant.data?.id ?? null),
    onSuccess: async () => {
      await invalidate()
      message.success('执行已启动')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const resume = useMutation({
    mutationFn: (plan: PlanDraft) => window.projectos.orchestration.resume(plan.id),
    onSuccess: async () => {
      await invalidate()
      message.success('已继续执行')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const pause = useMutation({
    mutationFn: (plan: PlanDraft) => window.projectos.orchestration.pause(plan.id),
    onSuccess: async () => {
      await invalidate()
      message.success('已暂停')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const createRequirement = useMutation({
    mutationFn: () =>
      window.projectos.requirements.create({
        projectId,
        title: requirementTitle.trim(),
        body: requirementBody.trim(),
        acceptanceCriteria: [],
        source: 'work-center',
        versionId: activeVersion?.id ?? null,
        iterationId: activeIteration?.id ?? null,
      }),
    onSuccess: async (result) => {
      setRequirementOpen(false)
      setRequirementTitle('')
      setRequirementBody('')
      setGoal(result.requirement.title)
      await queryClient.invalidateQueries({ queryKey: qk.overview(projectId) })
      await queryClient.invalidateQueries({ queryKey: qk.requirements(projectId) })
      message.success('需求已记录')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const requestVerification = useMutation({
    mutationFn: (taskId: string) => window.projectos.verification.request(projectId, taskId),
    onSuccess: async ({ sessionId }) => {
      await invalidate()
      message.success('已启动受控验证；请在工作台处理审批')
      navigate(`/projects/${projectId}/agents?session=${sessionId}`)
    },
    onError: (error) => {
      setBusyTaskId(null)
      message.error(errorMessage(error))
    },
  })

  const confirmStart = (): void => {
    if (!activePlan) return
    modal.confirm({
      title: '启动计划执行？',
      content: '将使用已批准的计划与当前授权启动 Scheduler。所有写操作仍需 PlanGrant/工具审批。',
      okText: '启动执行',
      cancelText: '取消',
      onOk: () => start.mutateAsync(activePlan),
    })
  }

  const confirmGrant = (): void => {
    if (!activePlan) return
    modal.confirm({
      title: '授权执行此计划？',
      content:
        '授权范围：当前 revision、计划任务、当前 Agent、工作区写入，最多 1 次启动 / 80 次工具调用 / 24 小时。计划批准本身不等于执行授权。',
      okText: '授权执行',
      cancelText: '取消',
      onOk: () => issueGrant.mutateAsync(activePlan),
    })
  }

  if (overview.isLoading || plans.isLoading) return <LoadingBlock rows={10} label="正在加载研发工作中心" />
  if (overview.isError) {
    return <ErrorState title="无法加载工作中心" message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />
  }

  const nextStep = firstUnfinished(activePlan)
  const execution = activePlan?.execution ?? null
  const grantReady = Boolean(grant.data?.valid)
  const planStatus = activePlan?.status ?? 'none'
  const serverGoal = goalStatus.data
  const focus = serverGoal?.nextAction
    ? {
        kicker:
          serverGoal.nextAction.owner === 'human'
            ? '需要你决定'
            : serverGoal.nextAction.owner === 'product'
              ? 'AI 正在自主推进'
              : '当前状态',
        title: serverGoal.nextAction.title,
        description: serverGoal.nextAction.detail,
        action: '',
        run: () => undefined,
      }
    : !requirements.length
    ? { kicker: '从目标开始', title: '先记录一条真实需求', description: '写清背景、边界和验收标准，计划才有可靠输入。', action: '记录需求', run: () => setRequirementOpen(true) }
    : !activePlan
      ? { kicker: '下一步', title: '把需求变成可审核的计划', description: 'AI 会生成 DAG、Agent 分工与验收节点；批准后再单独授权执行。', action: '生成计划', run: () => document.getElementById('work-goal')?.focus() }
      : activePlan.status === 'draft'
        ? { kicker: '当前重点', title: '审核并批准计划', description: '检查依赖、Agent 分工和验收标准；批准不会自动授权执行。', action: '', run: () => undefined }
        : !grantReady
          ? { kicker: '当前重点', title: '计划已批准，等待执行授权', description: '确认 revision、任务、Agent、路径和预算后，再启动 Scheduler。', action: '', run: () => undefined }
          : execution?.status === 'paused'
            ? { kicker: '需要处理', title: '执行已暂停', description: execution.error ?? '检查暂停原因，处理后继续；未知副作用不会自动重试。', action: '', run: () => undefined }
            : execution?.status === 'running'
              ? { kicker: '正在发生', title: 'Agent 正在执行', description: '查看任务、Run 和待审批事项；需要你决定时会在右侧集中展示。', action: '', run: () => undefined }
              : execution?.status === 'completed'
                ? { kicker: '已交付', title: '执行完成，查看成果与验收', description: '测试、Diff 和 Artifact 已可追溯；把结论沉淀到知识库。', action: '', run: () => undefined }
                : { kicker: '下一步', title: '启动执行或查看编排', description: '当前计划已就绪，可启动 Scheduler 或进入完整编排工作台。', action: '', run: () => undefined }

  return (
    <div className="po-page po-work-center">
      <PageHeader
        eyebrow={overview.data ? `${stageLabel(overview.data.project.currentStage)} · 本地优先` : 'WORK CENTER'}
        title={overview.data ? `${overview.data.project.name} · 研发工作中心` : '研发工作中心'}
        description="把一项真实工作从需求推进到可验收成果。"
        actions={
          <>
            <Button icon={<PlusOutlined />} onClick={() => setRequirementOpen(true)}>
              记录需求
            </Button>
            <Button onClick={() => navigate(`/projects/${projectId}/versions`)}>版本与迭代</Button>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => navigate(`/projects/${projectId}/orchestration`)}>
              完整编排工作台
            </Button>
          </>
        }
        meta={
          overview.data ? (
            <div className="wc-meta">
              <span>{overview.data.project.name}</span>
              <span className="wc-dot" />
              <span>{activeVersion ? `v${activeVersion.version} · ${VERSION_PHASE_LABELS[activeVersion.phase] ?? activeVersion.phase}` : '未设置版本'}</span>
              <span className="wc-dot" />
              <span>{overview.data.git?.branch ?? '未检测 Git'}</span>
              {stats ? <span className="wc-dot" /> : null}
              {stats ? <span>{stats.tasksDone}/{stats.tasksTotal} 任务完成</span> : null}
            </div>
          ) : null
        }
      />

      <div className="wc-focus">
        <div className="wc-focus-copy">
          <span className="wc-focus-kicker">{focus.kicker}</span>
          <h2>{focus.title}</h2>
          <p>{focus.description}</p>
        </div>
      </div>

      {serverGoal ? (
        <div className="wc-goal-states" data-testid="wc-goal-states">
          <GoalState
            label="执行"
            value={EXECUTION_LABELS[serverGoal.execution?.status ?? ''] ?? (serverGoal.execution ? serverGoal.execution.status : '未启动')}
            tone={serverGoal.execution?.status === 'running' ? 'active' : serverGoal.execution?.status === 'paused' ? 'warning' : 'neutral'}
            detail={String(serverGoal.execution?.error ?? '').slice(0, 160)}
          />
          <GoalState
            label="真实测试"
            value={GOAL_VERIFICATION_LABELS[serverGoal.verification.state] ?? serverGoal.verification.state}
            tone={
              serverGoal.verification.state === 'passed'
                ? 'success'
                : serverGoal.verification.state === 'failed' || serverGoal.verification.state === 'stale'
                  ? 'warning'
                  : serverGoal.verification.state === 'verifying'
                    ? 'active'
                    : 'neutral'
            }
            detail={serverGoal.verification.detail}
            href={
              serverGoal.verification.failing.length > 0
                ? `#/projects/${projectId}/runs`
                : undefined
            }
            onOpen={serverGoal.verification.failing.length > 0 ? () => navigate(`/projects/${projectId}/runs`) : undefined}
          />
          <GoalState
            label="当前审查"
            value={GOAL_REVIEW_LABELS[serverGoal.review.state] ?? serverGoal.review.state}
            tone={serverGoal.review.state === 'approved' ? 'success' : serverGoal.review.state === 'current_negative' ? 'warning' : 'neutral'}
            detail={serverGoal.review.detail}
          />
          <GoalState
            label="交付"
            value={GOAL_DELIVERY_LABELS[serverGoal.delivery.state] ?? serverGoal.delivery.state}
            tone={
              serverGoal.delivery.state === 'verified'
                ? 'success'
                : ['merged_verification_failed', 'blocked'].includes(serverGoal.delivery.state)
                  ? 'warning'
                  : 'neutral'
            }
            detail={serverGoal.delivery.detail}
          />
        </div>
      ) : null}

      {serverGoal && serverGoal.productSteps.length > 0 ? (
        <div className="wc-goal-autopilot" data-testid="wc-goal-autopilot">
          <span className="wc-goal-autopilot-kicker">AI 下一步（无需你操作）</span>
          <ul>
            {serverGoal.productSteps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span>{step.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <NextStepPanel projectId={projectId} navigate={navigate} />

      <div className="wc-metrics">
        <MetricCard label="需求" value={requirements.length} hint="全项目" icon={<FileTextOutlined />} />
        <MetricCard
          label="待审批"
          value={pendingApprovals.length}
          hint="需要你的决定"
          tone={pendingApprovals.length > 0 ? 'warning' : 'success'}
          icon={<SafetyCertificateOutlined />}
        />
        <MetricCard
          label="待验收"
          value={reviewTasks.length}
          hint="等待证据/人工验收"
          tone={reviewTasks.length > 0 ? 'warning' : 'success'}
          icon={<CheckCircleOutlined />}
        />
        <MetricCard
          label="运行中"
          value={stats?.activeRuns ?? 0}
          hint={`${workingAgents.length} 个正在工作 · ${activeAgents.length} 个可用`}
          tone="accent"
          icon={<PlayCircleOutlined />}
        />
        <MetricCard
          label="成果"
          value={stats?.artifacts ?? recentArtifacts.length}
          hint="全项目 · 含未验证"
          tone="info"
          icon={<CheckCircleOutlined />}
        />
      </div>

      <div className="wc-grid">
        <div className="wc-main">
          <SectionCard
            title="当前计划"
            subtitle={activePlan ? `r${activePlan.revision} · ${PLAN_STATUS_LABELS[activePlan.status] ?? activePlan.status}` : '尚未生成计划'}
            extra={
              activePlan ? (
                <Button size="small" type="text" onClick={() => navigate(`/projects/${projectId}/orchestration?plan=${activePlan.id}`)}>
                  打开 Plan Review <ArrowRightOutlined />
                </Button>
              ) : null
            }
          >
            {!activePlan ? (
              <div className="wc-empty">
                <EmptyState
                  compact
                  title="还没有计划"
                  description="把需求写成目标，AI 会生成可审核的 DAG；批准后再单独授权执行。"
                />
                <div className="wc-generate">
                  <Input.TextArea
                    id="work-goal"
                    rows={3}
                    value={goal}
                    onChange={(event) => setGoal(event.target.value)}
                    placeholder="例如：为 RBAC 模块增加审计日志，覆盖后端、测试与迁移"
                  />
                  <Button
                    type="primary"
                    icon={<ThunderboltOutlined />}
                    loading={generate.isPending && generate.variables === 'ai'}
                    disabled={goal.trim().length < 3}
                    onClick={() => generate.mutate('ai')}
                  >
                    生成 AI 计划
                  </Button>
                  <Button
                    size="small"
                    type="text"
                    loading={generate.isPending && generate.variables === 'local'}
                    disabled={goal.trim().length < 3}
                    onClick={() => generate.mutate('local')}
                  >
                    无模型时生成规则草案
                  </Button>
                </div>
              </div>
            ) : (
              <div className="wc-plan">
                <div className="wc-plan-head">
                  <div>
                    <div className="wc-plan-goal">{activePlan.goal}</div>
                    <div className="wc-plan-meta">
                      <StatusPill tone={PLAN_TONES[activePlan.status] ?? 'neutral'}>
                        {PLAN_STATUS_LABELS[activePlan.status] ?? activePlan.status}
                      </StatusPill>
                      <span>{activePlan.tasks.length} 个节点</span>
                      <span>{activePlan.generatedBy === 'provider' ? 'AI 生成' : '规则生成'}</span>
                      {activePlan.generation?.model ? <span>{activePlan.generation.model}</span> : null}
                      {activePlan.generation?.attempts ? <span>{activePlan.generation.attempts} 次尝试</span> : null}
                    </div>
                  </div>
                  <div className="wc-plan-actions">
                    {activePlan.status === 'draft' ? (
                      <Button
                        type="primary"
                        loading={approve.isPending}
                        onClick={() =>
                          modal.confirm({
                            title: '批准这份计划？',
                            content: '批准会创建任务与依赖，但不会自动授权执行。',
                            okText: '批准计划',
                            cancelText: '取消',
                            onOk: () => approve.mutateAsync(activePlan),
                          })
                        }
                      >
                        批准计划
                      </Button>
                    ) : null}
                    {activePlan.status === 'approved' && !grantReady ? (
                      <Button type="primary" icon={<SafetyCertificateOutlined />} loading={issueGrant.isPending} onClick={confirmGrant}>
                        授权执行
                      </Button>
                    ) : null}
                    {activePlan.status === 'approved' && grantReady && !execution ? (
                      <Button type="primary" icon={<PlayCircleOutlined />} loading={start.isPending} onClick={confirmStart}>
                        启动执行
                      </Button>
                    ) : null}
                    {execution?.status === 'paused' ? (
                      <Button type="primary" icon={<ReloadOutlined />} loading={resume.isPending} onClick={() => resume.mutate(activePlan)}>
                        继续执行
                      </Button>
                    ) : null}
                    {execution?.status === 'running' ? (
                      <Button loading={pause.isPending} onClick={() => pause.mutate(activePlan)}>
                        暂停
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="wc-plan-state">
                  <div>
                    <span className="wc-label">执行状态</span>
                    <strong>{execution ? EXECUTION_LABELS[execution.status] ?? execution.status : '尚未启动'}</strong>
                  </div>
                  <div>
                    <span className="wc-label">执行授权</span>
                    <strong>{grantReady ? '有效' : activePlan.status === 'approved' ? '未授权' : '待批准'}</strong>
                  </div>
                  <div>
                    <span className="wc-label">项目完成度</span>
                    <strong>{stats ? `${Math.round(stats.progress * 100)}%` : '—'}</strong>
                  </div>
                </div>

                {execution?.error ? (
                  <div className="wc-callout is-warning">
                    <WarningOutlined />
                    <div>
                      <strong>执行暂停/失败原因</strong>
                      <span>{execution.error}</span>
                      <span className="wc-muted">处理后可继续；系统不会自动重试未知副作用。</span>
                    </div>
                  </div>
                ) : null}

                <div className="wc-task-list">
                  {planTasks.length === 0 ? (
                    <div className="wc-muted">批准计划后，任务会出现在这里。</div>
                  ) : (
                    planTasks.map((task) => (
                      <div className="wc-task-row" key={task.id}>
                        <div className={`wc-task-status is-${task.status}`}>
                          {task.status === 'done' ? <CheckCircleOutlined /> : task.status === 'running' ? <PlayCircleOutlined /> : <ClockCircleOutlined />}
                        </div>
                        <div className="wc-task-main">
                          <button type="button" className="wc-task-title" onClick={() => navigate(`/projects/${projectId}/tasks?task=${task.id}`)}>
                            {task.title}
                          </button>
                          <div className="wc-task-meta">
                            <span>{taskStatusLabel(task.status)}</span>
                            {task.assigneeName ? <span>{task.assigneeName}</span> : <span>未分配</span>}
                            {task.dependencyIds.length ? <span>{task.dependencyIds.length} 个依赖</span> : null}
                            {task.artifactCount ? <span>{task.artifactCount} 个成果</span> : null}
                          </div>
                        </div>
                        <div className="wc-task-actions">
                          {task.status === 'review' ? (
                            <Button
                              size="small"
                              type="primary"
                              ghost
                              loading={requestVerification.isPending && busyTaskId === task.id}
                              onClick={() => {
                                setBusyTaskId(task.id)
                                requestVerification.mutate(task.id)
                              }}
                            >
                              请求受控验证
                            </Button>
                          ) : null}
                          <Button size="small" type="text" onClick={() => navigate(`/projects/${projectId}/tasks?task=${task.id}`)}>
                            查看
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Agent 协作"
            subtitle="谁在执行、做到哪一步、需要你决定什么"
            extra={
              <Button size="small" type="text" onClick={() => navigate(`/projects/${projectId}/agents`)}>
                Agent 工作台 <ArrowRightOutlined />
              </Button>
            }
          >
            {activeAgents.length === 0 ? (
              <div className="wc-muted">没有在线 Agent。检查 Runtime / 模型连接，或在 Agent 工作台创建会话。</div>
            ) : (
              <div className="wc-agents">
                {activeAgents.map((view) => (
                  <button
                    type="button"
                    className="wc-agent"
                    key={view.agent.id}
                    onClick={() => navigate(`/projects/${projectId}/agents`)}
                  >
                    <AgentAvatar name={view.agent.name} size={30} />
                    <span>
                      <strong>{view.agent.name}</strong>
                      <small>{view.agent.role} · {view.status === 'working' ? '执行中' : '空闲'}</small>
                    </span>
                    {view.activeRunId ? <StatusPill tone="info">Run</StatusPill> : null}
                  </button>
                ))}
              </div>
            )}
            <div className="wc-run-list">
              {(runs.data?.runs ?? []).slice(0, 5).map((run) => (
                <button
                  type="button"
                  className="wc-run-row"
                  key={run.id}
                  onClick={() => navigate(`/projects/${projectId}/runs?run=${run.id}`)}
                >
                  <span className={`wc-run-dot is-${run.status}`} />
                  <span className="wc-run-title">{run.taskTitle ?? run.sessionTitle ?? '未命名运行'}</span>
                  <span className="wc-run-agent">{run.agentName}</span>
                  <StatusPill tone={toneForStatus(run.status)}>{runStatusLabel(run.status)}</StatusPill>
                  <span className="wc-muted">{formatRelative(run.createdAt)}</span>
                </button>
              ))}
              {!runs.data?.runs.length ? <div className="wc-muted">还没有运行记录。</div> : null}
            </div>
          </SectionCard>

          <SectionCard
            title="成果与记录"
            subtitle="真实 Artifact、验收证据与项目知识"
            extra={
              <Button size="small" type="text" onClick={() => navigate(`/projects/${projectId}/knowledge`)}>
                知识库 <ArrowRightOutlined />
              </Button>
            }
          >
            {recentArtifacts.length === 0 ? (
              <div className="wc-muted">还没有成果。Agent 运行、测试或人工验收后会生成 Artifact。</div>
            ) : (
              <div className="wc-artifacts">
                {recentArtifacts.map((artifact) => (
                  <div className="wc-artifact" key={artifact.id}>
                    <FileTextOutlined />
                    <div>
                      <strong>{artifact.title}</strong>
                      <span>{artifact.kind} · {artifact.verifiedAt ? '已验证' : '未验证'} · {formatRelative(artifact.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="wc-activity">
              {(overview.data?.activity ?? []).slice(0, 6).map((item) => (
                <div key={item.id} className="wc-activity-row">
                  <span className={`wc-activity-dot is-${item.tone}`} />
                  <span>{item.summary}</span>
                  <span className="wc-muted">{formatRelative(item.createdAt)}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <aside className="wc-side">
          <SectionCard title="需要你处理" subtitle="审批与验收优先">
            {pendingApprovals.length + reviewTasks.length === 0 ? (
              <div className="wc-muted">当前没有阻塞项。</div>
            ) : (
              <div className="wc-needs">
                {pendingApprovals.slice(0, 5).map((approval) => (
                  <button
                    type="button"
                    className="wc-need"
                    key={approval.id}
                    onClick={() => navigate(`/projects/${projectId}/approvals`)}
                  >
                    <SafetyCertificateOutlined />
                    <span>
                      <strong>{approval.title}</strong>
                      <small>{APPROVAL_LABELS[approval.status] ?? approval.status} · {formatRelative(approval.requestedAt)}</small>
                    </span>
                    <ArrowRightOutlined />
                  </button>
                ))}
                {reviewTasks.slice(0, 5).map((task) => (
                  <button
                    type="button"
                    className="wc-need"
                    key={task.id}
                    onClick={() => navigate(`/projects/${projectId}/tasks?task=${task.id}`)}
                  >
                    <CheckCircleOutlined />
                    <span>
                      <strong>{task.title}</strong>
                      <small>等待验收 · {task.artifactCount} 个成果</small>
                    </span>
                    <ArrowRightOutlined />
                  </button>
                ))}
              </div>
            )}
            {failedRuns.length ? (
              <div className="wc-callout is-danger">
                <WarningOutlined />
                <div>
                  <strong>{failedRuns.length} 个运行需要核对</strong>
                  <span>失败/未知副作用不会自动重试；请到运行审计查看对账状态。</span>
                  <Button size="small" type="link" onClick={() => navigate(`/projects/${projectId}/runs`)}>
                    打开运行审计
                  </Button>
                </div>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="下一步" subtitle={nextStep ?? '保持当前节奏'}>
            <div className="wc-flow">
              {[
                ['需求', requirements.length > 0],
                ['计划', Boolean(activePlan)],
                ['批准', planStatus === 'approved' || execution !== null],
                ['授权', grantReady],
                ['执行', execution?.status === 'running' || execution?.status === 'completed'],
                ['验收', (stats?.tasksReview ?? 0) === 0 && (stats?.tasksDone ?? 0) > 0],
                ['成果', (stats?.artifacts ?? 0) > 0],
              ].map(([label, done], index) => (
                <div className={`wc-flow-step ${done ? 'is-done' : ''}`} key={String(label)}>
                  <span className="wc-flow-index">{done ? <CheckCircleOutlined /> : index + 1}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            {execution?.status === 'completed' ? (
              <Button block type="primary" onClick={() => navigate(`/projects/${projectId}/knowledge`)}>
                查看成果与知识
              </Button>
            ) : (
              <Button block onClick={() => navigate(`/projects/${projectId}/orchestration`)}>
                打开完整编排工作台
              </Button>
            )}
          </SectionCard>

          <SectionCard title="需求" subtitle={`${requirements.length} 条已记录`}>
            {requirements.length === 0 ? (
              <div className="wc-muted">先记录一条真实需求，再生成计划。</div>
            ) : (
              <div className="wc-requirements">
                {requirements.slice(0, 5).map((requirement) => (
                  <button
                    type="button"
                    className="wc-requirement"
                    key={requirement.id}
                    onClick={() => navigate(`/projects/${projectId}`)}
                  >
                    <span>{requirement.title}</span>
                    <StatusPill tone={requirement.status === 'approved' ? 'success' : 'neutral'}>{requirement.status}</StatusPill>
                  </button>
                ))}
              </div>
            )}
            <Button block icon={<PlusOutlined />} onClick={() => setRequirementOpen(true)}>
              记录需求
            </Button>
          </SectionCard>
        </aside>
      </div>

      <FormDialog
        open={requirementOpen}
        title="记录需求"
        okText="保存"
        cancelText="取消"
        confirmLoading={createRequirement.isPending}
        onOk={() => createRequirement.mutate()}
        onCancel={() => setRequirementOpen(false)}
        okButtonProps={{ disabled: requirementTitle.trim().length === 0 }}
      >
        <div className="wc-form">
          <label>
            <span>需求标题</span>
            <Input value={requirementTitle} onChange={(event) => setRequirementTitle(event.target.value)} placeholder="要解决什么问题？" />
          </label>
          <label>
            <span>背景与验收标准</span>
            <Input.TextArea rows={5} value={requirementBody} onChange={(event) => setRequirementBody(event.target.value)} placeholder="现状、边界、如何判定完成" />
          </label>
          <div className="wc-muted">需求会进入真实数据库；AI 规划会把它作为目标上下文。</div>
        </div>
      </FormDialog>
    </div>
  )
}
