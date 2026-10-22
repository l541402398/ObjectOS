import { useEffect, useMemo, useRef, useState, type ReactNode, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import * as Tabs from '@radix-ui/react-tabs'
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
  Sparkles,
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
import { StageJourney } from './StageJourney'
import { TaskGraph } from './TaskGraph'

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
  const selectedAgentLabel = agentOptions.find((option) => option.value === selected?.agentId)?.label ?? '角色默认'

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
  const activeStage = stages.find((stage) => stage.id === selectedStage) ?? stages[0]

  return (
    <>
      <div className="pui-root relative isolate flex h-full min-h-0 flex-col gap-0 overflow-hidden rounded-[20px] text-[var(--pui-ink)]" data-testid="plan-review-workbench">
        <div className="pui-ambient" />
        <motion.div
          initial={{ opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-[1] flex h-full min-h-0 flex-col"
        >
        <header className="po-plan-review-overview relative flex shrink-0 items-start justify-between gap-6 border-b border-[var(--pui-border)] pb-3 pl-8 pr-1 pt-1">
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
                  <StageJourney stages={stages} activeStage={selectedStage} onSelect={selectStage} roleLabels={roleLabels} />
                  {activeStage ? (
                    <div className="pui-focus-row">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-[var(--pui-accent-soft)] text-[var(--pui-accent)]"><Sparkles size={14} /></span>
                      <div className="min-w-0 flex-1"><div className="truncate text-[12.5px] font-medium text-[var(--pui-ink)]">{activeStage.title} · {activeStage.entries.length} 个任务</div><div className="truncate text-[11px] text-[var(--pui-ink-muted)]">{activeStage.entries.map((entry) => entry.task.title).join(' / ')}</div></div>
                      {activeStage.entries[0] ? <button type="button" className="flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-[var(--pui-accent)]" onClick={() => openTask(activeStage.entries[0]!.task.key)}>查看任务<ChevronRight size={12} /></button> : null}
                    </div>
                  ) : null}
                </Tabs.Content>

                <Tabs.Content value="dag" className="min-h-0 outline-none">
                  <TaskGraph tasks={draft.tasks} stages={stages} activeStage={selectedStage} selectedTaskKey={selectedTaskKey} agentLabels={Object.fromEntries(agentOptions.map((option) => [option.value, option.label]))} onSelect={openTask} />
                </Tabs.Content>

                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-1.5 flex items-end justify-between gap-3">
                    <div><h2 className="text-[13px] font-semibold text-[var(--pui-ink)]">任务清单</h2><p className="mt-0.5 text-[11.5px] text-[var(--pui-ink-muted)]">点击任务查看完整字段</p></div>
                    {draft.status === 'draft' ? <Button size="sm" variant="ghost" onClick={onAddTask}><Plus size={13} />添加任务</Button> : null}
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="pui-ledger flex flex-col" data-testid="plan-task-list">
                      {stages.map((stage) => {
                        const isCollapsed = collapsed.has(stage.id)
                        return (
                          <div key={stage.id} ref={(node) => { stageRefs.current[stage.id] = node }} className="border-t border-[var(--pui-border)] first:border-t-0">
                            <button type="button" className="flex h-8 w-full items-center gap-2 bg-[color-mix(in_srgb,var(--pui-ink-muted)_4%,transparent)] px-2.5 text-left" onClick={() => { setSelectedStage(stage.id); setCollapsed((current) => { const next = new Set(current); if (next.has(stage.id)) next.delete(stage.id); else next.add(stage.id); return next }) }} aria-expanded={!isCollapsed}>
                              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<strong className="text-[12.5px] font-medium">{stage.title}</strong><span className="text-[11.5px] text-[var(--pui-ink-muted)]">{stage.entries.length} 个任务</span>
                            </button>
                            {isCollapsed ? null : stage.entries.map((entry) => {
                              const risk = entry.task.assignmentBlocked || issues.some((issue) => issue.taskKey === entry.task.key)
                              return (
                                <button type="button" key={entry.task.key} data-testid={`plan-task-${entry.task.key}`} onClick={() => openTask(entry.task.key)} data-selected={selectedTaskKey === entry.task.key}
                                  className="pui-ledger-row po-plan-compact-task flex min-h-[48px] w-full items-center gap-2 border-t border-[var(--pui-border)] px-3 py-1.5 text-left">
                                  <span className="w-5 shrink-0 self-start pt-0.5 font-mono text-[11px] text-[var(--pui-ink-muted)]">{String(entry.index + 1).padStart(2, '0')}</span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[12.5px] font-medium leading-[1.4] text-[var(--pui-ink)]">{entry.task.title}</span>
                                    <span className="mt-0.5 block truncate text-[11px] leading-[1.35] text-[var(--pui-ink-muted)]">{entry.task.description || '未填写任务描述'}</span>
                                  </span>
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
                <div className="pui-risk-panel rounded-[15px] p-3">
                  <div className="flex items-center justify-between gap-2"><span className="text-[11.5px] text-[var(--pui-ink-muted)]">审批状态</span><strong className={cn('text-[12px] font-semibold', blocking ? 'text-[var(--pui-danger)]' : 'text-[var(--pui-success)]')}>{blocking ? '待修复' : risks.length ? '可批准 · 有提醒' : '可批准'}</strong></div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-[var(--pui-ink-muted)]"><span>阻塞 {blocking}</span><span>任务 {draft.tasks.length}</span><span>阶段 {stages.length}</span></div>
                  <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--pui-ink-muted)]">批准只创建任务与依赖，不会启动 Agent；执行需单独授权。</p>
                </div>
                <div className="pui-risk-panel overflow-hidden rounded-[15px]">
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
              <DialogContent side="right" className="po-plan-task-detail pui-detail-sheet">
                <div className="flex h-full flex-col">
                  <div className="flex shrink-0 items-start gap-3 border-b border-[var(--pui-border)] px-5 py-4 pr-12">
                    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--pui-accent-soft)] text-[var(--pui-accent)]">{roleIcon(selected.role)}</div>
                    <div className="min-w-0"><DialogTitle className="text-[14px] font-semibold leading-snug">{selectedIndex + 1}. {selected.title}</DialogTitle><DialogDescription className="mt-1 text-[11.5px] text-[var(--pui-ink-muted)]">{roleLabels[selected.role]} · {selected.key}</DialogDescription></div>
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                                        <div className="flex flex-col px-5 py-1">
                      <section className="pui-detail-section">
                        <div className="pui-detail-label">任务名称</div>
                        <input className="pui-detail-input -ml-2 w-[calc(100%+16px)] text-[13.5px] font-medium" value={selected.title} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ title: event.target.value })} />
                        <div className="pui-detail-label mt-3">任务描述</div>
                        <textarea className="pui-detail-input -ml-2 min-h-[58px] w-[calc(100%+16px)] resize-y" value={selected.description} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ description: event.target.value })} />
                      </section>

                      <section className="pui-detail-section">
                        <div className="pui-detail-label">角色</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(Object.entries(roleLabels) as Array<[PlanRole, string]>).map(([role, label]) => (
                            <button key={role} type="button" className="pui-role-option" data-active={selected.role === role} disabled={draft.status !== 'draft'} onClick={() => { if (role === 'custom') { createAgentFor(selected.key); return } setTask({ role }) }}>
                              {roleIcon(role)}{label}
                            </button>
                          ))}
                        </div>
                        <div className="pui-detail-label mt-4">Agent</div>
                        <details className="relative mt-1.5">
                          <summary className="pui-control flex cursor-pointer list-none items-center justify-between px-2.5">
                            <span className="flex min-w-0 items-center gap-2"><i className="flex size-5 items-center justify-center rounded-full bg-[var(--pui-accent-soft)] text-[10px] font-semibold not-italic text-[var(--pui-accent)]">{selectedAgentLabel.slice(0, 1)}</i><span className="truncate">{selectedAgentLabel}</span></span><ChevronDown size={13} className="shrink-0 text-[var(--pui-ink-muted)]" />
                          </summary>
                          <div className="pui-agent-list">
                            <button type="button" className="pui-agent-option" data-active={!selected.agentId} onClick={(event) => { setTask({ agentId: null, assignmentBlocked: false, assignmentReasons: [] }); event.currentTarget.closest('details')?.removeAttribute('open') }}><UserRound size={13} />角色默认</button>
                            {agentOptions.map((option) => (
                              <button key={option.value} type="button" className="pui-agent-option" data-active={selected.agentId === option.value} onClick={(event) => { if (option.value === '__custom__') { createAgentFor(selected.key); return } setTask({ agentId: option.value, assignmentBlocked: false, assignmentReasons: ['用户手动指定'] }); event.currentTarget.closest('details')?.removeAttribute('open') }}><span className="flex size-5 items-center justify-center rounded-full bg-[var(--pui-surface)] text-[10px]">{option.label.slice(0, 1)}</span>{option.label}</button>
                            ))}
                          </div>
                        </details>
                      </section>

                      <section className="pui-detail-section">
                        <div className="flex items-center justify-between"><div className="pui-detail-label">前置依赖</div><span className="text-[11px] text-[var(--pui-ink-muted)]">{selected.dependsOn.length ? `${selected.dependsOn.length} 项` : '无'}</span></div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selected.dependsOn.map((dependency) => <span className="pui-chip" key={dependency}>{draft.tasks.find((task) => task.key === dependency)?.title ?? dependency}<button type="button" aria-label="移除依赖" onClick={() => setTask({ dependsOn: selected.dependsOn.filter((key) => key !== dependency) })}><X size={11} /></button></span>)}
                          <details className="relative">
                            <summary className="pui-chip pui-chip-add cursor-pointer list-none"><Plus size={11} />添加</summary>
                            <div className="pui-agent-list max-h-48 overflow-auto">
                              {draft.tasks.filter((task) => task.key !== selected.key && !selected.dependsOn.includes(task.key)).map((task) => <button type="button" key={task.key} className="pui-agent-option" onClick={(event) => { setTask({ dependsOn: [...selected.dependsOn, task.key] }); event.currentTarget.closest('details')?.removeAttribute('open') }}>{task.title}</button>)}
                            </div>
                          </details>
                        </div>
                      </section>

                      <section className="pui-detail-section">
                        <div className="flex items-center justify-between"><div className="pui-detail-label">验收标准</div><span className="text-[11px] text-[var(--pui-ink-muted)]">{selected.acceptanceCriteria.length} 条</span></div>
                        <div className="mt-2 flex flex-col gap-1.5">
                          {selected.acceptanceCriteria.map((criterion, index) => (
                            <div className="flex items-start gap-1" key={`${index}-${criterion.slice(0, 12)}`}>
                              <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-[var(--pui-accent)]" />
                              <input className="pui-detail-input flex-1" value={criterion} disabled={draft.status !== 'draft'} onChange={(event) => setTask({ acceptanceCriteria: selected.acceptanceCriteria.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} onBlur={() => setTask({ acceptanceCriteria: selected.acceptanceCriteria.filter((item) => item.trim()) })} />
                              <button type="button" className="mt-1 inline-flex size-6 items-center justify-center rounded-md text-[var(--pui-ink-muted)] hover:bg-[var(--pui-danger-soft)] hover:text-[var(--pui-danger)]" aria-label="删除验收标准" onClick={() => setTask({ acceptanceCriteria: selected.acceptanceCriteria.filter((_, itemIndex) => itemIndex !== index) })}><X size={12} /></button>
                            </div>
                          ))}
                          <button type="button" className="pui-chip pui-chip-add w-fit" onClick={() => setTask({ acceptanceCriteria: [...selected.acceptanceCriteria, ''] })}><Plus size={11} />添加验收标准</button>
                        </div>
                      </section>

                      <section className="pui-detail-section">
                        <div className="flex items-center justify-between"><div className="pui-detail-label">预期交付物</div><span className="text-[11px] text-[var(--pui-ink-muted)]">{selected.expectedArtifacts.length} 个</span></div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {selected.expectedArtifacts.map((artifact, index) => <span className="pui-chip" key={`${artifact}-${index}`}>{artifact}<button type="button" aria-label="移除交付物" onClick={() => setTask({ expectedArtifacts: selected.expectedArtifacts.filter((_, itemIndex) => itemIndex !== index) })}><X size={11} /></button></span>)}
                          <details className="relative">
                            <summary className="pui-chip pui-chip-add cursor-pointer list-none"><Plus size={11} />添加</summary>
                            <div className="pui-agent-list">
                              <input placeholder="输入后回车" className="pui-control mb-1 w-full px-2" onKeyDown={(event) => { if (event.key === 'Enter' && event.currentTarget.value.trim()) { setTask({ expectedArtifacts: [...selected.expectedArtifacts, event.currentTarget.value.trim()] }); event.currentTarget.value = '' } }} />
                            </div>
                          </details>
                        </div>
                      </section>

                      <section className="pui-detail-section">
                        <div className="pui-detail-label">能力需求</div>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          <div><div className="mb-1.5 text-[11px] text-[var(--pui-ink-muted)]">需求</div><div className="flex flex-wrap gap-1">{AGENT_CAPABILITIES.map((capability) => <button type="button" key={capability} className="pui-chip" data-active={(selected.requiredCapabilities ?? []).includes(capability)} onClick={() => { const current = selected.requiredCapabilities ?? []; setTask({ requiredCapabilities: current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability] as AgentCapability[] }) }}>{capability}</button>)}</div></div>
                          <div><div className="mb-1.5 text-[11px] text-[var(--pui-ink-muted)]">硬性</div><div className="flex flex-wrap gap-1">{AGENT_CAPABILITIES.map((capability) => <button type="button" key={capability} className="pui-chip" data-active={(selected.hardCapabilities ?? []).includes(capability)} onClick={() => { const current = selected.hardCapabilities ?? []; setTask({ hardCapabilities: current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability] as AgentCapability[] }) }}>{capability}</button>)}</div></div>
                        </div>
                      </section>

                      <section className="pui-detail-section flex items-center justify-between gap-2 border-b-0">
                        <button type="button" className="flex items-center gap-2 text-[12px] text-[var(--pui-ink-secondary)]" disabled={draft.status !== 'draft'} onClick={() => setTask({ requiresApproval: !selected.requiresApproval })}><span className={cn('relative h-[18px] w-[32px] rounded-full border transition-colors', selected.requiresApproval ? 'border-[var(--pui-accent)] bg-[var(--pui-accent)]' : 'border-[var(--pui-border)] bg-[var(--pui-surface)]')}><span className={cn('absolute top-[2px] size-3 rounded-full bg-white shadow-sm transition-transform', selected.requiresApproval ? 'translate-x-[15px]' : 'translate-x-[2px]')} /></span>执行前人工审批</button>
                        {draft.status === 'draft' ? <Button size="sm" variant="danger" onClick={() => { onRemoveTask(selected.key); setSelectedTaskKey(null) }}><Trash2 size={13} />删除任务</Button> : null}
                      </section>
                      {selected.rationale ? <div className="po-plan-task-rationale rounded-lg border border-[var(--pui-border)] bg-[var(--pui-surface-muted)] p-2.5 text-[11.5px] leading-relaxed text-[var(--pui-ink-secondary)]">{selected.rationale}</div> : null}
                      {selected.assignmentBlocked ? <div className="rounded-lg border border-[color-mix(in_srgb,var(--pui-danger)_30%,var(--pui-border))] bg-[var(--pui-danger-soft)] p-2.5 text-[11.5px] text-[var(--pui-danger)]">{selected.assignmentReasons.join('；') || '该任务暂时无法分配 Agent'}</div> : null}
                    </div>
                  </ScrollArea>
                </div>
              </DialogContent>
            ) : null}
          </AnimatePresence>
        </Dialog>
        </motion.div>
      </div>
    </>
  )
}
