import { RequirementPlanDialog } from './RequirementPlanDialog'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Form, Input, Select, Tabs, Radio, Tooltip } from 'antd'
import { ArrowRightOutlined, EditOutlined, PlusOutlined, ReloadOutlined, PauseOutlined, PlayCircleOutlined, CloseOutlined } from '@ant-design/icons'
import type { RequirementWorkView, RequirementFlowTemplate, TaskFlow, RequirementFlowStep, FlowStartIntent, FlowAssignmentSource } from '@projectos/contracts'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, StatusPill, toneForStatus } from '@projectos/ui'
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
import { RequirementArrangement } from './RequirementArrangement'
import { RequirementNextAction } from './RequirementNextAction'
import './requirement-work.css'
import './requirement-flow.css'

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
  const save = useMutation({ mutationFn: async () => {
    const values = await form.validateFields()
    if (editor.kind === 'requirement') return (await window.projectos.requirements.create({ projectId, title: values.title, body: values.body ?? '', acceptanceCriteria: parseLines(values.acceptance ?? ''), source: 'local',
      workflow: { templateVersionId: values.templateVersionId, assignmentMode: values.assignmentMode, assignments: {} } })).requirement.id
    if (!req) throw new Error('需求已不可用，请重新打开')
    if (editor.kind === 'documents') await window.projectos.requirements.update({ requirementId: req.id, expectedVersion: req.version, title: values.title, body: values.body ?? '', technicalDesign: values.technicalDesign ?? '', acceptanceCriteria: parseLines(values.acceptance ?? '') })
    else await window.projectos.tasks.create({ projectId, requirementId: req.id, title: values.title, description: values.description ?? '', acceptanceCriteria: parseLines(values.acceptance ?? ''), dependsOn: values.dependsOn ?? [], workType: 'development' })
    return req.id
  }, onSuccess: async id => { setDirty(false); await onSaved(id); onClose() } })
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

function TaskFlowDetails({ flow, projectId, onRefresh, onNavigate, onClose, onReview }: {
  flow: TaskFlow; projectId: string; onRefresh: () => Promise<void>; onNavigate: (path: string) => void; onClose: () => void; onReview: () => void
}) {
  const agents = useAgents(projectId)
  const action = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => { await operation(); await onRefresh() } })
  return <aside className="rq-task-flow-detail" aria-label="任务流程详情"><div className="rq-section-title"><h3>节点与负责人</h3><Button type="text" icon={<CloseOutlined aria-hidden />} aria-label="收起任务流程详情" onClick={onClose} /></div>
    {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
    {flow.error && <Alert type="error" showIcon message={flow.error} />}
    {flow.pendingApprovalId && <RequirementApproval key={flow.pendingApprovalId} projectId={projectId} approvalId={flow.pendingApprovalId} onDecided={async () => { await onRefresh() }} />}
    <ol className="rq-step-list">{flow.steps.map((step, index) => <li key={step.id} className={`is-${step.status}${step.stale ? ' is-stale' : ''}`}><div className="rq-step-heading"><span className="rq-step-number">{step.status === 'completed' && !step.stale ? '✓' : index + 1}</span><strong>{step.title}</strong>{step.agentId && step.assignmentSource && <span className="rq-assignment-source">{sourceLabels[step.assignmentSource]}</span>}<span className="rq-secondary">{step.stale ? '已过期需重跑' : stepLabels[step.status]}</span></div>
      <Select aria-label={`${step.title}负责 Agent`} placeholder="选择负责 Agent" value={step.agentId} disabled={!['pending', 'ready'].includes(step.status) || action.isPending} loading={agents.isLoading} options={agents.data?.agents.map(({ agent }) => ({ value: agent.id, label: `${agent.name} · ${agent.role}` }))} onChange={agentId => action.mutate(() => window.projectos.workflows.assign({ stepId: step.id, expectedVersion: step.version, agentId }))} />
      {(step.error || step.staleReason) && <p className="rq-task-error">{step.error ?? step.staleReason}</p>}<div className="rq-inline-actions">{step.status === 'needs_reconciliation' && <Button onClick={() => action.mutate(() => window.projectos.workflows.reconcile({ stepId: step.id, expectedVersion: step.version }))}>核对节点记录</Button>}{step.runId && <Button type="link" onClick={() => onNavigate(`runs?run=${step.runId}`)}>运行记录</Button>}{(step.status === 'failed' || (step.status === 'completed' && (flow.status === 'blocked' || step.stale))) && <Button onClick={() => action.mutate(() => window.projectos.workflows.retry({ stepId: step.id, expectedVersion: step.version }))}>准备重试</Button>}</div>
    </li>)}</ol>
    <div className="rq-detail-actions">{flow.status === 'running' ? <Button icon={<PauseOutlined aria-hidden />} onClick={() => action.mutate(() => window.projectos.workflows.pause(flow.taskId))}>暂停后续节点</Button> : flow.status !== 'completed' && <Button type="primary" icon={<PlayCircleOutlined aria-hidden />} loading={action.isPending} onClick={() => action.mutate(() => window.projectos.workflows.start(flow.taskId))}>{flow.status === 'paused' ? '继续流程' : '开始流程'}</Button>}
      {flow.workspaceReady && <Button onClick={onReview}>成果审查与合入</Button>}<Button type="text" onClick={() => onNavigate(`tasks?task=${flow.taskId}`)}>任务详情与验收 <ArrowRightOutlined aria-hidden /></Button></div>
  </aside>
}

