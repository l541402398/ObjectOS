import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  DatePicker,
  Drawer,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Tooltip,
} from 'antd'
import {
  ArrowRightOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
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
  const plans = usePlans(projectId)
  const overview = useProjectOverview(projectId)
  const agents = useAgents(projectId)
  const approvals = useApprovals(projectId)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const taskDetail = useTaskDetail(selectedTaskId)
  const [query, setQuery] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<number | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null)
  const [createOpen, setCreateOpen] = useState(searchParams.get('new') === '1')
  const [editingTask, setEditingTask] = useState<TaskCard | null>(null)
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
      if (priorityFilter && task.priority !== priorityFilter) return false
      return true
    })
  }, [board.data, query, assigneeFilter, priorityFilter])

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

  const openTask = (task: TaskCard): void => setSelectedTaskId(task.id)

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

      <Modal
        title="新建任务"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        okText="创建任务"
        cancelText="取消"
        confirmLoading={createTask.isPending}
        width={620}
        destroyOnHidden
      >
        {formBody(createForm, 'create')}
      </Modal>

      <Modal
        title="编辑任务"
        open={Boolean(editingTask)}
        onCancel={() => setEditingTask(null)}
        onOk={() => void submitEdit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={updateTask.isPending}
        width={620}
        destroyOnHidden
      >
        {formBody(editForm, 'edit')}
      </Modal>

      <Drawer
        open={Boolean(selectedTaskId)}
        onClose={() => setSelectedTaskId(null)}
        width={620}
        title={taskDetail.data ? taskDetail.data.task.title : '任务详情'}
        destroyOnHidden
        className="po-task-drawer"
        extra={
          taskDetail.data ? (
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
                  onClick: ({ key }) =>
                    moveTask.mutate({ task: taskDetail.data!.task, to: key as TaskStatus }),
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
        }
      >
        {taskDetail.isLoading ? (
          <LoadingBlock rows={8} />
        ) : taskDetail.isError || !taskDetail.data ? (
          <ErrorState message={taskDetail.error ? errorMessage(taskDetail.error) : '任务不存在'} onRetry={() => void taskDetail.refetch()} />
        ) : (
          <div className="po-task-detail">
            <div className="po-task-detail-top">
              <StatusPill tone={toneForStatus(taskDetail.data.task.status)}>
                {taskStatusLabel(taskDetail.data.task.status)}
              </StatusPill>
              <StatusPill tone={taskDetail.data.task.priority === 1 ? 'danger' : 'neutral'} dot={false}>
                {priorityLabel(taskDetail.data.task.priority)}优先级
              </StatusPill>
              {taskDetail.data.task.dueAt ? (
                <span className="po-caption po-muted">
                  <ClockCircleOutlined /> 截止 {formatDate(taskDetail.data.task.dueAt)}
                </span>
              ) : null}
              <span className="po-grow" />
              <span className="po-caption po-muted">v{taskDetail.data.task.version}</span>
            </div>
            <div className="po-task-description">{taskDetail.data.task.description || '未填写任务描述。'}</div>

            <div className="po-task-assignee-row">
              <span>指派 Agent</span>
              <Select
                size="small"
                allowClear
                showSearch
                placeholder="选择 Agent"
                value={taskDetail.data.task.assigneeAgentId ?? undefined}
                options={agentOptions}
                style={{ width: 260 }}
                loading={updateTask.isPending}
                onChange={(value: string | undefined) =>
                  updateTask.mutate({
                    taskId: taskDetail.data!.task.id,
                    expectedVersion: taskDetail.data!.task.version,
                    assigneeAgentId: value ?? null,
                  })
                }
              />
              {taskDetail.data.task.assigneeName ? <span className="po-caption po-muted">当前：{taskDetail.data.task.assigneeName}</span> : null}
            </div>

            <SectionCard title="验收标准" subtitle="完成任务的必要条件" className="po-drawer-section">
              {taskDetail.data.task.acceptanceCriteria.length === 0 ? (
                <EmptyState compact title="缺少验收标准" description="补充验收标准后才能标记完成。" />
              ) : (
                <ul className="po-check-list">
                  {taskDetail.data.task.acceptanceCriteria.map((criterion) => (
                    <li key={criterion}>
                      <CheckCircleOutlined /> {criterion}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            <SectionCard
              title="依赖关系"
              subtitle="依赖未完成时无法进入就绪/执行"
              className="po-drawer-section"
              extra={
                <Select
                  size="small"
                  showSearch
                  placeholder="添加依赖"
                  value={undefined}
                  options={taskOptions}
                  style={{ width: 180 }}
                  onChange={(value: string) => addDependency.mutate({ taskId: taskDetail.data!.task.id, dependsOnId: value })}
                />
              }
            >
              {taskDetail.data.dependencies.length === 0 ? (
                <span className="po-caption po-muted">没有前置依赖。</span>
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
            </SectionCard>

            <SectionCard title="运行记录" className="po-drawer-section">
              {taskDetail.data.runs.length === 0 ? (
                <EmptyState compact title="还没有运行" description="在 Agent 工作台将会话关联到该任务后开始执行。" />
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
            </SectionCard>

            <SectionCard title="交付物" className="po-drawer-section">
              {taskDetail.data.artifacts.length === 0 ? (
                <span className="po-caption po-muted">尚无交付物。</span>
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
            </SectionCard>

            {taskDetail.data.approvals.length > 0 ? (
              <SectionCard title="相关授权" className="po-drawer-section">
                <div className="po-approval-list">
                  {taskDetail.data.approvals.map((approval) => (
                    <div className="po-approval-line" key={approval.id}>
                      <span>{approval.title}</span>
                      <StatusPill tone={toneForStatus(approval.status)}>{approval.status}</StatusPill>
                      <span className="po-caption po-muted">{formatRelative(approval.requestedAt)}</span>
                    </div>
                  ))}
                </div>
              </SectionCard>
            ) : null}
          </div>
        )}
      </Drawer>
    </div>
  )
}




