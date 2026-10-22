import { useEffect, useMemo, useRef, useState, type ReactNode, type ReactElement } from 'react'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AnimatePresence, motion } from 'motion/react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import * as Tabs from '@radix-ui/react-tabs'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Eye,
  FlaskConical,
  Layers3,
  Pencil,
  Plus,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import {
  AGENT_CAPABILITIES,
  type AgentCapability,
  type PlanDraft,
  type PlanRole,
  type PlannedTask,
} from '@projectos/contracts'
import { computeStages, planDependencyIssues, type Stage } from './plan-review-logic'
import { cn } from '../../../next-ui/cn'
import { Button } from '../../../next-ui/ui/button'
import { Badge } from '../../../next-ui/ui/badge'
import { ScrollArea } from '../../../next-ui/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../next-ui/ui/dialog'
import { TooltipContent, TooltipProvider, TooltipTrigger } from '../../../next-ui/ui/tooltip'

type AgentOption = { value: string; label: string }

function roleIcon(role: PlanRole): ReactNode {
  if (role === 'architect') return <Layers3 size={14} />
  if (role === 'developer') return <Code2 size={14} />
  if (role === 'reviewer') return <Eye size={14} />
  if (role === 'tester') return <FlaskConical size={14} />
  return <UserRound size={14} />
}

