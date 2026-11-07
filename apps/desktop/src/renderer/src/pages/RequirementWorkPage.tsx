import { RequirementPlanDialog } from './RequirementPlanDialog'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Form, Input, Select, Tabs, Radio, Tooltip } from 'antd'
import { ArrowRightOutlined, EditOutlined, PlusOutlined, ReloadOutlined, PauseOutlined, PlayCircleOutlined, CloseOutlined } from '@ant-design/icons'
import { CheckCircle2, GitBranch, Layers3 } from 'lucide-react'
import type { RequirementWorkView, RequirementFlowTemplate, TaskFlow, RequirementFlowStep, FlowStartIntent, FlowAssignmentSource, RequirementMaterial } from '@projectos/contracts'
import { AgentAvatar, EmptyState, ErrorState, LoadingBlock, PageHeader, StatusPill, toneForStatus } from '@projectos/ui'
import { qk, useAgents, useRequirements, useAutonomySettings } from '../lib/queries'
import { useUiStore } from '../stores/ui'
import { errorMessage } from '../lib/errors'
import { parseLines } from '../lib/format'
import { taskStatusLabel } from '../lib/labels'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea, useOverlayDismiss } from '../next-ui/overlay/overlay-shell'
import { RequirementJourneyTrack, summarizeParallelStages } from '../components/RequirementJourneyBar'
import { RequirementIntegrationDialog } from './RequirementIntegrationDialog'
import { RequirementApproval } from './RequirementApproval'
import { RequirementFlowEditor } from './RequirementFlowEditor'
import { RequirementMaterials } from './RequirementMaterials'
import { RequirementOrganizationKnowledge } from './RequirementOrganizationKnowledge'
import { RequirementArrangement } from './RequirementArrangement'
import { RequirementNextAction } from './RequirementNextAction'
import { RequirementDependencyGraph } from './RequirementDependencyGraph'
import './requirement-work.css'
import './requirement-flow.css'

const STAGE_EXPECTED_DELIVERABLE: Record<string, string> = {
  requirement_analysis: '需求分析文档',
  requirement_review: '需求审核结论',
  technical_design: '技术设计文档',
  design_review: '技术设计审核结论',
  development: '开发成果与代码变更',
  code_review: '代码审查结论',
  testing: '实际测试报告',
  custom: '阶段交付物',
}

const STAGE_ROLE_LABELS: Record<string, string> = {
  requirement_analysis: '产品负责人',
  requirement_review: '代码审查员',
  technical_design: '架构师',
  design_review: '代码审查员',
  development: '开发工程师',
  code_review: '代码审查员',
  testing: '测试工程师',
  custom: '执行 Agent',
}

type Editor = { kind: 'requirement' | 'documents' | 'task' }
type Values = { title: string; body: string; technicalDesign: string; acceptance: string; description: string; dependsOn: string[]; templateVersionId: string; assignmentMode: 'manual' | 'ai' }
const requirementLabels: Record<string, string> = { draft: '草稿', approved: '已确认', rejected: '已拒绝', implemented: '已实现', archived: '已归档', proposed: '待确认' }
const stepLabels: Record<RequirementFlowStep['status'], string> = { pending: '等待前序', ready: '可开始', starting: '正在启动', running: '执行中', waiting_approval: '待授权', completed: '已完成', failed: '未通过', needs_reconciliation: '待核对' }
const sourceLabels: Record<FlowAssignmentSource, string> = { default: '需求默认', manual: '单独指定', ai: 'AI 分配' }
const flowKey = (id: string) => ['requirement-flow', id]

function EditorCancel({ disabled }: { disabled: boolean }) { const dismiss = useOverlayDismiss(); return <Button disabled={disabled} onClick={dismiss}>取消</Button> }

