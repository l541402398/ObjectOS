import {
  CheckCircleFilled,
  CloseCircleFilled,
  LoadingOutlined,
  MinusCircleOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { ThoughtChain } from '@ant-design/x'
import type { ThoughtChainItemType } from '@ant-design/x'
import type { RunStep, ToolCall } from '@projectos/contracts'
import { RichText } from './RichText.js'

function truncate(value: unknown, limit = 2600): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  if (!text) return ''
  return text.length > limit ? `${text.slice(0, limit)}\n…（已截断）` : text
}

function stepStatus(step: RunStep): ThoughtChainItemType['status'] {
  if (step.kind === 'error') return 'error'
  if (step.kind === 'tool_result') {
    const ok = step.payload.ok
    return ok === false ? 'error' : 'success'
  }
  if (step.kind === 'approval') return 'loading'
  if (step.kind === 'status') {
    const status = String(step.payload.status ?? '')
    if (status === 'completed' || status === 'success') return 'success'
    if (status === 'failed' || status === 'needs_reconciliation') return 'error'
    if (status === 'cancelled') return 'abort'
    if (status === 'waiting_approval') return 'loading'
    return undefined
  }
  if (step.kind === 'tool_request') return undefined
  return undefined
}

function stepIcon(step: RunStep) {
  const status = stepStatus(step)
  if (status === 'success') return <CheckCircleFilled />
  if (status === 'error') return <CloseCircleFilled />
  if (status === 'abort') return <MinusCircleOutlined />
  if (status === 'loading') return <LoadingOutlined spin />
  return <ToolOutlined />
}

function stepContent(step: RunStep) {
  if (step.kind === 'text') {
    const content = typeof step.payload.content === 'string' ? step.payload.content : ''
    return content ? <RichText text={content} /> : undefined
  }
  if (step.kind === 'context') {
    return (
      <pre className="po-trace-json">
        {truncate({ chars: step.payload.chars, sources: step.payload.sources, truncated: step.payload.truncated })}
      </pre>
    )
  }
  if (step.kind === 'tool_request' || step.kind === 'tool_result' || step.kind === 'approval' || step.kind === 'error') {
    return <pre className="po-trace-json">{truncate(step.payload)}</pre>
  }
  return <pre className="po-trace-json">{truncate(step.payload)}</pre>
}

export interface ToolTraceProps {
  steps: RunStep[]
  toolCalls?: ToolCall[]
  title?: string
  emptyText?: string
}

export function ToolTrace({ steps, toolCalls = [], title, emptyText = '暂无执行步骤' }: ToolTraceProps) {
  const visible = steps.filter((step) => step.kind !== 'context' || steps.length < 6)
  const items: ThoughtChainItemType[] = visible.map((step, index) => ({
    key: step.id,
    title:
      step.kind === 'tool_request'
        ? `${String(step.payload.name ?? '工具')} · 请求`
        : step.kind === 'tool_result'
          ? `${String(step.payload.name ?? '工具')} · 结果`
          : step.kind === 'approval'
            ? `授权 · ${String(step.payload.toolName ?? '')}`
            : step.title || `步骤 ${index + 1}`,
    description: step.createdAt ? new Date(step.createdAt).toLocaleTimeString('zh-CN', { hour12: false }) : undefined,
    icon: stepIcon(step),
    status: stepStatus(step),
    content: stepContent(step),
    collapsible: true,
  }))
  if (items.length === 0) {
    return <div className="po-trace-empty">{emptyText}</div>
  }
  return (
    <div className="po-tool-trace">
      {title ? <div className="po-trace-title">{title}</div> : null}
      <ThoughtChain items={items} line="solid" />
      {toolCalls.length > 0 ? (
        <div className="po-tool-calls">
          <div className="po-trace-title">工具调用记录</div>
          {toolCalls.map((call) => (
            <div className="po-tool-call" key={call.id}>
              <div className="po-tool-call-head">
                <span className="po-mono">{call.toolName}</span>
                <span className={`po-call-status is-${call.status}`}>{call.status}</span>
              </div>
              <pre className="po-trace-json">{truncate(call.result ?? call.error ?? call.args)}</pre>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
