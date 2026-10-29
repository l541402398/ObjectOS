import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Empty,
  Form,
  Input,
  Select,
  Tooltip,
} from 'antd'
import {
  CheckCircleOutlined,
  CloseOutlined,
  DownOutlined,
  HistoryOutlined,
  SendOutlined,
  MessageOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { AgentView, MessageView, RunStatus, SessionSummary } from '@projectos/contracts'
import {
  AgentAvatar,
  EmptyState,
  ErrorState,
  KeyValueList,
  LoadingBlock,
  PageHeader,
  StatusPill,
  toneForStatus,
} from '@projectos/ui'
import { AgentComposer, ApprovalCard, MessageList, ToolTrace } from '@projectos/ai-ui'
import {
  useAIConnections,
  useAgents,
  useApprovals,
  useRunDetail,
  useRuns,
  usePlans,
  useSessionDetail,
  useSessions,
  useTaskBoard,
} from '../lib/queries'
import { formatDateTime, formatRelative } from '../lib/format'
import { runStatusLabel, taskStatusLabel } from '../lib/labels'
import { AgentStudioModal } from '../components/AgentStudioModal'
import { CollaborationOverview } from '../features/collaboration-overview/CollaborationOverview'
import { errorMessage } from '../lib/errors'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea, SheetShell } from '../next-ui/overlay/overlay-shell'
import { useUiStore } from '../stores/ui'

const ACTIVE_STATUSES: RunStatus[] = [
  'created',
  'queued',
  'running',
  'waiting_tool',
  'waiting_approval',
  'verifying',
  'suspended',
]

function SessionRow({
  session,
  selected,
  onSelect,
}: {
  session: SessionSummary
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`po-session-row ${selected ? 'is-selected' : ''}`.trim()}
      onClick={onSelect}
    >
      <AgentAvatar name={session.agentName} accent={session.agentAccent} size={30} />
      <span className="po-session-row-main">
        <span className="po-session-title">
          {session.title.startsWith('计划群聊') ? <em className="v17-group-badge">群聊</em> : null}
          {session.title}
        </span>
        <span className="po-session-sub">
          {session.agentRole} · {session.messageCount} 条消息
        </span>
        <span className="po-session-time">{formatRelative(session.lastMessageAt ?? session.updatedAt)}</span>
      </span>
      {session.pendingApprovals > 0 ? (
        <span className="po-session-approval-dot" title={`${session.pendingApprovals} 个待授权`} />
      ) : null}
    </button>
  )
}

