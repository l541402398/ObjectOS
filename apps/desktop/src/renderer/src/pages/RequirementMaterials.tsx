import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Select } from 'antd'
import {
  REQUIREMENT_STAGES,
  type Artifact,
  type RequirementMaterial,
  type RequirementStage,
  type TaskFlow,
} from '@projectos/contracts'
import { EmptyState, ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import { useArtifacts } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatDateTime } from '../lib/format'

const STATUS_META: Record<
  RequirementMaterial['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  current: { label: '当前版本', tone: 'success' },
  stale: { label: '已过期失效', tone: 'warning' },
  superseded: { label: '废弃版本', tone: 'neutral' },
  rejected: { label: '未通过', tone: 'danger' },
  draft: { label: '待验证', tone: 'neutral' },
}

const REVIEW_META: Record<
  NonNullable<RequirementMaterial['reviewVerdict']>,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }
> = {
  approved: { label: '审核已通过', tone: 'success' },
  rejected: { label: '审核未通过', tone: 'danger' },
  stale: { label: '旧审核已失效', tone: 'warning' },
  pending: { label: '待审核', tone: 'neutral' },
}

const STEP_STATE_LABELS: Record<string, string> = {
  pending: '未开始',
  ready: '待开始',
  starting: '正在启动',
  running: '进行中',
  waiting_approval: '待授权',
  completed: '已完成',
  failed: '失败',
  needs_reconciliation: '待核对',
}

export interface RequirementMaterialsProps {
  projectId: string
  requirementId?: string
  requirementTitle?: string
  materials: RequirementMaterial[]
  tasks?: Array<{ id: string; title: string }>
  taskFlows?: TaskFlow[]
  stageNode?: { id: string; title: string; stage: RequirementStage } | null
  initialTaskId?: string | null
  onNavigate?: (path: string) => void
}