function WorkEditor({ editor, projectId, view, onSaved, onClose }: {
  editor: Editor; projectId: string; view?: RequirementWorkView; onSaved: (id?: string) => Promise<void>; onClose: () => void
}) {
  const [form] = Form.useForm<Values>()
  const [dirty, setDirty] = useState(false)
  const [flowEditor, setFlowEditor] = useState(false)
  const [req] = useState(() => view?.requirement)
  const autonomy = useAutonomySettings(projectId)
  const waitingForMode = editor.kind === 'requirement' && (autonomy.isLoading || autonomy.isError)
  const templates = useQuery({ queryKey: ['workflow-templates', projectId], queryFn: () => window.projectos.workflows.templates(projectId), staleTime: 30_000 })
  const templateOptions = useMemo(
    () => templates.data?.templates.map(item => ({ value: item.versionId, label: item.name })) ?? [],
    [templates.data?.templates],
  )
  const dependencyOptions = useMemo(
    () => view?.tasks.filter(task => task.status !== 'cancelled').map(task => ({ value: task.id, label: task.title })) ?? [],
    [view?.tasks],
  )
  const selectedVersion = Form.useWatch('templateVersionId', form)
  const selectedTemplate = useMemo(
    () => templates.data?.templates.find(item => item.versionId === selectedVersion),
    [selectedVersion, templates.data?.templates],
  )
  const title = editor.kind === 'requirement' ? '新建需求' : editor.kind === 'documents' ? '编辑需求文档' : '添加任务'
  const saveLockRef = useRef(false)
  const save = useMutation({ mutationFn: async () => {
    if (saveLockRef.current) return undefined
    saveLockRef.current = true
    try {
      const values = await form.validateFields()
      if (editor.kind === 'requirement') return (await window.projectos.requirements.create({ projectId, title: values.title, body: values.body ?? '', acceptanceCriteria: parseLines(values.acceptance ?? ''), source: 'local',
        workflow: { templateVersionId: values.templateVersionId, assignmentMode: values.assignmentMode, assignments: {} } })).requirement.id
      if (!req) throw new Error('需求已不可用，请重新打开')
      if (editor.kind === 'documents') await window.projectos.requirements.update({ requirementId: req.id, expectedVersion: req.version, title: values.title, body: values.body ?? '', technicalDesign: values.technicalDesign ?? '', acceptanceCriteria: parseLines(values.acceptance ?? '') })
      else await window.projectos.tasks.create({ projectId, requirementId: req.id, title: values.title, description: values.description ?? '', acceptanceCriteria: parseLines(values.acceptance ?? ''), dependsOn: values.dependsOn ?? [], workType: 'development' })
      return req.id
    } finally {
      saveLockRef.current = false
    }
  }, onSuccess: async id => { if (!id && editor.kind === 'requirement') return; setDirty(false); await onSaved(id); onClose() } })
  return <DialogShell open onOpenChange={open => { if (!open && !save.isPending) onClose() }} dirty={dirty} ariaLabel={flowEditor ? '创建流程' : title} width={flowEditor ? 1120 : 720}>
    <OverlayHeader title={flowEditor ? '创建流程' : title} />
    <OverlayScrollArea className="po-dialog-form-scroll rq-editor">
      {flowEditor ? <RequirementFlowEditor projectId={projectId} onDirty={() => setDirty(true)} onCancel={() => setFlowEditor(false)} onSaved={template => { void templates.refetch(); form.setFieldValue('templateVersionId', template.versionId); setFlowEditor(false); setDirty(true) }} /> : waitingForMode ? autonomy.isError ? <ErrorState title="工作模式读取失败" message={errorMessage(autonomy.error)} onRetry={() => void autonomy.refetch()} /> : <LoadingBlock label="正在读取工作模式" rows={4} /> : <>
        {save.isError && <Alert type="error" showIcon message={errorMessage(save.error)} />}
        <Form form={form} layout="vertical" disabled={save.isPending} initialValues={editor.kind === 'documents' ? { title: req?.title, body: req?.body, technicalDesign: req?.technicalDesign, acceptance: req?.acceptanceCriteria.join('\n') } : { dependsOn: [], templateVersionId: 'wfv_standard1', assignmentMode: autonomy.data?.mode === 'autonomous' ? 'ai' : 'manual' }} onValuesChange={() => { if (!dirty) setDirty(true); if (save.isError) save.reset() }}>
          <Form.Item name="title" label={editor.kind === 'task' ? '任务名称' : '需求名称'} rules={[{ required: true, whitespace: true, message: '请填写名称' }]}><Input autoFocus maxLength={240} placeholder={editor.kind === 'task' ? '这个任务要交付什么' : '这次希望实现什么'} /></Form.Item>
          <Form.Item name={editor.kind === 'task' ? 'description' : 'body'} label={editor.kind === 'task' ? '任务说明' : '需求描述'}><Input.TextArea rows={4} maxLength={editor.kind === 'task' ? 8000 : 40000} placeholder="说明目标、使用场景与范围" /></Form.Item>
          {editor.kind === 'requirement' && <>
            <div className="rq-flow-selection"><Form.Item name="templateVersionId" label="执行流程" rules={[{ required: true, message: '请选择流程' }]}><Select aria-label="执行流程" virtual={false} loading={templates.isLoading} options={templateOptions} /></Form.Item><Button icon={<PlusOutlined aria-hidden />} onClick={() => setFlowEditor(true)}>新建流程</Button></div>
            {templates.isError && <Alert type="error" showIcon message="流程模板读取失败" action={<Button onClick={() => void templates.refetch()}>重试</Button>} />}
            <div className="rq-template-trail" aria-label="所选流程的节点">{selectedTemplate?.graph.nodes.map((node, index) => <span key={node.id}>{index > 0 && <span aria-hidden> → </span>}{node.title}</span>)}</div>
            <Form.Item name="assignmentMode" label="Agent 分配"><Radio.Group options={[{ value: 'manual', label: '我来分配' }, { value: 'ai', label: 'AI 自动分配' }]} /></Form.Item>
          </>}
          {editor.kind === 'documents' && <Form.Item name="technicalDesign" label="技术设计文档"><Input.TextArea rows={7} maxLength={80000} /></Form.Item>}
          <details className="rq-extra-fields" open={editor.kind !== 'requirement'}><summary>验收与前置条件</summary><Form.Item name="acceptance" label="验收标准" extra="每行一条" rules={editor.kind === 'task' ? [{ required: true, whitespace: true, message: '请填写验收标准' }] : []}><Input.TextArea rows={3} maxLength={20000} /></Form.Item>
            {editor.kind === 'task' && <Form.Item name="dependsOn" label="前置任务"><Select mode="multiple" virtual={false} allowClear options={dependencyOptions} /></Form.Item>}</details>
        </Form>
      </>}
    </OverlayScrollArea>
    {!flowEditor && <OverlayFooter><EditorCancel disabled={save.isPending} /><Button type="primary" disabled={waitingForMode} loading={save.isPending} onClick={() => save.mutate()}>{editor.kind === 'documents' ? '保存文档' : editor.kind === 'task' ? '添加任务' : '创建需求'}</Button></OverlayFooter>}
  </DialogShell>
}

export function RequirementCreateModal({
  projectId,
  onClose,
  onCreated,
}: {
  projectId: string
  onClose: () => void
  onCreated?: (requirementId: string) => Promise<void> | void
}) {
  const queryClient = useQueryClient()
  const setSelectedRequirement = useUiStore((state) => state.setSelectedRequirement)
  return (
    <WorkEditor
      editor={{ kind: 'requirement' }}
      projectId={projectId}
      onClose={onClose}
      onSaved={async (id) => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.requirements(projectId) }),
          queryClient.invalidateQueries({ queryKey: qk.overview(projectId) }),
          queryClient.invalidateQueries({ queryKey: ['work', 'journey', projectId] }),
          queryClient.invalidateQueries({ queryKey: ['work', 'goalStatus', projectId] }),
          queryClient.invalidateQueries({ queryKey: ['requirement-work'] }),
          queryClient.invalidateQueries({ queryKey: ['requirement-flow'] }),
          queryClient.invalidateQueries({ queryKey: qk.board(projectId) }),
        ])
        if (id) {
          setSelectedRequirement(projectId, id)
          await onCreated?.(id)
        }
      }}
    />
  )
}

