import { useQuery } from '@tanstack/react-query'
import { Tag } from 'antd'
import { useAIConnections } from '../../lib/queries'

export function UsageSettingsPanel() {
  const connections = useAIConnections()
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => window.projectos.aiUsage.summary() })
  const prices = useQuery({ queryKey: ['ai-pricing'], queryFn: () => window.projectos.aiPricing.list() })
  const nameOf = (connectionId: string | null) =>
    connections.data?.connections.find((connection) => connection.id === connectionId)?.name ?? '未绑定连接'
  const planner = usage.data?.planner
  const costText = usage.data?.costUnknown
    ? `${usage.data?.estimatedCost ?? 0} + 未知`
    : String(usage.data?.estimatedCost ?? 0)

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head"><div><h2>用量与价格</h2><p>来自真实 AgentRun 与 Planner usage；无 usage 或单价时显示未知，不伪造费用</p></div></div>
      <div className="v16-stat-grid">
        <div className="v16-stat-card is-blue"><div className="v16-stat-value">{usage.data?.runs ?? 0}</div><div className="v16-stat-label">Runs</div></div>
        <div className="v16-stat-card is-teal"><div className="v16-stat-value">{usage.data?.inputTokens ?? 0}</div><div className="v16-stat-label">Input tokens</div></div>
        <div className="v16-stat-card is-violet"><div className="v16-stat-value">{usage.data?.outputTokens ?? 0}</div><div className="v16-stat-label">Output tokens</div></div>
        <div className="v16-stat-card is-amber"><div className="v16-stat-value">{costText}</div><div className="v16-stat-label">估算费用</div></div>
        <div className="v16-stat-card is-blue"><div className="v16-stat-value">{planner?.calls ?? 0}</div><div className="v16-stat-label">Planner calls</div></div>
        <div className="v16-stat-card is-amber"><div className="v16-stat-value">{usage.data?.unpricedCalls ?? 0}</div><div className="v16-stat-label">未知单价调用</div></div>
      </div>

      <div className="v16-card-title"><strong>按连接 / 模型（Run）</strong><span>{usage.data?.byConnection.length ?? 0} 组</span></div>
      {usage.data?.byConnection.length ? (
        <div className="v16-team-list">
          {usage.data.byConnection.map((row) => (
            <div className="v16-team-row" key={`${row.connectionId}-${row.modelId}`}>
              <div><strong>{nameOf(row.connectionId)}</strong><span>{row.modelId ?? '模型未知'}</span></div>
              <span>{row.runs} runs · {row.inputTokens + row.outputTokens} tokens</span>
              <strong>{row.unpricedCalls > 0 ? `${row.estimatedCost} + 未知` : row.estimatedCost}</strong>
            </div>
          ))}
        </div>
      ) : (
        <div className="v16-empty-inline">尚无 Run usage。没有证据时不显示虚构费用。</div>
      )}

      <div className="v16-card-title"><strong>Planner（按尝试）</strong><span>{planner?.calls ?? 0} 次模型调用</span></div>
      {planner?.calls ? (
        <div className="v16-team-list">
          {planner.byConnection.map((row) => (
            <div className="v16-team-row" key={`planner-${row.connectionId}-${row.modelId}`}>
              <div><strong>{nameOf(row.connectionId)}</strong><span>{row.modelId ?? '模型未知'} · 含纠错尝试</span></div>
              <span>{row.calls} calls · {row.inputTokens + row.outputTokens} tokens</span>
              <strong>{row.unpricedCalls > 0 ? `${row.estimatedCost} + 未知` : row.estimatedCost}</strong>
            </div>
          ))}
          {planner.unpricedCalls > 0 ? (
            <div className="v16-empty-inline">
              {planner.unpricedCalls} 次 Planner 调用没有可用单价，费用保持未知；不会按 0 计入。
            </div>
          ) : null}
        </div>
      ) : (
        <div className="v16-empty-inline">尚无 Planner 模型调用。未配置单价时费用保持未知。</div>
      )}

      <div className="v16-card-title"><strong>模型价格</strong><span>{prices.data?.prices.length ?? 0} 条</span></div>
      {(prices.data?.prices.length ?? 0) === 0 ? (
        <div className="v16-empty-inline">尚未配置模型价格。费用统计保持未知，不按猜测计费。</div>
      ) : (
        <div className="v16-team-list">
          {prices.data?.prices.map((price) => (
            <div className="v16-team-row" key={price.id}>
              <div><strong>{nameOf(price.connectionId)}</strong><span>{price.modelId} · {price.currency}</span></div>
              <Tag>输入 {price.inputPerMillion}/M</Tag>
              <Tag>输出 {price.outputPerMillion}/M</Tag>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
