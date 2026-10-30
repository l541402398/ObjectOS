import type { NavigateFunction } from 'react-router-dom'
import { Button, Tag } from 'antd'
import { ArrowRightOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { useActionCenter } from '../lib/queries'
import { journeyActionLabel, JOURNEY_OWNER_LABEL } from '../lib/journey'
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
  const journey = useQuery({ queryKey: ['work', 'journey', projectId], queryFn: () => window.projectos.work.journey(projectId), staleTime: 2000, refetchInterval: 5000 })
  const next = journey.data?.nextAction
  const items = (actions.data?.items ?? []).filter((item) => !item.stale)
  const first = items[0] ?? null
  const rest = items.slice(1)

  if (actions.isError) return <section className="wc-next" aria-label="当前待办"><div className="wc-next-body"><p role="alert">待办读取失败，暂时无法确认需要处理的事项。</p><Button onClick={() => void actions.refetch()}>重新读取</Button></div></section>

  return (
    <section className="wc-next" data-testid="next-step-panel">
      <header className="wc-next-head">
        <span className="wc-next-kicker">NEXT STEP</span>
        <strong>{first ? '现在需要你决定' : next ? JOURNEY_OWNER_LABEL[next.owner] : '正在读取当前进度'}</strong>
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
            {first.kind === 'tool_approval' || first.kind === 'delivery_approval' ? '处理审批' : first.kind === 'task_acceptance' ? '查看验收' : first.kind === 'version_gate' ? '查看版本门禁' : first.kind === 'run_failure' ? '查看失败原因' : '处理对账'}
          </Button>
        </div>
      ) : (
        <div className="wc-next-body">
          <div className="wc-next-main">
            <p className="wc-next-reason">
              <CheckCircleOutlined /> {next?.label ?? (journey.isError ? '进度读取失败，请重试。' : '正在读取项目进度…')}
            </p>
            {next?.detail ? <p className="wc-next-resume">{next.detail}</p> : null}
          </div>
          {next?.route ? <Button type="primary" onClick={() => navigate(next.route!)}>{journeyActionLabel(next)}</Button> : journey.isError ? <Button onClick={() => void journey.refetch()}>重试</Button> : null}
        </div>
      )}
      {rest.length > 0 ? (
        <details className="wc-next-rest"><summary>其他 {items.length - 1} 项待处理</summary>
          {rest.map((item: ActionItem) => (
            <button type="button" key={item.id} className="wc-next-row" onClick={() => navigate(item.route)}>
              <Tag>{KIND_LABEL[item.kind] ?? item.kind}</Tag>
              <span>{item.title}</span>
              <ArrowRightOutlined />
            </button>
          ))}
        </details>
      ) : null}
    </section>
  )
}
