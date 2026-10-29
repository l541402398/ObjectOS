import { useState, type ReactNode } from 'react'
import { ArrowRightLeft, Lock, Trash2, X } from 'lucide-react'
import {
  WORKFLOW_KINDS,
  type WorkflowEdgeDef,
  type WorkflowIssue,
  type WorkflowKind,
  type WorkflowNodeDef,
} from '../data'
import { Badge, Button, Field, Select, Surface, TextInput, Toggle } from '../ui'

export function WorkflowInspector({
  node,
  nodes,
  edges,
  issues,
  onUpdate,
  onDelete,
  onRemoveEdge,
  onClose,
}: {
  node: WorkflowNodeDef | null
  nodes: WorkflowNodeDef[]
  edges: WorkflowEdgeDef[]
  issues: WorkflowIssue[]
  onUpdate: (id: string, patch: Partial<WorkflowNodeDef>) => void
  onDelete: (id: string) => void
  onRemoveEdge: (id: string) => void
  onClose: () => void
}): ReactNode {
  const [armedDelete, setArmedDelete] = useState(false)

  if (!node) {
    const gateCount = nodes.filter((item) => WORKFLOW_KINDS[item.kind].mandatory).length
    const blocking = issues.filter((issue) => issue.severity === 'error')
    return (
      <aside className="pw-flow-inspector" aria-label="流程模板检查器">
        <div className="pw-inspector-scroll">
          <section className="pw-inspector-block">
            <h2>模板概览</h2>
            <div className="pw-flow-summary">
              <div><strong className="pw-num">{nodes.length}</strong><span>节点</span></div>
              <div><strong className="pw-num">{edges.length}</strong><span>连线</span></div>
              <div><strong className="pw-num">{gateCount}</strong><span>强制门禁</span></div>
            </div>
            <p className="pw-inspector-note">
              选择画布中的节点查看配置；从左侧节点库拖入新节点，并用节点两侧的连接点建立依赖。
            </p>
          </section>

          <section className="pw-inspector-block">
            <div className="pw-inspector-head">
              <h2>校验结果</h2>
              <Badge tone={blocking.length ? 'danger' : 'ok'} dot>
                {blocking.length ? `${blocking.length} 个阻断` : '通过'}
              </Badge>
            </div>
            {issues.length === 0 ? (
              <div className="pw-validation-ok">
                <Lock size={13} />
                <span>组织强制门禁完整，流程无循环依赖。</span>
              </div>
            ) : (
              <ul className="pw-issue-list">
                {issues.map((issue) => (
                  <li key={issue.id} data-severity={issue.severity}>
                    <span>{issue.severity === 'error' ? '阻断' : '提醒'}</span>
                    <p>{issue.message}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="pw-inspector-block">
            <h2>组织规则</h2>
            <ul className="pw-check-list">
              <li><Lock size={12} /><span>组织强制门禁不能从模板中删除，也不能改为可选</span></li>
              <li><Lock size={12} /><span>发布后的版本冻结；运行中的实例不会随更新改变</span></li>
              <li><Lock size={12} /><span>条件只能使用受控规则，不允许任意脚本或 eval</span></li>
            </ul>
          </section>
        </div>
      </aside>
    )
  }

  const meta = WORKFLOW_KINDS[node.kind]
  const incoming = edges.filter((edge) => edge.target === node.id)
  const outgoing = edges.filter((edge) => edge.source === node.id)
  const nodeIssues = issues.filter((issue) => issue.nodeId === node.id)
  const nameOf = (id: string): string => nodes.find((item) => item.id === id)?.title ?? id

  return (
    <aside className="pw-flow-inspector" aria-label="节点检查器">
      <div className="pw-inspector-scroll">
        <div className="pw-flow-inspector-head">
          <div>
            <span className="pw-flow-inspector-kicker">节点配置</span>
            <h2>{node.title}</h2>
          </div>
          <button type="button" className="pw-icon-btn" aria-label="取消选择节点" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="pw-flow-inspector-badges">
          <Badge tone={meta.tone} dot>{meta.label}</Badge>
          {node.mandatory ? <Badge tone="warn" icon={<Lock size={10} />}>强制门禁</Badge> : <Badge tone="neutral">可选步骤</Badge>}
        </div>

        <p className="pw-inspector-note">{meta.description}</p>

        {nodeIssues.length > 0 ? (
          <div className="pw-node-issues" role="status">
            {nodeIssues.map((issue) => (
              <p key={issue.id} data-severity={issue.severity}>
                <span>{issue.severity === 'error' ? '阻断' : '提醒'}</span>
                {issue.message}
              </p>
            ))}
          </div>
        ) : null}

        <div className="pw-inspector-form">
          <Field label="节点标题" htmlFor={`node-title-${node.id}`}>
            <TextInput
              id={`node-title-${node.id}`}
              value={node.title}
              onChange={(event) => onUpdate(node.id, { title: event.target.value })}
              maxLength={40}
            />
          </Field>

          <Field label="节点类型" hint="类型决定门禁语义与可信完成依据。">
            <Select
              value={node.kind}
              onChange={(event) => {
                const kind = event.target.value as WorkflowKind
                const nextMeta = WORKFLOW_KINDS[kind]
                onUpdate(node.id, {
                  kind,
                  mandatory: nextMeta.mandatory ? true : node.mandatory,
                  role: node.role || nextMeta.role,
                })
              }}
            >
              {Object.entries(WORKFLOW_KINDS).map(([kind, item]) => (
                <option key={kind} value={kind}>{item.label}</option>
              ))}
            </Select>
          </Field>

          <Field label="执行角色" hint="人类门禁填写审批角色；Agent 任务填写 Agent 名称。">
            <TextInput
              value={node.role}
              onChange={(event) => onUpdate(node.id, { role: event.target.value })}
              placeholder="例如 项目 Maintainer"
            />
          </Field>

          <Field label="输出契约" hint="用逗号分隔；门禁将校验这些产物是否存在。">
            <TextInput
              value={node.outputs.join(', ')}
              onChange={(event) =>
                onUpdate(node.id, {
                  outputs: event.target.value.split(',').map((item) => item.trim()).filter(Boolean),
                })
              }
              placeholder="例如 设计文档, 影响范围"
            />
          </Field>

          <div className="pw-inspector-toggle">
            <div>
              <strong>组织强制门禁</strong>
              <span>关闭后校验会阻断发布；组织规则优先于模板。</span>
            </div>
            <Toggle
              checked={node.mandatory}
              label="组织强制门禁"
              onChange={(checked) => onUpdate(node.id, { mandatory: checked })}
            />
          </div>

          <Field label="失败处理">
            <Select
              value={node.failurePolicy ?? 'block'}
              onChange={(event) => onUpdate(node.id, { failurePolicy: event.target.value as WorkflowNodeDef['failurePolicy'] })}
            >
              <option value="block">阻断并保留证据</option>
              <option value="manual">转人工判断</option>
              <option value="retry">重试一次（幂等动作）</option>
            </Select>
          </Field>
        </div>

        <section className="pw-inspector-block">
          <h2>连接</h2>
          {incoming.length === 0 && outgoing.length === 0 ? (
            <p className="pw-inspector-note">该节点还没有连线。拖动节点两侧的连接点建立依赖。</p>
          ) : (
            <ul className="pw-edge-list">
              {incoming.map((edge) => (
                <li key={edge.id}>
                  <span className="pw-edge-direction"><ArrowRightLeft size={11} /> 上游</span>
                  <span>{nameOf(edge.source)}</span>
                  <button type="button" aria-label={`移除来自 ${nameOf(edge.source)} 的连线`} onClick={() => onRemoveEdge(edge.id)}>
                    <X size={12} />
                  </button>
                </li>
              ))}
              {outgoing.map((edge) => (
                <li key={edge.id}>
                  <span className="pw-edge-direction">下游 <ArrowRightLeft size={11} /></span>
                  <span>{nameOf(edge.target)}</span>
                  <button type="button" aria-label={`移除到 ${nameOf(edge.target)} 的连线`} onClick={() => onRemoveEdge(edge.id)}>
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="pw-inspector-note">发布后连线结构随版本冻结；实例运行中不可修改。</p>
        </section>

        <Surface title="删除节点" className="pw-danger-zone" subtitle="删除后校验会立即指出受影响的门禁。">
          <Button
            variant="danger"
            icon={<Trash2 size={13} />}
            onClick={() => {
              if (!armedDelete) {
                setArmedDelete(true)
                window.setTimeout(() => setArmedDelete(false), 3500)
                return
              }
              onDelete(node.id)
            }}
          >
            {armedDelete ? '确认删除此节点' : '删除节点'}
          </Button>
        </Surface>
      </div>
    </aside>
  )
}