export default function AgentWorkbenchPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const sessions = useSessions(projectId)
  const plans = usePlans(projectId)
  const agents = useAgents(projectId)
  const board = useTaskBoard(projectId)
  const connections = useAIConnections()
  const openSettings = useUiStore((state) => state.openSettings)
  const approvals = useApprovals(projectId)
  const runs = useRuns(projectId, 100)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'overview' | 'pro'>(() => (searchParams.get('view') === 'pro' ? 'pro' : 'overview'))
  const sessionDetail = useSessionDetail(selectedSessionId)
  const [createOpen, setCreateOpen] = useState(false)
  const [studioOpen, setStudioOpen] = useState(false)
  const [createForm] = Form.useForm<{ agentId: string; title: string }>()
  const [streamingRunId, setStreamingRunId] = useState<string | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const streamBuffer = useRef('')
  const [groupOpen, setGroupOpen] = useState(false)
  const handoffs = useQuery({
    queryKey: ['handoffs', projectId],
    queryFn: () => window.projectos.handoffs.list(projectId),
    enabled: Boolean(projectId) && groupOpen,
    refetchInterval: groupOpen ? 5_000 : false,
  })
  const [groupMessages, setGroupMessages] = useState<MessageView[]>([])
  const [groupInput, setGroupInput] = useState('')
  const [groupBusy, setGroupBusy] = useState(false)
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)
  const [runPanelOpen, setRunPanelOpen] = useState(() => window.innerWidth >= 1280)

  const sessionList = useMemo(() => sessions.data?.sessions ?? [], [sessions.data])
  const latestPlan = plans.data?.plans[0] ?? null
  const groupSessions = useMemo(() => sessionList.filter((session) => session.title.startsWith('计划协作')), [sessionList])
  const groupSession = useMemo(() => sessionList.find((session) => session.title.startsWith('计划群聊 ·')) ?? null, [sessionList])
  const groupTasks = useMemo(() => {
    if (!latestPlan) return []
    return latestPlan.createdTaskIds
      .map((taskId) => board.data?.tasks.find((task) => task.id === taskId))
      .filter((task): task is NonNullable<typeof task> => Boolean(task))
  }, [latestPlan, board.data])
  const groupHandoffs = handoffs.data?.handoffs ?? []
  const pendingHandoffs = groupHandoffs.filter((handoff) => handoff.status === 'requested').length
  const acceptedHandoffs = groupHandoffs.filter((handoff) => handoff.status === 'accepted').length
  const selectedSession = sessionList.find((session) => session.id === selectedSessionId) ?? null
  const selectedRun = useMemo(() => {
    const list = runs.data?.runs ?? []
    const forSession = list.filter((run) => run.sessionId === selectedSessionId)
    return forSession.find((run) => ACTIVE_STATUSES.includes(run.status)) ?? forSession[0] ?? null
  }, [runs.data, selectedSessionId])
  const runDetail = useRunDetail(selectedRun?.id)
  const active = selectedRun ? ACTIVE_STATUSES.includes(selectedRun.status) : false
  const sessionApprovals = (approvals.data?.approvals ?? []).filter(
    (approval) => approval.sessionId === selectedSessionId && approval.status === 'pending',
  )
  const providerInfo = useMemo(() => {
    const list = connections.data?.connections ?? []
    return list.find((connection) => connection.isDefault) ?? list.find((connection) => connection.enabled) ?? null
  }, [connections.data])
  const providerReady = Boolean(providerInfo?.enabled && providerInfo.hasSecret && providerInfo.defaultModelId)
  const currentAgentTask = useMemo(() => {
    const agentId = selectedSession?.agentId
    if (!agentId) return null
    const assigned = (board.data?.tasks ?? []).filter(
      (task) => task.assigneeAgentId === agentId && !['done', 'cancelled'].includes(task.status),
    )
    return assigned.find((task) => ['running', 'review'].includes(task.status)) ??
      assigned.find((task) => ['ready', 'backlog'].includes(task.status)) ?? null
  }, [board.data, selectedSession?.agentId])

  useEffect(() => {
    if (!sessionList.length) {
      setSelectedSessionId(null)
      return
    }
    if (!selectedSessionId || !sessionList.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessionList[0]!.id)
    }
  }, [sessionList, selectedSessionId])

  useEffect(() => {
    const sessionFromQuery = searchParams.get('session')
    if (sessionFromQuery) {
      setSelectedSessionId(sessionFromQuery)
    }
    if (sessionFromQuery) {
      const next = new URLSearchParams(searchParams)
      next.delete('task')
      next.delete('session')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    if (searchParams.get('group') !== '1' || !groupSession) return
    setGroupOpen(true)
    const next = new URLSearchParams(searchParams)
    next.delete('group')
    setSearchParams(next, { replace: true })
  }, [groupSession, searchParams, setSearchParams])

  useEffect(() => {
    setStreamingRunId(null)
    setStreamingText('')
    streamBuffer.current = ''
  }, [selectedSessionId])

  useEffect(() => {
    const unsubscribe = window.projectos.runtime.onEvent(({ event }) => {
      if (event.type === 'run.delta' && event.sessionId === selectedSessionId) {
        setStreamingRunId(event.runId)
        streamBuffer.current += event.text
        setStreamingText(streamBuffer.current)
        return
      }
      if (event.type === 'run.changed' && event.sessionId === selectedSessionId) {
        if (['completed', 'failed', 'cancelled'].includes(event.status)) {
          setStreamingRunId(null)
          setStreamingText('')
          streamBuffer.current = ''
        }
        void queryClient.invalidateQueries({ queryKey: ['runs', projectId] })
        void queryClient.invalidateQueries({ queryKey: ['run', event.runId] })
        void queryClient.invalidateQueries({ queryKey: ['session', event.sessionId] })
        void queryClient.invalidateQueries({ queryKey: ['sessions', projectId] })
        void queryClient.refetchQueries({ queryKey: ['run', event.runId] })
      }
    })
    return unsubscribe
  }, [projectId, queryClient, selectedSessionId])

  const invalidateSession = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['session', selectedSessionId] }),
      queryClient.invalidateQueries({ queryKey: ['runs', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['approvals', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      queryClient.invalidateQueries({ queryKey: ['overview', projectId] }),
    ])
  }

  const sendMessage = useMutation({
    mutationFn: (content: string) =>
      window.projectos.sessions.sendMessage({
        sessionId: selectedSessionId!,
        content,
        taskId: null,
        startRun: true,
      }),
    onSuccess: async (result) => {
      await invalidateSession()
      await queryClient.invalidateQueries({ queryKey: ['task-board', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['collaboration', projectId] })
      if (result.warning) {
        message.warning(result.warning)
      }
      if (result.runId) {
        setStreamingRunId(result.runId)
        setStreamingText('')
        streamBuffer.current = ''
      }
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const createSession = useMutation({
    mutationFn: (input: { agentId: string; title?: string }) =>
      window.projectos.sessions.create({ projectId, agentId: input.agentId, title: input.title }),
    onSuccess: async ({ session }) => {
      await queryClient.invalidateQueries({ queryKey: ['sessions', projectId] })
      setSelectedSessionId(session.id)
      setCreateOpen(false)
      createForm.resetFields()
      message.success('会话已创建')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const decideApproval = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: 'approved' | 'rejected' }) =>
      window.projectos.approvals.decide({ approvalId, decision, note: '' }),
    onSuccess: async () => {
      await invalidateSession()
      await runDetail.refetch()
      message.success('授权决定已记录，Agent 将根据决定继续')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const cancelRun = useMutation({
    mutationFn: (runId: string) => window.projectos.runs.cancel(runId),
    onSuccess: async () => {
      await invalidateSession()
      message.success('已请求取消运行')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const openCreate = (): void => {
    setCreateOpen(true)
    createForm.setFieldsValue({ agentId: agents.data?.agents[0]?.agent.id, title: '' })
  }

  const prompts = useMemo(
    () => [
      {
        key: 'plan',
        label: '拆解当前任务',
        description: '把任务拆成可验收步骤，并指出缺口',
      },
      {
        key: 'inspect',
        label: '先阅读相关代码',
        description: '只读探索，给出实现计划后再动手',
      },
      {
        key: 'review',
        label: '检查验收标准',
        description: '指出验收标准中不可验证或缺失的部分',
      },
    ],
    [],
  )

  const submitCreate = async (): Promise<void> => {
    const values = await createForm.validateFields()
    createSession.mutate({ agentId: values.agentId, title: values.title?.trim() || undefined })
  }

  const messages = sessionDetail.data?.messages ?? []
  const agent = sessionDetail.data?.agent
  const latestText = sessionDetail.data?.activeRun?.id === selectedRun?.id ? '' : ''
  const isStreaming = Boolean(streamingRunId)
  const streaming = isStreaming || Boolean(active && selectedRun?.status === 'running')
  const displayedStream = streamingText || latestText

  const loadGroup = async (): Promise<void> => {
    if (!groupSession) {
      setGroupMessages([])
      return
    }
    const detail = await window.projectos.sessions.get(groupSession.id, 200)
    setGroupMessages([...detail.messages].sort((a, b) => a.createdAt - b.createdAt || a.seq - b.seq))
  }

  useEffect(() => {
    if (!groupOpen || !groupSession) return
    void loadGroup()
    const timer = setInterval(() => void loadGroup(), 4_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupOpen, groupSession?.id, sessionList.length])

  const sendGroup = async (): Promise<void> => {
    const content = groupInput.trim()
    if (!content || !latestPlan || !groupSession) return
    setGroupBusy(true)
    try {
      const result = await window.projectos.plans.discuss(latestPlan.id, content)
      setGroupInput('')
      message.success(`已发起讨论：${result.participants} 个 Agent 将依次发言，完成后会显示成功/失败统计`)
      await new Promise((resolve) => setTimeout(resolve, 400))
      await loadGroup()
      setGroupBusy(false)
      void invalidateSession()
    } catch (error) {
      setGroupBusy(false)
      message.error(errorMessage(error))
    }
  }

  const switchView = (mode: 'overview' | 'pro'): void => {
    setViewMode(mode)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (mode === 'pro') next.set('view', 'pro')
      else next.delete('view')
      return next
    }, { replace: true })
  }

  if (viewMode === 'overview') {
    return (
      <CollaborationOverview
        projectId={projectId}
        onSwitchToPro={() => switchView('pro')}
        onOpenSession={(sessionId) => {
          setSelectedSessionId(sessionId)
          switchView('pro')
        }}
        onManageAgents={() => setStudioOpen(true)}
      />
    )
  }

  return (
    <div className="po-page po-agent-page">
      <PageHeader
        compact
        title="Agent 工作台"
        actions={
          <>
            <Button onClick={() => switchView('overview')}>协作总览</Button>
            <Button icon={<ReloadOutlined />} onClick={() => void invalidateSession()} loading={sessions.isRefetching}>
              刷新
            </Button>
            <Button
              icon={<SettingOutlined />}
              onClick={() =>
                providerInfo
                  ? openSettings('models', providerInfo.id)
                  : openSettings('ai-connections')
              }
            >
              模型设置
            </Button>
            <Button onClick={() => setStudioOpen(true)}>Agent 管理</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建会话
            </Button>
          </>
        }
      />

      {!providerReady ? (
        <div className="po-provider-banner">
          <div>
            <strong>{providerInfo ? 'AI 连接不可用' : '未配置 AI 连接'}</strong>
            <span>{providerInfo ? '请检查密钥、默认模型或启用状态。' : '消息会保存，但不会启动 Agent 运行。'}</span>
          </div>
          <Button
            size="small"
            type="primary"
            onClick={() => openSettings('ai-connections', providerInfo?.id ?? null)}
          >
            打开设置
          </Button>
        </div>
      ) : null}

      <div className={`po-agent-workspace ${runPanelOpen ? 'is-run-open' : ''}`.trim()}>


        <section className="po-chat-pane">
          <div className="v17-session-switch">
            <button type="button" onClick={() => setSessionMenuOpen((open) => !open)} aria-expanded={sessionMenuOpen}>
              <MessageOutlined />
              <span>会话</span>
              <strong>{selectedSession?.title ?? '选择会话'}</strong>
              <em>{sessionList.length}</em>
              <DownOutlined className={sessionMenuOpen ? 'is-open' : ''} />
            </button>
          </div>
          {sessionMenuOpen ? (
            <div className="v17-session-dropdown">
              {sessionList.length === 0 ? <div className="v16-empty-inline">还没有会话</div> : sessionList.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedSessionId}
                  onSelect={() => { if (session.title.startsWith('计划群聊')) { setGroupOpen(true); setSessionMenuOpen(false); return } setSelectedSessionId(session.id); setSessionMenuOpen(false) }}
                />
              ))}
            </div>
          ) : null}
          {selectedSession && agent ? (
            <>
              <div className="po-chat-head">
                <AgentAvatar name={agent.name} accent={agent.accent} size={36} status={active ? 'working' : 'idle'} />
                <div className="po-chat-head-main">
                  <div className="po-chat-title">
                    {selectedSession.title}
                    {active ? <StatusPill tone="accent">{runStatusLabel(selectedRun?.status ?? 'running')}</StatusPill> : null}
                  </div>
                  <div className="po-chat-sub">
                    {agent.name} · {agent.role}
                    {selectedRun ? ` · 最近运行 ${formatRelative(selectedRun.startedAt ?? selectedRun.createdAt)}` : ''}
                  </div>
                </div>
                <div className="po-chat-actions">
                  {selectedRun ? (
                    <Tooltip title="运行审计">
                      <Button
                        type="text"
                        size="small"
                        icon={<HistoryOutlined />}
                        onClick={() => navigate(`/projects/${projectId}/runs?run=${selectedRun.id}`)}
                      />
                    </Tooltip>
                  ) : null}
                  {active ? (
                    <Button
                      size="small"
                      danger
                      icon={<StopOutlined />}
                      loading={cancelRun.isPending}
                      onClick={() => selectedRun && cancelRun.mutate(selectedRun.id)}
                    >
                      取消
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="po-chat-context">
                <div className="po-chat-context-item">
                  <span className="po-chat-context-label">当前任务</span>
                  {currentAgentTask ? (
                    <span className="po-chat-task-pill">
                      {currentAgentTask.title}
                      <em>{taskStatusLabel(currentAgentTask.status)}</em>
                    </span>
                  ) : (
                    <span className="po-chat-idle">空闲</span>
                  )}
                  <span className="po-chat-context-hint">可直接对话，让 Agent 按需接取或交接任务</span>
                </div>
                <span className="po-grow" />
                <span className="po-chat-context-meta">
                  {providerReady
                    ? `${providerInfo?.name} · ${providerInfo?.defaultModelId}`
                    : '模型未配置'}
                </span>
              </div>

              <div className="po-chat-scroll">
                {sessionDetail.isLoading ? (
                  <LoadingBlock rows={6} />
                ) : sessionDetail.isError ? (
                  <ErrorState message={errorMessage(sessionDetail.error)} onRetry={() => void sessionDetail.refetch()} />
                ) : messages.length === 0 && !streaming ? (
                  <div className="po-chat-empty">
                    <AgentAvatar name={agent.name} accent={agent.accent} size={44} />
                    <h3>{agent.name} 已准备好</h3>
                    <p>{agent.description}</p>
                    <div className="po-chat-empty-hints">
                      <span>选择任务后描述目标</span>
                      <span>Agent 会先读取上下文，再请求写入或命令授权</span>
                    </div>
                  </div>
                ) : (
                  <MessageList
                    messages={messages
                      .filter((item) => item.role !== 'tool')
                      .map((item) => ({
                        id: item.id,
                        role: item.role as 'user' | 'assistant' | 'system',
                        content: item.content,
                        createdAt: item.createdAt,
                        agentName: item.agentName ?? undefined,
                      }))}
                    agentName={agent.name}
                    agentAccent={agent.accent}
                    streaming={streaming}
                    streamingText={displayedStream}
                  />
                )}
              </div>

              {sessionApprovals.length > 0 ? (
                <div className="po-chat-approvals">
                  {sessionApprovals.map((approval) => (
                    <ApprovalCard
                      key={approval.id}
                      approval={approval}
                      busy={decideApproval.isPending}
                      onDecide={(decision) => decideApproval.mutate({ approvalId: approval.id, decision })}
                    />
                  ))}
                </div>
              ) : null}

              <AgentComposer
                agentName={agent.name}
                loading={sendMessage.isPending || active}
                placeholder={
                  active
                    ? 'Agent 正在执行。可以先准备下一条指令；取消运行后可继续。'
                    : providerReady
                      ? '描述目标、补充约束，或要求 Agent 继续执行…'
                      : '消息会保存到会话；配置 AI 连接后才能启动 Agent。'
                }
                showPrompts={messages.length === 0}
                prompts={prompts}
                onSubmit={(value) => sendMessage.mutate(value)}
                onCancel={() => selectedRun && cancelRun.mutate(selectedRun.id)}
                onPrompt={(prompt) => sendMessage.mutate(`${prompt.label}：${prompt.description ?? ''}`)}
              />
            </>
          ) : (
            <div className="po-chat-blank">
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <span>
                    选择左侧会话，或创建一个新的 Agent 会话。
                    <br />
                    会话是持久化的协作容器，不是临时聊天窗口。
                  </span>
                }
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新建会话
              </Button>
            </div>
          )}
        </section>

        <button type="button" className="v17-run-bookmark" onClick={() => setRunPanelOpen((open) => !open)} aria-expanded={runPanelOpen}>{runPanelOpen ? '收起' : '运行检查器'}</button>
        <aside className="po-run-inspector">
          <div className="po-pane-head">
            <div>
              <div className="po-pane-title">运行检查器</div>
              <div className="po-pane-subtitle">{selectedRun ? runStatusLabel(selectedRun.status) : '尚无运行'}</div>
            </div>
            {selectedRun ? <StatusPill tone={toneForStatus(selectedRun.status)}>{runStatusLabel(selectedRun.status)}</StatusPill> : null}
            <Button type="text" size="small" icon={<CloseOutlined />} aria-label="收起运行检查器" onClick={() => setRunPanelOpen(false)} />
          </div>
          <div className="po-run-inspector-scroll">
            {!selectedRun ? (
              <EmptyState
                compact
                icon={<ThunderboltOutlined />}
                title="等待第一次运行"
                description="发送消息后，模型调用、工具请求与授权会显示在这里。"
              />
            ) : runDetail.isLoading ? (
              <LoadingBlock rows={5} />
            ) : runDetail.isError || !runDetail.data ? (
              <ErrorState compact message={runDetail.error ? errorMessage(runDetail.error) : '运行不存在'} />
            ) : (
              <div className="po-run-inspector-content">
                <div className="po-run-summary">
                  <div className="po-run-summary-head">
                    <span className="po-mono po-caption">{selectedRun.id.slice(0, 18)}…</span>
                    <span className="po-caption po-muted">{formatDateTime(selectedRun.startedAt)}</span>
                  </div>
                  {selectedRun.taskTitle ? (
                    <div className="po-run-task">
                      <CheckCircleOutlined /> {selectedRun.taskTitle}
                    </div>
                  ) : null}
                  <KeyValueList
                    compact
                    items={[
                      { label: 'Agent', value: selectedRun.agentName },
                      { label: '步骤', value: runDetail.data.steps.length },
                      { label: '工具', value: runDetail.data.toolCalls.length },
                      { label: '审批', value: runDetail.data.approvals.length },
                      {
                        label: 'Token',
                        value: `${runDetail.data.run.inputTokens} / ${runDetail.data.run.outputTokens}`,
                      },
                    ]}
                  />
                  {selectedRun.status === 'waiting_approval' ? (
                    <div className="po-run-waiting">
                      <SafetyCertificateOutlined /> 运行已暂停，等待授权
                    </div>
                  ) : null}
                  {active ? (
                    <Button
                      block
                      size="small"
                      danger
                      icon={<StopOutlined />}
                      loading={cancelRun.isPending}
                      onClick={() => cancelRun.mutate(selectedRun.id)}
                    >
                      取消运行
                    </Button>
                  ) : null}
                </div>
                <ToolTrace
                  steps={runDetail.data.steps}
                  toolCalls={runDetail.data.toolCalls}
                  title="执行步骤"
                />
                {runDetail.data.approvals.length > 0 ? (
                  <div className="po-run-approvals">
                    <div className="po-trace-title">授权记录</div>
                    {runDetail.data.approvals.map((approval) => (
                      <div className="po-run-approval-row" key={approval.id}>
                        <span>{approval.title}</span>
                        <StatusPill tone={toneForStatus(approval.status)}>{approval.status}</StatusPill>
                      </div>
                    ))}
                  </div>
                ) : null}
                {selectedRun.status === 'needs_reconciliation' ? (
                  <ErrorState
                    compact
                    title="执行状态待人工核对"
                    message="Runtime 在执行期间退出。系统不会自动重试危险操作，请检查工作区后重新发起运行。"
                  />
                ) : null}
              </div>
            )}
          </div>
        </aside>
      </div>

      <DialogShell open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false) }} ariaLabel="新建 Agent 会话" width={520}>
        <OverlayHeader eyebrow="AGENT SESSION" title="新建 Agent 会话" closeLabel="关闭新建会话" />
        <OverlayScrollArea className="po-dialog-form-scroll">
        <Form form={createForm} layout="vertical" requiredMark={false} className="po-form">
          <Form.Item name="agentId" label="选择 Agent" rules={[{ required: true, message: '请选择 Agent' }]}>
            <Select
              options={(agents.data?.agents ?? []).map((view: AgentView) => ({
                value: view.agent.id,
                label: `${view.agent.name} · ${view.agent.role}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="title" label="会话标题">
            <Input placeholder="留空则自动生成，例如：实现反向链接索引" />
          </Form.Item>
          <div className="po-form-note">
            每个会话有独立的上下文与运行状态；跨会话消息可在「跨会话中心」发送。
          </div>
        </Form>
        </OverlayScrollArea>
        <OverlayFooter>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button type="primary" loading={createSession.isPending} onClick={() => void submitCreate()}>创建会话</Button>
        </OverlayFooter>
      </DialogShell>
      <SheetShell open={groupOpen} onOpenChange={(open) => { if (!open) setGroupOpen(false) }} ariaLabel="计划群聊" width={620}>
        <OverlayHeader eyebrow="TEAMWORK" title="计划群聊" closeLabel="关闭计划群聊" />
        <OverlayScrollArea className="po-group-scroll">
        {latestPlan ? (
          <div className="v17-group-plan-context">
            <strong>{latestPlan.goal}</strong>
            <span>{groupSessions.length} 个 Agent · 依次阅读前文并发言</span>
          </div>
        ) : null}
        <div className="v17-group-participants">
          {groupSessions.map((session) => (
            <span key={session.id} className="v17-group-participant">
              <i style={{ background: session.agentAccent }}>{session.agentName.slice(0, 1)}</i>
              {session.agentName}
            </span>
          ))}
        </div>
        {groupTasks.length > 0 || groupHandoffs.length > 0 ? (
          <>
            <div className="v17-group-plan-context">
              <strong>团队进度</strong>
              <span>
                {groupTasks.filter((task) => task.status === 'done').length}/{groupTasks.length} 任务已交付 ·
                交接 {pendingHandoffs} 待接受 / {acceptedHandoffs} 已接受
              </span>
            </div>
            <div className="v17-group-participants">
              {groupTasks.map((task) => (
                <span key={task.id} className="v17-group-participant" title={task.assigneeName ?? '未分配'}>
                  <i>{task.assigneeName?.slice(0, 1) ?? '·'}</i>
                  {task.title} · {taskStatusLabel(task.status)}
                </span>
              ))}
            </div>
          </>
        ) : null}
        <div className="v17-group-timeline">
          {groupMessages.length === 0 ? <div className="v16-empty-inline">计划群聊还没有消息。</div> : groupMessages.map((entry) => (
            <div key={entry.id} className={`v17-group-message is-${entry.role}`}>
              <div className="v17-group-message-meta">
                <strong>{entry.role === 'user' ? '你' : entry.role === 'system' ? '系统' : entry.agentName ?? 'Agent'}</strong>
                <span>{new Date(entry.createdAt).toLocaleTimeString()}</span>
              </div>
              <p>{entry.content}</p>
            </div>
          ))}
        </div>
        <div className="v17-group-composer">
          <Input.TextArea
            rows={3}
            value={groupInput}
            onChange={(event) => setGroupInput(event.target.value)}
            placeholder="向计划中的所有 Agent 说明你的意见、约束或下一步…"
          />
          <Button type="primary" icon={<SendOutlined />} loading={groupBusy} onClick={() => void sendGroup()}>
            发起群聊讨论
          </Button>
        </div>
        </OverlayScrollArea>
      </SheetShell>

      <AgentStudioModal open={studioOpen} onClose={() => setStudioOpen(false)} projectId={projectId} />
    </div>
  )
}
