import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Drawer,
  Input,
  Select,
  Switch,
  Tag,
  Tooltip,
} from 'antd'
import {
  ApartmentOutlined,
  ApartmentOutlined as DagIcon,
  CheckOutlined,
  CloseOutlined,
  CodeOutlined,
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  ExperimentOutlined,
  EyeOutlined,
  InfoCircleOutlined,
  NodeIndexOutlined,
  PlusOutlined,
  RightOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  MarkerType,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  AGENT_CAPABILITIES,
  type AgentCapability,
  type PlanDraft,
  type PlanRole,
  type PlannedTask,
} from '@projectos/contracts'

import { computeStages, planDependencyIssues, type Stage, type TaskEntry } from './plan-review-logic'
export { hasPlanBlockingIssues } from './plan-review-logic'

type AgentOption = { value: string; label: string }

function shortAgentLabel(label: string | undefined): string {
  if (!label) return '角色默认'
  return label.split(' · ')[0] ?? label
}

function stageIcon(role: PlanRole | undefined) {
  if (role === 'architect') return <ApartmentOutlined />
  if (role === 'developer') return <CodeOutlined />
  if (role === 'reviewer') return <EyeOutlined />
  if (role === 'tester') return <ExperimentOutlined />
  return <UserOutlined />
}

function summarize(draft: PlanDraft, stages: Stage[], risks: number): string {
  const path = stages.map((stage) => stage.title).join(' → ')
  return `${path || '单个任务'} · ${draft.tasks.length} 个任务 · ${risks ? `${risks} 项需复核` : '没有阻塞性问题'}`
}

type PlanFlowNodeData = {
  task: PlannedTask
  index: number
  roleLabel: string
  agentLabel: string
  risk: boolean
  selected: boolean
  related: boolean
}

function PlanFlowNode({ data }: NodeProps<Node<PlanFlowNodeData>>) {
  return (
    <div
      className={`po-plan-dag-node po-biz-task-node${data.selected ? ' is-selected' : ''}${data.related ? ' is-related' : ''}${data.risk ? ' is-risk' : ''}`}
      aria-label={`任务 ${data.index + 1}：${data.task.title}`}
    >
      <Handle type="target" position={Position.Left} className="po-biz-port" />
      <div className="po-biz-node-head">
        <span className="po-biz-kicker">TASK {String(data.index + 1).padStart(2, '0')} · {data.roleLabel}</span>
        {data.risk ? <span className="po-biz-risk">需复核</span> : null}
      </div>
      <strong className="po-biz-node-title" title={data.task.title}>{data.task.title}</strong>
      <div className="po-biz-node-foot">
        <span className="po-biz-agent"><i>{data.agentLabel.slice(0, 1)}</i>{data.agentLabel}</span>
        <span>{data.task.dependsOn.length ? `${data.task.dependsOn.length} 前置` : '起点任务'}</span>
      </div>
      <Handle type="source" position={Position.Right} className="po-biz-port" />
    </div>
  )
}

const FLOW_NODE_TYPES = { planTask: PlanFlowNode }

