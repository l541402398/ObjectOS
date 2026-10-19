import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Switch,
} from 'antd'
import {
  ArrowRightOutlined,
  BellOutlined,
  CheckOutlined,
  CloseOutlined,
  InboxOutlined,
  MessageOutlined,
  SendOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import type { CrossSessionType, HandoffView, InboxItemView } from '@projectos/contracts'
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
import { useBootstrap, useCollaboration } from '../lib/queries'
import { formatRelative, truncate } from '../lib/format'
import { DELIVERY_LABELS, HANDOFF_LABELS } from '../lib/labels'
import { errorMessage } from '../lib/errors'

const TYPE_LABELS: Record<string, string> = {
  'agent.message': '消息',
  'task.delegate': '任务委派',
  'task.accept': '任务接受',
  'task.result': '任务结果',
  'task.reject': '任务拒绝',
  'handoff.request': '交接请求',
  'handoff.accept': '交接接受',
  'agent.wake': '唤醒',
  'approval.request': '授权请求',
}

function InboxRow({
  item,
  onAck,
  onResume,
  onOpen,
  busy,
}: {
  item: InboxItemView
  onAck: () => void
  onResume: () => void
  onOpen: () => void
  busy: boolean
}) {
  return (
    <div className="po-inbox-row">
      <div className="po-inbox-route">
        <span className="po-inbox-agent">{item.senderAgentName}</span>
        <ArrowRightOutlined />
        <span className="po-inbox-agent">{item.recipientAgentName}</span>
        <StatusPill tone={toneForStatus(item.status)}>{DELIVERY_LABELS[item.status]}</StatusPill>
      </div>
      <div className="po-inbox-body">
        <div className="po-inbox-meta">
          <span>{TYPE_LABELS[item.type] ?? item.type}</span>
          {item.taskTitle ? <span>任务：{item.taskTitle}</span> : null}
          <span>{formatRelative(item.createdAt)}</span>
        </div>
        <div className="po-inbox-preview">{truncate(item.preview, 180)}</div>
      </div>
      <div className="po-inbox-actions">
        {item.status === 'delivered' || item.status === 'accepted' ? (
          <Button size="small" icon={<CheckOutlined />} loading={busy} onClick={onAck}>
            确认
          </Button>
        ) : null}
        {item.status !== 'completed' ? (
          <Button size="small" type="primary" icon={<BellOutlined />} loading={busy} onClick={onResume}>
            唤醒
          </Button>
        ) : null}
        <Button size="small" type="text" onClick={onOpen}>
          打开会话
        </Button>
      </div>
    </div>
  )
}

function HandoffCard({
  handoff,
  onAccept,
  onReject,
  busy,
}: {
  handoff: HandoffView
  onAccept: () => void
  onReject: () => void
  busy: boolean
}) {
  return (
    <div className={`po-handoff ${handoff.status === 'requested' ? 'is-pending' : ''}`.trim()}>
      <div className="po-handoff-head">
        <div>
          <strong>{handoff.taskTitle}</strong>
          <div className="po-handoff-route">
            {handoff.fromAgentName} <ArrowRightOutlined /> {handoff.toAgentName}
          </div>
        </div>
        <StatusPill tone={toneForStatus(handoff.status)}>{HANDOFF_LABELS[handoff.status]}</StatusPill>
      </div>
      <div className="po-handoff-summary">{truncate(handoff.summary, 220)}</div>
      <div className="po-handoff-footer">
        <span className="po-caption po-muted">{formatRelative(handoff.requestedAt)}</span>
        {handoff.status === 'requested' ? (
          <div className="po-row">
            <Button size="small" icon={<CloseOutlined />} loading={busy} onClick={onReject}>
              拒绝
            </Button>
            <Button size="small" type="primary" icon={<CheckOutlined />} loading={busy} onClick={onAccept}>
              接受交接
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function CollaborationPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const bootstrap = useBootstrap()
  const collaboration = useCollaboration(projectId)
  const [sendOpen, setSendOpen] = useState(false)
  const [form] = Form.useForm<{
    fromSessionId: string
    toSessionId: string
    type: CrossSessionType
    body: string
    wake: boolean
  }>()

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['collaboration', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['sessions', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
    ])
  }

  const send = useMutation({
    mutationFn: (input: {
      fromSessionId: string
      toSessionId: string
      type: CrossSessionType
      body: string
      wake: boolean
    }) => window.projectos.inbox.send({ projectId, ...input }),
    onSuccess: async ({ inbox }) => {
      await refresh()
      setSendOpen(false)
      form.resetFields()
      message.success(
        inbox.status === 'accepted'
          ? '消息已投递并唤醒接收方 Agent'
          : '消息已持久化投递；接收方会在下次运行时看到',
      )
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const ack = useMutation({
    mutationFn: (inboxId: string) => window.projectos.inbox.ack(inboxId),
    onSuccess: async () => {
      await refresh()
      message.success('消息已确认')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const resume = useMutation({
    mutationFn: (inboxId: string) => window.projectos.inbox.resume(inboxId),
    onSuccess: async (result) => {
      await refresh()
      if (result.warning) message.warning(result.warning)
      else if (result.runId) message.success('已唤醒接收方 Agent')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const accept = useMutation({
    mutationFn: (handoffId: string) => window.projectos.handoffs.accept(handoffId),
    onSuccess: async (result) => {
      await refresh()
      message.success('已接受交接')
      navigate(`/projects/${projectId}/agents?session=${result.sessionId}`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const reject = useMutation({
    mutationFn: (handoffId: string) => window.projectos.handoffs.reject(handoffId, ''),
    onSuccess: async () => {
      await refresh()
      message.success('已拒绝交接')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const data = collaboration.data
  const sessions = data?.sessions ?? []
  const agents = data?.agents ?? []
  const inbox = data?.inbox ?? []
  const handoffs = useMemo(() => data?.handoffs ?? [], [data])
  const providerConfigured = bootstrap.data?.provider.configured ?? false

  const pendingHandoffs = useMemo(() => handoffs.filter((handoff) => handoff.status === 'requested'), [handoffs])

  const openSend = (): void => {
    setSendOpen(true)
    form.setFieldsValue({
      fromSessionId: sessions[0]?.id,
      toSessionId: sessions[1]?.id ?? sessions[0]?.id,
      type: 'agent.message',
      body: '',
      wake: true,
    })
  }

  const submitSend = async (): Promise<void> => {
    const values = await form.validateFields()
    if (values.fromSessionId === values.toSessionId) {
      message.error('发送方与接收方不能是同一个会话')
      return
    }
    send.mutate(values)
  }

  if (collaboration.isLoading) {
    return (
      <div className="po-page">
        <LoadingBlock rows={8} label="正在加载跨会话状态" />
      </div>
    )
  }
  if (collaboration.isError || !data) {
    return (
      <div className="po-page">
        <ErrorState
          message={collaboration.error ? errorMessage(collaboration.error) : '跨会话数据不存在'}
          onRetry={() => void collaboration.refetch()}
        />
      </div>
    )
  }

  return (
    <div className="po-page po-collaboration-page">
      <PageHeader
        title="跨会话中心"
        actions={
          <>
            <Button icon={<MessageOutlined />} onClick={() => navigate(`/projects/${projectId}/agents`)}>
              Agent 工作台
            </Button>
            <Button type="primary" icon={<SendOutlined />} onClick={openSend} disabled={sessions.length < 1}>
              发送消息
            </Button>
          </>
        }
        meta={
          <>
            <span>{agents.length} 个 Agent</span>
            <span>{sessions.length} 个会话</span>
            <span>{inbox.length} 条跨会话消息</span>
            <span>{pendingHandoffs.length} 个待接受交接</span>
          </>
        }
      />

      {!providerConfigured ? (
        <div className="po-provider-banner is-neutral">
          <div>
            <strong>模型未配置</strong>
            <span>仍然可以持久化跨会话消息与交接；「唤醒」需要先在设置中配置模型 Provider。</span>
          </div>
          <Button size="small" onClick={() => navigate('/settings')}>去配置</Button>
        </div>
      ) : null}

      <div className="po-metric-grid po-metric-grid-4">
        <MetricCard
          label="已投递"
          value={data.deliveryStats.delivered}
          icon={<SendOutlined />}
          tone="info"
          hint="已进入接收方持久化收件箱"
        />
        <MetricCard
          label="已唤醒"
          value={data.deliveryStats.accepted}
          icon={<BellOutlined />}
          tone="accent"
          hint="接收方 Agent 已开始处理"
        />
        <MetricCard
          label="已完成"
          value={data.deliveryStats.completed}
          icon={<CheckOutlined />}
          tone="success"
          hint="接收方运行完成并回写状态"
        />
        <MetricCard
          label="待接受交接"
          value={pendingHandoffs.length}
          icon={<SwapOutlined />}
          tone={pendingHandoffs.length > 0 ? 'warning' : 'neutral'}
          hint="接受后任务责任人会更新"
        />
      </div>

      <div className="po-collab-grid">
        <div className="po-collab-main">
          <SectionCard
            title="收件箱"

            extra={<InboxOutlined className="po-muted" />}
          >
            {inbox.length === 0 ? (
              <EmptyState
                compact
                icon={<InboxOutlined />}
                title="还没有跨会话消息"
                description="从任意 Agent 会话向另一个会话发送消息，或让 Agent 使用 send_agent_message 工具。"
                action={<Button size="small" type="primary" onClick={openSend}>发送第一条消息</Button>}
              />
            ) : (
              <div className="po-inbox-list">
                {inbox.map((item) => (
                  <InboxRow
                    key={item.id}
                    item={item}
                    busy={ack.isPending || resume.isPending}
                    onAck={() => ack.mutate(item.id)}
                    onResume={() => resume.mutate(item.id)}
                    onOpen={() => navigate(`/projects/${projectId}/agents?session=${item.recipientSessionId}`)}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="交接记录">
            {handoffs.length === 0 ? (
              <EmptyState compact icon={<SwapOutlined />} title="还没有任务交接" description="在任务详情或 Agent 工具中发起交接。" />
            ) : (
              <div className="po-handoff-list">
                {handoffs.map((handoff) => (
                  <HandoffCard
                    key={handoff.id}
                    handoff={handoff}
                    busy={accept.isPending || reject.isPending}
                    onAccept={() => accept.mutate(handoff.id)}
                    onReject={() => reject.mutate(handoff.id)}
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <aside className="po-collab-side">
          <SectionCard title="Agent 阵容" className="po-compact-card">
            <div className="po-collab-agents">
              {agents.map((view) => (
                <div className="po-collab-agent" key={view.agent.id}>
                  <AgentAvatar name={view.agent.name} accent={view.agent.accent} size={32} status={view.status} />
                  <div className="po-collab-agent-main">
                    <strong>{view.agent.name}</strong>
                    <span>{view.agent.role}</span>
                  </div>
                  <div className="po-collab-agent-meta">
                    <StatusPill tone={toneForStatus(view.status)}>
                      {view.status === 'working' ? '执行中' : '空闲'}
                    </StatusPill>
                    <span className="po-caption po-muted">{view.sessionCount} 会话</span>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="活跃会话" className="po-compact-card">
            {sessions.length === 0 ? (
              <EmptyState compact title="暂无会话" />
            ) : (
              <div className="po-collab-sessions">
                {sessions.slice(0, 6).map((session) => (
                  <button
                    type="button"
                    className="po-collab-session"
                    key={session.id}
                    onClick={() => navigate(`/projects/${projectId}/agents?session=${session.id}`)}
                  >
                    <AgentAvatar name={session.agentName} accent={session.agentAccent} size={26} />
                    <span className="po-collab-session-main">
                      <strong>{session.title}</strong>
                      <span>{session.agentRole} · {session.messageCount} 条消息</span>
                    </span>
                    {session.pendingApprovals > 0 ? <StatusPill tone="warning">{session.pendingApprovals}</StatusPill> : null}
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="投递语义" className="po-compact-card">
            <ul className="po-semantics">
              <li><strong>至少一次</strong>：消息持久化后再投递，重复由幂等键去重。</li>
              <li><strong>唤醒 ≠ 完成</strong>：accepted 表示接收方开始处理，completed 才表示运行完成。</li>
              <li><strong>可恢复</strong>：Runtime 重启后收件箱仍保留，可手动唤醒。</li>
              <li><strong>无全局 exactly-once</strong>：跨外部系统的副作用由审批与人工核对兜底。</li>
            </ul>
          </SectionCard>
        </aside>
      </div>

      <Modal
        title="发送跨会话消息"
        open={sendOpen}
        onCancel={() => setSendOpen(false)}
        onOk={() => void submitSend()}
        okText="发送消息"
        cancelText="取消"
        confirmLoading={send.isPending}
        width={560}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} className="po-form">
          <div className="po-form-row">
            <Form.Item name="fromSessionId" label="发送方会话" rules={[{ required: true }]}>
              <Select
                options={sessions.map((session) => ({
                  value: session.id,
                  label: `${session.agentName} · ${session.title}`,
                }))}
              />
            </Form.Item>
            <Form.Item name="toSessionId" label="接收方会话" rules={[{ required: true }]}>
              <Select
                options={sessions.map((session) => ({
                  value: session.id,
                  label: `${session.agentName} · ${session.title}`,
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item name="type" label="消息类型">
            <Select
              options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item name="body" label="消息正文" rules={[{ required: true, message: '请输入消息正文' }]}>
            <Input.TextArea rows={5} placeholder="说明背景、期望动作、验收标准与回复要求。" />
          </Form.Item>
          <Form.Item name="wake" label="投递后唤醒接收方 Agent" valuePropName="checked">
            <Switch />
          </Form.Item>
          <div className="po-form-note">
            唤醒会在接收方启动一次真实 Agent 运行；如果模型未配置，消息仍会持久化，但不会启动运行。
          </div>
        </Form>
      </Modal>
    </div>
  )
}