export function RequirementMaterials({
  projectId,
  requirementId,
  requirementTitle,
  materials,
  tasks = [],
  taskFlows = [],
  stageNode = null,
  initialTaskId = null,
  onNavigate,
}: RequirementMaterialsProps) {
  const navigate = useNavigate()
  const artifacts = useArtifacts(projectId)
  const scopeKey = `${projectId}:${requirementId ?? 'all'}:${stageNode?.id ?? 'all'}:${initialTaskId ?? 'all'}`
  const [state, setState] = useState<{ scopeKey: string; taskFilter: string; selectedId: string | null }>(() => ({
    scopeKey,
    taskFilter: initialTaskId ?? 'all',
    selectedId: null,
  }))

  const taskFilter = state.scopeKey === scopeKey ? state.taskFilter : (initialTaskId ?? 'all')
  const selected = state.scopeKey === scopeKey ? state.selectedId : null
  const setTaskFilter = (nextTask: string) =>
    setState({ scopeKey, taskFilter: nextTask, selectedId: null })
  const setSelected = (nextId: string | null) =>
    setState({ scopeKey, taskFilter, selectedId: nextId })

  const openPath = (path: string) => {
    if (onNavigate) onNavigate(path)
    else navigate(`/projects/${projectId}/${path}`)
  }

  // Strict project + requirement isolation: never read cached artifacts from another project or requirement.
  const projectArtifacts = useMemo(
    () => (artifacts.data?.artifacts ?? []).filter((item) => item.projectId === projectId),
    [artifacts.data, projectId],
  )
  const artifactMap = useMemo(
    () => new Map(projectArtifacts.map((item) => [item.id, item])),
    [projectArtifacts],
  )
  const scopedMaterials = useMemo(
    () =>
      materials.filter(
        (item) => !requirementId || item.requirementId === requirementId,
      ),
    [materials, requirementId],
  )

  const hasMissingArtifact = useMemo(
    () => scopedMaterials.some((item) => !artifactMap.has(item.artifactId)),
    [artifactMap, scopedMaterials],
  )

  useEffect(() => {
    if (hasMissingArtifact && !artifacts.isFetching) {
      void artifacts.refetch()
    }
  }, [artifacts, hasMissingArtifact])

  const taskChoices = useMemo(() => {
    const map = new Map<string, { id: string; title: string; stepStatus: string | null; stale: boolean }>()
    for (const task of tasks) {
      map.set(task.id, { id: task.id, title: task.title, stepStatus: null, stale: false })
    }
    for (const flow of taskFlows) {
      if (requirementId && flow.requirementId !== requirementId) continue
      const existing = map.get(flow.taskId)
      const step = stageNode ? flow.steps.find((s) => s.nodeId === stageNode.id) : null
      map.set(flow.taskId, {
        id: flow.taskId,
        title: existing?.title ?? flow.taskId,
        stepStatus: step?.status ?? existing?.stepStatus ?? null,
        stale: Boolean(step?.stale),
      })
    }
    for (const mat of scopedMaterials) {
      if (mat.taskId && !map.has(mat.taskId)) {
        map.set(mat.taskId, {
          id: mat.taskId,
          title: mat.taskTitle ?? mat.taskId,
          stepStatus: null,
          stale: mat.status === 'stale',
        })
      }
    }
    return [...map.values()]
  }, [requirementId, scopedMaterials, stageNode, taskFlows, tasks])

  const stageSummary = useMemo(() => {
    if (!stageNode || !taskFlows.length) return null
    const steps = taskFlows
      .filter((flow) => !requirementId || flow.requirementId === requirementId)
      .flatMap((flow) => flow.steps.filter((step) => step.nodeId === stageNode.id))
    if (!steps.length) return null
    const isReview = ['requirement_review', 'design_review', 'code_review'].includes(stageNode.stage)
    const completed = steps.filter((s) => s.status === 'completed' && !s.stale).length
    const stale = steps.filter((s) => s.status === 'completed' && s.stale).length
    const running = steps.filter((s) => s.status === 'starting' || s.status === 'running').length
    const waitingApproval = steps.filter((s) => s.status === 'waiting_approval').length
    const failed = steps.filter((s) => s.status === 'failed' || s.status === 'needs_reconciliation').length
    const ready = steps.filter((s) => s.status === 'ready').length
    const waitingReview = isReview ? ready + running + waitingApproval : 0
    const notStarted = steps.filter((s) => s.status === 'pending' || (!isReview && s.status === 'ready')).length
    return { total: steps.length, completed, stale, running, waitingApproval, waitingReview, failed, notStarted, isReview }
  }, [requirementId, stageNode, taskFlows])

  const filteredMaterials = useMemo(
    () =>
      taskFilter === 'all'
        ? scopedMaterials
        : scopedMaterials.filter((item) => item.taskId === taskFilter),
    [scopedMaterials, taskFilter],
  )

  const active = filteredMaterials.find((item) => item.artifactId === selected) ?? filteredMaterials[0]
  const artifact = active ? artifactMap.get(active.artifactId) : undefined

  if (artifacts.isLoading) return <LoadingBlock rows={5} label="正在读取文档正文" />
  if (artifacts.isError) return <ErrorState title="资料读取失败" message={errorMessage(artifacts.error)} onRetry={() => void artifacts.refetch()} />
  if (active && !artifact && artifacts.isFetching) return <LoadingBlock label="正在读取文档正文" rows={5} />

  const selectedTaskChoice = taskFilter !== 'all' ? taskChoices.find((t) => t.id === taskFilter) : null

  return (
    <div className="rq-materials-wrap" data-project-id={projectId} data-requirement-id={requirementId ?? ''}>
      {(stageSummary || taskChoices.length > 1) ? (
        <div className="rq-material-toolbar" role="region" aria-label="阶段任务与资料筛选">
          {stageSummary ? (
            <div className="rq-material-stage-counts" data-testid="stage-task-counts">
              <span>共 <strong>{stageSummary.total}</strong> 个任务</span>
              <span>已完成 <strong>{stageSummary.completed}/{stageSummary.total}</strong></span>
              {stageSummary.running > 0 ? <span>进行中 <strong>{stageSummary.running}</strong></span> : null}
              {stageSummary.waitingReview > 0 ? <span>待审核 <strong>{stageSummary.waitingReview}</strong></span> : null}
              {stageSummary.waitingApproval > 0 ? <span>待授权 <strong>{stageSummary.waitingApproval}</strong></span> : null}
              {stageSummary.failed > 0 ? <span className="is-danger">失败 <strong>{stageSummary.failed}</strong></span> : null}
              {stageSummary.stale > 0 ? <span className="is-warn">已过期 <strong>{stageSummary.stale}</strong></span> : null}
              {stageSummary.notStarted > 0 ? <span>未开始 <strong>{stageSummary.notStarted}</strong></span> : null}
            </div>
          ) : null}
          {taskChoices.length > 0 ? (
            <div className="rq-material-task-filter" role="group" aria-label="按任务筛选资料">
              <Button
                size="small"
                type={taskFilter === 'all' ? 'primary' : 'default'}
                onClick={() => setTaskFilter('all')}
              >
                全部任务 ({scopedMaterials.length})
              </Button>
              {taskChoices.map((task) => {
                const count = scopedMaterials.filter((m) => m.taskId === task.id).length
                const stateText = task.stale
                  ? '已过期'
                  : task.stepStatus
                    ? (STEP_STATE_LABELS[task.stepStatus] ?? task.stepStatus)
                    : null
                return (
                  <Button
                    key={task.id}
                    size="small"
                    type={taskFilter === task.id ? 'primary' : 'default'}
                    onClick={() => setTaskFilter(task.id)}
                    data-task-filter={task.id}
                  >
                    {task.title}{stateText ? ` · ${stateText}` : ''} ({count})
                  </Button>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {!active ? (
        <EmptyState
          title={selectedTaskChoice ? `「${selectedTaskChoice.title}」尚无此阶段资料` : '尚无产出资料'}
          description={
            selectedTaskChoice?.stepStatus
              ? `该任务在当前阶段的状态为「${selectedTaskChoice.stale ? '已过期' : (STEP_STATE_LABELS[selectedTaskChoice.stepStatus] ?? selectedTaskChoice.stepStatus)}」，节点完成后文档与审核结论会显示在这里。`
              : '节点完成后，文档和审核结论会显示在这里。'
          }
        />
      ) : (
        <div className="rq-materials">
          <nav aria-label="产出文档列表">
            {filteredMaterials.map((item) => {
              const statusMeta = STATUS_META[item.status]
              return (
                <Button
                  key={item.artifactId}
                  type={active.artifactId === item.artifactId ? 'primary' : 'text'}
                  onClick={() => setSelected(item.artifactId)}
                  data-material-id={item.artifactId}
                  data-material-status={item.status}
                >
                  <div className="rq-material-nav-item">
                    <strong>{item.title}</strong>
                    <small>
                      {item.taskTitle ? `${item.taskTitle} · ` : ''}v{item.attempt || 1} · {statusMeta.label}
                    </small>
                  </div>
                </Button>
              )
            })}
          </nav>
          <article className="rq-material-body">
            <div className="rq-section-title">
              <h3>{active.title}</h3>
              <div className="rq-inline-actions">
                <StatusPill tone={STATUS_META[active.status].tone}>
                  {STATUS_META[active.status].label}
                </StatusPill>
                {active.reviewVerdict ? (
                  <StatusPill tone={REVIEW_META[active.reviewVerdict].tone}>
                    {REVIEW_META[active.reviewVerdict].label}
                  </StatusPill>
                ) : null}
              </div>
            </div>
            <p className="rq-secondary">
              {active.agentName ?? '项目资料'} · {formatDateTime(active.createdAt)}
              {active.attempt > 0 ? ` · 第 ${active.attempt} 次执行` : ''}
            </p>
            <dl className="rq-material-meta" aria-label="资料溯源信息">
              <div>
                <dt>所属需求</dt>
                <dd>{active.requirementTitle || requirementTitle || active.requirementId}</dd>
              </div>
              <div>
                <dt>所属任务</dt>
                <dd>
                  {active.taskTitle ?? '需求公共资料'}
                  {active.taskId ? (
                    <Button type="link" size="small" onClick={() => openPath(`tasks?task=${active.taskId}`)}>
                      查看任务
                    </Button>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt>流程节点</dt>
                <dd>{active.stepTitle ?? (active.stage ? REQUIREMENT_STAGES[active.stage]?.label : '文档资料')}</dd>
              </div>
              <div>
                <dt>产出 Agent</dt>
                <dd>{active.agentName ?? '项目资料'}</dd>
              </div>
              <div>
                <dt>版本状态</dt>
                <dd>第 {active.attempt || 1} 版 · {STATUS_META[active.status].label}</dd>
              </div>
              <div>
                <dt>审核结果</dt>
                <dd>
                  {active.reviewVerdict
                    ? `${REVIEW_META[active.reviewVerdict].label}${active.reviewedByAgentName ? `（${active.reviewedByAgentName}）` : ''}`
                    : '无独立审核门禁'}
                </dd>
              </div>
              {active.runId ? (
                <div>
                  <dt>运行记录</dt>
                  <dd>
                    <Button type="link" size="small" onClick={() => openPath(`runs?run=${active.runId}`)}>
                      查看运行记录 ({active.runId})
                    </Button>
                  </dd>
                </div>
              ) : null}
            </dl>
            {(active.status === 'stale' || active.reviewVerdict === 'stale') ? (
              <Alert
                type="warning"
                showIcon
                className="rq-material-banner"
                message="已过期失效（文档或需求范围已更新）"
                description={active.statusReason ?? active.reviewNote ?? '关联文档或需求范围已更新，旧审核结论不再作为有效门禁依据，请重新执行审核。'}
              />
            ) : active.status === 'superseded' ? (
              <Alert
                type="info"
                showIcon
                className="rq-material-banner"
                message="废弃版本（已被新版本替代）"
                description={active.statusReason ?? '此版本已在节点重试或后续执行中被新版本替代，仅供历史对照。'}
              />
            ) : (active.status === 'rejected' || active.reviewVerdict === 'rejected') ? (
              <Alert
                type="error"
                showIcon
                className="rq-material-banner"
                message="审核未通过"
                description={active.reviewNote ?? active.statusReason ?? '请根据审核意见修改前置文档或代码后重新执行。'}
              />
            ) : null}
            <div className="rq-prose" tabIndex={0} role="region" aria-label="文档正文">
              {artifact?.body || '此产物没有内联正文。'}
            </div>
          </article>
        </div>
      )}
    </div>
  )
}

/** Embedded in the existing Agent inspector; no nested overlay or alternate data source. */
export function AgentWorkflowMaterials({ projectId, agentId }: { projectId: string; agentId: string }) {
  const navigate = useNavigate()
  const materials = useQuery({
    queryKey: ['agent-workflow-materials', projectId, agentId],
    queryFn: () => window.projectos.workflows.materials(projectId, agentId),
  })
  const artifacts = useArtifacts(projectId)
  const scopeKey = `${projectId}:${agentId}`
  const [state, setState] = useState<{ scopeKey: string; selectedId: string | null }>({
    scopeKey,
    selectedId: null,
  })
  const selected = state.scopeKey === scopeKey ? state.selectedId : null
  const setSelected = (nextId: string | null) => setState({ scopeKey, selectedId: nextId })

  const list = (artifacts.data?.artifacts ?? []).filter(
    (item) =>
      item.projectId === projectId &&
      materials.data?.materials.some((material) => material.artifactId === item.id) &&
      typeof item.metadata?.workflowStepId === 'string',
  )
  const active: Artifact | undefined = list.find((item) => item.id === selected) ?? list[0]
  const provenance = materials.data?.materials.find((item) => item.artifactId === active?.id)

  if (materials.isLoading || artifacts.isLoading) return <LoadingBlock label="正在读取流程资料" rows={2} />
  if (materials.isError) return <ErrorState title="流程资料读取失败" message={errorMessage(materials.error)} onRetry={() => void materials.refetch()} />
  if (artifacts.isError) return <ErrorState title="文档正文读取失败" message={errorMessage(artifacts.error)} onRetry={() => void artifacts.refetch()} />
  if (!list.length) return null

  return (
    <section className="aco-detail-section rq-agent-materials">
      <h3>流程产出</h3>
      <Select
        aria-label="查看 Agent 产出的文档"
        value={active?.id}
        onChange={setSelected}
        options={list.map((item) => {
          const mat = materials.data?.materials.find((m) => m.artifactId === item.id)
          const statusLabel = mat ? STATUS_META[mat.status].label : ''
          return {
            value: item.id,
            label: `${item.title}${mat?.taskTitle ? ` · ${mat.taskTitle}` : ''}${statusLabel ? `（${statusLabel}）` : ''}`,
          }
        })}
      />
      {provenance ? (
        <>
          <p className="rq-secondary">
            {STATUS_META[provenance.status].label} · 第 {provenance.attempt || 1} 次执行 · {formatDateTime(provenance.createdAt)}
          </p>
          <div className="rq-agent-provenance">
            <span>需求：{provenance.requirementTitle || provenance.requirementId}</span>
            {provenance.taskTitle ? <span>任务：{provenance.taskTitle}</span> : null}
            {provenance.reviewVerdict ? <span>审核：{REVIEW_META[provenance.reviewVerdict].label}</span> : null}
            {provenance.runId ? (
              <Button type="link" size="small" onClick={() => navigate(`/projects/${projectId}/runs?run=${provenance.runId}`)}>
                运行记录
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      <div className="rq-prose">{active?.body || '此产物没有内联正文。'}</div>
    </section>
  )
}