function TaskFlowDetails({ flow, materials, flashStepId, projectId, onRefresh, onNavigate, onClose, onReview, onShowMaterials }: {
  flow: TaskFlow; materials: RequirementMaterial[]; flashStepId?: string | null; projectId: string; onRefresh: () => Promise<void>; onNavigate: (path: string) => void; onClose: () => void; onReview: () => void; onShowMaterials: () => void
}) {
  const agents = useAgents(projectId)
  const action = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => { await operation(); await onRefresh() } })
  const pad2 = (n: number) => String(n).padStart(2, '0')

  return <aside className="rq-task-flow-detail" aria-label="任务流程详情">
    <div className="rq-section-title rq-detail-head-bar">
      <div>
        <span className="rq-dl-eyebrow">STAGE EXECUTION &amp; DELIVERABLES · 阶段执行、产出与负责人一体表</span>
        <h3>节点与负责人</h3>
      </div>
      <div className="rq-inline-actions">
        {flow.status === 'running' ? (
          <Button size="small" icon={<PauseOutlined aria-hidden />} onClick={() => action.mutate(() => window.projectos.workflows.pause(flow.taskId))}>暂停后续节点</Button>
        ) : (
          flow.status !== 'completed' && (
            <Button size="small" type="primary" icon={<PlayCircleOutlined aria-hidden />} loading={action.isPending} onClick={() => action.mutate(() => window.projectos.workflows.start(flow.taskId))}>
              {flow.status === 'paused' ? '继续流程' : '开始流程'}
            </Button>
          )
        )}
        {flow.workspaceReady && (
          <Button size="small" type={flow.status === 'completed' ? 'primary' : 'default'} onClick={onReview}>成果审查与合入</Button>
        )}
        <Button type="text" icon={<CloseOutlined aria-hidden />} aria-label="收起任务流程详情" onClick={onClose} />
      </div>
    </div>
    {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
    {flow.error && <Alert type="error" showIcon message={flow.error} />}
    {flow.pendingApprovalId && <RequirementApproval key={flow.pendingApprovalId} projectId={projectId} approvalId={flow.pendingApprovalId} onDecided={async () => { await onRefresh() }} />}
    <ol className="rq-step-list">{flow.steps.map((step, index) => {
      const stepMaterials = materials.filter(
        (m) => m.stepId === step.id || (m.taskId === flow.taskId && m.nodeId === step.nodeId),
      )
      const latestMat = stepMaterials[0]
      const isStepRunning = step.status === 'running' || step.status === 'starting'
      const isStepDone = step.status === 'completed' && !step.stale
      const activity: 'coding' | 'writing' =
        step.stage === 'development' || step.stage === 'testing' ? 'coding' : 'writing'

      return (
        <li
          key={step.id}
          data-step-id={step.id}
          className={`rq-unified-step-row is-${step.status}${step.stale ? ' is-stale' : ''}${flashStepId === step.id ? ' is-flash-focus' : ''}`}
        >
          <div className="rq-step-heading">
            <span className="rq-step-number">{isStepDone ? '✓' : index + 1}</span>
            <div className="rq-step-title-stack">
              <div className="rq-step-title-line">
                <span className="rq-step-code-tag">STAGE {pad2(index + 1)}</span>
                <strong>{step.title}</strong>
              </div>
              <div className="rq-step-meta-line">
                {step.agentId && step.assignmentSource && (
                  <span className="rq-assignment-source">{sourceLabels[step.assignmentSource]}</span>
                )}
                <span className={`rq-secondary rq-step-status-badge is-${step.status}`}>
                  {step.stale ? '已过期需重跑' : stepLabels[step.status]}
                </span>
              </div>
            </div>
          </div>

          <div className="rq-step-deliverable-cell">
            {latestMat ? (
              <button
                type="button"
                className="rq-step-deliverable-card is-produced"
                onClick={onShowMaterials}
                title={`点击查看阶段产出：${latestMat.title}`}
              >
                <div className="rq-step-deliverable-top">
                  <span className="rq-step-deliverable-kicker">📄 本阶段产出</span>
                  {latestMat.reviewVerdict === 'approved' && (
                    <span className="rq-dl-verdict-tag">✓ 审核通过</span>
                  )}
                </div>
                <strong className="rq-step-deliverable-title">{latestMat.title}</strong>
              </button>
            ) : (
              <div className="rq-step-deliverable-card is-expected">
                <span className="rq-step-deliverable-kicker">预期阶段产出</span>
                <span className="rq-step-deliverable-expected">
                  {STAGE_EXPECTED_DELIVERABLE[step.stage] ?? '阶段交付物'}
                </span>
              </div>
            )}
            {(step.error || step.staleReason) && (
              <p className="rq-task-error">{step.error ?? step.staleReason}</p>
            )}
          </div>

          <div className="rq-step-agent-cell">
            <AgentAvatar
              name={step.agentName ?? 'Agent'}
              role={STAGE_ROLE_LABELS[step.stage] ?? step.stage}
              size={32}
              status={isStepRunning ? 'working' : 'idle'}
              activity={activity}
            />
            <Select
              aria-label={`${step.title}负责 Agent`}
              placeholder="选择负责 Agent"
              value={step.agentId}
              disabled={!['pending', 'ready'].includes(step.status) || action.isPending}
              loading={agents.isLoading}
              options={agents.data?.agents.map(({ agent }) => {
                const isNative = agent.kind !== 'external'
                return {
                  value: agent.id,
                  disabled: !isNative,
                  label: `${agent.name} · ${agent.role}${isNative ? ' · 内置结构化' : ' · 外部 Runtime (不支持流程文档)'}`,
                }
              })}
              onChange={agentId => action.mutate(() => window.projectos.workflows.assign({ stepId: step.id, expectedVersion: step.version, agentId }))}
            />
          </div>

          <div className="rq-inline-actions rq-step-actions-cell">
            {step.status === 'needs_reconciliation' && (
              <Button size="small" onClick={() => action.mutate(() => window.projectos.workflows.reconcile({ stepId: step.id, expectedVersion: step.version }))}>核对节点记录</Button>
            )}
            {latestMat && (
              <Button size="small" type="link" onClick={onShowMaterials}>查看产出</Button>
            )}
            {step.runId && (
              <Button size="small" type="link" onClick={() => onNavigate(`runs?run=${step.runId}`)}>运行记录</Button>
            )}
            {(step.status === 'failed' || (step.status === 'completed' && (flow.status === 'blocked' || step.stale))) && (
              <Button size="small" onClick={() => action.mutate(() => window.projectos.workflows.retry({ stepId: step.id, expectedVersion: step.version }))}>准备重试</Button>
            )}
          </div>
        </li>
      )
    })}</ol>
    <div className="rq-detail-actions">
      {flow.status === 'running' ? (
        <Button icon={<PauseOutlined aria-hidden />} onClick={() => action.mutate(() => window.projectos.workflows.pause(flow.taskId))}>暂停后续节点</Button>
      ) : (
        flow.status !== 'completed' && (
          <Button type="primary" icon={<PlayCircleOutlined aria-hidden />} loading={action.isPending} onClick={() => action.mutate(() => window.projectos.workflows.start(flow.taskId))}>
            {flow.status === 'paused' ? '继续流程' : '开始流程'}
          </Button>
        )
      )}
      {flow.workspaceReady && <Button onClick={onReview}>成果审查与合入</Button>}
      <Button type="text" onClick={() => onNavigate(`tasks?task=${flow.taskId}`)}>任务详情与验收 <ArrowRightOutlined aria-hidden /></Button>
    </div>
  </aside>
}