export function PlanReviewWorkbench({
  draft,
  roleLabels,
  agentOptions,
  onUpdateTask,
  onUpdateGoal,
  onAddTask,
  onRemoveTask,
  onOpenCustomAgent,
}: {
  draft: PlanDraft
  roleLabels: Record<PlanRole, string>
  agentOptions: AgentOption[]
  onUpdateTask: (index: number, patch: Partial<PlannedTask>) => void
  onUpdateGoal: (goal: string) => void
  onAddTask: () => void
  onRemoveTask: (taskKey: string) => void
  onOpenCustomAgent: (taskKey: string) => void
}) {
  const stages = useMemo(() => computeStages(draft.tasks, roleLabels), [draft.tasks, roleLabels])
  const dependencyIssues = useMemo(() => planDependencyIssues(draft.tasks), [draft.tasks])
  const blockingTasks = draft.tasks.filter((task) => task.assignmentBlocked)
  const blockingCount = blockingTasks.length + dependencyIssues.length
  const reviewRisks: Array<{ key: string; taskKey: string | null; blocking: boolean; text: string }> = [
    ...blockingTasks.map((task) => ({ key: task.key, taskKey: task.key, blocking: true, text: `${task.title}：${task.assignmentReasons.join('；') || '无法分配 Agent'}` })),
    ...dependencyIssues.map((issue) => ({ key: issue.taskKey, taskKey: issue.taskKey, blocking: true, text: `${issue.detail}（${issue.taskKey}）` })),
    ...draft.risks.map((risk, index) => ({ key: `risk-${index}`, taskKey: null, blocking: false, text: risk })),
  ]
  const [view, setView] = useState<'route' | 'dag'>('route')
  const [riskOpen, setRiskOpen] = useState(false)
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalDraft, setGoalDraft] = useState(draft.goal)
  useEffect(() => { setGoalDraft(draft.goal) }, [draft.goal])
  const [selectedStage, setSelectedStage] = useState<string | null>(stages[0]?.id ?? null)
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null)
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(new Set())
  const stageRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const selectedTask = draft.tasks.find((task) => task.key === selectedTaskKey) ?? null
  const selectedIndex = selectedTask ? draft.tasks.findIndex((task) => task.key === selectedTask.key) : -1

  useEffect(() => {
    if (!selectedStage && stages[0]) setSelectedStage(stages[0].id)
    if (selectedStage && !stages.some((stage) => stage.id === selectedStage)) setSelectedStage(stages[0]?.id ?? null)
  }, [selectedStage, stages])

  const openTask = (taskKey: string): void => {
    setSelectedTaskKey(taskKey)
    const stage = stages.find((item) => item.entries.some((entry) => entry.task.key === taskKey))
    if (stage) setSelectedStage(stage.id)
  }

  useEffect(() => {
    if (!selectedTaskKey) return
    const stage = stages.find((item) => item.entries.some((entry) => entry.task.key === selectedTaskKey))
    if (stage) setSelectedStage(stage.id)
  }, [selectedTaskKey, stages])

  const selectStage = (stage: Stage): void => {
    setSelectedStage(stage.id)
    setCollapsedStages((current) => {
      const next = new Set(current)
      next.delete(stage.id)
      return next
    })
    window.setTimeout(() => {
      stageRefs.current[stage.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 30)
  }

  const toggleStage = (stageId: string): void => {
    setCollapsedStages((current) => {
      const next = new Set(current)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      return next
    })
  }

  const updateSelected = (patch: Partial<PlannedTask>): void => {
    if (selectedIndex >= 0) onUpdateTask(selectedIndex, patch)
  }

  const flow = useMemo(() => {
    const positions = new Map<string, { x: number; y: number }>()
    const grouped = new Map<number, TaskEntry[]>()
    for (const stage of stages) {
      for (const entry of stage.entries) {
        const list = grouped.get(entry.level) ?? []
        list.push(entry)
        grouped.set(entry.level, list)
      }
    }
    for (const [level, entries] of grouped) {
      entries.forEach((entry, index) => {
        positions.set(entry.task.key, { x: level * 330, y: index * 128 })
      })
    }
    const related = new Set<string>()
    if (selectedTask) {
      const upstream = (key: string): void => {
        const task = draft.tasks.find((item) => item.key === key)
        for (const dependency of task?.dependsOn ?? []) {
          related.add(dependency)
          upstream(dependency)
        }
      }
      const downstream = (key: string): void => {
        for (const task of draft.tasks) {
          if (task.dependsOn.includes(key) && !related.has(task.key)) {
            related.add(task.key)
            downstream(task.key)
          }
        }
      }
      upstream(selectedTask.key)
      downstream(selectedTask.key)
    }
    const nodes: Array<Node<PlanFlowNodeData>> = draft.tasks.map((task, index) => {
      const option = agentOptions.find((item) => item.value === task.agentId)
      return {
        id: task.key,
        type: 'planTask',
        position: positions.get(task.key) ?? { x: 0, y: 0 },
        data: {
          task,
          index,
          roleLabel: roleLabels[task.role] ?? task.role,
          agentLabel: shortAgentLabel(option?.label),
          risk: task.assignmentBlocked || dependencyIssues.some((issue) => issue.taskKey === task.key),
          selected: selectedTaskKey === task.key,
          related: related.has(task.key),
        },
      }
    })
    const edges: Edge[] = []
    for (const task of draft.tasks) {
      for (const dependency of task.dependsOn) {
        if (!draft.tasks.some((item) => item.key === dependency)) continue
        const edgeRelated = !selectedTask
          || dependency === selectedTask.key
          || task.key === selectedTask.key
          || (related.has(dependency) && related.has(task.key))
        edges.push({
          id: `${dependency}->${task.key}`,
          source: dependency,
          target: task.key,
          type: 'smoothstep',
          animated: false,
          className: `po-plan-dag-edge${edgeRelated ? ' is-related' : ' is-dimmed'}`,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 14,
            height: 14,
            color: edgeRelated ? '#7f99bb' : '#aeb9c8',
          },
          style: {
            stroke: edgeRelated ? 'rgba(103, 132, 172, .82)' : 'rgba(150, 164, 184, .38)',
            strokeWidth: edgeRelated ? 1.5 : 1.1,
          },
        })
      }
    }
    return { nodes, edges }
  }, [agentOptions, dependencyIssues, draft.tasks, roleLabels, selectedTask, selectedTaskKey, stages])

  return (
    <div className="po-plan-review" data-testid="plan-review-workbench">
      <section className="po-plan-review-overview">
        <div className="po-plan-review-overview-head">
          <div className="po-plan-review-title">
            <span className="po-plan-eyebrow">PLAN REVIEW · R{draft.revision}</span>
            {editingGoal ? (
              <div className="po-plan-goal-editor">
                <Input.TextArea
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  value={goalDraft}
                  onChange={(event) => setGoalDraft(event.target.value)}
                  aria-label="计划目标"
                />
                <div>
                  <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => { setGoalDraft(draft.goal); setEditingGoal(false) }}>取消</Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<CheckOutlined />}
                    disabled={!goalDraft.trim()}
                    onClick={() => { onUpdateGoal(goalDraft.trim()); setEditingGoal(false) }}
                  >
                    保存目标
                  </Button>
                </div>
              </div>
            ) : (
              <div className="po-plan-goal-title">
                <h2 title={draft.goal}>{draft.goal}</h2>
                {draft.status === 'draft' ? (
                  <Button type="text" size="small" icon={<EditOutlined />} aria-label="编辑计划目标" onClick={() => { setGoalDraft(draft.goal); setEditingGoal(true) }} />
                ) : null}
              </div>
            )}
            <p>{summarize(draft, stages, reviewRisks.length)}</p>
          </div>
          <div className="po-plan-review-metrics" aria-label="计划概览指标">
            <div><strong>{draft.tasks.length}</strong><span>任务</span></div>
            <div><strong>{stages.length}</strong><span>阶段</span></div>
            <div className={blockingCount ? 'is-risk' : ''}><strong>{reviewRisks.length}</strong><span>需复核</span></div>
            <div><strong>r{draft.revision}</strong><span>版本</span></div>
          </div>
        </div>
        <div className="po-plan-review-overview-foot">
          <details className="po-plan-generation-details">
            <summary>生成详情 <DownOutlined /></summary>
            <div>
              <p>{draft.generatedBy === 'provider' ? `模型：${draft.generation?.connectionName ?? '默认连接'} · ${draft.generation?.model ?? '来源未记录'}` : '来源：本地规则模板（未调用模型）'}</p>
              <p>耗时：{draft.generation ? `${Math.max(1, Math.round(draft.generation.durationMs / 1000))}s` : '—'} · 尝试：{draft.generation?.attempts ?? 0} 次 · 上下文：{draft.generation?.contextSources.length ?? 0} 项</p>
              {draft.assumptions.length ? <p>假设：{draft.assumptions.join('；')}</p> : null}
              {draft.generation?.warnings.length ? <p className="is-warning">历史提示：{draft.generation.warnings.join('；')}</p> : null}
            </div>
          </details>
        </div>
      </section>

      <section className="po-plan-review-map">
        <div className="po-plan-review-map-head">
          <div>
            <h3><ApartmentOutlined /> 计划路线</h3>
            <span>阶段由真实依赖层级推导；同一层级表示可并行任务。</span>
          </div>
          <div className="po-plan-view-switch" role="tablist" aria-label="计划视图">
            <button type="button" role="tab" aria-selected={view === 'route'} className={view === 'route' ? 'is-active' : ''} onClick={() => setView('route')}><NodeIndexOutlined /> 阶段路线</button>
            <button type="button" role="tab" aria-selected={view === 'dag'} className={view === 'dag' ? 'is-active' : ''} onClick={() => setView('dag')}><DagIcon /> 任务依赖</button>
          </div>
        </div>

        {view === 'route' ? (
          <div className="po-stage-route" data-testid="plan-stage-route">
            {stages.map((stage, index) => (
              <div className="po-stage-route-item" key={stage.id}>
                <Tooltip
                  title={(
                    <div>
                      {stage.entries.map((entry) => <div key={entry.task.key}>{entry.task.title}</div>)}
                      {stage.hasRisk ? <div>存在需复核的任务</div> : null}
                    </div>
                  )}
                >
                  <button
                    type="button"
                    className={`po-stage-card${selectedStage === stage.id ? ' is-selected' : ''}${stage.hasRisk ? ' is-risk' : ''}`}
                    onClick={() => selectStage(stage)}
                    aria-label={`${stage.title}，${stage.entries.length} 个任务`}
                  >
                    <span className="po-stage-card-top">
                      <span className="po-stage-icon">{stageIcon(stage.roles[0])}</span>
                      <span className="po-stage-index">{String(index + 1).padStart(2, '0')}</span>
                      {stage.hasRisk ? <WarningOutlined className="po-stage-risk" /> : null}
                    </span>
                    <strong>{stage.title}</strong>
                    <span className="po-stage-meta">
                      <span>{stage.entries.length} 个任务</span>
                      <em>{stage.entries.length > 1 ? '并行' : `${stage.roles.map((role) => roleLabels[role]).join(' / ')}`}</em>
                    </span>
                  </button>
                </Tooltip>
                {index < stages.length - 1 ? <span className="po-stage-connector" aria-hidden="true"><RightOutlined /></span> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="po-plan-dag" data-testid="plan-task-dag">
            {draft.tasks.length ? (
              <ReactFlow
                nodes={flow.nodes}
                edges={flow.edges}
                nodeTypes={FLOW_NODE_TYPES}
                fitView={false}
                defaultViewport={{ x: 12, y: 36, zoom: 0.78 }}
                minZoom={0.35}
                maxZoom={1.5}
                onNodeClick={(_event, node) => openTask(node.id)}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={22} size={1} color="rgba(120, 145, 175, .16)" />
                <Controls showInteractive={false} />
              </ReactFlow>
            ) : <div className="po-plan-review-empty">还没有任务节点。</div>}
          </div>
        )}
      </section>

      <section className="po-plan-review-risks">
        <button type="button" className={`po-plan-risk-summary${reviewRisks.length ? ' has-risks' : ''}`} onClick={() => setRiskOpen((open) => !open)} aria-expanded={riskOpen}>
          <WarningOutlined />
          <span>{reviewRisks.length ? `发现 ${reviewRisks.length} 项需复核的问题` : '没有发现需要复核的问题'}</span>
          {blockingCount ? <Tag color="error">{blockingCount} 项阻塞</Tag> : null}
          <em>{riskOpen ? '收起' : '点击查看'}</em>
        </button>
        <div className="po-review-aside-status">
          <div><span>审批状态</span><strong className={blockingCount ? 'is-blocking' : 'is-ready'}>{blockingCount ? '待修复' : reviewRisks.length ? '可批准 · 有提醒' : '可批准'}</strong></div>
          <div><span>阻塞项</span><em>{blockingCount}</em></div>
          <div><span>任务 / 阶段</span><em>{draft.tasks.length} / {stages.length}</em></div>
          <p>批准只创建任务与依赖，不会启动 Agent；执行需单独授权。</p>
        </div>
        {riskOpen ? (
          <div className="po-plan-risk-list" data-testid="plan-risk-list">
            {reviewRisks.length ? reviewRisks.map((risk) => (
              risk.taskKey ? (
                <button
                  type="button"
                  key={risk.key}
                  className={risk.blocking ? 'is-blocking' : ''}
                  onClick={() => { if (risk.taskKey) openTask(risk.taskKey) }}
                >
                  <span>{risk.blocking ? '阻塞' : '提醒'}</span>
                  <strong>{risk.text}</strong>
                  <em>定位任务</em>
                </button>
              ) : (
                <div className="po-plan-risk-planlevel" key={risk.key}>
                  <span>提醒</span>
                  <strong>{risk.text}</strong>
                  <em>计划级</em>
                </div>
              )
            )) : <p>校验通过，可以继续审核任务。</p>}
          </div>
        ) : null}
      </section>

      <section className="po-plan-review-tasks">
        <div className="po-plan-review-section-head">
          <div><h3>任务清单</h3><span>默认只显示摘要；点击任务打开详情并编辑。</span></div>
          {draft.status === 'draft' ? <Button size="small" icon={<PlusOutlined />} onClick={onAddTask}>添加任务</Button> : null}
        </div>
        <div className="po-plan-compact-list" data-testid="plan-task-list">
          {stages.map((stage) => {
            const collapsed = collapsedStages.has(stage.id)
            return (
              <div
                className={`po-plan-stage-group${selectedStage === stage.id ? ' is-selected' : ''}`}
                key={stage.id}
                ref={(node) => { stageRefs.current[stage.id] = node }}
              >
                <button type="button" className="po-plan-stage-group-head" onClick={() => { setSelectedStage(stage.id); toggleStage(stage.id) }} aria-expanded={!collapsed}>
                  <span>{collapsed ? <RightOutlined /> : <DownOutlined />}</span>
                  <strong>{stage.title}</strong>
                  <em>{stage.entries.length} 个任务</em>
                  {stage.hasRisk ? <WarningOutlined className="is-risk" /> : null}
                </button>
                {collapsed ? null : stage.entries.map((entry) => {
                  const risk = entry.task.assignmentBlocked || dependencyIssues.some((issue) => issue.taskKey === entry.task.key)
                  const agent = agentOptions.find((option) => option.value === entry.task.agentId)
                  return (
                    <button
                      type="button"
                      className={`po-plan-compact-task${selectedTaskKey === entry.task.key ? ' is-selected' : ''}`}
                      key={entry.task.key}
                      onClick={() => openTask(entry.task.key)}
                      data-testid={`plan-task-${entry.task.key}`}
                    >
                      <span className="po-plan-task-number">{String(entry.index + 1).padStart(2, '0')}</span>
                      <strong>{entry.task.title}</strong>
                      <span className="po-plan-compact-agent">{shortAgentLabel(agent?.label)}</span>
                      {risk ? <Tag color="error">需复核</Tag> : null}
                      {!risk && entry.task.dependsOn.length ? <Tag>{entry.task.dependsOn.length} 前置</Tag> : null}
                      <RightOutlined className="po-plan-compact-arrow" />
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </section>

      <Drawer
        open={Boolean(selectedTask)}
        onClose={() => setSelectedTaskKey(null)}
        width={560}
        zIndex={2000}
        mask={false}
        rootStyle={{ top: 64, height: 'calc(100% - 150px)' }}
        title={selectedTask ? `${selectedIndex + 1}. ${selectedTask.title}` : '任务详情'}
        className="po-plan-task-drawer"
        destroyOnHidden
      >
        {selectedTask ? (
          <div className="po-plan-task-detail">
            <label>任务名称<Input value={selectedTask.title} disabled={draft.status !== 'draft'} onChange={(event) => updateSelected({ title: event.target.value })} /></label>
            <label>任务描述<Input.TextArea rows={3} value={selectedTask.description} disabled={draft.status !== 'draft'} onChange={(event) => updateSelected({ description: event.target.value })} /></label>
            <div className="po-plan-task-detail-row">
              <label>任务类型
                <Select
                  value={selectedTask.role}
                  disabled={draft.status !== 'draft'}
                  options={Object.entries(roleLabels).map(([value, label]) => ({ value, label }))}
                  onChange={(role) => {
                    if (role === 'custom') {
                      onOpenCustomAgent(selectedTask.key)
                      return
                    }
                    updateSelected({ role: role as PlanRole })
                  }}
                />
              </label>
              <label>Agent
                <Select
                  allowClear
                  value={selectedTask.agentId ?? undefined}
                  placeholder="角色默认"
                  disabled={draft.status !== 'draft'}
                  options={agentOptions}
                  onChange={(agentId) => {
                    if (agentId === '__custom__') {
                      onOpenCustomAgent(selectedTask.key)
                      return
                    }
                    updateSelected({ agentId: agentId ?? null, assignmentBlocked: false, assignmentReasons: agentId ? ['用户手动指定'] : [] })
                  }}
                />
              </label>
            </div>
            <label>前置依赖
              <Select
                mode="multiple"
                value={selectedTask.dependsOn}
                disabled={draft.status !== 'draft'}
                placeholder="选择前置任务"
                options={draft.tasks.filter((task) => task.key !== selectedTask.key).map((task) => ({ value: task.key, label: task.title }))}
                onChange={(dependsOn) => updateSelected({ dependsOn })}
              />
            </label>
            <label>验收标准
              <Select mode="tags" value={selectedTask.acceptanceCriteria} disabled={draft.status !== 'draft'} tokenSeparators={['\n']} placeholder="回车添加一条可检验标准" onChange={(acceptanceCriteria) => updateSelected({ acceptanceCriteria })} />
            </label>
            <label>预期交付物
              <Select mode="tags" value={selectedTask.expectedArtifacts} disabled={draft.status !== 'draft'} tokenSeparators={['\n']} placeholder="回车添加交付物" onChange={(expectedArtifacts) => updateSelected({ expectedArtifacts })} />
            </label>
            <div className="po-plan-task-detail-row">
              <label>能力需求
                <Select
                  mode="multiple"
                  value={selectedTask.requiredCapabilities ?? []}
                  disabled={draft.status !== 'draft'}
                  options={AGENT_CAPABILITIES.map((capability) => ({ value: capability, label: capability }))}
                  onChange={(requiredCapabilities) => updateSelected({ requiredCapabilities: requiredCapabilities as AgentCapability[] })}
                />
              </label>
              <label>硬性能力
                <Select
                  mode="multiple"
                  value={selectedTask.hardCapabilities ?? []}
                  disabled={draft.status !== 'draft'}
                  options={AGENT_CAPABILITIES.map((capability) => ({ value: capability, label: capability }))}
                  onChange={(hardCapabilities) => updateSelected({ hardCapabilities: hardCapabilities as AgentCapability[] })}
                />
              </label>
            </div>
            <div className="po-plan-task-detail-row is-inline">
              <label>执行前人工审批 <Switch checked={selectedTask.requiresApproval} disabled={draft.status !== 'draft'} onChange={(requiresApproval) => updateSelected({ requiresApproval })} /></label>
              {draft.status === 'draft' ? (
                <Button danger type="text" icon={<DeleteOutlined />} onClick={() => { onRemoveTask(selectedTask.key); setSelectedTaskKey(null) }}>删除任务</Button>
              ) : null}
            </div>
            {selectedTask.rationale ? <div className="po-plan-task-rationale"><InfoCircleOutlined /><span>{selectedTask.rationale}</span></div> : null}
            {selectedTask.assignmentBlocked ? (
              <Alert type="error" showIcon message="该任务暂时无法分配 Agent" description={selectedTask.assignmentReasons.join('；')} />
            ) : null}
            {dependencyIssues.filter((issue) => issue.taskKey === selectedTask.key).map((issue) => (
              <Alert key={`${issue.kind}-${issue.detail}`} type="error" showIcon message="依赖关系需要修正" description={issue.detail} />
            ))}
            {selectedTask.assignmentReasons.length ? <p className="po-plan-task-detail-note">{selectedTask.assignmentReasons.join('；')}</p> : null}
          </div>
        ) : null}
      </Drawer>
    </div>
  )
}

