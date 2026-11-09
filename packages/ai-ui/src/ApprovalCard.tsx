import { CheckOutlined, CloseOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
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
    <article
      className={`po-decision ${compact ? 'is-compact' : ''} ${pending ? 'is-pending' : 'is-resolved'} ${selected ? 'is-selected' : ''}`.trim()}
      aria-label={pending ? `待授权：${approval.title}` : `已处理：${approval.title}`}
    >
      <div className="po-decision-rail" aria-hidden>
        <span className={`po-decision-dot ${pending ? 'is-live' : ''}`} />
        <span className="po-decision-stem" />
      </div>
      <div className="po-decision-body">
        <header className="po-decision-head">
          {selectable && pending ? (
            <Checkbox
              checked={selected}
              disabled={busy}
              onChange={(event) => onSelectChange?.(event.target.checked)}
              aria-label="选择授权"
            />
          ) : null}
          <div className="po-decision-heading">
            <div className="po-decision-title-row">
              <h3 className="po-decision-title">{approval.title}</h3>
              <StatusPill tone={toneForStatus(approval.status)}>
                {pending ? '待授权' : approval.status === 'approved' ? '已批准' : approval.status === 'rejected' ? '已拒绝' : approval.status}
              </StatusPill>
            </div>
            <p className="po-decision-meta">
              <span>{approval.agentName}</span>
              {approval.taskTitle ? <span>· {approval.taskTitle}</span> : null}
              {toolName ? <code className="po-decision-tool">{toolName}</code> : null}
            </p>
          </div>
        </header>
        {pending ? (
          <>
            <p className="po-decision-detail">{approval.detail}</p>
            <details className="po-decision-args">
              <summary>请求参数 / Diff 预览</summary>
              <pre>{pretty(approval.request)}</pre>
            </details>
            <div className="po-decision-actions" role="group" aria-label="授权决定">
              <Button
                className="po-decision-reject"
                size="middle"
                icon={<CloseOutlined />}
                disabled={busy}
                onClick={() => onDecide('rejected')}
              >
                拒绝
              </Button>
              {onApproveKind && toolName ? (
                <Button size="middle" disabled={busy} onClick={() => onApproveKind()}>
                  批准本 Run 同类
                </Button>
              ) : null}
              <Button
                className="po-decision-approve"
                size="middle"
                type="primary"
                icon={<CheckOutlined />}
                loading={busy}
                onClick={() => onDecide('approved')}
              >
                批准并继续
              </Button>
            </div>
          </>
        ) : (
          <p className="po-decision-detail po-decision-resolved">
            <SafetyCertificateOutlined /> 决定：{approval.decision ?? approval.status}
          </p>
        )}
      </div>
    </article>
  )
}
