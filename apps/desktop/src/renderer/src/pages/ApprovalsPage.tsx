import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { App as AntApp, Button, Empty, Input, Tag } from 'antd'
import { CheckOutlined, CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApprovals } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'
import './approvals-workbench.css'

type QueueItem =
  | { kind: 'tool'; id: string; title: string; meta: string; status: string; requestedAt: number }
  | { kind: 'delivery'; id: string; title: string; meta: string; status: string; requestedAt: number; subjectType: string; subjectRevision: number; fingerprint: string }

function statusLabel(status: string): string {
  return status === 'pending' ? '待审批' : status === 'approved' ? '已批准' : status === 'rejected' ? '已拒绝' : status
}

export default function ApprovalsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const approvals = useApprovals(projectId ?? null)
  const delivery = useQuery({
    queryKey: ['release-approvals', projectId],
    queryFn: () => window.projectos.release.approvals(projectId!),
    enabled: Boolean(projectId),
  })
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [scope, setScope] = useState<'all' | 'tool' | 'delivery'>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const items = useMemo<QueueItem[]>(() => {
    const tool: QueueItem[] = (approvals.data?.approvals ?? []).map((approval) => ({
      kind: 'tool', id: approval.id, title: approval.title,
      meta: `${approval.agentName} · ${approval.taskTitle ?? '未关联任务'} · ${formatRelative(approval.requestedAt)}`,
      status: approval.status, requestedAt: approval.requestedAt,
    }))
    const deliveryItems: QueueItem[] = (delivery.data?.approvals ?? []).map((approval) => ({
      kind: 'delivery', id: approval.id,
      title: approval.subjectTitle ?? (approval.subjectType === 'change_request' ? '发布变更审批' : '部署审批'),
      meta: `${approval.subjectType === 'change_request' ? '发布变更' : '部署'} · r${approval.subjectRevision} · ${formatRelative(approval.requestedAt)}`,
      status: approval.status, requestedAt: approval.requestedAt,
      subjectType: approval.subjectType, subjectRevision: approval.subjectRevision, fingerprint: approval.contentFingerprint,
    }))
    return [...tool, ...deliveryItems]
  }, [approvals.data, delivery.data])

  const filtered = useMemo(
    () => items.filter((item) => (filter === 'pending' ? item.status === 'pending' : true) && (scope === 'all' || item.kind === scope)),
    [filter, items, scope],
  )
  useEffect(() => {
    if (!filtered.some((item) => `${item.kind}:${item.id}` === selectedKey)) {
      setSelectedKey(filtered[0] ? `${filtered[0].kind}:${filtered[0].id}` : null)
    }
  }, [filtered, selectedKey])

  const selected = filtered.find((item) => `${item.kind}:${item.id}` === selectedKey) ??
    items.find((item) => `${item.kind}:${item.id}` === selectedKey) ?? null
  const toolApproval = selected?.kind === 'tool' ? approvals.data?.approvals.find((item) => item.id === selected.id) ?? null : null
  const deliveryApproval = selected?.kind === 'delivery' ? delivery.data?.approvals.find((item) => item.id === selected.id) ?? null : null

  const decideTool = useMutation({
    mutationFn: ({ decision }: { decision: 'approved' | 'rejected' }) =>
      window.projectos.approvals.decide({ approvalId: selected!.id, decision, note }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['approvals'] })
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      setNote(''); setSelectedKey(null); message.success('审批已处理')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const decideDelivery = useMutation({
    mutationFn: ({ decision }: { decision: 'approved' | 'rejected' }) =>
      window.projectos.release.decideApproval({ approvalId: selected!.id, decision, note: note || '审批工作台处理', rationale: note || '审批工作台处理' }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['release-approvals'] })
      await queryClient.invalidateQueries({ queryKey: ['release-overview'] })
      setNote(''); setSelectedKey(null); message.success('交付审批已处理')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const pending = items.filter((item) => item.status === 'pending').length

  return (
    <div className="ap-shell">
      <header className="ap-head">
        <div><div className="rw-eyebrow">REVIEW DESK</div><h1>审批工作台</h1><p>对工具权限与交付变更做可追溯决策</p></div>
        <div className="ap-head-metrics"><span><strong>{pending}</strong>待处理</span><span><strong>{items.length}</strong>全部</span></div>
      </header>

      <div className="ap-body">
        <aside className="ap-queue">
          <div className="ap-filters">
            <button className={filter === 'pending' ? 'is-active' : ''} onClick={() => setFilter('pending')}>待处理</button>
            <button className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>历史</button>
          </div>
          <div className="ap-scopes">
            <button className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}>全部</button>
            <button className={scope === 'tool' ? 'is-active' : ''} onClick={() => setScope('tool')}>工具权限</button>
            <button className={scope === 'delivery' ? 'is-active' : ''} onClick={() => setScope('delivery')}>交付</button>
          </div>
          <div className="ap-list">
            {filtered.length === 0 ? <div className="ap-empty">没有符合条件的审批</div> : null}
            {filtered.map((item) => {
              const key = `${item.kind}:${item.id}`
              return (
                <button key={key} className={`ap-row ${selectedKey === key ? 'is-selected' : ''}`} onClick={() => { setSelectedKey(key); setNote('') }}>
                  <span className="ap-row-title"><strong>{item.title}</strong><em>{statusLabel(item.status)}</em></span>
                  <span className="ap-row-meta">{item.meta}</span>
                  <span className={`ap-kind ${item.kind}`}>{item.kind === 'tool' ? '工具权限' : '交付审批'}</span>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="ap-detail">
          {!selected ? <div className="ap-detail-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择一条审批" /></div> : null}
          {selected ? (
            <>
              <div className="ap-detail-head">
                <div><span className="rw-kicker">{selected.kind === 'tool' ? 'TOOL PERMISSION' : 'DELIVERY DECISION'}</span><h2>{selected.title}</h2></div>
                <Tag>{statusLabel(selected.status)}</Tag>
              </div>
              <div className="ap-facts">
                <span><b>申请</b>{selected.kind === 'tool' ? toolApproval?.agentName ?? '—' : 'ProjectOS 交付'}</span>
                <span><b>时间</b>{formatRelative(selected.requestedAt)}</span>
                <span><b>状态</b>{statusLabel(selected.status)}</span>
              </div>
              {toolApproval ? (
                <>
                  <h3 className="ap-section">申请内容</h3>
                  <div className="ap-code">{toolApproval.detail || '没有提供可审阅的详情'}</div>
                  {toolApproval.taskTitle ? <p className="ap-muted">关联任务：{toolApproval.taskTitle}</p> : null}
                  <div className="ap-callout warn"><strong>Diff 预览未接入</strong><span>当前只能看到工具请求摘要；批准文件写入前需要接入真实 diff。</span></div>
                </>
              ) : null}
              {deliveryApproval ? (
                <>
                  <h3 className="ap-section">审批快照</h3>
                  <div className="ap-kv-grid">
                    <span><b>对象</b>{deliveryApproval.subjectType === 'change_request' ? '发布变更' : '部署'}</span>
                    <span><b>revision</b>r{deliveryApproval.subjectRevision}</span>
                    <span><b>内容指纹</b><code>{deliveryApproval.contentFingerprint.slice(0, 24)}…</code></span>
                    <span><b>申请时间</b>{formatRelative(deliveryApproval.requestedAt)}</span>
                  </div>
                  <div className="ap-callout"><strong>批准即绑定当前内容</strong><span>变更内容一旦修改，此审批自动失效，需要重新提交。</span></div>
                </>
              ) : null}
            </>
          ) : null}
        </section>

        <aside className="ap-action">
          <h3>决策</h3>
          {selected ? (
            <>
              <div className="ap-risk"><span>风险</span><strong>{selected.kind === 'tool' ? '写入/权限' : '发布/部署'}</strong></div>
              <p className="ap-muted">批准会记录操作者、备注与时间；不会自动执行危险动作。</p>
              <label className="ap-note"><span>审批备注</span><Input.TextArea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选：说明批准/拒绝理由" /></label>
              <div className="ap-actions">
                <Button danger icon={<CloseOutlined />} loading={selected.kind === 'tool' ? decideTool.isPending : decideDelivery.isPending}
                  onClick={() => selected.kind === 'tool' ? decideTool.mutate({ decision: 'rejected' }) : decideDelivery.mutate({ decision: 'rejected' })}>拒绝</Button>
                <Button type="primary" icon={<CheckOutlined />} loading={selected.kind === 'tool' ? decideTool.isPending : decideDelivery.isPending}
                  onClick={() => selected.kind === 'tool' ? decideTool.mutate({ decision: 'approved' }) : decideDelivery.mutate({ decision: 'approved' })}>批准</Button>
              </div>
              <div className="ap-rail-divider" />
              <div className="ap-scope-copy"><SafetyCertificateOutlined /> 审批不会绕过对象 revision 与内容指纹校验。</div>
            </>
          ) : <p className="ap-muted">选择一条审批后，在此批准或拒绝。</p>}
        </aside>
      </div>
    </div>
  )
}
