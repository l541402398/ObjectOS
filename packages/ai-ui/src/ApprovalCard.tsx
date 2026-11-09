import { AlertOutlined, CheckOutlined, CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Button, Checkbox } from 'antd'
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

function toolNameOf(approval: ApprovalView): string | null {
  return typeof approval.request.toolName === 'string' ? approval.request.toolName : null
}

export interface ApprovalCardProps {
  approval: ApprovalView
  busy?: boolean
  onDecide: (decision: 'approved' | 'rejected') => void
  /** Approve this tool kind for the rest of the Run. */
  onApproveKind?: () => void
  compact?: boolean
  selectable?: boolean
  selected?: boolean
  onSelectChange?: (selected: boolean) => void
}

export function ApprovalCard({
  approval,
  busy = false,
  onDecide,
  onApproveKind,
  compact = false,
  selectable = false,
  selected = false,
  onSelectChange,
}: ApprovalCardProps) {
  const pending = approval.status === 'pending'
  const toolName = toolNameOf(approval)
  return (
    <div className={`po-approval ${compact ? 'is-compact' : ''} ${pending ? 'is-pending' : ''} ${selected ? 'is-selected' : ''}`.trim()}>
      <div className="po-approval-head">
        {selectable && pending ? (
          <Checkbox
            checked={selected}
            disabled={busy}
            onChange={(event) => onSelectChange?.(event.target.checked)}
            aria-label="选择授权"
          />
        ) : null}
        <div className="po-approval-icon">
          {pending ? <AlertOutlined /> : <SafetyCertificateOutlined />}
        </div>
        <div className="po-approval-heading">
          <div className="po-approval-title">{approval.title}</div>
          <div className="po-approval-sub">
            {approval.agentName}
            {approval.taskTitle ? ` · ${approval.taskTitle}` : ''}
            {toolName ? ` · ${toolName}` : ''}
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
            {onApproveKind && toolName ? (
              <Button size="small" disabled={busy} onClick={() => onApproveKind()}>
                批准本 Run 同类
              </Button>
            ) : null}
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