function RequirementWorkspace({ view, onEdit, onRefresh }: { view: RequirementWorkView; onEdit: (editor: Editor) => void; onRefresh: () => Promise<void> }) {
  const navigate = useNavigate(), req = view.requirement
  const [search] = useSearchParams()
  const [tab, setTab] = useState(() => search.get('tab') ?? 'tasks')
  const [planOpen, setPlanOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => search.get('task'))
  const [reviewTaskId, setReviewTaskId] = useState<string | null>(null)
  const [templateEditor, setTemplateEditor] = useState<RequirementFlowTemplate | 'new' | null>(null)
  const [templateDirty, setTemplateDirty] = useState(false)
  const [arrangeOpen, setArrangeOpen] = useState(false)
  const [startResult, setStartResult] = useState<FlowStartIntent | null>(null)
  const [bindingVersion, setBindingVersion] = useState('wfv_standard1')
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
  const selectedFlow = data?.tasks.find(task => task.taskId === selectedTaskId)
  const parallel = binding && data ? summarizeParallelStages(binding.graph, data.tasks) : null
  const refresh = async () => { await Promise.all([onRefresh(), flow.refetch(), flow.data ? Promise.resolve() : Promise.resolve()]) }
  const action = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => { await operation(); await refresh() } })
  const go = (path: string) => navigate(`/projects/${req.projectId}/${path}`)
  const start = (taskId: string) => { setSelectedTaskId(taskId); action.mutate(() => window.projectos.workflows.start(taskId)) }
  const bind = (templateVersionId: string) => action.mutate(() => window.projectos.workflows.bind({ requirementId: req.id, expectedRequirementVersion: req.version, templateVersionId, assignmentMode: binding?.assignmentMode ?? 'manual', assignments: {} }))
  const stageCount = binding?.graph.nodes.length ?? 0
  const materialCount = data?.materials.length ?? 0
  const pad2 = (n: number) => String(n).padStart(2, '0')
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
    {action.isError && <Alert type="error" showIcon message={errorMessage(action.error)} />}
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
      {data && <RequirementNextAction requirementId={req.id} flow={data} tasks={view.tasks} result={startResult} onResult={setStartResult} onArrange={() => setArrangeOpen(true)}
        onSelectTask={taskId => { setTab('tasks'); setSelectedTaskId(taskId) }} onShowMaterials={() => setTab('materials')} onRefresh={refresh} />}
    </>}
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'tasks', label: `任务 ${view.tasks.length}`, children: <><div className="rq-section-title"><h3>{view.tasks.length ? '这次交付的任务' : '接下来，添加任务'}</h3><div className="rq-inline-actions"><Button disabled={!binding || req.status === 'implemented'} onClick={() => setPlanOpen(true)}>AI 拆分任务</Button>{binding && view.tasks.length > 0 && <Button loading={action.isPending} onClick={() => action.mutate(() => window.projectos.workflows.assignAI(req.id))}>AI 分配 Agent</Button>}<Button type={view.tasks.length ? 'default' : 'primary'} icon={<PlusOutlined aria-hidden />} disabled={!binding || req.status === 'implemented'} onClick={() => onEdit({ kind: 'task' })}>添加任务</Button></div></div>
        {!view.tasks.length ? <EmptyState title="将需求拆成可以独立完成的任务" description="每个任务都会执行上方所选流程，可由不同 Agent 接力完成。" /> : <div className={`rq-task-workbench${selectedFlow ? ' has-detail' : ''}`}><ul className="rq-task-list">{view.tasks.map(task => {
          const taskFlow = data?.tasks.find(item => item.taskId === task.id)
          const activeSteps = taskFlow?.steps.filter(step => ['starting', 'running', 'waiting_approval', 'failed', 'needs_reconciliation'].includes(step.status)) ?? []
          const staleSteps = taskFlow?.steps.filter(step => step.status === 'completed' && step.stale) ?? []
          const readySteps = taskFlow?.steps.filter(step => step.status === 'ready') ?? []
          const focusSteps = activeSteps.length > 0 ? activeSteps : staleSteps.length > 0 ? staleSteps : readySteps
          const current = focusSteps[0]
          const stepSummary = focusSteps.length > 1
            ? `并行：${focusSteps.map(s => `${s.title} · ${s.stale ? '已过期需重跑' : stepLabels[s.status]}`).join(' / ')}`
            : current
              ? `${current.title} · ${current.stale ? '已过期需重跑' : stepLabels[current.status]}`
              : taskFlow?.status === 'completed'
                ? '流程完成 · 待验收'
                : taskStatusLabel(task.status)
          const agentNames = [...new Set(focusSteps.map(s => s.agentName).filter((name): name is string => Boolean(name)))]
          const missing = taskFlow?.steps.some(step => !step.agentId)
          const preparation = view.preparations.find(item => item.taskId === task.id)
          const selected = selectedTaskId === task.id
          return <li key={task.id} className={`rq-task${selected ? ' is-selected' : ''}`} data-task-id={task.id}><div className="rq-task-main"><button className="rq-task-title" onClick={() => setSelectedTaskId(selected ? null : task.id)}>{task.title}</button><div className="rq-task-meta"><span>{stepSummary}</span>{agentNames.length > 0 && <span>{agentNames.join('、')}</span>}{task.dependencyIds.length > 0 && <span>{task.dependencyIds.length} 项前置任务</span>}</div>{(taskFlow?.error || preparation?.error) && <p className="rq-task-error">{taskFlow?.error ?? preparation?.error}</p>}</div>
            <div className="rq-task-actions">{taskFlow ? <Button loading={action.isPending && selected} onClick={() => { if ((missing && binding?.assignmentMode !== 'ai') || taskFlow.pendingApprovalId || ['running', 'blocked', 'completed'].includes(taskFlow.status)) setSelectedTaskId(task.id); else start(task.id) }}>{taskFlow.pendingApprovalId ? '处理授权' : taskFlow.status === 'completed' ? (staleSteps.length > 0 ? '重新验证' : '查看成果') : taskFlow.status === 'blocked' ? '处理问题' : taskFlow.status === 'running' ? '查看进度' : missing && binding?.assignmentMode !== 'ai' ? '分配 Agent' : taskFlow.status === 'paused' ? '继续流程' : '开始流程'}</Button> : <Button onClick={() => go(`tasks?task=${task.id}`)}>任务详情</Button>}</div></li>
        })}</ul>{selectedFlow && <TaskFlowDetails key={selectedFlow.taskId} flow={selectedFlow} projectId={req.projectId} onClose={() => setSelectedTaskId(null)} onRefresh={refresh} onNavigate={go} onReview={() => setReviewTaskId(selectedFlow.taskId)} />}</div>}</> },
      { key: 'documents', label: '需求说明', children: <div className="rq-documents"><h3>{req.title}</h3><div className="rq-prose">{req.body || '尚未补充需求描述'}</div>{req.acceptanceCriteria.length > 0 && <><h3>验收标准</h3><ol>{req.acceptanceCriteria.map((item, index) => <li key={index}>{item}</li>)}</ol></>}{req.technicalDesign && <><h3>技术设计</h3><div className="rq-prose">{req.technicalDesign}</div></>}</div> },
      { key: 'materials', label: `产出资料 ${data?.materials.length ?? 0}`, children: <RequirementMaterials projectId={req.projectId} requirementId={req.id} requirementTitle={req.title} materials={data?.materials ?? []} tasks={view.tasks.map(t => ({ id: t.id, title: t.title }))} taskFlows={data?.tasks ?? []} onNavigate={go} /> },
    ]} />
    {planOpen && <RequirementPlanDialog requirement={req} onClose={() => setPlanOpen(false)} onApplied={refresh}
      onStart={binding ? taskIds => action.mutate(async () => { const result = await window.projectos.workflows.startAll({ requirementId: req.id, expectedBindingVersion: binding.version, requestKey: `plan-start-${crypto.randomUUID()}`, taskIds }); setStartResult(result.intent) }) : undefined} />}
    {arrangeOpen && binding && <RequirementArrangement requirementId={req.id} projectId={req.projectId} binding={binding} onClose={() => setArrangeOpen(false)} onChanged={refresh} />}
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
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: qk.requirements(projectId) }), queryClient.invalidateQueries({ queryKey: ['requirement-work'] }), queryClient.invalidateQueries({ queryKey: ['requirement-flow'] }), queryClient.invalidateQueries({ queryKey: qk.artifacts(projectId) }), queryClient.invalidateQueries({ queryKey: qk.board(projectId) }), queryClient.invalidateQueries({ queryKey: qk.approvals(projectId) })]) }
  const choose = (id: string) => { setSelectedRequirement(projectId, id); setSearch({ requirement: id }) }
  return <div className="po-page rq-page" key={projectId}>
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
