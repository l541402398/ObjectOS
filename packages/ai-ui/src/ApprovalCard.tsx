import { AlertOutlined, CheckOutlined, CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Button } from 'antd'
import type { ApprovalView } from '@projectos/contracts'
import { StatusPill, toneForStatus } from '@projectos/ui'

function pretty(value: unknown, limit = 2400): string {
  try {
    const text = JSON.stringify(value, null, 2)
    return text && text.length > limit ? `${text.slice(0, limit)}\n…` : (text ?? '')
  } catch {
    return String(value)
  }
}

export interface ApprovalCardProps {
  approval: ApprovalView
  busy?: boolean
  onDecide: (decision: 'approved' | 'rejected') => void
  compact?: boolean
}

export function ApprovalCard({ approval, busy = false, onDecide, compact = false }: ApprovalCardProps) {
  const pending = approval.status === 'pending'
  return (
    <div className={`po-approval ${compact ? 'is-compact' : ''} ${pending ? 'is-pending' : ''}`.trim()}>
      <div className="po-approval-head">
        <div className="po-approval-icon">
          {pending ? <AlertOutlined /> : <SafetyCertificateOutlined />}
        </div>
        <div className="po-approval-heading">
          <div className="po-approval-title">{approval.title}</div>
          <div className="po-approval-sub">
            {approval.agentName}
            {approval.taskTitle ? ` · ${approval.taskTitle}` : ''}
          </div>
        </div>
        <StatusPill tone={toneForStatus(approval.status)}>
          {pending ? '待授权' : approval.status === 'approved' ? '已批准' : approval.status === 'rejected' ? '已拒绝' : approval.status}
        </StatusPill>
      </div>
      {pending ? (
        <>
          <div className="po-approval-detail">{approval.detail}</div>
          <details className="po-approval-args">
            <summary>查看请求参数</summary>
            <pre>{pretty(approval.request)}</pre>
          </details>
          <div className="po-approval-actions">
            <Button size="small" icon={<CloseOutlined />} disabled={busy} onClick={() => onDecide('rejected')}>
              拒绝
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<CheckOutlined />}
              loading={busy}
              onClick={() => onDecide('approved')}
            >
              批准并继续
            </Button>
          </div>
        </>
      ) : approval.decision ? (
        <div className="po-approval-detail">决定：{approval.decision}</div>
      ) : null}
    </div>
  )
}
