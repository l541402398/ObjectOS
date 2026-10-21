import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Input,
  Modal,
  Select,
  Table,
  Tabs,
  type TableColumnsType,
} from 'antd'
import {
  HistoryOutlined,
  ReloadOutlined,
  RobotOutlined,
  StopOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import type { RunSummary } from '@projectos/contracts'
import {
  EmptyState,
  ErrorState,
  KeyValueList,
  LoadingBlock,
  PageHeader,
  SectionCard,
  StatusPill,
  toneForStatus,
} from '@projectos/ui'
import { ApprovalCard, ToolTrace } from '@projectos/ai-ui'
import { useApprovals, useProjectEvents, useRunDetail, useRuns } from '../lib/queries'
import { formatDateTime, formatDuration, formatRelative } from '../lib/format'
import { runStatusLabel } from '../lib/labels'
import { errorMessage } from '../lib/errors'

const ACTIVE = new Set(['created', 'queued', 'running', 'waiting_tool', 'waiting_approval', 'verifying', 'suspended'])

export default function RunsPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(searchParams.get('run'))
  const [detailOpen, setDetailOpen] = useState(Boolean(searchParams.get('run')))
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const runs = useRuns(projectId, 100)
  const runDetail = useRunDetail(selectedRunId)
  const approvals = useApprovals(projectId)
  const events = useProjectEvents(projectId, 100)

  useEffect(() => {
    const runFromQuery = searchParams.get('run')
    if (runFromQuery) {
      setSelectedRunId(runFromQuery)
      const next = new URLSearchParams(searchParams)
      next.delete('run')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const runList = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return (runs.data?.runs ?? []).filter((run) => {
      if (statusFilter && run.status !== statusFilter) return false
      if (!normalized) return true
      return `${run.agentName} ${run.taskTitle ?? ''} ${run.sessionTitle} ${run.status}`
        .toLowerCase()
        .includes(normalized)
    })
  }, [runs.data, statusFilter, query])

  useEffect(() => {
    if (!selectedRunId && runList.length > 0) setSelectedRunId(runList[0]!.id)
  }, [runList, selectedRunId])

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['runs', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['run'] }),
      queryClient.invalidateQueries({ queryKey: ['approvals', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['events', projectId] }),
    ])
  }

  const decide = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: 'approved' | 'rejected' }) =>
      window.projectos.approvals.decide({ approvalId, decision, note: '' }),
    onSuccess: async () => {
      await refresh()
      await runDetail.refetch()
      message.success('授权决定已记录')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const cancel = useMutation({
    mutationFn: (runId: string) => window.projectos.runs.cancel(runId),
    onSuccess: async () => {
      await refresh()
      await runDetail.refetch()
      message.success('已请求取消运行')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const columns: TableColumnsType<RunSummary> = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (status: string) => <StatusPill tone={toneForStatus(status)}>{runStatusLabel(status)}</StatusPill>,
    },
    {
      title: 'Agent',
      dataIndex: 'agentName',
      width: 116,
      render: (name: string) => (
        <span className="po-table-agent">
          <RobotOutlined /> {name}
        </span>
      ),
    },
    {
      title: '任务 / 会话',
      key: 'context',
      render: (_, run) => (
        <div className="po-table-context">
          <strong>{run.taskTitle ?? '无关联任务'}</strong>
          <span>{run.sessionTitle}</span>
        </div>
      ),
    },
    {
      title: '开始 / 耗时',
      key: 'time',
      width: 142,
      render: (_, run) => (
        <div className="po-table-time">
          <span>{formatRelative(run.startedAt ?? run.createdAt)}</span>
          <span className="po-muted">{formatDuration(run.startedAt, run.finishedAt)}</span>
        </div>
      ),
    },
    {
      title: '授权',
      dataIndex: 'pendingApprovals',
      width: 66,
      render: (count: number) => (count > 0 ? <StatusPill tone="warning">{count}</StatusPill> : <span className="po-muted">—</span>),
    },
  ]

  const pendingApprovals = (approvals.data?.approvals ?? []).filter((approval) => approval.status === 'pending')
  const selectedRun = runList.find((run) => run.id === selectedRunId) ?? null
  const detailApprovals = (runDetail.data?.approvals ?? []).filter((approval) => approval.status === 'pending')

  return (
    <div className="po-page po-runs-page">
      <PageHeader
        title="运行审计"
        actions={
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={runs.isRefetching}>
            刷新
          </Button>
        }
        meta={
          <>
            <span>{runList.length} 个运行</span>
            <span>{runList.filter((run) => ACTIVE.has(run.status)).length} 个进行中</span>
            <span>{pendingApprovals.length} 个待授权</span>
          </>
        }
      />

      {pendingApprovals.length > 0 ? (
        <SectionCard
          title="需要你的授权"
          subtitle="Agent 运行已暂停，等待批准或拒绝"
          extra={<StatusPill tone="warning">{pendingApprovals.length}</StatusPill>}
        >
          <div className="po-approval-list is-grid">
            {pendingApprovals.map((approval) => (
              <ApprovalCard
                key={approval.id}
                approval={approval}
                compact
                busy={decide.isPending}
                onDecide={(decision) => decide.mutate({ approvalId: approval.id, decision })}
              />
            ))}
          </div>
        </SectionCard>
      ) : null}

      <Tabs
        className="po-runs-tabs"
        items={[
          {
            key: 'runs',
            label: '运行记录',
            children: (
              <>
              <div className="po-runs-list po-runs-full">
                <div className="po-board-toolbar">
                  <Input
                    allowClear
                    prefix={<UnorderedListOutlined />}
                    placeholder="搜索 Agent、任务或会话"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    style={{ maxWidth: 280 }}
                  />
                  <Select
                    allowClear
                    placeholder="状态"
                    value={statusFilter}
                    onChange={(value) => setStatusFilter(value ?? null)}
                    style={{ width: 150 }}
                    options={[
                      'completed',
                      'failed',
                      'running',
                      'waiting_approval',
                      'needs_reconciliation',
                      'cancelled',
                    ].map((status) => ({ value: status, label: runStatusLabel(status) }))}
                  />
                  <span className="po-grow" />
                  <span className="po-board-hint">点击任意运行查看完整详情</span>
                </div>
                {runs.isLoading ? (
                  <LoadingBlock rows={8} />
                ) : runs.isError ? (
                  <ErrorState message={errorMessage(runs.error)} onRetry={() => void runs.refetch()} />
                ) : runList.length === 0 ? (
                  <EmptyState
                    icon={<HistoryOutlined />}
                    title="还没有运行记录"
                    description="在 Agent 工作台发送消息并配置模型后，运行记录会出现在这里。"
                    action={<Button onClick={() => navigate(`/projects/${projectId}/agents`)}>前往 Agent 工作台</Button>}
                  />
                ) : (
                  <Table
                    rowKey="id"
                    size="small"
                    columns={columns}
                    dataSource={runList}
                    pagination={{ pageSize: 20, showSizeChanger: false }}
                    scroll={{ y: 560 }}
                    rowClassName={(record) => (record.id === selectedRunId ? 'po-row-selected' : '')}
                    onRow={(record) => ({ onClick: () => { setSelectedRunId(record.id); setDetailOpen(true) } })}
                  />
                )}
              </div>

              <Modal
                open={detailOpen && Boolean(selectedRun)}
                onCancel={() => setDetailOpen(false)}
                footer={null}
                width={920}
                className="po-run-detail-modal"
                title="运行详情"
                styles={{ body: { maxHeight: '72vh', overflow: 'auto' } }}
              >
                {!selectedRun ? null : runDetail.isLoading ? (
                  <LoadingBlock rows={6} />
                ) : runDetail.isError || !runDetail.data ? (
                  <ErrorState compact message={runDetail.error ? errorMessage(runDetail.error) : '运行不存在'} />
                ) : (
                  <div className="po-run-detail">
                    <div className="po-run-detail-head">
                      <div>
                        <div className="po-run-detail-title">{selectedRun.taskTitle ?? selectedRun.sessionTitle}</div>
                        <div className="po-caption po-muted">
                          {selectedRun.agentName} · {formatDateTime(selectedRun.startedAt)}
                        </div>
                      </div>
                      <StatusPill tone={toneForStatus(selectedRun.status)}>{runStatusLabel(selectedRun.status)}</StatusPill>
                    </div>
                    <KeyValueList
                      compact
                      items={[
                        { label: '会话', value: selectedRun.sessionTitle },
                        { label: '尝试', value: `#${selectedRun.attempt}` },
                        { label: '耗时', value: formatDuration(selectedRun.startedAt, selectedRun.finishedAt) },
                        { label: 'Token', value: `${selectedRun.inputTokens} / ${selectedRun.outputTokens}` },
                        { label: '待授权', value: selectedRun.pendingApprovals },
                        ...(runDetail.data.snapshot
                          ? [
                              {
                                label: 'Agent 快照',
                                value: `${runDetail.data.snapshot.agentName} · v${runDetail.data.snapshot.agentConfigVersion}`,
                              },
                              {
                                label: 'Runtime 快照',
                                value: runDetail.data.snapshot.runtimeProfileName ?? '内置 Provider',
                              },
                              {
                                label: '权限快照',
                                value:
                                  [
                                    runDetail.data.snapshot.permissions.files ? '文件' : '',
                                    runDetail.data.snapshot.permissions.shell ? 'Shell' : '',
                                    runDetail.data.snapshot.permissions.network ? '网络' : '',
                                  ]
                                    .filter(Boolean)
                                    .join(' / ') || '无',
                              },
                            ]
                          : []),
                      ]}
                    />
                    {selectedRun.error ? <ErrorState compact title="运行错误" message={selectedRun.error} /> : null}
                    <div className="po-run-detail-actions">
                      <Button size="small" onClick={() => navigate(`/projects/${projectId}/agents`)}>
                        打开会话
                      </Button>
                      {ACTIVE.has(selectedRun.status) ? (
                        <Button
                          size="small"
                          danger
                          icon={<StopOutlined />}
                          loading={cancel.isPending}
                          onClick={() => cancel.mutate(selectedRun.id)}
                        >
                          取消运行
                        </Button>
                      ) : null}
                    </div>
                    {detailApprovals.length > 0 ? (
                      <div className="po-approval-list">
                        {detailApprovals.map((approval) => (
                          <ApprovalCard
                            key={approval.id}
                            approval={approval}
                            compact
                            busy={decide.isPending}
                            onDecide={(decision) => decide.mutate({ approvalId: approval.id, decision })}
                          />
                        ))}
                      </div>
                    ) : null}
                    <ToolTrace
                      steps={runDetail.data.steps}
                      toolCalls={runDetail.data.toolCalls}
                      title="运行步骤"
                    />
                  </div>
                )}
              </Modal>
              </>
            ),
          },
          {
            key: 'events',
            label: '项目事件',
            children: (
              <SectionCard title="项目事件流">
                {events.isLoading ? (
                  <LoadingBlock rows={8} />
                ) : events.isError ? (
                  <ErrorState message={errorMessage(events.error)} onRetry={() => void events.refetch()} />
                ) : (events.data?.events.length ?? 0) === 0 ? (
                  <EmptyState compact title="暂无事件" />
                ) : (
                  <div className="po-event-list">
                    {events.data!.events.map((event) => (
                      <div className="po-event-row" key={event.id}>
                        <span className="po-event-seq">#{event.seq}</span>
                        <span className="po-event-type">{event.eventType}</span>
                        <span className="po-event-summary">{event.summary}</span>
                        <span className="po-event-time">{formatRelative(event.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>
            ),
          },
        ]}
      />
    </div>
  )
}


