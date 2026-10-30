import { useMemo, useState, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  GitBranch,
  Layers3,
  Plus,
  ShieldAlert,
  X,
} from 'lucide-react'
import { AGENT_CAPABILITIES, type AgentCapability, type PlanDraft, type PlanRole, type PlannedTask } from '@projectos/contracts'
import { computeStages, mergeStagesByRole, planDependencyIssues, type Stage } from './plan-review-logic'
import { LabStageJourney } from '../../design-lab/StageJourney'
import { LabTaskGraph } from '../../design-lab/TaskGraph'
import { TaskInspector } from '../../design-lab/TaskInspector'
import { OpticalGlass } from '../../design-lab/OpticalGlass'
import type { LabStage, LabTask } from '../../design-lab/data'
import '../../design-lab/design-lab.css'
import { useResolvedTheme } from '../../../stores/ui'
import { useReducedMotionPreference } from '../../../hooks/useReducedMotionPreference'

type AgentOption = { value: string; label: string }

const ROLE_SUBTITLE: Record<PlanRole, string> = {
  architect: '确认边界与风险',
  developer: '并行实现视觉系统',
  reviewer: '复核体验与可访问性',
  tester: '回归与交付验证',
  custom: '执行计划任务',
}

function statusFor(task: LabTask): { label: string; tone: string } {
  if (task.risk) return { label: '需复核', tone: 'warn' }
  if (task.requiresApproval) return { label: '待审批', tone: 'accent' }
  return { label: '就绪', tone: 'ok' }
}

function toLabStage(stage: Stage, roleLabels: Record<PlanRole, string>): LabStage {
  const role = stage.roles[0] ?? 'custom'
  return {
    id: stage.id,
    title: stage.title,
    subtitle: ROLE_SUBTITLE[role],
    role: roleLabels[role],
    risk: stage.hasRisk,
  }
}

function toLabTask(task: PlannedTask, index: number, stageId: string, roleLabels: Record<PlanRole, string>, agents: AgentOption[]): LabTask {
  return {
    id: task.key,
    code: `TASK ${String(index + 1).padStart(2, '0')}`,
    title: task.title,
    description: task.description,
    stageId,
    role: roleLabels[task.role],
    agent: agents.find((agent) => agent.value === task.agentId)?.label.split(' · ')[0] ?? '角色默认',
    dependsOn: task.dependsOn,
    criteria: task.acceptanceCriteria,
    artifacts: task.expectedArtifacts,
    capabilities: (task.requiredCapabilities ?? []) as AgentCapability[],
    risk: task.assignmentBlocked ? task.assignmentReasons.join('；') || '无法分配 Agent' : undefined,
    requiresApproval: task.requiresApproval,
  }
}