function shortAgent(label: string | undefined): string {
  return label?.split(' · ')[0] ?? '角色默认'
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 1120)
  useEffect(() => {
    const update = (): void => setNarrow(window.innerWidth < 1120)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return narrow
}

type TaskFlowData = { task: PlannedTask; index: number; role: string; agent: string; risk: boolean; selected: boolean; related: boolean }

function NextTaskNode({ data }: NodeProps<Node<TaskFlowData>>) {
  return (
    <div
      className={cn(
        'w-[248px] rounded-[13px] border bg-[linear-gradient(180deg,var(--pui-surface-strong),var(--pui-surface))] px-3 py-2.5 text-left shadow-[0_12px_28px_-24px_rgba(20,45,85,.55)] transition-[border-color,box-shadow,transform] duration-200',
        data.selected ? 'border-[var(--pui-accent)] shadow-[0_0_0_3px_var(--pui-accent-soft),0_16px_30px_-24px_rgba(20,45,85,.6)]' : data.related ? 'border-[color-mix(in_srgb,var(--pui-accent)_40%,var(--pui-border))]' : 'border-[var(--pui-border)]',
        data.risk && 'border-[color-mix(in_srgb,var(--pui-danger)_45%,var(--pui-border))]',
      )}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-2 !border-[color-mix(in_srgb,var(--pui-accent)_45%,var(--pui-border))] !bg-[var(--pui-surface-strong)]" />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium tracking-[.06em] text-[var(--pui-ink-muted)]">TASK {String(data.index + 1).padStart(2, '0')} · {data.role}</span>
        {data.risk ? <Badge tone="danger">需复核</Badge> : null}
      </div>
      <div className="mt-1.5 line-clamp-2 min-h-[34px] text-[12.5px] font-medium leading-[1.4] text-[var(--pui-ink)]" title={data.task.title}>{data.task.title}</div>
      <div className="mt-2 flex items-center justify-between border-t border-[var(--pui-border)] pt-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">
        <span className="flex items-center gap-1.5 truncate"><i className="flex size-4 items-center justify-center rounded-full bg-[var(--pui-accent-soft)] text-[10px] font-semibold not-italic text-[var(--pui-accent)]">{data.agent.slice(0, 1)}</i>{data.agent}</span>
        <span>{data.task.dependsOn.length ? `${data.task.dependsOn.length} 前置` : '起点'}</span>
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-2 !border-[color-mix(in_srgb,var(--pui-accent)_45%,var(--pui-border))] !bg-[var(--pui-surface-strong)]" />
    </div>
  )
}

const nodeTypes = { task: NextTaskNode }

export function PlanReviewNext({
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
}): ReactElement {
  const narrow = useNarrow()
  const stages = useMemo(() => computeStages(draft.tasks, roleLabels), [draft.tasks, roleLabels])
  const issues = useMemo(() => planDependencyIssues(draft.tasks), [draft.tasks])
  const blockingTasks = draft.tasks.filter((task) => task.assignmentBlocked)
  const blocking = blockingTasks.length + issues.length
  const risks: Array<{ key: string; taskKey: string | null; blocking: boolean; text: string }> = [
    ...blockingTasks.map((task) => ({ key: task.key, taskKey: task.key, blocking: true, text: `${task.title}：${task.assignmentReasons.join('；') || '无法分配 Agent'}` })),
    ...issues.map((issue) => ({ key: issue.taskKey, taskKey: issue.taskKey, blocking: true, text: `${issue.detail}（${issue.taskKey}）` })),
    ...draft.risks.map((risk, index) => ({ key: `risk-${index}`, taskKey: null, blocking: false, text: risk })),
  ]
  const [selectedTaskKey, setSelectedTaskKey] = useState<string | null>(null)
  const [selectedStage, setSelectedStage] = useState(stages[0]?.id ?? '')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editingGoal, setEditingGoal] = useState(false)
  const [goalDraft, setGoalDraft] = useState(draft.goal)
  const [riskOpen, setRiskOpen] = useState(true)
  const stageRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const selected = draft.tasks.find((task) => task.key === selectedTaskKey) ?? null
  const selectedIndex = selected ? draft.tasks.findIndex((task) => task.key === selected.key) : -1

  useEffect(() => setGoalDraft(draft.goal), [draft.goal])

  useEffect(() => {
    if (!selectedTaskKey) return
    const containing = stages.find((stage) => stage.entries.some((entry) => entry.task.key === selectedTaskKey))
    if (containing) setSelectedStage(containing.id)
  }, [selectedTaskKey, stages])

  const openTask = (key: string): void => {
    setSelectedTaskKey(key)
    const containing = stages.find((stage) => stage.entries.some((entry) => entry.task.key === key))
    if (containing) setSelectedStage(containing.id)
  }

  const selectStage = (stage: Stage): void => {
    setSelectedStage(stage.id)
    setCollapsed((current) => { const next = new Set(current); next.delete(stage.id); return next })
    window.setTimeout(() => stageRefs.current[stage.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }

  const flow = useMemo(() => {
    const level = new Map(stages.flatMap((stage) => stage.entries.map((entry) => [entry.task.key, entry.level] as const)))
    const row = new Map<number, number>()
    const positions = new Map<string, { x: number; y: number }>()
    for (const task of draft.tasks) {
      const l = level.get(task.key) ?? 0
      const index = row.get(l) ?? 0
      row.set(l, index + 1)
      positions.set(task.key, { x: l * 326, y: index * 124 })
    }
    const related = new Set<string>()
    if (selected) {
      const up = (key: string): void => {
        const task = draft.tasks.find((item) => item.key === key)
        for (const dependency of task?.dependsOn ?? []) { related.add(dependency); up(dependency) }
      }
      const down = (key: string): void => {
        for (const task of draft.tasks) if (task.dependsOn.includes(key) && !related.has(task.key)) { related.add(task.key); down(task.key) }
      }
      up(selected.key)
      down(selected.key)
    }
    const nodes: Array<Node<TaskFlowData>> = draft.tasks.map((task, index) => ({
      id: task.key,
      type: 'task',
      position: positions.get(task.key) ?? { x: 0, y: 0 },
      data: {
        task,
        index,
        role: roleLabels[task.role] ?? task.role,
        agent: shortAgent(agentOptions.find((option) => option.value === task.agentId)?.label),
        risk: task.assignmentBlocked || issues.some((issue) => issue.taskKey === task.key),
        selected: selectedTaskKey === task.key,
        related: related.has(task.key),
      },
    }))
    const edges: Edge[] = []
    for (const task of draft.tasks) {
      for (const dependency of task.dependsOn) {
        if (!draft.tasks.some((item) => item.key === dependency)) continue
        const relatedEdge = !selected || dependency === selected.key || task.key === selected.key || (related.has(dependency) && related.has(task.key))
        edges.push({
          id: `${dependency}->${task.key}`,
          source: dependency,
          target: task.key,
          type: 'smoothstep',
          className: relatedEdge ? 'pui-edge-related' : 'pui-edge-dimmed',
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: relatedEdge ? '#7f99bb' : '#aeb9c8' },
          style: { stroke: relatedEdge ? 'rgba(103,132,172,.8)' : 'rgba(150,164,184,.34)', strokeWidth: relatedEdge ? 1.5 : 1 },
        })
      }
    }
    return { nodes, edges }
  }, [agentOptions, draft.tasks, issues, roleLabels, selected, selectedTaskKey, stages])

  const setTask = (patch: Partial<PlannedTask>): void => {
    if (selectedIndex >= 0) onUpdateTask(selectedIndex, patch)
  }

  const createAgentFor = (taskKey: string): void => {
    // The task detail is a Radix modal and Agent Studio is an existing Ant
    // modal. Close the sheet first so focus traps and pointer layers do not
    // compete, then let the parent open Agent Studio for this task.
    setSelectedTaskKey(null)
    window.setTimeout(() => onOpenCustomAgent(taskKey), 100)
  }

  const summaryPath = stages.map((stage) => stage.title).join(' → ')

  return (
    <TooltipProvider>
      <div className="pui-root flex h-full min-h-0 flex-col gap-0 text-[var(--pui-ink)]" data-testid="plan-review-workbench">
        <header className="po-plan-review-overview flex shrink-0 items-start justify-between gap-6 border-b border-[var(--pui-border)] px-1 pb-3 pt-1">
          <div className="min-w-0">
            <div className="pui-kicker">Plan review · R{draft.revision}</div>
            {editingGoal ? (
              <div className="mt-1 flex max-w-[760px] flex-col gap-2">
                <textarea
                  className="pui-control min-h-[58px] w-full resize-y px-3 py-2 leading-relaxed"
                  value={goalDraft}
                  onChange={(event) => setGoalDraft(event.target.value)}
                  aria-label="计划目标"
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setGoalDraft(draft.goal); setEditingGoal(false) }}><X size={13} />取消</Button>
                  <Button size="sm" variant="primary" disabled={!goalDraft.trim()} onClick={() => { onUpdateGoal(goalDraft.trim()); setEditingGoal(false) }}><Check size={13} />保存目标</Button>
                </div>
              </div>
            ) : (
              <div className="mt-0.5 flex items-start gap-2">
                <h1 className="line-clamp-2 max-w-[820px] text-[21px] font-semibold leading-[1.32] tracking-[-0.015em] text-[var(--pui-ink)]" title={draft.goal}>{draft.goal}</h1>
                {draft.status === 'draft' ? (
                  <Button size="icon" variant="ghost" className="mt-0.5 text-[var(--pui-ink-muted)]" aria-label="编辑计划目标" onClick={() => { setGoalDraft(draft.goal); setEditingGoal(true) }}><Pencil size={13} /></Button>
                ) : null}
              </div>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-[var(--pui-ink-muted)]">
              <span>{summaryPath || '单任务'}</span><span>·</span><span>{draft.tasks.length} 个任务</span><span>·</span><span className={risks.length ? 'text-[var(--pui-warning)]' : ''}>{risks.length ? `${risks.length} 项提醒` : '无待处理项'}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-start gap-5 pt-1">
            {[['任务', draft.tasks.length], ['阶段', stages.length], ['待复核', risks.length], ['版本', `r${draft.revision}`]].map(([label, value]) => (
              <div key={String(label)} className="flex min-w-[46px] flex-col gap-0.5">
                <strong className={cn('pui-metric-value', label === '待复核' && blocking > 0 && 'text-[var(--pui-danger)]')}>{value}</strong>
                <span className="text-[11.5px] text-[var(--pui-ink-muted)]">{label}</span>
              </div>
            ))}
          </div>
        </header>

        <Tabs.Root defaultValue="route" className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-3 py-2.5">
            <Tabs.List className="inline-flex items-center gap-0.5 rounded-[10px] border border-[var(--pui-border)] bg-[var(--pui-surface-muted)] p-[3px]" aria-label="计划视图">
              <Tabs.Trigger value="route" className="inline-flex h-6 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] text-[var(--pui-ink-muted)] outline-none transition-colors hover:text-[var(--pui-ink)] data-[state=active]:bg-[var(--pui-surface-strong)] data-[state=active]:text-[var(--pui-ink)]"><ArrowRight size={13} />阶段路线</Tabs.Trigger>
              <Tabs.Trigger value="dag" className="inline-flex h-6 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] text-[var(--pui-ink-muted)] outline-none transition-colors hover:text-[var(--pui-ink)] data-[state=active]:bg-[var(--pui-surface-strong)] data-[state=active]:text-[var(--pui-ink)]"><Layers3 size={13} />任务依赖</Tabs.Trigger>
            </Tabs.List>
            <div className="flex items-center gap-2">
              <Badge tone={blocking ? 'danger' : risks.length ? 'accent' : 'success'}>{blocking ? `${blocking} 项阻塞` : risks.length ? '有提醒，可批准' : '校验通过'}</Badge>
              <details className="po-plan-generation-details relative text-[11.5px] text-[var(--pui-ink-muted)]">
                <summary className="cursor-pointer list-none text-[var(--pui-accent)]">生成详情 <ChevronDown size={12} className="inline" /></summary>
                <div className="pui-glass absolute right-0 z-20 mt-2 w-[320px] rounded-xl p-3 text-[11.5px] leading-relaxed">
                  <div>{draft.generatedBy === 'provider' ? `${draft.generation?.connectionName ?? '默认连接'} · ${draft.generation?.model ?? '来源未记录'}` : '本地规则模板（未调用模型）'}</div>
                  <div className="mt-1">耗时 {draft.generation ? `${Math.max(1, Math.round(draft.generation.durationMs / 1000))}s` : '—'} · 尝试 {draft.generation?.attempts ?? 0} 次 · 上下文 {draft.generation?.contextSources.length ?? 0} 项</div>
                  {draft.assumptions.length ? <div className="mt-1">假设：{draft.assumptions.join('；')}</div> : null}
                  {draft.generation?.warnings.length ? <div className="mt-1 text-[var(--pui-warning)]">历史提示：{draft.generation.warnings.join('；')}</div> : null}
                </div>
              </details>
            </div>
          </div>

          <Group orientation={narrow ? 'vertical' : 'horizontal'} className="min-h-0 flex-1">
            <Panel defaultSize={narrow ? '68%' : '76%'} minSize="45%" className="min-h-0">
              <div className="flex h-full min-h-0 flex-col gap-3">
                <Tabs.Content value="route" className="min-h-0 outline-none">
                  <div className="pui-scroll flex min-h-[104px] gap-0 overflow-x-auto pb-1 pt-0.5" data-testid="plan-stage-route">
                    {stages.map((stage, index) => (
                      <div key={stage.id} className="flex min-w-[190px] flex-1 items-center">
                        <Tooltip.Root>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              aria-label={`${stage.title}，${stage.entries.length} 个任务`}
                              onClick={() => selectStage(stage)}
                              className={cn(
                                'po-stage-card group relative flex min-h-[98px] w-full flex-col items-start gap-1 rounded-[13px] border bg-[color-mix(in_srgb,var(--pui-surface-strong)_76%,transparent)] p-3 text-left transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:bg-[var(--pui-surface-strong)]',
                                selectedStage === stage.id ? 'border-[color-mix(in_srgb,var(--pui-accent)_62%,var(--pui-border))] shadow-[0_0_0_3px_var(--pui-accent-soft)]' : 'border-[var(--pui-border)]',
                                stage.hasRisk && 'border-[color-mix(in_srgb,var(--pui-danger)_42%,var(--pui-border))]',
                              )}
                            >
                              <span className="flex w-full items-center gap-2">
                                <span className="flex size-7 items-center justify-center rounded-lg border border-[var(--pui-border)] bg-[var(--pui-accent-soft)] text-[var(--pui-accent)]">{roleIcon(stage.roles[0] ?? 'custom')}</span>
                                <span className="ml-auto font-mono text-[11px] text-[var(--pui-ink-muted)]">{String(index + 1).padStart(2, '0')}</span>
                                {stage.hasRisk ? <AlertTriangle size={13} className="text-[var(--pui-danger)]" /> : null}
                              </span>
                              <strong className="mt-1 text-[14px] font-semibold text-[var(--pui-ink)]">{stage.title}</strong>
                              <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]"><span>{stage.entries.length} 个任务</span><em className="rounded-full bg-[var(--pui-accent-soft)] px-1.5 py-px not-italic text-[var(--pui-accent)]">{stage.entries.length > 1 ? '并行' : roleLabels[stage.roles[0] ?? 'custom']}</em></span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent><div className="space-y-1">{stage.entries.map((entry) => <div key={entry.task.key}>{entry.task.title}</div>)}</div></TooltipContent>
                        </Tooltip.Root>
                        {index < stages.length - 1 ? <ChevronRight size={14} className="mx-0.5 shrink-0 text-[var(--pui-ink-muted)] opacity-50" /> : null}
                      </div>
                    ))}
                  </div>
                </Tabs.Content>

                <Tabs.Content value="dag" className="min-h-0 outline-none">
                  <div data-testid="plan-task-dag" className="h-[286px] overflow-hidden rounded-[13px] border border-[var(--pui-border)] bg-[color-mix(in_srgb,var(--pui-surface-muted)_78%,transparent)]">
                    <ReactFlow
                      nodes={flow.nodes}
                      edges={flow.edges}
                      nodeTypes={nodeTypes}
                      fitView={false}
                      defaultViewport={{ x: 12, y: 32, zoom: 0.78 }}
                      minZoom={0.35}
                      maxZoom={1.5}
                      nodesDraggable={false}
                      nodesConnectable={false}
                      elementsSelectable
                      onNodeClick={(_event, node) => openTask(node.id)}
                      proOptions={{ hideAttribution: true }}
                    >
                      <Background gap={20} size={1} color="rgba(120,145,175,.15)" />
                      <Controls showInteractive={false} />
                    </ReactFlow>
                  </div>
                </Tabs.Content>

                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-1.5 flex items-end justify-between gap-3">
                    <div><h2 className="text-[13px] font-semibold text-[var(--pui-ink)]">任务清单</h2><p className="mt-0.5 text-[11.5px] text-[var(--pui-ink-muted)]">点击任务查看完整字段</p></div>
                    {draft.status === 'draft' ? <Button size="sm" variant="ghost" onClick={onAddTask}><Plus size={13} />添加任务</Button> : null}
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="flex flex-col gap-1.5 pr-1" data-testid="plan-task-list">
                      {stages.map((stage) => {
                        const isCollapsed = collapsed.has(stage.id)
                        return (
                          <div key={stage.id} ref={(node) => { stageRefs.current[stage.id] = node }} className={cn('overflow-hidden rounded-[11px] border bg-[color-mix(in_srgb,var(--pui-surface-strong)_55%,transparent)]', selectedStage === stage.id ? 'border-[color-mix(in_srgb,var(--pui-accent)_38%,var(--pui-border))]' : 'border-[var(--pui-border)]')}>
                            <button type="button" className="flex h-8 w-full items-center gap-2 bg-[color-mix(in_srgb,var(--pui-ink-muted)_4%,transparent)] px-2.5 text-left" onClick={() => { setSelectedStage(stage.id); setCollapsed((current) => { const next = new Set(current); if (next.has(stage.id)) next.delete(stage.id); else next.add(stage.id); return next }) }} aria-expanded={!isCollapsed}>
                              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<strong className="text-[12.5px] font-medium">{stage.title}</strong><span className="text-[11.5px] text-[var(--pui-ink-muted)]">{stage.entries.length} 个任务</span>
                            </button>
                            {isCollapsed ? null : stage.entries.map((entry) => {
                              const risk = entry.task.assignmentBlocked || issues.some((issue) => issue.taskKey === entry.task.key)
                              return (
                                <button type="button" key={entry.task.key} data-testid={`plan-task-${entry.task.key}`} onClick={() => openTask(entry.task.key)} className={cn('po-plan-compact-task flex h-[36px] w-full items-center gap-2 border-t border-[var(--pui-border)] px-3 text-left transition-colors hover:bg-[var(--pui-accent-soft)]', selectedTaskKey === entry.task.key && 'bg-[var(--pui-accent-soft)]')}>
                                  <span className="w-5 shrink-0 font-mono text-[11px] text-[var(--pui-ink-muted)]">{String(entry.index + 1).padStart(2, '0')}</span>
                                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{entry.task.title}</span>
                                  <span className="max-w-[110px] truncate text-[11.5px] text-[var(--pui-ink-muted)]">{shortAgent(agentOptions.find((option) => option.value === entry.task.agentId)?.label)}</span>
                                  {risk ? <Badge tone="danger">需复核</Badge> : entry.task.dependsOn.length ? <span className="text-[11px] text-[var(--pui-ink-muted)]">{entry.task.dependsOn.length} 前置</span> : null}
                                  <ChevronRight size={12} className="text-[var(--pui-ink-muted)] opacity-60" />
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </Panel>
            <Separator className={cn('group relative shrink-0', narrow ? 'h-2' : 'w-2')}>
              <div className={cn('absolute rounded-full bg-[var(--pui-border)] transition-colors group-hover:bg-[var(--pui-accent)]', narrow ? 'left-1/2 top-0.5 h-1 w-10 -translate-x-1/2' : 'left-0.5 top-1/2 h-10 w-1 -translate-y-1/2')} />
            </Separator>
            <Panel defaultSize={narrow ? '32%' : '24%'} minSize="18%" className="min-h-0">
              <aside className="pui-scroll flex h-full min-h-0 flex-col gap-2 overflow-auto pl-1">
                <div className="rounded-[13px] border border-[var(--pui-border)] bg-[color-mix(in_srgb,var(--pui-surface-strong)_72%,transparent)] p-3">
                  <div className="flex items-center justify-between gap-2"><span className="text-[11.5px] text-[var(--pui-ink-muted)]">审批状态</span><strong className={cn('text-[12px] font-semibold', blocking ? 'text-[var(--pui-danger)]' : 'text-[var(--pui-success)]')}>{blocking ? '待修复' : risks.length ? '可批准 · 有提醒' : '可批准'}</strong></div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-[var(--pui-ink-muted)]"><span>阻塞 {blocking}</span><span>任务 {draft.tasks.length}</span><span>阶段 {stages.length}</span></div>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--pui-ink-muted)]">批准只创建任务与依赖，不会启动 Agent；执行需单独授权。</p>
                </div>
                <div className="overflow-hidden rounded-[13px] border border-[var(--pui-border)]">
                  <button type="button" className="po-plan-risk-summary flex w-full items-center gap-2 px-3 py-2.5 text-left" onClick={() => setRiskOpen((open) => !open)} aria-expanded={riskOpen}>
                    <AlertTriangle size={14} className={risks.length ? 'text-[var(--pui-warning)]' : 'text-[var(--pui-ink-muted)]'} />
                    <span className="flex-1 text-[12px]">{risks.length ? `${risks.length} 项需复核` : '无待处理项'}</span><ChevronDown size={12} className={cn('transition-transform', riskOpen && 'rotate-180')} />
                  </button>
                  <AnimatePresence initial={false}>
                    {riskOpen ? (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }} className="overflow-hidden">
                        <div className="border-t border-[var(--pui-border)] p-1.5" data-testid="plan-risk-list">
                          {risks.length ? risks.map((risk) => risk.taskKey ? (
                            <button type="button" key={risk.key} onClick={() => openTask(risk.taskKey!)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-[var(--pui-accent-soft)]"><span className={cn('w-7 shrink-0 text-[11px]', risk.blocking ? 'text-[var(--pui-danger)]' : 'text-[var(--pui-ink-muted)]')}>{risk.blocking ? '阻塞' : '提醒'}</span><span className="flex-1 text-[11.5px] leading-relaxed">{risk.text}</span><ChevronRight size={12} className="mt-0.5 shrink-0 text-[var(--pui-accent)]" /></button>
                          ) : (
                            <div key={risk.key} className="flex items-start gap-2 px-2 py-1.5"><span className="w-7 shrink-0 text-[11px] text-[var(--pui-ink-muted)]">提醒</span><span className="flex-1 text-[11.5px] leading-relaxed">{risk.text}</span></div>
                          )) : <p className="px-2 py-2 text-[11.5px] text-[var(--pui-ink-muted)]">校验通过，可以继续审核任务。</p>}
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </aside>
            </Panel>
          </Group>
        </Tabs.Root>

        <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelectedTaskKey(null) }}>
          <AnimatePresence>
            {selected ? (
              <DialogContent side="right" className="po-plan-task-detail">
                <div className="flex h-full flex-col">
                  <div className="flex shrink-0 items-start gap-3 border-b border-[var(--pui-border)] px-5 py-4 pr-12">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--pui-accent-soft)] text-[var(--pui-accent)]">{roleIcon(selected.role)}</div>
                    <div className="min-w-0"><DialogTitle className="text-[14px] font-semibold leading-snug">{selectedIndex + 1}. {selected.title}</DialogTitle><DialogDescription className="mt-1 text-[11.5px] text-[var(--pui-ink-muted)]">{roleLabels[selected.role]} · {selected.key}</DialogDescription></div>
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="pui-scroll flex flex-col gap-3 px-5 py-4">
                      <label className="flex flex-col gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">任务名称<input className="pui-control px-2.5" value={selected.title} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ title: event.target.value })} /></label>
                      <label className="flex flex-col gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">任务描述<textarea className="pui-control min-h-[72px] resize-y px-2.5 py-2 leading-relaxed" value={selected.description} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ description: event.target.value })} /></label>
                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="flex flex-col gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">任务类型<select className="pui-control px-2" value={selected.role} disabled={draft.status !== 'draft'} onChange={(event) => { if (event.target.value === 'custom') { createAgentFor(selected.key); return } setTask({ role: event.target.value as PlanRole }) }}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                        <label className="flex flex-col gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">Agent<select className="pui-control px-2" value={selected.agentId ?? ''} disabled={draft.status !== 'draft'} onChange={(event) => { if (event.target.value === '__custom__') { createAgentFor(selected.key); return } setTask({ agentId: event.target.value || null, assignmentBlocked: false, assignmentReasons: event.target.value ? ['用户手动指定'] : [] }) }}><option value="">角色默认</option>{agentOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      </div>
                      <label className="flex flex-col gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">前置依赖<select multiple className="pui-control min-h-[64px] px-2 py-1.5" value={selected.dependsOn} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ dependsOn: [...event.target.selectedOptions].map((option) => option.value) })}>{draft.tasks.filter((task) => task.key !== selected.key).map((task) => <option key={task.key} value={task.key}>{task.title}</option>)}</select></label>
                      <label className="flex flex-col gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">验收标准<textarea className="pui-control min-h-[64px] resize-y px-2.5 py-2 leading-relaxed" value={selected.acceptanceCriteria.join('\n')} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ acceptanceCriteria: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label>
                      <label className="flex flex-col gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">预期交付物<textarea className="pui-control min-h-[56px] resize-y px-2.5 py-2 leading-relaxed" value={selected.expectedArtifacts.join('\n')} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ expectedArtifacts: event.target.value.split('\n').map((item) => item.trim()).filter(Boolean) })} /></label>
                      <div className="grid grid-cols-2 gap-2.5">
                        <label className="flex flex-col gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">能力需求<select multiple className="pui-control min-h-[66px] px-2 py-1.5" value={selected.requiredCapabilities ?? []} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ requiredCapabilities: [...event.target.selectedOptions].map((option) => option.value) as AgentCapability[] })}>{AGENT_CAPABILITIES.map((capability) => <option key={capability} value={capability}>{capability}</option>)}</select></label>
                        <label className="flex flex-col gap-1.5 text-[11.5px] text-[var(--pui-ink-muted)]">硬性能力<select multiple className="pui-control min-h-[66px] px-2 py-1.5" value={selected.hardCapabilities ?? []} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ hardCapabilities: [...event.target.selectedOptions].map((option) => option.value) as AgentCapability[] })}>{AGENT_CAPABILITIES.map((capability) => <option key={capability} value={capability}>{capability}</option>)}</select></label>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[11.5px] text-[var(--pui-ink-secondary)]"><label className="flex items-center gap-2"><input type="checkbox" checked={selected.requiresApproval} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ requiresApproval: event.target.checked })} />执行前人工审批</label>{draft.status === 'draft' ? <Button size="sm" variant="danger" onClick={() => { onRemoveTask(selected.key); setSelectedTaskKey(null) }}><Trash2 size={13} />删除任务</Button> : null}</div>
                      {selected.rationale ? <div className="po-plan-task-rationale rounded-lg border border-[var(--pui-border)] bg-[var(--pui-surface-muted)] p-2.5 text-[11.5px] leading-relaxed text-[var(--pui-ink-secondary)]">{selected.rationale}</div> : null}
                      {selected.assignmentBlocked ? <div className="rounded-lg border border-[color-mix(in_srgb,var(--pui-danger)_30%,var(--pui-border))] bg-[var(--pui-danger-soft)] p-2.5 text-[11.5px] text-[var(--pui-danger)]">{selected.assignmentReasons.join('；') || '该任务暂时无法分配 Agent'}</div> : null}
                    </div>
                  </ScrollArea>
                </div>
              </DialogContent>
            ) : null}
          </AnimatePresence>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}