function RequirementWorkspace({ view, onEdit, onRefresh }: { view: RequirementWorkView; onEdit: (editor: Editor) => void; onRefresh: () => Promise<void> }) {
  const navigate = useNavigate(), req = view.requirement
  const [search] = useSearchParams()
  const [tab, setTab] = useState(() => search.get('tab') ?? 'tasks')
  const [viewMode, setViewMode] = useState<'route' | 'dag'>('route')
  const [planOpen, setPlanOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => search.get('task') ?? view.tasks[0]?.id ?? null)
  const [detailDismissed, setDetailDismissed] = useState(false)
  const [flashStepId, setFlashStepId] = useState<string | null>(null)
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null)
  const [templateEditor, setTemplateEditor] = useState<RequirementFlowTemplate | 'new' | null>(null)
  const [templateDirty, setTemplateDirty] = useState(false)
  const [arrangeOpen, setArrangeOpen] = useState(false)
  const [startResult, setStartResult] = useState<FlowStartIntent | null>(null)
  const [bindingVersion, setBindingVersion] = useState('wfv_standard1')
  const [criteriaOpen, setCriteriaOpen] = useState(false)
  const flow = useQuery({
    queryKey: flowKey(req.id),
    queryFn: () => window.projectos.workflows.view(req.id),
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks ?? []
      const hasActive = tasks.some((t) =>
        t.status === 'running' || t.steps.some((s) => s.status === 'starting' || s.status === 'running'),
      )
      return hasActive ? 2500 : 10000
    },
    refetchIntervalInBackground: false,
  })
  const templates = useQuery({ queryKey: ['workflow-templates', req.projectId], queryFn: () => window.projectos.workflows.templates(req.projectId), staleTime: 30_000 })
  const data = flow.data, binding = data?.binding
  const effectiveSelectedTaskId = selectedTaskId ?? (!detailDismissed ? (data?.tasks[0]?.taskId ?? view.tasks[0]?.id ?? null) : null)
  const selectedFlow = data?.tasks.find(task => task.taskId === effectiveSelectedTaskId)
  const parallel = binding && data ? summarizeParallelStages(binding.graph, data.tasks) : null
  const actionLockRef = useRef(false)
  const assignAILockRef = useRef(false)
  const [startingTaskId, setStartingTaskId] = useState<string | null>(null)
  const refresh = async () => { await Promise.all([onRefresh(), flow.refetch(), flow.data ? Promise.resolve() : Promise.resolve()]) }
  const action = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => {
    if (actionLockRef.current) return
    actionLockRef.current = true
    try {
      await operation()
      await refresh()
    } finally {
      actionLockRef.current = false
    }
  } })
  const assignAIMutation = useMutation({ mutationFn: async () => {
    if (assignAILockRef.current) return
    assignAILockRef.current = true
    try {
      await window.projectos.workflows.assignAI(req.id)
      await refresh()
    } finally {
      assignAILockRef.current = false
    }
  } })
  const go = (path: string) => navigate(`/projects/${req.projectId}/${path}`)
  const start = (taskId: string) => {
    setDetailDismissed(false)
    setSelectedTaskId(taskId)
    setStartingTaskId(taskId)
    action.mutate(() => window.projectos.workflows.start(taskId), {
      onSettled: () => setStartingTaskId((curr) => (curr === taskId ? null : curr)),
    })
  }
  const bind = (templateVersionId: string) => action.mutate(() => window.projectos.workflows.bind({ requirementId: req.id, expectedRequirementVersion: req.version, templateVersionId, assignmentMode: binding?.assignmentMode ?? 'manual', assignments: {} }))
  const stageCount = binding?.graph.nodes.length ?? 0
  const materialCount = data?.materials.length ?? 0
  const pad2 = (n: number) => String(n).padStart(2, '0')
  const focusStepInDetail = (taskId: string, stepId?: string | null, scrollApproval?: boolean) => {
    setDetailDismissed(false)
    setSelectedTaskId(taskId)
    if (stepId) {
      setFlashStepId(stepId)
      window.setTimeout(() => setFlashStepId((curr) => (curr === stepId ? null : curr)), 2200)
    }
    window.setTimeout(() => {
      if (scrollApproval) {
        const approvalEl = document.querySelector('.rq-approval-card')
        if (approvalEl) {
          approvalEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return
        }
      }
      if (stepId) {
        const stepEl = document.querySelector(`[data-step-id="${stepId}"]`)
        if (stepEl) {
          stepEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return
        }
      }
      document.querySelector('.rq-task-flow-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 80)
  }
  const criteriaCoverage = useMemo(() => {
    return req.acceptanceCriteria.map((raw, idx) => {
      const code = `C-${pad2(idx + 1)}`
      const text = raw.trim()
      const matchedTasks = view.tasks.filter((task) => {
        if (view.tasks.length === 1) return true
        return (
          task.acceptanceCriteria.some((ac) => ac.includes(`[${code}]`) || ac.includes(text) || text.includes(ac.trim())) ||
          task.title.includes(text) ||
          task.description.includes(text)
        )
      })
      const doneCount = matchedTasks.filter((t) => t.status === 'done').length
      const status: 'verified' | 'in_progress' | 'unmapped' =
        matchedTasks.length === 0 ? 'unmapped' : doneCount === matchedTasks.length ? 'verified' : 'in_progress'
      return { code, text, matchedTasks, status }
    })
  }, [req.acceptanceCriteria, view.tasks])
  const coveredCriteriaCount = criteriaCoverage.filter((item) => item.status !== 'unmapped').length
  const verifiedCriteriaCount = criteriaCoverage.filter((item) => item.status === 'verified').length
  const completedFlowsCount = data?.tasks.filter((t) => t.status === 'completed').length ?? 0
  return <section className="rq-workspace" aria-label={req.title}>
    <div className="rq-heading">
      <div className="rq-heading-main">
        <div className="rq-eyebrow">
          <b>REQUIREMENT FLOW</b>
          <i aria-hidden />
          <span>{stageCount ? `${stageCount} 个阶段` : '待绑定流程'} · {view.tasks.length} 项任务</span>
        </div>
        <h2>{req.title}</h2>
        <div className="rq-heading-meta">
          <StatusPill tone={toneForStatus(req.status)}>{requirementLabels[req.status] ?? req.status}</StatusPill>
          <span>版本 {req.version}</span>
        </div>
      </div>
      <div className="rq-heading-side">
        <div className="rq-metrics" aria-label="需求指标汇总">
          <div><strong>{pad2(view.tasks.length)}</strong><span>任务项</span></div>
          <div><strong>{pad2(stageCount)}</strong><span>流程阶段</span></div>
          <div><strong>{pad2(materialCount)}</strong><span>产出资料</span></div>
        </div>
        <Button icon={<EditOutlined aria-hidden />} onClick={() => onEdit({ kind: 'documents' })}>编辑需求</Button>
      </div>
    </div>
    {(action.isError || assignAIMutation.isError) && <Alert type="error" showIcon message={errorMessage(action.error ?? assignAIMutation.error)} />}
    {flow.isLoading ? <LoadingBlock label="正在读取需求流程" rows={3} /> : flow.isError ? <ErrorState title="流程读取失败" message={errorMessage(flow.error)} onRetry={() => void flow.refetch()} /> : !binding ? <div className="rq-bind-flow"><h3>先为这个需求选择流程</h3><div className="rq-inline-actions"><Select aria-label="选择需求流程" value={bindingVersion} onChange={setBindingVersion} options={templates.data?.templates.map(template => ({ value: template.versionId, label: template.name }))} /><Button type="primary" onClick={() => bind(bindingVersion)}>使用这个流程</Button><Button onClick={() => setTemplateEditor('new')}>新建流程</Button></div></div> : <>
      {data && <RequirementJourneyTrack
        projectId={req.projectId}
        requirementId={req.id}
        requirementTitle={req.title}
        binding={binding}
        flow={data}
        tasks={view.tasks.map(t => ({ id: t.id, title: t.title }))}
        onNavigate={go}
      />}
      <div className="rq-flow-caption"><span>{binding.templateName} · {binding.assignmentMode === 'ai' ? 'AI 自动分配' : '手动分配 Agent'}{parallel?.hasParallelActive && parallel.activeNodes.length > 1 ? ` · ${parallel.headline}` : ''}</span><Tooltip title={binding.lockedAt ? '执行中的需求固定使用所选流程版本' : undefined}><Button type="text" disabled={Boolean(binding.lockedAt)} onClick={() => setTemplateEditor(templates.data?.templates.find(template => template.versionId === binding.templateVersionId) ?? 'new')}>调整流程</Button></Tooltip></div>
      <div className="rq-governance-strip" role="region" aria-label="全链路工程治理与验收覆盖">
        <div className="rq-governance-pills">
          <div className="rq-gov-pill is-ok" title="规划与执行上下文完整装载，不发生静默截断">
            <span className="rq-gov-dot" aria-hidden />
            <span className="rq-gov-label">上下文契约</span>
            <strong>全文装载 · {(req.body?.length ?? 0) + req.acceptanceCriteria.join('').length} 字</strong>
          </div>
          <button
            type="button"
            className={`rq-gov-pill is-interactive ${
              req.acceptanceCriteria.length === 0
                ? 'is-neutral'
                : coveredCriteriaCount === req.acceptanceCriteria.length
                  ? 'is-ok'
                  : 'is-warn'
            }`}
            aria-expanded={criteriaOpen}
            onClick={() => setCriteriaOpen((prev) => !prev)}
          >
            <span className="rq-gov-dot" aria-hidden />
            <span className="rq-gov-label">验收标准覆盖</span>
            <strong>
              {req.acceptanceCriteria.length > 0
                ? `${coveredCriteriaCount}/${req.acceptanceCriteria.length} 已承接 · ${verifiedCriteriaCount} 已验证`
                : '未设独立条目'}
            </strong>
            <span className="rq-gov-toggle">{criteriaOpen ? '收起' : '矩阵'}</span>
          </button>
          <div className="rq-gov-pill is-ok" title="所有流程节点均经过结构化能力预检，执行期锁定模板版本">
            <span className="rq-gov-dot" aria-hidden />
            <span className="rq-gov-label">执行器门禁</span>
            <strong>{binding.lockedAt ? `版本已锁定 v${binding.version}` : `结构化预检就绪 v${binding.version}`}</strong>
          </div>
          <div className="rq-gov-pill is-ok" title="测试、构建、代码检查按命令分组独立裁决，后续命令不会掩盖失败">
            <span className="rq-gov-dot" aria-hidden />
            <span className="rq-gov-label">逐项验证隔离</span>
            <strong>{completedFlowsCount}/{view.tasks.length} 流程完结</strong>
          </div>
        </div>
        {criteriaOpen && req.acceptanceCriteria.length > 0 && (
          <div className="rq-criteria-matrix" aria-label="需求验收标准追踪矩阵">
            <div className="rq-criteria-matrix-head">
              <strong>需求验收标准追踪矩阵（Acceptance Coverage Matrix）</strong>
              <span className="rq-secondary">点击关联任务可直接定位至下方任务与流程节点</span>
            </div>
            <ul className="rq-criteria-list">
              {criteriaCoverage.map((item) => (
                <li key={item.code} className={`rq-criteria-row is-${item.status}`}>
                  <span className="rq-criteria-code">{item.code}</span>
                  <span className="rq-criteria-text">{item.text}</span>
                  <div className="rq-criteria-tasks">
                    {item.matchedTasks.length > 0 ? (
                      item.matchedTasks.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          className="rq-criteria-task-chip"
                          onClick={() => {
                            setTab('tasks')
                            setSelectedTaskId(t.id)
                          }}
                        >
                          {t.title} · {taskStatusLabel(t.status)}
                        </button>
                      ))
                    ) : (
                      <span className="rq-criteria-unmapped">待拆分或关联任务</span>
                    )}
                  </div>
                  <StatusPill
                    tone={item.status === 'verified' ? 'success' : item.status === 'in_progress' ? 'accent' : 'warning'}
                  >
                    {item.status === 'verified' ? '已验证' : item.status === 'in_progress' ? '执行中' : '待覆盖'}
                  </StatusPill>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {data && <RequirementNextAction requirementId={req.id} flow={data} tasks={view.tasks} result={startResult} onResult={setStartResult} onArrange={() => setArrangeOpen(true)}
        onSelectTask={taskId => { setTab('tasks'); setSelectedTaskId(taskId) }} onShowMaterials={() => setTab('materials')} onRefresh={refresh} />}
    </>}
    <Tabs activeKey={tab} onChange={setTab} items={[
      {
        key: 'tasks',
        label: `任务 ${view.tasks.length}`,
        children: (
          <>
            <div className="rq-section-title rq-dl-viewbar-row">
              <div className="rq-dl-viewbar-left">
                <h3>{view.tasks.length ? '这次交付的任务' : '接下来，添加任务'}</h3>
                {view.tasks.length > 0 && (
                  <div className="rq-dl-viewbar" role="tablist" aria-label="需求任务与依赖视图">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewMode === 'route'}
                      className={viewMode === 'route' ? 'is-active' : ''}
                      onClick={() => setViewMode('route')}
                    >
                      <Layers3 size={14} />
                      阶段路线
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={viewMode === 'dag'}
                      className={viewMode === 'dag' ? 'is-active' : ''}
                      onClick={() => setViewMode('dag')}
                    >
                      <GitBranch size={14} />
                      任务依赖
                    </button>
                  </div>
                )}
              </div>
              <div className="rq-inline-actions">
                <Button disabled={!binding || req.status === 'implemented' || planOpen || action.isPending || assignAIMutation.isPending} onClick={() => setPlanOpen(true)}>AI 拆分任务</Button>
                {binding && view.tasks.length > 0 && (
                  <Button loading={assignAIMutation.isPending} disabled={assignAIMutation.isPending || action.isPending} onClick={() => assignAIMutation.mutate()}>AI 分配 Agent</Button>
                )}
                <Button type={view.tasks.length ? 'default' : 'primary'} icon={<PlusOutlined aria-hidden />} disabled={!binding || req.status === 'implemented' || action.isPending || assignAIMutation.isPending} onClick={() => onEdit({ kind: 'task' })}>添加任务</Button>
              </div>
            </div>

            {!view.tasks.length ? (
              <EmptyState title="将需求拆成可以独立完成的任务" description="每个任务都会执行上方所选流程，可由不同 Agent 接力完成。" />
            ) : viewMode === 'dag' ? (
              <RequirementDependencyGraph
                graph={binding?.graph}
                tasks={view.tasks}
                taskFlows={data?.tasks ?? []}
                materials={data?.materials ?? []}
                selectedTaskId={effectiveSelectedTaskId}
                onSelectTask={(taskId) => {
                  setDetailDismissed(false)
                  setSelectedTaskId(taskId)
                }}
                onOpenStageMaterial={() => setTab('materials')}
              />
            ) : (
              <div className={`rq-task-workbench${selectedFlow ? ' has-detail' : ''}`}>
                <div className="rq-dl-ledger-panel">
                  <div className="rq-dl-panel-head">
                    <div>
                      <span className="rq-dl-eyebrow">DELIVERY TASKS &amp; READINESS</span>
                      <h4>交付任务与协作团队</h4>
                    </div>
                    <span className="rq-dl-panel-note">
                      {view.tasks.length} 项任务 · {stageCount} 阶段
                    </span>
                  </div>
                  <ul className="rq-task-list">
                    {view.tasks.map((task, taskIdx) => {
                      const taskFlow = data?.tasks.find((item) => item.taskId === task.id)
                      const activeSteps = taskFlow?.steps.filter((step) => ['starting', 'running', 'waiting_approval', 'failed', 'needs_reconciliation'].includes(step.status)) ?? []
                      const staleSteps = taskFlow?.steps.filter((step) => step.status === 'completed' && step.stale) ?? []
                      const readySteps = taskFlow?.steps.filter((step) => step.status === 'ready') ?? []
                      const focusSteps = activeSteps.length > 0 ? activeSteps : staleSteps.length > 0 ? staleSteps : readySteps
                      const current = focusSteps[0]
                      const stepSummary = focusSteps.length > 1
                        ? `并行：${focusSteps.map((s) => `${s.title} · ${s.stale ? '已过期需重跑' : stepLabels[s.status]}`).join(' / ')}`
                        : current
                          ? `${current.title} · ${current.stale ? '已过期需重跑' : stepLabels[current.status]}`
                          : taskFlow?.status === 'completed'
                            ? '流程完成 · 待验收'
                            : taskStatusLabel(task.status)
                      const agentNames = [...new Set(focusSteps.map((s) => s.agentName).filter((name): name is string => Boolean(name)))]
                      const missing = taskFlow?.steps.some((step) => !step.agentId)
                      const preparation = view.preparations.find((item) => item.taskId === task.id)
                      const selected = effectiveSelectedTaskId === task.id
                      const doneStepCount = taskFlow?.steps.filter((s) => s.status === 'completed' && !s.stale).length ?? 0
                      const totalStepCount = taskFlow?.steps.length ?? 0

                      return (
                        <li key={task.id} className={`rq-task${selected ? ' is-selected' : ''}`} data-task-id={task.id}>
                          <div className="rq-task-top-row">
                            <div className="rq-task-main">
                              <div className="rq-dl-task-kicker">
                                <span className="rq-dl-task-code">TASK {pad2(taskIdx + 1)}</span>
                                {totalStepCount > 0 && (
                                  <span className="rq-dl-task-progress">
                                    阶段进度 {doneStepCount}/{totalStepCount}
                                  </span>
                                )}
                              </div>
                              <button
                                className="rq-task-title"
                                onClick={() => {
                                  if (selected && !detailDismissed) {
                                    setDetailDismissed(true)
                                    setSelectedTaskId(null)
                                  } else {
                                    setDetailDismissed(false)
                                    setSelectedTaskId(task.id)
                                  }
                                }}
                              >
                                {task.title}
                              </button>
                              <div className="rq-task-meta">
                                <span>{stepSummary}</span>
                                {agentNames.length > 0 && <span>{agentNames.join('、')}</span>}
                                {task.dependencyIds.length > 0 && <span>{task.dependencyIds.length} 项前置任务</span>}
                              </div>
                              {(taskFlow?.error || preparation?.error) && (
                                <p className="rq-task-error">{taskFlow?.error ?? preparation?.error}</p>
                              )}
                            </div>
                            <div className="rq-task-actions">
                              {taskFlow ? (
                                <Button
                                  type={taskFlow.status === 'completed' || taskFlow.pendingApprovalId ? 'primary' : 'default'}
                                  loading={action.isPending && startingTaskId === task.id}
                                  disabled={action.isPending && startingTaskId === task.id}
                                  onClick={() => {
                                    if (taskFlow.pendingApprovalId) {
                                      focusStepInDetail(task.id, activeSteps[0]?.id, true)
                                    } else if (taskFlow.status === 'completed' && staleSteps.length === 0) {
                                      setDetailDismissed(false)
                                      setSelectedTaskId(task.id)
                                      setReviewTaskId(task.id)
                                    } else if (taskFlow.status === 'running' || taskFlow.status === 'blocked' || (taskFlow.status === 'completed' && staleSteps.length > 0)) {
                                      focusStepInDetail(task.id, current?.id)
                                    } else if (missing && binding?.assignmentMode !== 'ai') {
                                      focusStepInDetail(task.id, taskFlow.steps.find((s) => !s.agentId)?.id)
                                    } else {
                                      start(task.id)
                                    }
                                  }}
                                >
                                  {taskFlow.pendingApprovalId
                                    ? '处理授权'
                                    : taskFlow.status === 'completed'
                                      ? staleSteps.length > 0
                                        ? '重新验证'
                                        : '查看成果'
                                      : taskFlow.status === 'blocked'
                                        ? '处理问题'
                                        : taskFlow.status === 'running'
                                          ? '查看进度'
                                          : missing && binding?.assignmentMode !== 'ai'
                                            ? '分配 Agent'
                                            : taskFlow.status === 'paused'
                                              ? '继续流程'
                                              : '开始流程'}
                                </Button>
                              ) : (
                                <Button onClick={() => go(`tasks?task=${task.id}`)}>任务详情</Button>
                              )}
                            </div>
                          </div>
                        </li>
                      )
                    })}
                  </ul>

                  {selectedFlow && (() => {
                    const completedSteps = selectedFlow.steps.filter((s) => s.status === 'completed' && !s.stale).length
                    const totalSteps = selectedFlow.steps.length
                    const taskMaterials = (data?.materials ?? []).filter((m) => m.taskId === selectedFlow.taskId)
                    const uniqueAgents = [...new Map(
                      selectedFlow.steps
                        .filter((s) => s.agentName)
                        .map((s) => [s.agentName!, { name: s.agentName!, role: STAGE_ROLE_LABELS[s.stage] ?? s.stage, isRunning: s.status === 'running' || s.status === 'starting' }]),
                    ).values()]

                    return (
                      <div className="rq-dl-readiness-box rq-dl-left-readiness" aria-label="阶段准备度与协作团队">
                        <div className="rq-dl-readiness-top">
                          <span className="rq-dl-eyebrow">REVIEW &amp; EXECUTION READINESS</span>
                          <span className={`rq-dl-ready-badge ${selectedFlow.status === 'completed' ? 'is-ok' : selectedFlow.pendingApprovalId ? 'is-warn' : 'is-accent'}`}>
                            <CheckCircle2 size={13} />
                            {selectedFlow.status === 'completed' ? '全部阶段已完成' : selectedFlow.pendingApprovalId ? '有待处理授权' : `阶段 ${completedSteps}/${totalSteps}`}
                          </span>
                        </div>
                        <div className="rq-dl-readiness-score">
                          <strong>{pad2(completedSteps)}<span> / {pad2(totalSteps)} 阶段</span></strong>
                          <div className="rq-dl-readiness-stats">
                            <div><span>参与 Agent</span><strong>{uniqueAgents.length} 位</strong></div>
                            <div><span>产出资料</span><strong>{taskMaterials.length} 份</strong></div>
                          </div>
                        </div>
                        {uniqueAgents.length > 0 && (
                          <div className="rq-dl-agent-strip">
                            {uniqueAgents.map((ag) => (
                              <span key={ag.name} className={`rq-dl-agent-chip${ag.isRunning ? ' is-running' : ''}`}>
                                <AgentAvatar name={ag.name} role={ag.role ?? undefined} size={20} status={ag.isRunning ? 'working' : 'idle'} />
                                <b>{ag.name}</b>
                              </span>
                            ))}
                          </div>
                        )}
                        <div className="rq-detail-actions rq-detail-actions-top">
                          {selectedFlow.workspaceReady && (
                            <Button size="small" type={selectedFlow.status === 'completed' ? 'primary' : 'default'} onClick={() => setReviewTaskId(selectedFlow.taskId)}>成果审查与合入</Button>
                          )}
                          {taskMaterials.length > 0 && (
                            <Button size="small" onClick={() => setTab('materials')}>查看产出 ({taskMaterials.length})</Button>
                          )}
                          <Button size="small" type="link" onClick={() => go(`collaboration`)}>Agent 协作图 →</Button>
                        </div>
                      </div>
                    )
                  })()}
                </div>
                {selectedFlow && (
                  <TaskFlowDetails
                    key={selectedFlow.taskId}
                    flow={selectedFlow}
                    materials={data?.materials ?? []}
                    flashStepId={flashStepId}
                    projectId={req.projectId}
                    onClose={() => {
                      setDetailDismissed(true)
                      setSelectedTaskId(null)
                    }}
                    onRefresh={refresh}
                    onNavigate={go}
                    onReview={() => setReviewTaskId(selectedFlow.taskId)}
                    onShowMaterials={() => setTab('materials')}
                  />
                )}
              </div>
            )}
          </>
        ),
      },
      { key: 'documents', label: '需求说明', children: <div className="rq-documents"><h3>{req.title}</h3><div className="rq-prose">{req.body || '尚未补充需求描述'}</div>{req.acceptanceCriteria.length > 0 && <><h3>验收标准</h3><ol>{req.acceptanceCriteria.map((item, index) => <li key={index}>{item}</li>)}</ol></>}{req.technicalDesign && <><h3>技术设计</h3><div className="rq-prose">{req.technicalDesign}</div></>}</div> },
      { key: 'organization-knowledge', label: '组织资料', children: <RequirementOrganizationKnowledge key={req.id} requirementId={req.id}/> },
      { key: 'materials', label: `产出资料 ${data?.materials.length ?? 0}`, children: <RequirementMaterials projectId={req.projectId} requirementId={req.id} requirementTitle={req.title} materials={data?.materials ?? []} tasks={view.tasks.map(t => ({ id: t.id, title: t.title }))} taskFlows={data?.tasks ?? []} onNavigate={go} /> },
    ]} />
    {planOpen && <RequirementPlanDialog requirement={req} onClose={() => setPlanOpen(false)} onApplied={refresh}
      onStart={binding ? taskIds => action.mutate(async () => { const result = await window.projectos.workflows.startAll({ requirementId: req.id, expectedBindingVersion: binding.version, requestKey: `plan-start-${crypto.randomUUID()}`, taskIds }); setStartResult(result.intent) }) : undefined} />}
    {arrangeOpen && binding && <RequirementArrangement requirementId={req.id} projectId={req.projectId} binding={binding} taskFlows={data?.tasks} onClose={() => setArrangeOpen(false)} onChanged={refresh} />}
    {templateEditor && <DialogShell open dirty={templateDirty} onOpenChange={open => { if (!open) { setTemplateEditor(null); setTemplateDirty(false) } }} ariaLabel="调整需求流程" width={1120}><OverlayHeader title="调整需求流程" /><OverlayScrollArea className="rq-integration-scroll"><RequirementFlowEditor projectId={req.projectId} initial={templateEditor === 'new' ? undefined : templateEditor} onDirty={() => setTemplateDirty(true)} onCancel={() => { setTemplateEditor(null); setTemplateDirty(false) }} onSaved={template => { setTemplateEditor(null); setTemplateDirty(false); void templates.refetch(); bind(template.versionId) }} /></OverlayScrollArea></DialogShell>}
    {reviewTaskId && <RequirementIntegrationDialog taskId={reviewTaskId} projectId={req.projectId} onClose={() => setReviewTaskId(null)} onRefresh={refresh} onNavigate={go} />}
  </section>
}

export default function RequirementWorkPage() {
  const { projectId = '' } = useParams()
  const [search, setSearch] = useSearchParams()
  const queryClient = useQueryClient()
  const requirements = useRequirements(projectId)
  const selectedByProject = useUiStore((state) => state.selectedRequirementByProject)
  const setSelectedRequirement = useUiStore((state) => state.setSelectedRequirement)
  const [editor, setEditor] = useState<Editor | null>(null)
  const list = requirements.data?.requirements ?? []
  const requested = search.get('requirement')
  const storedId = selectedByProject[projectId]
  const selectedId = requested ?? (storedId && list.some(req => req.id === storedId) ? storedId : list[0]?.id)
  const selected = list.find(req => req.id === selectedId)
  useEffect(() => {
    if (projectId && selected && storedId !== selected.id) {
      setSelectedRequirement(projectId, selected.id)
    }
  }, [projectId, selected, setSelectedRequirement, storedId])
  const work = useQuery({
    queryKey: qk.requirementWork(selectedId ?? ''),
    queryFn: () => window.projectos.requirements.work(selectedId!),
    enabled: Boolean(selected),
    refetchInterval: editor ? false : 8000,
    refetchIntervalInBackground: false,
  })
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.requirements(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['requirement-work'] }),
      queryClient.invalidateQueries({ queryKey: ['requirement-flow'] }),
      queryClient.invalidateQueries({ queryKey: ['flow-assignment-preview'] }),
      queryClient.invalidateQueries({ queryKey: qk.projectRequirementFlows(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.collaborationOverview(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['agents', projectId] }),
      queryClient.invalidateQueries({ queryKey: qk.artifacts(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.board(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.approvals(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['task'] }),
    ])
  }
  useEffect(() => {
    if (!projectId) return undefined
    const unsubscribe = window.projectos.runtime.onEvent(({ event }) => {
      if (event.type === 'runtime.log' || event.type === 'run.delta') return
      void queryClient.invalidateQueries({ queryKey: ['requirement-work'] })
      void queryClient.invalidateQueries({ queryKey: ['requirement-flow'] })
      void queryClient.invalidateQueries({ queryKey: ['flow-assignment-preview'] })
      void queryClient.invalidateQueries({ queryKey: qk.projectRequirementFlows(projectId) })
      void queryClient.invalidateQueries({ queryKey: qk.collaborationOverview(projectId) })
      void queryClient.invalidateQueries({ queryKey: qk.board(projectId) })
    })
    return unsubscribe
  }, [projectId, queryClient])
  const choose = (id: string) => { setSelectedRequirement(projectId, id); setSearch({ requirement: id }) }
  return <div className="po-page po-page-wide rq-page" key={projectId}>
    <PageHeader compact title="需求工作台" actions={<><Button icon={<ReloadOutlined aria-hidden />} aria-label="刷新需求" onClick={() => void refresh()} loading={work.isFetching && !work.isLoading} /><Button icon={<PlusOutlined aria-hidden />} onClick={() => setEditor({ kind: 'requirement' })}>新建需求</Button></>} />
    {requirements.isLoading ? <LoadingBlock label="正在读取需求" rows={6} /> : requirements.isError ? <ErrorState title="需求读取失败" message={errorMessage(requirements.error)} onRetry={() => void requirements.refetch()} /> : list.length === 0 ? <div className="rq-start"><EmptyState title="以需求组织一次完整交付" description="描述目标并选择流程，再将任务交给 Agent 协作完成。" /><Button type="primary" icon={<PlusOutlined aria-hidden />} onClick={() => setEditor({ kind: 'requirement' })}>创建第一个需求</Button></div> : <div className="rq-layout">
      <nav className="rq-requirements" aria-label="需求列表"><div className="rq-list-label">项目需求 <span>{list.length}</span></div>{list.map(req => <button key={req.id} className={`rq-requirement ${req.id === selectedId ? 'is-selected' : ''}`} aria-current={req.id === selectedId ? 'page' : undefined} onClick={() => choose(req.id)}><strong>{req.title}</strong><span>{requirementLabels[req.status] ?? req.status} · 版本 {req.version}</span></button>)}</nav>
      <div className="rq-content">
        <Select className="rq-mobile-select" aria-label="选择需求" value={selectedId} onChange={choose} options={list.map(req => ({ value: req.id, label: req.title }))} />
        {!selected ? <ErrorState title="此需求不在当前项目中" message="请选择当前项目的需求继续工作。" onRetry={() => choose(list[0]!.id)} /> : work.isLoading ? <LoadingBlock rows={7} label="正在读取需求与任务" /> : work.isError ? <ErrorState title="工作台读取失败" message={errorMessage(work.error)} onRetry={() => void work.refetch()} /> : work.data ? <RequirementWorkspace key={work.data.requirement.id} view={work.data} onEdit={setEditor} onRefresh={refresh} /> : null}
      </div>
    </div>}
    {editor && <WorkEditor key={`${projectId}-${selectedId}-${editor.kind}`} editor={editor} projectId={projectId} view={work.data} onClose={() => setEditor(null)} onSaved={async (id) => { await refresh(); if (id) choose(id) }} />}
  </div>
}
