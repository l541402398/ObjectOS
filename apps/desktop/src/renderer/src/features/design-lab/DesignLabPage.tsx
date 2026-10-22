import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import LiquidGlass from 'liquid-glass-react'
import { OpticalGlass } from './OpticalGlass'
import {
  Activity,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  FlaskConical,
  GitBranch,
  House,
  Layers3,
  Moon,
  MoreHorizontal,
  ShieldAlert,
  Sparkles,
  Sun,
  Workflow,
  X,
} from 'lucide-react'
import './design-lab.css'
import Aurora from './Aurora'
import { demoGoal, labStages, labTasks, type LabTask } from './data'
import { LabStageJourney } from './StageJourney'
import { LabTaskGraph } from './TaskGraph'
import { TaskInspector } from './TaskInspector'

type View = 'route' | 'dag'

function statusFor(task: LabTask): { label: string; tone: string } {
  if (task.risk) return { label: '需复核', tone: 'warn' }
  if (task.requiresApproval) return { label: '待审批', tone: 'accent' }
  return { label: '就绪', tone: 'ok' }
}

export default function DesignLabPage(): ReactElement {
  const reduce = useReducedMotion()
  const [theme, setTheme] = useState<'light' | 'dark'>('light')
  const [view, setView] = useState<View>('route')
  const [auroraMode, setAuroraMode] = useState<'probing' | 'on' | 'fallback'>('probing')
  const [glassLab, setGlassLab] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('glasslab') === '1')
  const [tasks, setTasks] = useState<LabTask[]>(labTasks)
  const [activeStage, setActiveStage] = useState(labStages[0]!.id)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [riskOpen, setRiskOpen] = useState(true)
  const [approved, setApproved] = useState(false)
  const [toast, setToast] = useState('')
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(() => new Set())

  const counts = useMemo(() => Object.fromEntries(labStages.map((stage) => [stage.id, tasks.filter((task) => task.stageId === stage.id).length])), [tasks])
  const selected = tasks.find((task) => task.id === selectedId) ?? null
  const activeTasks = tasks.filter((task) => task.stageId === activeStage)
  const risks = tasks.filter((task) => task.risk)
  const blocking = risks.length
  const stageLabel = labStages.find((stage) => stage.id === activeStage)?.title ?? ''

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const forced = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('aurora')
    if (forced === 'on') { setAuroraMode('on'); return undefined }
    if (forced === 'off') { setAuroraMode('fallback'); return undefined }
    let frames = 0
    let raf = 0
    const started = performance.now()
    const tick = (now: number): void => {
      frames += 1
      if (now - started < 1200) {
        raf = requestAnimationFrame(tick)
        return
      }
      const fps = (frames * 1000) / (now - started)
      setAuroraMode(fps >= 42 ? 'on' : 'fallback')
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const patchTask = (id: string, patch: Partial<LabTask>): void => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task))
  }

  const selectStage = (id: string): void => {
    setActiveStage(id)
    setCollapsedStages((current) => { const next = new Set(current); next.delete(id); return next })
  }

  return (
    <div className="pdl-root" data-theme={theme} data-aurora={auroraMode} data-testid="design-lab">
      <div className="pdl-aurora" aria-hidden="true">
        {auroraMode === 'fallback' ? (
          <div className="pdl-aurora-fallback"><i /><i /><i /></div>
        ) : (
          <Aurora
            colorStops={theme === 'light' ? ['#d8dcff', '#b9e8f5', '#e7d9ff'] : ['#344fa3', '#236c78', '#51449d']}
            amplitude={0.8}
            blend={0.62}
            speed={0.38}
            height={0.36}
            layers={1}
            glow={0.45}
            brightness={theme === 'light' ? 0.72 : 0.9}
            opacity={theme === 'light' ? 0.68 : 0.8}
            lightMode={theme === 'light'}
            mouseInteraction={false}
            dpr={0.65}
          />
        )}
      </div>
      <div className="pdl-ambient" aria-hidden="true"><i /><i /><i /></div>

      <header className="pdl-topbar">
        <div className="pdl-brand">
          <span className="pdl-brand-icon"><Sparkles size={17} /></span>
          <span>PROJECTOS</span><em>DESIGN LAB</em>
        </div>
        <div className="pdl-top-actions">
          <span className="pdl-local-badge"><i />LOCAL PROTOTYPE</span>
          <button type="button" className="pdl-icon-button" aria-label="玻璃兼容性对照" aria-pressed={glassLab} onClick={() => setGlassLab((value) => !value)}><FlaskConical size={16} /></button>
          <button type="button" className="pdl-icon-button" aria-label={theme === 'light' ? '切换到暗色' : '切换到浅色'} onClick={() => setTheme((value) => value === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</button>
          <span className="pdl-avatar">P</span>
        </div>
      </header>

      <div className="pdl-shell">
        <aside className="pdl-rail" aria-label="工作区导航">
          <button type="button" className="pdl-rail-button" aria-label="项目概览"><House size={18} /></button>
          <button type="button" className="pdl-rail-button is-active" aria-label="计划审核"><Layers3 size={18} /></button>
          <button type="button" className="pdl-rail-button" aria-label="编排"><Workflow size={18} /></button>
          <button type="button" className="pdl-rail-button" aria-label="任务"><GitBranch size={18} /></button>
          <button type="button" className="pdl-rail-button" aria-label="审计"><Activity size={18} /></button>
          <span className="pdl-rail-spacer" />
          <button type="button" className="pdl-rail-avatar" aria-label="当前用户">S</button>
        </aside>

        <main className="pdl-workspace">
          <div className="pdl-workspace-glow" aria-hidden="true" />
          <header className="pdl-plan-head">
            <div className="pdl-plan-title">
              <span className="pdl-eyebrow">PLAN REVIEW <b>R2</b><i /> {labStages.length} 个阶段 · {tasks.length} 项工作</span>
              <h1>{demoGoal}</h1>
              <div className="pdl-plan-meta">
                <span className={`pdl-state ${approved ? 'is-approved' : ''}`}><i />{approved ? '已批准' : '待批准'}</span>
                <span>审查人 Sage</span><span>·</span><span>{risks.length ? `${risks.length} 项提醒` : '无待处理项'}</span>
              </div>
            </div>
            <div className="pdl-head-side">
              <div className="pdl-metrics">
                <div><strong>{String(tasks.length).padStart(2, '0')}</strong><span>工作项</span></div>
                <div><strong>{String(labStages.length).padStart(2, '0')}</strong><span>阶段</span></div>
                <div><strong className={blocking ? 'is-warn' : ''}>{String(risks.length).padStart(2, '0')}</strong><span>待复核</span></div>
              </div>
              <button type="button" className="pdl-more" aria-label="更多计划操作" onClick={() => setToast('原型交互：更多计划操作未连接到正式系统')}><MoreHorizontal size={18} /></button>
            </div>
          </header>

          <div className="pdl-viewbar-row">
            <OpticalGlass className="pdl-viewbar-glass" radius={18}>
              <div className="pdl-viewbar" role="tablist" aria-label="计划视图">
                <button type="button" role="tab" aria-selected={view === 'route'} className={view === 'route' ? 'is-active' : ''} onClick={() => setView('route')}><Layers3 size={14} />阶段路线</button>
                <button type="button" role="tab" aria-selected={view === 'dag'} className={view === 'dag' ? 'is-active' : ''} onClick={() => setView('dag')}><GitBranch size={14} />任务依赖</button>
              </div>
            </OpticalGlass>
            <div className="pdl-view-context"><span>{view === 'route' ? `${stageLabel} · ${activeTasks.length} 项工作` : '真实依赖结构 · ELK 自动布局'}</span><button type="button" onClick={() => setToast('原型交互：视图已重置')}>重置视图</button></div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {view === 'route' ? (
              <motion.div key="route" className="pdl-route-view" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? {} : { opacity: 0, y: -5 }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
                <LabStageJourney stages={labStages} active={activeStage} onSelect={selectStage} taskCounts={counts} />
                <div className="pdl-content-grid">
                  <section className="pdl-ledger-panel" aria-label="任务清单">
                    <div className="pdl-panel-head">
                      <div><span className="pdl-eyebrow">TASK SEQUENCE</span><h2>准备审核的工作</h2></div>
                      <span className="pdl-panel-note">{activeTasks.length} 项当前阶段</span>
                    </div>
                    <div className="pdl-ledger">
                      {labStages.map((stage) => {
                        const stageTasks = tasks.filter((task) => task.stageId === stage.id)
                        const collapsed = collapsedStages.has(stage.id) && stage.id !== activeStage
                        return (
                          <div className={`pdl-stage-group${stage.id === activeStage ? ' is-active' : ''}`} key={stage.id}>
                            <button type="button" className="pdl-stage-group-head" onClick={() => selectStage(stage.id)} aria-expanded={!collapsed}>
                              {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                              <span>{stage.title}</span><em>{stageTasks.length}</em>
                            </button>
                            {collapsed ? null : stageTasks.map((task) => {
                              const state = statusFor(task)
                              return (
                                <button type="button" key={task.id} className={`pdl-task-row${selectedId === task.id ? ' is-selected' : ''}${task.stageId === activeStage ? ' is-current' : ''}`} onClick={() => { setSelectedId(task.id); setInspectorOpen(true) }} data-testid={`design-lab-task-${task.id}`}>
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
                    <div className="pdl-review-top">
                      <span className="pdl-eyebrow">REVIEW READINESS</span>
                      <span className={`pdl-ready ${blocking ? 'is-warn' : ''}`}><CheckCircle2 size={13} />{blocking ? '有提醒' : '可批准'}</span>
                    </div>
                    <div className="pdl-readiness"><strong>{String(tasks.length).padStart(2, '0')}<span> / {String(tasks.length).padStart(2, '0')}</span></strong><p>{risks.length ? '依赖结构完整，有 1 项提醒建议在执行前检查。' : '依赖结构完整，可进入审批。'}</p></div>
                    <div className="pdl-review-stats"><div><span>阶段</span><strong>04</strong></div><div><span>依赖</span><strong>{tasks.reduce((total, task) => total + task.dependsOn.length, 0)}</strong></div><div><span>待复核</span><strong className={blocking ? 'is-warn' : ''}>{String(risks.length).padStart(2, '0')}</strong></div></div>
                    <div className="pdl-risk-box">
                      <button type="button" className="pdl-risk-toggle" onClick={() => setRiskOpen((value) => !value)} aria-expanded={riskOpen}><span><ShieldAlert size={14} />{risks.length ? `${risks.length} 项需复核` : '无待处理项'}</span><ChevronDown size={13} className={riskOpen ? 'is-open' : ''} /></button>
                      <AnimatePresence initial={false}>
                        {riskOpen ? (
                          <motion.div className="pdl-risk-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}>
                            {risks.length ? risks.map((task) => <button type="button" key={task.id} onClick={() => { setSelectedId(task.id); setInspectorOpen(true) }}><span>{task.code}</span><p>{task.risk}</p><ArrowRight size={12} /></button>) : <p>当前没有阻塞项。</p>}
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                    <div className="pdl-review-foot"><CircleAlert size={12} /><span>批准前不会创建任务或启动 Agent</span></div>
                  </aside>
                </div>
              </motion.div>
            ) : (
              <motion.div key="dag" className="pdl-dag-view" initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? {} : { opacity: 0, y: -5 }} transition={{ duration: 0.22 }}>
                <div className="pdl-dag-head"><div><span className="pdl-eyebrow">DEPENDENCY MAP</span><h2>任务依赖</h2></div><div className="pdl-dag-actions"><span>{tasks.filter((task) => task.dependsOn.length === 0).length} 个起点 · {tasks.reduce((total, task) => total + task.dependsOn.length, 0)} 条依赖</span><button type="button" onClick={() => setView('route')}>返回阶段路线</button></div></div>
                <LabTaskGraph tasks={tasks} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setInspectorOpen(true) }} />
                <div className="pdl-dag-caption"><span>选择节点查看上下游路径</span><span>ELK layered · React Flow</span></div>
              </motion.div>
            )}
          </AnimatePresence>

          <footer className="pdl-footer">
            <div className="pdl-footer-meta"><i />原型交互 · 不写入数据库 · 不启动 Agent</div>
            <div className="pdl-footer-actions">
              <button type="button" className="pdl-quiet" disabled={approved} onClick={() => { setApproved(true); setToast('原型交互：已模拟拒绝，未修改任何任务') }}>拒绝计划</button>
              <button type="button" className="pdl-primary" disabled={approved} onClick={() => { setApproved(true); setToast('原型交互：已模拟批准，未写入真实任务') }}><Check size={14} />{approved ? '已批准' : '批准计划'}</button>
            </div>
          </footer>
        </main>
      </div>

      <AnimatePresence>
        {selected && inspectorOpen ? <TaskInspector task={selected} tasks={tasks} onPatch={patchTask} onClose={() => setInspectorOpen(false)} /> : null}
      </AnimatePresence>
      {glassLab ? (
        <div className="pdl-glass-probe">
          <LiquidGlass displacementScale={42} blurAmount={0.08} saturation={150} aberrationIntensity={1.5} elasticity={0.08} cornerRadius={14} padding="7px 11px" mode="standard">
            <span className="pdl-glass-probe-label">Liquid Glass · library</span>
          </LiquidGlass>
          <span>Chromium filter probe</span>
        </div>
      ) : null}
      <AnimatePresence>
        {toast ? <motion.button type="button" className="pdl-toast" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} onClick={() => setToast('')}>{toast}<X size={12} /></motion.button> : null}
      </AnimatePresence>
    </div>
  )
}




