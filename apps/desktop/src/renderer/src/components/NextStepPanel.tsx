import type { NavigateFunction } from 'react-router-dom'
import { Button, Tag } from 'antd'
import { ArrowRightOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useActionCenter } from '../lib/queries'
import type { ActionItem } from '@projectos/contracts'

const KIND_LABEL: Record<string, string> = {
  tool_approval: '工具授权',
  task_acceptance: '任务验收',
  delivery_approval: '发布/部署审批',
  version_gate: '版本门禁',
  deployment_reconciliation: '部署对账',
  run_failure: 'Run 失败',
}

const RISK_LABEL: Record<string, string> = { low: '低风险', medium: '需确认', high: '高风险' }

/**
 * "Next step" surface: the single place that answers "what now?".
 * It is a projection of the action center, so it can never disagree with the
 * approvals/gates/deployments modules.
 */
export function NextStepPanel({ projectId, navigate }: { projectId: string; navigate: NavigateFunction }) {
  const actions = useActionCenter(projectId)
  const items = (actions.data?.items ?? []).filter((item) => !item.stale)
  const first = items[0] ?? null
  const rest = items.slice(1, 4)

  return (
    <section className="wc-next" data-testid="next-step-panel">
      <header className="wc-next-head">
        <span className="wc-next-kicker">NEXT STEP</span>
        <strong>{first ? '现在需要你决定' : '无需你介入，系统在推进'}</strong>
        <Tag className="wc-next-count">{items.length} 项待办</Tag>
      </header>
      {first ? (
        <div className="wc-next-body">
          <div className="wc-next-main">
            <div className="wc-next-title">
              <Tag>{KIND_LABEL[first.kind] ?? first.kind}</Tag>
              <span className={`wc-next-risk is-${first.risk}`}>{RISK_LABEL[first.risk] ?? first.risk}</span>
              <h3>{first.title}</h3>
            </div>
            <p className="wc-next-reason">{first.reason}</p>
            <p className="wc-next-decision">需要你：{first.requiredDecision}</p>
            <p className="wc-next-resume">处理后：{first.resume}</p>
          </div>
          <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => navigate(first.route)}>
            去处理
          </Button>
        </div>
      ) : (
        <div className="wc-next-body">
          <div className="wc-next-main">
            <p className="wc-next-reason">
              <CheckCircleOutlined /> 当前没有需要人工处理的事项。AI 会继续执行已授权的任务、收集证据并在满足门禁时自动推进阶段。
            </p>
          </div>
        </div>
      )}
      {rest.length > 0 ? (
        <div className="wc-next-rest">
          {rest.map((item: ActionItem) => (
            <button type="button" key={item.id} className="wc-next-row" onClick={() => navigate(item.route)}>
              <Tag>{KIND_LABEL[item.kind] ?? item.kind}</Tag>
              <span>{item.title}</span>
              <ArrowRightOutlined />
            </button>
          ))}
        </div>
      ) : null}
    </section>
  )
}
