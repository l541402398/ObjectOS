import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  DatePicker,
  Dropdown,
  Form,
  Input,
  Select,
  Tabs,
  Tooltip,
  Alert,
  Checkbox,
  Tag,
} from 'antd'
import {
  ArrowRightOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  HistoryOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  PlusOutlined,
  RobotOutlined,
  SearchOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import {
  TASK_COLUMNS,
  TASK_STATUSES,
  type CreateTaskInput,
  type TaskCard,
  type TaskStatus,
  type UpdateTaskInput,
} from '@projectos/contracts'
import {
  AgentAvatar,
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  toneForStatus,
} from '@projectos/ui'
import {
  qk,
  useAgents,
  useApprovals,
  useProjectOverview,
  usePlans,
  useTaskBoard,
  useLifecycle,
  useTaskDetail,
} from '../lib/queries'
import { formatDate, formatDateTime, formatRelative, parseLines } from '../lib/format'
import {
  ARTIFACT_LABELS,
  PRIORITY_LABELS,
  priorityLabel,
  runStatusLabel,
  taskStatusLabel,
} from '../lib/labels'
import { errorMessage } from '../lib/errors'
import { DialogShell, InspectorShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from '../next-ui/overlay/overlay-shell'

function descriptionBlocks(description: string): string[] {
  return description
    .replace(/\r\n/g, '\n')
    .replace(/\s+(?=\d+[)）、]\s)/g, '\n')
    .replace(/\s+(?=[-•]\s)/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

interface TaskFormValues {
  title: string
  description: string
  priority: number
  assigneeAgentId?: string
  milestoneId?: string
  acceptance: string
  labels: string
  dependsOn: string[]
  dueAt?: Dayjs
}

interface AcceptancePolicyView {
  riskLevel: 'normal' | 'high' | 'critical'
  reasons: string[]
  evidence: {
    runs: number
    verifiedArtifacts: number
    successfulTools: string[]
    attributedFiles: number
  }
  requiresExtraEvidence: boolean
  hasExtraEvidence: boolean
  requiresApproval: boolean
  canAcceptDirectly: boolean
  unsatisfiedRequirements: string[]
}

const PRIORITY_COLORS: Record<number, string> = { 1: '#D22D23', 2: '#E0A23C', 3: '#4C8DFF', 4: '#89919E' }

function TaskTile({
  task,
  onOpen,
  onDragStart,
  onDragEnd,
  dragging,
}: {
  task: TaskCard
  onOpen: () => void
  onDragStart: () => void
  onDragEnd: () => void
  dragging: boolean
}) {
  return (
    <article
      className={`po-task-tile ${dragging ? 'is-dragging' : ''}`.trim()}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="po-task-tile-top">
        <span className="po-priority-mark" style={{ background: PRIORITY_COLORS[task.priority] }} />
        <span className={`po-priority-label is-${task.priority}`}>{priorityLabel(task.priority)}</span>
        <span className="po-grow" />
        {task.latestRunStatus ? (
          <StatusPill tone={toneForStatus(task.latestRunStatus)} dot={false}>
            {runStatusLabel(task.latestRunStatus)}
          </StatusPill>
        ) : null}
      </div>
      <div className="po-task-tile-title">{task.title}</div>
      {task.description ? <div className="po-task-tile-desc">{task.description}</div> : null}
      {task.labels.length > 0 ? (
        <div className="po-task-labels">
          {task.labels.slice(0, 3).map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      ) : null}
      <div className="po-task-tile-footer">
        <div className="po-task-meta">
          {task.dependencyIds.length > 0 ? (
            <Tooltip title={`${task.dependencyIds.length} 个依赖`}>
              <span><BranchesOutlined /> {task.dependencyIds.length}</span>
            </Tooltip>
          ) : null}
          {task.blockedBy.length > 0 ? (
            <Tooltip title={`${task.blockedBy.length} 个依赖未完成`}>
              <span className="po-task-blocked"><StopOutlined /> {task.blockedBy.length}</span>
            </Tooltip>
          ) : null}
          {task.runCount > 0 ? (
            <Tooltip title={`${task.runCount} 次运行`}>
              <span><RobotOutlined /> {task.runCount}</span>
            </Tooltip>
          ) : null}
          {task.artifactCount > 0 ? (
            <Tooltip title={`${task.artifactCount} 个交付物`}>
              <span><FileTextOutlined /> {task.artifactCount}</span>
            </Tooltip>
          ) : null}
        </div>
        {task.assigneeName ? (
          <AgentAvatar name={task.assigneeName} size={23} title={`指派给 ${task.assigneeName}`} />
        ) : (
          <span className="po-unassigned"><UserOutlined /></span>
        )}
      </div>
    </article>
  )
}

export default function TaskBoardPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const board = useTaskBoard(projectId)
  const lifecycle = useLifecycle(projectId)
  const plans = usePlans(projectId)
  const overview = useProjectOverview(projectId)
  const agents = useAgents(projectId)
  const approvals = useApprovals(projectId)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerWidth, setDrawerWidth] = useState(700)
  useEffect(() => {
    const update = (): void => setDrawerWidth(window.innerWidth < 1250 ? 560 : 700)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const taskDetail = useTaskDetail(selectedTaskId)
  const [query, setQuery] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null)
  const [versionFilter, setVersionFilter] = useState<string | null>(null)
  const [iterationFilter, setIterationFilter] = useState<string | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null)
  const [createOpen, setCreateOpen] = useState(searchParams.get('new') === '1')
  const [editingTask, setEditingTask] = useState<TaskCard | null>(null)
  const [acceptanceTask, setAcceptanceTask] = useState<TaskCard | null>(null)
  const [acceptancePolicy, setAcceptancePolicy] = useState<AcceptancePolicyView | null>(null)
  const [acceptanceReason, setAcceptanceReason] = useState('')
  const [acceptanceConfirm, setAcceptanceConfirm] = useState(false)
  const [acceptanceOverride, setAcceptanceOverride] = useState(false)
  const [acceptanceApproval, setAcceptanceApproval] = useState<{ id: string; status: string } | null>(null)
  const [acceptanceBusy, setAcceptanceBusy] = useState(false)
  const [createForm] = Form.useForm<TaskFormValues>()
  const [editForm] = Form.useForm<TaskFormValues>()

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setCreateOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['board', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['overview', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      queryClient.invalidateQueries({ queryKey: ['task'] }),
    ])
  }

  const moveTask = useMutation({
    mutationFn: ({ task, to }: { task: TaskCard; to: TaskStatus }) =>
      window.projectos.tasks.move({ taskId: task.id, to, expectedVersion: task.version }),
    onSuccess: async (result) => {
      await invalidate()
      message.success(`「${result.task.title}」已移到${taskStatusLabel(result.task.status)}`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const openAcceptance = async (task: TaskCard): Promise<void> => {
    setAcceptanceTask(task)
    setAcceptancePolicy(null)
    setAcceptanceReason('')
    setAcceptanceConfirm(false)
    setAcceptanceOverride(false)
    setAcceptanceApproval(null)
    try {
      const policy = await window.projectos.tasks.acceptancePolicy(task.id)
      setAcceptancePolicy(policy as AcceptancePolicyView)
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const finishAcceptance = async (): Promise<void> => {
    await invalidate()
    setAcceptanceTask(null)
    setAcceptancePolicy(null)
    setAcceptanceApproval(null)
    message.success('任务已完成并通过验收')
  }

  const submitAcceptance = async (): Promise<void> => {
    if (!acceptanceTask || !acceptancePolicy) return
    setAcceptanceBusy(true)
    try {
      if (acceptancePolicy.requiresApproval) {
        if (!acceptanceApproval) {
          const result = await window.projectos.tasks.requestAcceptance(acceptanceTask.id, acceptanceReason)
          setAcceptanceApproval({ id: result.approvalId, status: 'pending' })
          message.info('已提交独立验收审批，请在弹窗内批准或拒绝')
        } else if (acceptanceApproval.status === 'pending') {
          await window.projectos.tasks.decideAcceptance(acceptanceApproval.id, 'approved', acceptanceReason)
          setAcceptanceApproval({ id: acceptanceApproval.id, status: 'approved' })
          message.success('验收审批已通过，请再次点击确认完成')
        } else {
          await window.projectos.tasks.confirmAcceptance(
            acceptanceTask.id,
            acceptanceApproval.id,
            acceptanceReason,
          )
          await finishAcceptance()
        }
        return
      }
      await window.projectos.tasks.move({
        taskId: acceptanceTask.id,
        to: 'done',
        expectedVersion: acceptanceTask.version,
        acceptance: {
          reason: acceptanceReason,
          confirmHighRisk: acceptanceConfirm,
          override: acceptanceOverride,
        },
      })
      await finishAcceptance()
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setAcceptanceBusy(false)
    }
  }

  const rejectAcceptance = async (): Promise<void> => {
    if (!acceptanceApproval) return
    setAcceptanceBusy(true)
    try {
      await window.projectos.tasks.decideAcceptance(
        acceptanceApproval.id,
        'rejected',
        acceptanceReason || '验收证据不足',
      )
      setAcceptanceApproval({ id: acceptanceApproval.id, status: 'rejected' })
      message.info('验收审批已拒绝，任务保持未完成')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setAcceptanceBusy(false)
    }
  }

  const createTask = useMutation({
    mutationFn: (input: CreateTaskInput) => window.projectos.tasks.create(input),
    onSuccess: async () => {
      await invalidate()
      setCreateOpen(false)
      createForm.resetFields()
      message.success('任务已创建')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const updateTask = useMutation({
    mutationFn: (input: UpdateTaskInput) => window.projectos.tasks.update(input),
    onSuccess: async () => {
      await invalidate()
      setEditingTask(null)
      message.success('任务已更新')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const addDependency = useMutation({
    mutationFn: ({ taskId, dependsOnId }: { taskId: string; dependsOnId: string }) =>
      window.projectos.tasks.addDependency(taskId, dependsOnId),
    onSuccess: async () => {
      await invalidate()
      message.success('依赖已添加')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const removeDependency = useMutation({
    mutationFn: ({ taskId, dependsOnId }: { taskId: string; dependsOnId: string }) =>
      window.projectos.tasks.removeDependency(taskId, dependsOnId),
    onSuccess: async () => {
      await invalidate()
      message.success('依赖已移除')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const tasks = useMemo(() => {
    const list = board.data?.tasks ?? []
    const normalized = query.trim().toLowerCase()
    return list.filter((task) => {
      if (normalized && !`${task.title} ${task.description} ${task.labels.join(' ')}`.toLowerCase().includes(normalized)) {
        return false
      }
      if (assigneeFilter && task.assigneeAgentId !== assigneeFilter) return false
      if (versionFilter && task.versionId !== versionFilter) return false
      if (iterationFilter && task.iterationId !== iterationFilter) return false
      if (priorityFilter && task.priority !== priorityFilter) return false
      return true
    })
  }, [board.data, query, assigneeFilter, versionFilter, iterationFilter, priorityFilter])

  const columns = TASK_COLUMNS.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status),
  }))
  const otherTasks = tasks.filter((task) => task.status === 'blocked' || task.status === 'cancelled')
  const agentOptions = (agents.data?.agents ?? []).map((agent) => ({
    value: agent.agent.id,
    label: `${agent.agent.name} · ${agent.agent.role}`,
  }))
  const taskOptions = (board.data?.tasks ?? [])
    .filter((task) => task.id !== selectedTaskId && task.status !== 'cancelled')
    .map((task) => ({ value: task.id, label: task.title }))
  const milestoneOptions = (overview.data?.milestones ?? []).map((milestone) => ({
    value: milestone.id,
    label: milestone.title,
  }))

  const openTask = (task: TaskCard): void => {
    setSelectedTaskId(task.id)
    setDrawerOpen(true)
  }

  const openEdit = (task: TaskCard): void => {
    setEditingTask(task)
    editForm.setFieldsValue({
      title: task.title,
      description: task.description,
      priority: task.priority,
      assigneeAgentId: task.assigneeAgentId ?? undefined,
      milestoneId: task.milestoneId ?? undefined,
      acceptance: task.acceptanceCriteria.join('\n'),
      labels: task.labels.join(', '),
      dependsOn: task.dependencyIds,
      dueAt: task.dueAt ? dayjs(task.dueAt) : undefined,
    })
  }

  const submitCreate = async (): Promise<void> => {
    const values = await createForm.validateFields()
    const acceptance = parseLines(values.acceptance ?? '')
    const versions = lifecycle.data?.versions ?? []
    const activeVersion =
      versions.find((item) => item.id === lifecycle.data?.focus?.subjectId) ??
      versions.find((item) => item.isDefault) ??
      versions[0] ??
      null
    const iterations = lifecycle.data?.iterations ?? []
    const activeIteration =
      iterations.find((item) => item.versionId === activeVersion?.id && item.status === 'active') ??
      iterations.find((item) => item.versionId === activeVersion?.id) ??
      null
    createTask.mutate({
      projectId,
      title: values.title.trim(),
      description: values.description?.trim() ?? '',
      priority: (values.priority ?? 3) as 1 | 2 | 3 | 4,
      acceptanceCriteria: acceptance,
      labels: (values.labels ?? '')
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean),
      assigneeAgentId: values.assigneeAgentId ?? null,
      milestoneId: values.milestoneId ?? null,
      versionId: activeVersion?.id ?? null,
      iterationId: activeIteration?.id ?? null,
      dependsOn: values.dependsOn ?? [],
      dueAt: values.dueAt ? values.dueAt.valueOf() : null,
    })
  }

  const submitEdit = async (): Promise<void> => {
    if (!editingTask) return
    const values = await editForm.validateFields()
    updateTask.mutate({
      taskId: editingTask.id,
      expectedVersion: editingTask.version,
      title: values.title.trim(),
      description: values.description?.trim() ?? '',
      priority: (values.priority ?? 3) as 1 | 2 | 3 | 4,
      acceptanceCriteria: parseLines(values.acceptance ?? ''),
      labels: (values.labels ?? '')
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean),
      assigneeAgentId: values.assigneeAgentId ?? null,
      milestoneId: values.milestoneId ?? null,
      dueAt: values.dueAt ? values.dueAt.valueOf() : null,
    })
  }

  const formBody = (form: typeof createForm, mode: 'create' | 'edit') => (
    <Form form={form} layout="vertical" requiredMark={false} className="po-form">
      <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入任务标题' }]}>
        <Input placeholder="例如：实现反向链接索引的增量更新" autoFocus />
      </Form.Item>
      <Form.Item name="description" label="描述与范围">
        <Input.TextArea rows={3} placeholder="背景、范围、约束与已知风险" />
      </Form.Item>
      <div className="po-form-row">
        <Form.Item name="priority" label="优先级" initialValue={3}>
          <Select
            options={[1, 2, 3, 4].map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
          />
        </Form.Item>
        <Form.Item name="assigneeAgentId" label="指派 Agent">
          <Select allowClear placeholder="不指派" options={agentOptions} />
        </Form.Item>
      </div>
      <div className="po-form-row">
        <Form.Item name="milestoneId" label="里程碑">
          <Select allowClear placeholder="未关联" options={milestoneOptions} />
        </Form.Item>
        <Form.Item name="dueAt" label="截止时间">
          <DatePicker showTime style={{ width: '100%' }} />
        </Form.Item>
      </div>
      <Form.Item
        name="acceptance"
        label="验收标准"
        extra="每行一条。没有验收标准的任务无法标记完成；Agent 会把这些标准作为执行上下文。"
        rules={[{ required: true, message: '请至少写一条验收标准' }]}
      >
        <Input.TextArea rows={4} placeholder={'例如：\n单次编辑只更新受影响节点\n索引与正文最终一致'} />
      </Form.Item>
      <Form.Item name="labels" label="标签" extra="用逗号分隔，例如：graph, performance">
        <Input placeholder="graph, performance" />
      </Form.Item>
      {mode === 'create' ? (
        <Form.Item name="dependsOn" label="依赖任务">
          <Select mode="multiple" allowClear placeholder="选择前置任务" options={taskOptions} />
        </Form.Item>
      ) : null}
    </Form>
  )

  const pendingPlan = plans.data?.plans.find((plan) => plan.status === 'approved' && !plan.execution) ?? null
  const failedPlan = plans.data?.plans.find((plan) => plan.execution?.status === 'failed') ?? null
  const startPlan = async (planId: string): Promise<void> => {
    try {
      await window.projectos.orchestration.start(planId, 2, 2)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.plans(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.board(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.snapshot(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.sessions(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.bootstrap }),
      ])
      message.success('计划开始执行')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const acceptanceMinReason = acceptancePolicy?.riskLevel === 'normal' ? 4 : 8
  const acceptanceNeedsOverride = Boolean(acceptancePolicy && acceptancePolicy.unsatisfiedRequirements.length > 0)
  const acceptanceReady =
    Boolean(acceptancePolicy) &&
    acceptanceReason.trim().length >= acceptanceMinReason &&
    (acceptancePolicy!.riskLevel !== 'high' || acceptanceConfirm) &&
    (!acceptanceNeedsOverride || acceptanceOverride) &&
    (!acceptancePolicy!.requiresExtraEvidence || acceptancePolicy!.hasExtraEvidence) &&
    acceptanceApproval?.status !== 'rejected'
  const acceptancePrimaryLabel = !acceptancePolicy?.requiresApproval
    ? '确认完成'
    : !acceptanceApproval
      ? '申请验收审批'
      : acceptanceApproval.status === 'pending'
        ? '批准验收'
        : acceptanceApproval.status === 'approved'
          ? '确认完成'
          : '已拒绝，无法完成'

  const drawerActions = taskDetail.data ? (
    <div className="po-drawer-actions">
      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(taskDetail.data!.task)}>
        编辑
      </Button>
      <Dropdown
        trigger={['click']}
        menu={{
          items: TASK_STATUSES.filter((status) => status !== taskDetail.data!.task.status).map((status) => ({
            key: status,
            label: taskStatusLabel(status),
          })),
          onClick: ({ key }) => {
            const task = taskDetail.data!.task
            if (key === 'done') {
              void openAcceptance(task)
              return
            }
            moveTask.mutate({ task, to: key as TaskStatus })
          },
        }}
      >
        <Button size="small">变更状态</Button>
      </Dropdown>
      <Button
        size="small"
        type="primary"
        icon={<RobotOutlined />}
        onClick={() => navigate(`/projects/${projectId}/agents?task=${selectedTaskId}`)}
      >
        交给 Agent
      </Button>
    </div>
  ) : null

  return (
    <div className="po-page po-page-wide po-tasks-page">
      <PageHeader
        title="任务看板"
        actions={
          <>
            <Button icon={<RobotOutlined />} onClick={() => navigate(`/projects/${projectId}/agents`)}>
              Agent 工作台
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新建任务
            </Button>
          </>
        }
        meta={
          <>
            <span>{tasks.length} 个任务</span>
            <span>{tasks.filter((task) => task.status === 'running').length} 个执行中</span>
            <span>{tasks.filter((task) => task.status === 'review').length} 个待审查</span>
            <span>{(approvals.data?.approvals ?? []).filter((approval) => approval.status === 'pending').length} 个待授权</span>
          </>
        }
      />

      {pendingPlan ? (
        <div className="v17-next-step-banner">
          <div className="v17-next-step-icon"><CheckCircleOutlined /></div>
          <div className="v17-next-step-copy">
            <strong>计划已批准，任务已创建</strong>
            <span>「{pendingPlan.goal}」的 {pendingPlan.createdTaskIds.length} 个任务正在等待你确认执行。</span>
          </div>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void startPlan(pendingPlan.id)}>开始执行</Button>
          <Button onClick={() => navigate(`/projects/${projectId}/orchestration`)}>查看编排</Button>
        </div>
      ) : null}

      {failedPlan ? (
        <div className="v17-next-step-banner is-error">
          <div className="v17-next-step-icon"><StopOutlined /></div>
          <div className="v17-next-step-copy">
            <strong>计划执行失败</strong>
            <span>{failedPlan.execution?.error ?? '请查看运行审计，修复后重新执行。'}</span>
          </div>
          <Button type="primary" onClick={() => void startPlan(failedPlan.id)}>重新执行</Button>
          <Button onClick={() => navigate(`/projects/${projectId}/runs`)}>运行审计</Button>
        </div>
      ) : null}

      <div className="po-board-toolbar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索任务、描述或标签"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="po-board-search"
        />
        <Select
          allowClear
          placeholder="按 Agent 过滤"
          value={assigneeFilter}
          onChange={(value) => setAssigneeFilter(value ?? null)}
          options={agentOptions}
          style={{ width: 200 }}
        />
        <Select
          allowClear
          placeholder="按版本过滤"
          value={versionFilter}
          onChange={(value) => setVersionFilter(value ?? null)}
          options={(lifecycle.data?.versions ?? []).map((version) => ({
            value: version.id,
            label: `v${version.version}${version.isDefault ? ' · 默认' : ''}`,
          }))}
          style={{ width: 160 }}
        />
        <Select
          allowClear
          placeholder="按迭代过滤"
          value={iterationFilter}
          onChange={(value) => setIterationFilter(value ?? null)}
          options={(lifecycle.data?.iterations ?? [])
            .filter((iteration) => !versionFilter || iteration.versionId === versionFilter)
            .map((iteration) => ({ value: iteration.id, label: iteration.name }))}
          style={{ width: 160 }}
        />
        <Select
          allowClear
          placeholder="优先级"
          value={priorityFilter}
          onChange={(value) => setPriorityFilter(value ?? null)}
          options={[1, 2, 3, 4].map((value) => ({ value, label: PRIORITY_LABELS[value] }))}
          style={{ width: 120 }}
        />
        <span className="po-grow" />
        <span className="po-board-hint">拖动卡片更新状态</span>
      </div>

      {board.isLoading ? (
        <LoadingBlock rows={7} label="正在加载任务看板" />
      ) : board.isError ? (
        <ErrorState message={errorMessage(board.error)} onRetry={() => void board.refetch()} />
      ) : (
        <>
          <div className="po-board-scroll">
            <div className={`po-board ${draggingId ? 'is-dragging' : ''}`.trim()} onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}>
              {columns.map((column) => (
                <section
                  key={column.status}
                  className={`po-board-column ${dropTarget === column.status ? 'is-drop-target' : ''}`.trim()}
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropTarget(column.status)
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) setDropTarget(null)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    setDropTarget(null)
                    const taskId = event.dataTransfer.getData('text/plain') || draggingId
                    const task = tasks.find((entry) => entry.id === taskId)
                    setDraggingId(null)
                    if (!task || task.status === column.status) return
                    if (column.status === 'done') {
                      void openAcceptance(task)
                      return
                    }
                    moveTask.mutate({ task, to: column.status })
                  }}
                >
                  <div className="po-board-column-head">
                    <div>
                      <span className={`po-column-dot is-${column.status}`} />
                      <strong>{taskStatusLabel(column.status)}</strong>
                    </div>
                    <span className="po-column-count">{column.tasks.length}</span>
                  </div>
                  <div className="po-board-column-body">
                    {column.tasks.length === 0 ? (
                      <div className="po-column-empty">拖入任务或新建</div>
                    ) : (
                      column.tasks.map((task) => (
                        <TaskTile
                          key={task.id}
                          task={task}
                          dragging={draggingId === task.id}
                          onDragStart={() => setDraggingId(task.id)}
                          onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                          onOpen={() => openTask(task)}
                        />
                      ))
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
          {otherTasks.length > 0 ? (
            <SectionCard title="受阻与取消">
              <div className="po-other-tasks">
                {otherTasks.map((task) => (
                  <button type="button" className="po-other-task" key={task.id} onClick={() => openTask(task)}>
                    <StatusPill tone={toneForStatus(task.status)}>{taskStatusLabel(task.status)}</StatusPill>
                    <span>{task.title}</span>
                    {task.latestRunStatus ? <span className="po-caption po-muted">{runStatusLabel(task.latestRunStatus)}</span> : null}
                    <ArrowRightOutlined />
                  </button>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </>
      )}

      <DialogShell open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false) }} ariaLabel="新建任务" width={620}>
        <OverlayHeader eyebrow="TASK BOARD" title="新建任务" closeLabel="关闭新建任务" />
        <OverlayScrollArea className="po-dialog-form-scroll">{formBody(createForm, 'create')}</OverlayScrollArea>
        <OverlayFooter>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button type="primary" loading={createTask.isPending} onClick={() => void submitCreate()}>创建任务</Button>
        </OverlayFooter>
      </DialogShell>

      <DialogShell open={Boolean(editingTask)} onOpenChange={(open) => { if (!open) setEditingTask(null) }} ariaLabel="编辑任务" width={620}>
        <OverlayHeader eyebrow="TASK BOARD" title="编辑任务" closeLabel="关闭编辑任务" />
        <OverlayScrollArea className="po-dialog-form-scroll">{formBody(editForm, 'edit')}</OverlayScrollArea>
        <OverlayFooter>
          <Button onClick={() => setEditingTask(null)}>取消</Button>
          <Button type="primary" loading={updateTask.isPending} onClick={() => void submitEdit()}>保存</Button>
        </OverlayFooter>
      </DialogShell>

      <DialogShell open={Boolean(acceptanceTask)} onOpenChange={(open) => { if (!open) setAcceptanceTask(null) }} ariaLabel="完成验收" width={560}>
        <OverlayHeader eyebrow="ACCEPTANCE" title={acceptanceTask ? `完成验收 · ${acceptanceTask.title}` : '完成验收'} closeLabel="关闭验收" />
        <OverlayScrollArea className="po-acceptance-scroll">
        {!acceptancePolicy ? (
          <LoadingBlock rows={3} label="正在评估任务风险" />
        ) : (
          <div className="po-acceptance">
            <div className="po-acceptance-head">
              <Tag color={acceptancePolicy.riskLevel === 'critical' ? 'red' : acceptancePolicy.riskLevel === 'high' ? 'orange' : 'green'}>
                {acceptancePolicy.riskLevel === 'critical'
                  ? '关键风险'
                  : acceptancePolicy.riskLevel === 'high'
                    ? '高风险'
                    : '常规'}
              </Tag>
              <span>{acceptancePolicy.requiresApproval ? '需要独立验收审批' : '由项目所有者确认'}</span>
            </div>
            <ul className="po-acceptance-reasons">
              {(acceptancePolicy.reasons.length > 0 ? acceptancePolicy.reasons : ['无写入、进程或敏感路径，按常规验收']).map(
                (reason) => (
                  <li key={reason}>{reason}</li>
                ),
              )}
            </ul>
            <div className="po-acceptance-evidence">
              <span>运行 {acceptancePolicy.evidence.runs}</span>
              <span>已验证 Artifact {acceptancePolicy.evidence.verifiedArtifacts}</span>
              <span>工具 {acceptancePolicy.evidence.successfulTools.join('、') || '无'}</span>
              <span>文件归属 {acceptancePolicy.evidence.attributedFiles}</span>
            </div>
            {acceptancePolicy.requiresExtraEvidence && !acceptancePolicy.hasExtraEvidence ? (
              <Alert
                type="warning"
                showIcon
                message="缺少额外证据"
                description="高风险/关键风险验收必须存在已验证 Artifact、真实工具结果或文件归属；请先完成真实执行。"
              />
            ) : null}
            {acceptancePolicy.unsatisfiedRequirements.length > 0 ? (
              <Alert
                type="info"
                showIcon
                message="以下自动验收要求未满足，确认后将记录为人工覆盖"
                description={acceptancePolicy.unsatisfiedRequirements.join('；')}
              />
            ) : null}
            <Input.TextArea
              rows={4}
              value={acceptanceReason}
              onChange={(event) => setAcceptanceReason(event.target.value)}
              placeholder={`填写验收理由（至少 ${acceptanceMinReason} 字），将写入验收记录与审计事件`}
              maxLength={2000}
              showCount
            />
            <div className="po-acceptance-checks">
              {acceptancePolicy.riskLevel === 'high' ? (
                <Checkbox checked={acceptanceConfirm} onChange={(event) => setAcceptanceConfirm(event.target.checked)}>
                  我已核对风险依据与证据，确认高风险验收
                </Checkbox>
              ) : null}
              {acceptanceNeedsOverride ? (
                <Checkbox checked={acceptanceOverride} onChange={(event) => setAcceptanceOverride(event.target.checked)}>
                  我确认覆盖未满足的自动验收要求
                </Checkbox>
              ) : null}
            </div>
            {acceptancePolicy.requiresApproval ? (
              <div className="po-acceptance-approval">
                审批状态：
                {!acceptanceApproval
                  ? '尚未申请'
                  : acceptanceApproval.status === 'pending'
                    ? '待批准（批准后可确认完成）'
                    : acceptanceApproval.status === 'approved'
                      ? '已批准（可确认完成）'
                      : '已拒绝'}
              </div>
            ) : null}
          </div>
        )}
        </OverlayScrollArea>
        <OverlayFooter>
          <Button onClick={() => setAcceptanceTask(null)}>取消</Button>
          {acceptancePolicy?.requiresApproval && acceptanceApproval?.status === 'pending' ? (
            <Button danger loading={acceptanceBusy} onClick={() => void rejectAcceptance()}>拒绝审批</Button>
          ) : null}
          <Button type="primary" loading={acceptanceBusy} disabled={!acceptanceReady} onClick={() => void submitAcceptance()}>{acceptancePrimaryLabel}</Button>
        </OverlayFooter>
      </DialogShell>

      <InspectorShell
        open={drawerOpen}
        onOpenChange={(open) => { setDrawerOpen(open); if (!open) window.setTimeout(() => setSelectedTaskId(null), 320) }}
        ariaLabel="任务详情"
        width={drawerWidth}
        testId="task-detail-inspector"
      >
        <OverlayHeader
          eyebrow="任务详情"
          title={taskDetail.data?.task.title ?? '加载中…'}
          closeLabel="关闭任务详情"
          meta={taskDetail.data ? <><StatusPill tone={toneForStatus(taskDetail.data.task.status)}>{taskStatusLabel(taskDetail.data.task.status)}</StatusPill><StatusPill tone={taskDetail.data.task.priority === 1 ? 'danger' : 'neutral'} dot={false}>{priorityLabel(taskDetail.data.task.priority)}优先级</StatusPill><span>v{taskDetail.data.task.version}</span>{taskDetail.data.task.assigneeName ? <span>指派给 {taskDetail.data.task.assigneeName}</span> : <span>未指派</span>}</> : null}
        />
        <OverlayScrollArea className="po-task-detail-scroll">
        {taskDetail.isLoading ? (
          <LoadingBlock rows={8} />
        ) : taskDetail.isError || !taskDetail.data ? (
          <ErrorState message={taskDetail.error ? errorMessage(taskDetail.error) : '任务不存在'} onRetry={() => void taskDetail.refetch()} />
        ) : (
          <div className="po-task-detail">
            <div className="po-task-drawer-toolbar">{drawerActions}</div>
            <Tabs
              className="po-task-tabs"
              defaultActiveKey="overview"
              items={[
                {
                  key: 'overview',
                  label: <span className="po-task-tab-label"><InfoCircleOutlined />概览</span>,
                  children: (
                    <div className="po-task-tab-panel">
                      <section className="po-detail-block">
                        <div className="po-detail-block-head">
                          <div>
                            <strong>任务说明</strong>
                            <span>Agent 执行时使用的上下文与当前指派</span>
                          </div>
                          {taskDetail.data.task.assigneeName ? (
                            <AgentAvatar name={taskDetail.data.task.assigneeName} size={30} />
                          ) : (
                            <span className="po-unassigned"><UserOutlined /></span>
                          )}
                        </div>
                        <div className="po-description-lines">
                          {descriptionBlocks(taskDetail.data.task.description).map((line, index) => (
                            <p key={`${index}-${line.slice(0, 12)}`}>{line}</p>
                          ))}
                          {taskDetail.data.task.description ? null : <p className="po-muted">未填写任务描述。</p>}
                        </div>
                      </section>

                      <section className="po-detail-block">
                        <div className="po-detail-block-head">
                          <div>
                            <strong>执行信息</strong>
                            <span>状态、优先级、时间与当前负责人</span>
                          </div>
                        </div>
                        <div className="po-task-fact-grid">
                          <div><span>当前状态</span><strong>{taskStatusLabel(taskDetail.data.task.status)}</strong></div>
                          <div><span>优先级</span><strong>{priorityLabel(taskDetail.data.task.priority)}</strong></div>
                          <div><span>负责人</span><strong>{taskDetail.data.task.assigneeName ?? '未指派'}</strong></div>
                          <div><span>截止时间</span><strong>{taskDetail.data.task.dueAt ? formatDate(taskDetail.data.task.dueAt) : '未设置'}</strong></div>
                        </div>
                        <div className="po-task-assignee-row is-bottom">
                          <span>调整指派</span>
                          <Select
                            size="small"
                            allowClear
                            showSearch
                            placeholder="选择 Agent"
                            value={taskDetail.data.task.assigneeAgentId ?? undefined}
                            options={agentOptions}
                            style={{ width: 250 }}
                            loading={updateTask.isPending}
                            onChange={(value: string | undefined) =>
                              updateTask.mutate({
                                taskId: taskDetail.data!.task.id,
                                expectedVersion: taskDetail.data!.task.version,
                                assigneeAgentId: value ?? null,
                              })
                            }
                          />
                        </div>
                      </section>
                    </div>
                  ),
                },
                {
                  key: 'acceptance',
                  label: (
                    <span className="po-task-tab-label">
                      <SafetyCertificateOutlined />验收与依赖
                      <span className="po-task-tab-count">{taskDetail.data.task.acceptanceCriteria.length + taskDetail.data.dependencies.length}</span>
                    </span>
                  ),
                  children: (
                    <div className="po-task-tab-panel">
                      <section className="po-detail-block">
                        <div className="po-detail-block-head">
                          <div>
                            <strong>验收标准</strong>
                            <span>完成任务的必要证据；不满足时不能自动完成</span>
                          </div>
                        </div>
                        {taskDetail.data.task.acceptanceCriteria.length === 0 ? (
                          <EmptyState compact title="缺少验收标准" description="补充验收标准后才能标记完成。" />
                        ) : (
                          <ol className="po-criteria-list">
                            {taskDetail.data.task.acceptanceCriteria.map((criterion, index) => (
                              <li key={criterion}>
                                <span className="po-criteria-index">{String(index + 1).padStart(2, '0')}</span>
                                <CheckCircleOutlined />
                                <span>{criterion}</span>
                              </li>
                            ))}
                          </ol>
                        )}
                      </section>

                      <section className="po-detail-block">
                        <div className="po-detail-block-head">
                          <div>
                            <strong>依赖关系</strong>
                            <span>依赖未完成时无法进入就绪/执行</span>
                          </div>
                          <Select
                            size="small"
                            showSearch
                            placeholder="添加依赖"
                            value={undefined}
                            options={taskOptions}
                            style={{ width: 180 }}
                            onChange={(value: string) => addDependency.mutate({ taskId: taskDetail.data!.task.id, dependsOnId: value })}
                          />
                        </div>
                        {taskDetail.data.dependencies.length === 0 ? (
                          <div className="po-drawer-empty-line">没有前置依赖，任务可直接进入就绪。</div>
                        ) : (
                          <div className="po-dependency-list">
                            {taskDetail.data.dependencies.map((dependency) => (
                              <div className="po-dependency" key={dependency.id}>
                                <StatusPill tone={toneForStatus(dependency.status)}>{taskStatusLabel(dependency.status)}</StatusPill>
                                <span>{dependency.title}</span>
                                <button
                                  type="button"
                                  className="po-icon-button is-small"
                                  onClick={() => removeDependency.mutate({ taskId: taskDetail.data!.task.id, dependsOnId: dependency.id })}
                                  aria-label="移除依赖"
                                >
                                  <DeleteOutlined />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>
                  ),
                },
                {
                  key: 'execution',
                  label: (
                    <span className="po-task-tab-label">
                      <HistoryOutlined />运行与交付
                      <span className="po-task-tab-count">{taskDetail.data.runs.length + taskDetail.data.artifacts.length}</span>
                    </span>
                  ),
                  children: (
                    <div className="po-task-tab-panel">
                      <section className="po-detail-block">
                        <div className="po-detail-block-head">
                          <div>
                            <strong>运行记录</strong>
                            <span>每次真实 Run 的 Agent、状态与时间线</span>
                          </div>
                        </div>
                        {taskDetail.data.runs.length === 0 ? (
                          <div className="po-drawer-empty-line">还没有运行。关联 Agent 会话后，真实执行记录会显示在这里。</div>
                        ) : (
                          <div className="po-run-list">
                            {taskDetail.data.runs.map((run) => (
                              <button
                                type="button"
                                className="po-run-row"
                                key={run.id}
                                onClick={() => navigate(`/projects/${projectId}/runs?run=${run.id}`)}
                              >
                                <StatusPill tone={toneForStatus(run.status)}>{runStatusLabel(run.status)}</StatusPill>
                                <span className="po-run-row-main">
                                  <strong>{run.agentName}</strong>
                                  <span>{formatDateTime(run.startedAt)}</span>
                                </span>
                                {run.pendingApprovals > 0 ? <StatusPill tone="warning">{run.pendingApprovals} 待授权</StatusPill> : null}
                                <ArrowRightOutlined />
                              </button>
                            ))}
                          </div>
                        )}
                      </section>

                      <section className="po-detail-block">
                        <div className="po-detail-block-head">
                          <div>
                            <strong>交付物</strong>
                            <span>真实 Artifact；未验证产物不等同于完成证据</span>
                          </div>
                        </div>
                        {taskDetail.data.artifacts.length === 0 ? (
                          <div className="po-drawer-empty-line">尚无交付物。</div>
                        ) : (
                          <div className="po-artifact-list">
                            {taskDetail.data.artifacts.map((artifact) => (
                              <div className="po-artifact-row" key={artifact.id}>
                                <FileTextOutlined />
                                <div>
                                  <strong>{artifact.title}</strong>
                                  <span className="po-caption po-muted">
                                    {ARTIFACT_LABELS[artifact.kind]}
                                    {artifact.verifiedAt ? ' · 已验证' : ' · 未验证'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>
                  ),
                },
                {
                  key: 'approvals',
                  label: (
                    <span className="po-task-tab-label">
                      <LinkOutlined />授权
                      <span className="po-task-tab-count">{taskDetail.data.approvals.length}</span>
                    </span>
                  ),
                  children: (
                    <div className="po-task-tab-panel">
                      <section className="po-detail-block">
                        <div className="po-detail-block-head">
                          <div>
                            <strong>相关授权</strong>
                            <span>该任务运行期间产生的逐次审批记录</span>
                          </div>
                        </div>
                        {taskDetail.data.approvals.length === 0 ? (
                          <div className="po-drawer-empty-line">没有待处理或已记录的授权。</div>
                        ) : (
                          <div className="po-approval-list">
                            {taskDetail.data.approvals.map((approval) => (
                              <div className="po-approval-line" key={approval.id}>
                                <span>{approval.title}</span>
                                <StatusPill tone={toneForStatus(approval.status)}>{approval.status}</StatusPill>
                                <span className="po-caption po-muted">{formatRelative(approval.requestedAt)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </section>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        )}
        </OverlayScrollArea>
      </InspectorShell>
    </div>
  )
}
