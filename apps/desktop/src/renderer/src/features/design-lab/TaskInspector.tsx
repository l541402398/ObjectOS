import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Check, ChevronDown, GitBranch, Layers3, Plus, Trash2, X } from 'lucide-react'
import { OpticalGlass } from './OpticalGlass'
import type { LabTask } from './data'

function FieldLabel({ children }: { children: ReactNode }): ReactElement {
  return <div className="pdl-field-label">{children}</div>
}

export function TaskInspector({
  task,
  tasks,
  onPatch,
  onClose,
}: {
  task: LabTask
  tasks: LabTask[]
  onPatch: (id: string, patch: Partial<LabTask>) => void
  onClose: () => void
}): ReactElement {
  const reduce = useReducedMotion()
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const [menu, setMenu] = useState<'agent' | 'deps' | 'artifacts' | null>(null)
  const patch = (value: Partial<LabTask>): void => onPatch(task.id, value)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const shell = document.querySelector('.pdl-shell') as HTMLElement | null
    shell?.setAttribute('inert', '')
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { onClose(); return }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      shell?.removeAttribute('inert')
      previous?.focus()
    }
  }, [onClose])

  return (
    <motion.div className="pdl-inspector-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.2 }} onMouseDown={onClose}>
      <motion.aside
        ref={panelRef}
        className="pdl-inspector"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdl-inspector-title"
        onMouseDown={(event) => event.stopPropagation()}
        initial={reduce ? false : { x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={reduce ? {} : { x: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 36 }}
        data-testid="design-lab-inspector"
      >
        <div className="pdl-inspector-head">
          <div>
            <span className="pdl-eyebrow">{task.code} · 检查器</span>
            <span className="pdl-inspector-role"><Layers3 size={12} />{task.role} · {task.agent}</span>
          </div>
          <button ref={closeRef} type="button" className="pdl-icon-button" onClick={onClose} aria-label="关闭任务检查器"><X size={17} /></button>
        </div>

        <div className="pdl-inspector-scroll">
          <section className="pdl-field-block">
            <FieldLabel>任务身份</FieldLabel>
            <input id="pdl-inspector-title" className="pdl-title-input" value={task.title} onChange={(event) => patch({ title: event.target.value })} />
            <textarea className="pdl-desc-input" value={task.description} onChange={(event) => patch({ description: event.target.value })} rows={3} />
          </section>

          <section className="pdl-field-block">
            <FieldLabel>角色与 Agent</FieldLabel>
            <div className="pdl-role-row">
              {['架构', '开发', '审查', '测试'].map((role) => (
                <button key={role} type="button" className={`pdl-role${task.role === role ? ' is-active' : ''}`} onClick={() => patch({ role })}>{role}</button>
              ))}
            </div>
            <div className="pdl-popover-wrap">
              <button type="button" className="pdl-select-like" onClick={() => setMenu(menu === 'agent' ? null : 'agent')} aria-expanded={menu === 'agent'}>
                <span><i className="pdl-avatar">{task.agent.slice(0, 1)}</i>{task.agent}</span><ChevronDown size={14} />
              </button>
              <AnimatePresence>
                {menu === 'agent' ? (
                  <motion.div className="pdl-popover" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                    {['Sage', 'Kai', 'Mira', 'Nova', 'Iris'].map((agent) => (
                      <button key={agent} type="button" className={task.agent === agent ? 'is-active' : ''} onClick={() => { patch({ agent }); setMenu(null) }}><i className="pdl-avatar">{agent.slice(0, 1)}</i>{agent}{task.agent === agent ? <Check size={13} /> : null}</button>
                    ))}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </section>

          <section className="pdl-field-block">
            <FieldLabel>前置依赖</FieldLabel>
            <div className="pdl-chip-row">
              {task.dependsOn.length ? task.dependsOn.map((id) => {
                const parent = tasks.find((item) => item.id === id)
                return <span className="pdl-chip" key={id}><GitBranch size={11} />{parent?.code.replace('TASK ', '') ?? id}<button type="button" aria-label="移除依赖" onClick={() => patch({ dependsOn: task.dependsOn.filter((item) => item !== id) })}><X size={10} /></button></span>
              }) : <span className="pdl-empty-inline">无</span>}
              <div className="pdl-popover-wrap">
                <button type="button" className="pdl-chip pdl-chip-add" onClick={() => setMenu(menu === 'deps' ? null : 'deps')}><Plus size={11} />添加</button>
                {menu === 'deps' ? (
                  <div className="pdl-popover">
                    {tasks.filter((item) => item.id !== task.id && !task.dependsOn.includes(item.id)).map((item) => (
                      <button key={item.id} type="button" onClick={() => { patch({ dependsOn: [...task.dependsOn, item.id] }); setMenu(null) }}>{item.code} · {item.title}</button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="pdl-field-block">
            <div className="pdl-field-head"><FieldLabel>验收标准</FieldLabel><span>{task.criteria.length} 项</span></div>
            <div className="pdl-criteria">
              {task.criteria.map((criterion, index) => (
                <div className="pdl-criterion" key={`${task.id}-${index}`}>
                  <span className="pdl-criterion-dot" />
                  <input value={criterion} onChange={(event) => patch({ criteria: task.criteria.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} onBlur={() => patch({ criteria: task.criteria.filter((item) => item.trim()) })} />
                  <button type="button" aria-label="删除验收标准" onClick={() => patch({ criteria: task.criteria.filter((_, itemIndex) => itemIndex !== index) })}><X size={11} /></button>
                </div>
              ))}
              <button type="button" className="pdl-add-row" onClick={() => patch({ criteria: [...task.criteria, ''] })}><Plus size={12} />添加验收标准</button>
            </div>
          </section>

          <section className="pdl-field-block">
            <div className="pdl-field-head"><FieldLabel>预期交付物</FieldLabel><span>{task.artifacts.length} 个</span></div>
            <div className="pdl-chip-row">
              {task.artifacts.map((artifact, index) => <span className="pdl-chip" key={`${artifact}-${index}`}>{artifact}<button type="button" aria-label="移除交付物" onClick={() => patch({ artifacts: task.artifacts.filter((_, itemIndex) => itemIndex !== index) })}><X size={10} /></button></span>)}
              <div className="pdl-popover-wrap">
                <button type="button" className="pdl-chip pdl-chip-add" onClick={() => setMenu(menu === 'artifacts' ? null : 'artifacts')}><Plus size={11} />添加</button>
                {menu === 'artifacts' ? (
                  <div className="pdl-popover">
                    <input autoFocus placeholder="输入后回车" onKeyDown={(event) => { if (event.key === 'Enter' && event.currentTarget.value.trim()) { patch({ artifacts: [...task.artifacts, event.currentTarget.value.trim()] }); event.currentTarget.value = ''; setMenu(null) } }} />
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="pdl-field-block">
            <FieldLabel>能力要求</FieldLabel>
            <div className="pdl-chip-row">
              {['plan', 'typescript', 'react', 'motion', 'svg', 'elk', 'accessibility'].map((capability) => {
                const active = task.capabilities.includes(capability)
                return <button key={capability} type="button" className={`pdl-chip${active ? ' is-active' : ''}`} onClick={() => patch({ capabilities: active ? task.capabilities.filter((item) => item !== capability) : [...task.capabilities, capability] })}>{capability}</button>
              })}
            </div>
          </section>

          <section className="pdl-field-block pdl-inspector-bottom">
            <button type="button" className="pdl-approval-toggle" onClick={() => patch({ requiresApproval: !task.requiresApproval })}>
              <span className={`pdl-switch${task.requiresApproval ? ' is-on' : ''}`}><i /></span>执行前人工审批
            </button>
            <button type="button" className="pdl-text-danger" onClick={onClose}><Trash2 size={13} />删除任务</button>
          </section>
        </div>

        <div className="pdl-inspector-foot">
          <OpticalGlass className="pdl-liquid-action" radius={14} style={{ width: '100%' }}>
            <button type="button" className="pdl-primary pdl-primary-wide" onClick={onClose}>返回计划审核</button>
          </OpticalGlass>
        </div>
      </motion.aside>
    </motion.div>
  )
}