export function PlanReviewWorkspace({
  draft,
  roleLabels,
  agentOptions,
  onUpdateTask,
  onAddTask,
  onRemoveTask,
  onApprove,
  onReject,
  onBack,
}: {
  draft: PlanDraft
  roleLabels: Record<PlanRole, string>
  agentOptions: AgentOption[]
  onUpdateTask: (index: number, patch: Partial<PlannedTask>) => void
  onAddTask: () => void
  onRemoveTask: (key: string) => void
  onApprove: () => void
  onReject: () => void
  onBack: () => void
}): ReactElement {
  const reduce = useReducedMotionPreference()
  const theme = useResolvedTheme()
  const stages = useMemo(() => mergeStagesByRole(computeStages(draft.tasks, roleLabels)), [draft.tasks, roleLabels])
  const issues = useMemo(() => planDependencyIssues(draft.tasks), [draft.tasks])
  const labStages = useMemo(() => stages.map((stage) => toLabStage(stage, roleLabels)), [stages, roleLabels])
  const stageByTask = useMemo(() => {
    const map = new Map<string, string>()
    for (const stage of stages) for (const entry of stage.entries) map.set(entry.task.key, stage.id)
    return map
  }, [stages])
  const tasks = useMemo(
    () => draft.tasks.map((task, index) => toLabTask(task, index, stageByTask.get(task.key) ?? stages[0]?.id ?? '', roleLabels, agentOptions)),
    [agentOptions, draft.tasks, roleLabels, stageByTask, stages],
  )
  const [view, setView] = useState<'route' | 'dag'>('dag')
  const [activeStage, setActiveStage] = useState(labStages[0]?.id ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [riskOpen, setRiskOpen] = useState(true)

  const selected = tasks.find((task) => task.id === selectedId) ?? null
  const risks = tasks.filter((task) => task.risk)
  const readyCount = tasks.filter((task) => !task.risk && !issues.some((issue) => issue.taskKey === task.id)).length
  const dependencyCount = tasks.reduce((total, task) => total + task.dependsOn.length, 0)
  const blocking = draft.tasks.some((task) => task.assignmentBlocked) || issues.length > 0
  const activeTasks = tasks.filter((task) => task.stageId === activeStage)
  const activeStageLabel = labStages.find((stage) => stage.id === activeStage)?.title ?? ''

  const patchTask = (id: string, patch: Partial<LabTask>): void => {
    const real = draft.tasks.find((task) => task.key === id)
    if (!real) return
    const next: Partial<PlannedTask> = {}
    if (patch.title !== undefined) next.title = patch.title
    if (patch.description !== undefined) next.description = patch.description
    if (patch.role !== undefined) next.role = (Object.entries(roleLabels).find(([, label]) => label === patch.role)?.[0] as PlanRole | undefined) ?? real.role
    if (patch.criteria !== undefined) next.acceptanceCriteria = patch.criteria
    if (patch.artifacts !== undefined) next.expectedArtifacts = patch.artifacts
    if (patch.capabilities !== undefined) next.requiredCapabilities = patch.capabilities as AgentCapability[]
    if (patch.requiresApproval !== undefined) next.requiresApproval = patch.requiresApproval
    if (patch.dependsOn !== undefined) next.dependsOn = patch.dependsOn
    if (patch.agent !== undefined) {
      const agent = agentOptions.find((option) => option.value === real.agentId || option.label === patch.agent || option.label.startsWith(`${patch.agent} `))
      next.agentId = agent?.value ?? null
      next.assignmentMode = 'explicit'
    }
    const index = draft.tasks.findIndex((task) => task.key === id)
    if (index >= 0) onUpdateTask(index, next)
  }

  return (
    <div className="pdl-root po-plan-workspace" data-theme={theme} data-testid="plan-review-workspace">
      <section className="pdl-workspace" aria-label="计划审核">
          <header className="pdl-plan-head">
            <div className="pdl-plan-title">
              <span className="pdl-eyebrow">PLAN REVIEW<i /> {labStages.length} 个阶段 · {tasks.length} 项工作</span>
              <h1>{draft.goal}</h1>
              <div className="pdl-plan-meta">
                <span className="pdl-state"><i />待批准</span>
                <span>{draft.generatedBy === 'provider' ? 'AI 计划' : '本地规则计划'}</span><span>·</span><span className={risks.length ? 'is-warn' : ''}>{risks.length ? `${risks.length} 项提醒` : '无待处理项'}</span>
              </div>
            </div>
            <div className="pdl-head-side">
              <button type="button" className="pdl-icon-button" aria-label="返回编排" onClick={onBack}><X size={16} /></button>
              <div className="pdl-metrics">
                <div><strong>{String(tasks.length).padStart(2, '0')}</strong><span>工作项</span></div>
                <div><strong>{String(labStages.length).padStart(2, '0')}</strong><span>阶段</span></div>
                <div><strong className={risks.length ? 'is-warn' : ''}>{String(risks.length).padStart(2, '0')}</strong><span>待复核</span></div>
              </div>
            </div>
          </header>
          <div className="pdl-viewbar-row">
            <OpticalGlass className="pdl-viewbar-glass" radius={18}>
              <div className="pdl-viewbar" role="tablist" aria-label="计划视图">
                <button type="button" role="tab" aria-selected={view === 'route'} className={view === 'route' ? 'is-active' : ''} onClick={() => setView('route')}><Layers3 size={14} />阶段路线</button>
                <button type="button" role="tab" aria-selected={view === 'dag'} className={view === 'dag' ? 'is-active' : ''} onClick={() => setView('dag')}><GitBranch size={14} />任务依赖</button>
              </div>
            </OpticalGlass>
            <div className="pdl-view-context"><span>{view === 'route' ? `${activeStageLabel} · ${activeTasks.length} 项工作` : '真实依赖结构 · ELK 自动布局'}</span></div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {view === 'route' ? (
              <motion.div key="route" className="pdl-route-view" initial={reduce ? false : { y: 8 }} animate={{ y: 0 }} exit={reduce ? {} : { y: -5 }} transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}>
                <LabStageJourney stages={labStages} active={activeStage} onSelect={(id) => { setActiveStage(id); setCollapsed((current) => { const next = new Set(current); next.delete(id); return next }) }} taskCounts={Object.fromEntries(labStages.map((stage) => [stage.id, tasks.filter((task) => task.stageId === stage.id).length]))} />
                <div className="pdl-content-grid">
                  <section className="pdl-ledger-panel" aria-label="任务清单">
                    <div className="pdl-panel-head"><div><span className="pdl-eyebrow">TASK SEQUENCE</span><h2>准备审核的工作</h2></div><div className="pdl-panel-actions"><span className="pdl-panel-note">{activeTasks.length} 项当前阶段</span><button type="button" className="pdl-quiet" onClick={onAddTask}><Plus size={13} />添加任务</button></div></div>
                    <div className="pdl-ledger">
                      {labStages.map((stage) => {
                        const stageTasks = tasks.filter((task) => task.stageId === stage.id)
                        const isCollapsed = collapsed.has(stage.id) && stage.id !== activeStage
                        return (
                          <div className={`pdl-stage-group${stage.id === activeStage ? ' is-active' : ''}`} key={stage.id}>
                            <button type="button" className="pdl-stage-group-head" onClick={() => { setActiveStage(stage.id); setCollapsed((current) => { const next = new Set(current); if (next.has(stage.id)) next.delete(stage.id); else next.add(stage.id); return next }) }} aria-expanded={!isCollapsed}>
                              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<span>{stage.title}</span><em>{stageTasks.length}</em>
                            </button>
                            {isCollapsed ? null : stageTasks.map((task) => {
                              const state = statusFor(task)
                              return (
                                <button type="button" key={task.id} className={`pdl-task-row${selectedId === task.id ? ' is-selected' : ''}${task.stageId === activeStage ? ' is-current' : ''}`} onClick={() => { setSelectedId(task.id); setInspectorOpen(true) }} data-testid={`plan-workspace-task-${task.id}`}>
                                  <span className="pdl-task-code">{task.code.replace('TASK ', '')}</span>
                                  <span className="pdl-task-copy"><strong>{task.title}</strong><span>{task.description}</span></span>
                                  <span className="pdl-task-agent"><i>{task.agent.slice(0, 1)}</i>{task.agent}</span>
                                  <span className={`pdl-task-state ${state.tone}`}>{state.label}</span>
                                  <ChevronRight size={13} className="pdl-task-chevron" />
                                </button>
                              )
                            })}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                  <aside className="pdl-review-panel" aria-label="审核摘要">
                    <div className="pdl-review-top"><span className="pdl-eyebrow">REVIEW READINESS</span><span className={`pdl-ready ${risks.length ? 'is-warn' : ''}`}><CheckCircle2 size={13} />{risks.length ? '有提醒' : '可批准'}</span></div>
                    <div className="pdl-readiness"><strong>{String(readyCount).padStart(2, '0')}<span> / {String(tasks.length).padStart(2, '0')}</span></strong><p>{risks.length ? `还有 ${risks.length} 项需要复核；批准只会创建任务与依赖，不会启动 Agent。` : '依赖结构完整，可进入审批；批准只创建任务与依赖，不会启动 Agent。'}</p></div>
                    <div className="pdl-review-stats"><div><span>阶段</span><strong>{String(labStages.length).padStart(2, '0')}</strong></div><div><span>依赖</span><strong>{dependencyCount}</strong></div><div><span>待复核</span><strong className={risks.length ? 'is-warn' : ''}>{String(risks.length).padStart(2, '0')}</strong></div></div>
                    <div className="pdl-risk-box">
                      <button type="button" className="pdl-risk-toggle" onClick={() => setRiskOpen((open) => !open)} aria-expanded={riskOpen}><span><ShieldAlert size={14} />{risks.length ? `${risks.length} 项需复核` : '无待处理项'}</span><ChevronDown size={13} className={riskOpen ? 'is-open' : ''} /></button>
                      <AnimatePresence initial={false}>{riskOpen ? (
                        <motion.div className="pdl-risk-body" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} transition={{ duration: reduce ? 0 : 0.2 }}>
                          {risks.length ? risks.map((task) => <button type="button" key={task.id} onClick={() => { setSelectedId(task.id); setInspectorOpen(true) }}><span>{task.code}</span><p>{task.risk}</p><ArrowRight size={12} /></button>) : <p>当前没有阻塞项。</p>}
                        </motion.div>
                      ) : null}</AnimatePresence>
                    </div>
                    <div className="pdl-review-foot"><CircleAlert size={12} /><span>批准前不会创建任务或启动 Agent</span></div>
                  </aside>
                </div>
              </motion.div>
            ) : (
              <motion.div key="dag" className="pdl-dag-view" initial={reduce ? false : { y: 8 }} animate={{ y: 0 }} exit={reduce ? {} : { y: -5 }} transition={{ duration: reduce ? 0 : 0.22 }}>
                <div className="pdl-dag-head"><div><span className="pdl-eyebrow">DEPENDENCY MAP</span><h2>任务依赖</h2></div><div className="pdl-dag-actions"><span>{tasks.filter((task) => task.dependsOn.length === 0).length} 个起点 · {dependencyCount} 条依赖</span><button type="button" onClick={() => setView('route')}>返回阶段路线</button></div></div>
                <LabTaskGraph tasks={tasks} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setInspectorOpen(true) }} />
                <div className="pdl-dag-caption"><span>选择节点查看上下游路径</span><span>滚轮缩放 · 拖动平移</span></div>
              </motion.div>
            )}
          </AnimatePresence>
          <footer className="pdl-footer">
            <div className="pdl-footer-meta"><i />真实计划 · 审批前不会创建任务或启动 Agent</div>
            <div className="pdl-footer-actions">
              <button type="button" className="pdl-quiet" onClick={onReject}>拒绝计划</button>
              <button type="button" className="pdl-primary" onClick={onApprove} disabled={blocking} title={blocking ? '存在阻塞项，修复后才能批准' : undefined}><Check size={14} />批准计划</button>
            </div>
          </footer>
      </section>
      {selected ? <TaskInspector key={selected.id} task={selected} tasks={tasks} open={inspectorOpen} theme={theme}
        roleChoices={Object.values(roleLabels)} capabilityChoices={AGENT_CAPABILITIES}
        agentChoices={agentOptions} selectedAgent={draft.tasks.find((task) => task.key === selected.id)?.agentId}
        onAgentChange={(agentId) => onUpdateTask(draft.tasks.findIndex((task) => task.key === selected.id), { agentId: agentId || null, assignmentMode: 'explicit' })}
        onPatch={patchTask} onInspect={(id) => { setSelectedId(id); setInspectorOpen(true) }}
        onDelete={() => { onRemoveTask(selected.id); setInspectorOpen(false) }} onClose={() => setInspectorOpen(false)} /> : null}
    </div>
  )
}
