import { useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, CheckCircle2, ChevronDown, GitBranch, Layers3, Pencil, Plus, Trash2, X } from 'lucide-react'
import { InspectorShell, OverlayHeader, OverlayScrollArea } from '../../next-ui/overlay/overlay-shell'
import type { LabTask } from './data'

function FieldLabel({ children }: { children: ReactNode }): ReactElement {
  return <div className="pdl-field-label">{children}</div>
}

function Status({ task }: { task: LabTask }): ReactElement {
  if (task.risk) return <span className="pdl-inspector-status is-risk">需复核</span>
  if (task.requiresApproval) return <span className="pdl-inspector-status">待审批</span>
  return <span className="pdl-inspector-status is-ready">就绪</span>
}

export function TaskInspector({
  task,
  tasks,
  theme,
  onPatch,
  onDelete,
  onClose,
}: {
  task: LabTask
  tasks: LabTask[]
  theme: 'light' | 'dark'
  onPatch: (id: string, patch: Partial<LabTask>) => void
  onDelete: (id: string) => void
  onClose: () => void
}): ReactElement {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<LabTask>(task)
  const [menu, setMenu] = useState<'agent' | 'deps' | 'artifacts' | null>(null)

  useEffect(() => setDraft(task), [task])
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(task)

  const patchDraft = (patch: Partial<LabTask>): void => setDraft((current) => ({ ...current, ...patch }))
  const beginEdit = (): void => { setDraft(task); setEditing(true) }
  const cancelEdit = (): void => { setDraft(task); setEditing(false); setMenu(null) }
  const saveEdit = (): void => {
    if (!draft.title.trim()) return
    onPatch(task.id, draft)
    setEditing(false)
    setMenu(null)
  }

  const dependencies = task.dependsOn.map((id) => tasks.find((item) => item.id === id)).filter((item): item is LabTask => Boolean(item))

  return (
    <InspectorShell
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      dirty={dirty}
      onDiscard={() => { setDraft(task); setEditing(false); setMenu(null) }}
      ariaLabel="任务检查器"
      width={480}
      theme={theme}
      skin="projectos"
      testId="design-lab-inspector"
    >
        <OverlayHeader
          eyebrow={`${task.code} · TASK INSPECTOR`}
          title={editing ? draft.title : task.title}
          closeLabel="关闭任务检查器"
          meta={<><Status task={task} /><span><Layers3 size={12} />{task.role}</span><span><i className="pdl-avatar">{task.agent.slice(0, 1)}</i>{task.agent}</span><span>{task.requiresApproval ? '执行前审批' : '无需审批'}</span></>}
          actions={editing ? (
            <>
              <button type="button" className="pdl-quiet pdl-small" onClick={cancelEdit}>取消</button>
              <button type="button" className="pdl-primary pdl-small" disabled={!draft.title.trim()} onClick={saveEdit}><Check size={13} />保存</button>
            </>
          ) : (
            <button type="button" className="pdl-quiet pdl-small" onClick={beginEdit}><Pencil size={13} />编辑</button>
          )}
        />

        <OverlayScrollArea className="pdl-inspector-scroll">
          {!editing ? (
            <div className="pdl-inspector-view">
              <section className="pdl-inspector-section">
                <FieldLabel>任务概要</FieldLabel>
                <p className="pdl-inspector-description">{task.description || '未填写任务描述。'}</p>
              </section>

              <section className="pdl-inspector-section">
                <div className="pdl-inspector-section-head"><FieldLabel>依赖关系</FieldLabel><span>{dependencies.length ? `${dependencies.length} 项` : '无'}</span></div>
                <div className="pdl-chip-row">
                  {dependencies.length ? dependencies.map((dependency) => (
                    <span className="pdl-chip is-static" key={dependency.id}><GitBranch size={12} />{dependency.code.replace('TASK ', '')}<span className="pdl-chip-text">{dependency.title}</span></span>
                  )) : <span className="pdl-empty-inline">无前置依赖</span>}
                </div>
              </section>

              <section className="pdl-inspector-section">
                <div className="pdl-inspector-section-head"><FieldLabel>验收标准</FieldLabel><span>{task.criteria.length} 项</span></div>
                {task.criteria.length ? (
                  <ul className="pdl-criteria-view">
                    {task.criteria.map((criterion, index) => <li key={`${task.id}-criterion-${index}`}><CheckCircle2 size={15} /><span>{criterion}</span></li>)}
                  </ul>
                ) : <span className="pdl-empty-inline">尚未添加验收标准</span>}
              </section>

              <section className="pdl-inspector-section">
                <div className="pdl-inspector-section-head"><FieldLabel>预期交付物</FieldLabel><span>{task.artifacts.length} 个</span></div>
                <div className="pdl-chip-row">{task.artifacts.length ? task.artifacts.map((artifact, index) => <span className="pdl-chip is-static" key={`${artifact}-${index}`}>{artifact}</span>) : <span className="pdl-empty-inline">未指定交付物</span>}</div>
              </section>

              <section className="pdl-inspector-section">
                <FieldLabel>能力要求</FieldLabel>
                <div className="pdl-chip-row">{task.capabilities.length ? task.capabilities.map((capability) => <span className="pdl-chip is-static" key={capability}>{capability}</span>) : <span className="pdl-empty-inline">无特殊能力要求</span>}</div>
              </section>

              {task.risk ? (
                <section className="pdl-inspector-risk"><FieldLabel>需要复核</FieldLabel><p>{task.risk}</p></section>
              ) : null}
            </div>
          ) : (
            <div className="pdl-inspector-edit">
              <section className="pdl-inspector-section">
                <FieldLabel>任务身份</FieldLabel>
                <input className="pdl-title-input" value={draft.title} autoFocus onChange={(event) => patchDraft({ title: event.target.value })} aria-label="任务标题" />
                <textarea className="pdl-desc-input" value={draft.description} onChange={(event) => patchDraft({ description: event.target.value })} rows={3} aria-label="任务描述" />
              </section>

              <section className="pdl-inspector-section">
                <FieldLabel>角色与 Agent</FieldLabel>
                <div className="pdl-role-row">
                  {['架构', '开发', '审查', '测试'].map((role) => <button key={role} type="button" className={`pdl-role${draft.role === role ? ' is-active' : ''}`} onClick={() => patchDraft({ role })}>{role}</button>)}
                </div>
                <div className="pdl-popover-wrap">
                  <button type="button" className="pdl-select-like" onClick={() => setMenu(menu === 'agent' ? null : 'agent')} aria-expanded={menu === 'agent'}>
                    <span><i className="pdl-avatar">{draft.agent.slice(0, 1)}</i>{draft.agent}</span><ChevronDown size={14} />
                  </button>
                  <AnimatePresence>
                    {menu === 'agent' ? (
                      <motion.div className="pdl-popover" initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
                        {['Sage', 'Kai', 'Mira', 'Nova', 'Iris'].map((agent) => <button key={agent} type="button" className={draft.agent === agent ? 'is-active' : ''} onClick={() => { patchDraft({ agent }); setMenu(null) }}><i className="pdl-avatar">{agent.slice(0, 1)}</i>{agent}{draft.agent === agent ? <Check size={13} /> : null}</button>)}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </section>

              <section className="pdl-inspector-section">
                <FieldLabel>前置依赖</FieldLabel>
                <div className="pdl-chip-row">
                  {draft.dependsOn.length ? draft.dependsOn.map((id) => {
                    const parent = tasks.find((item) => item.id === id)
                    return <span className="pdl-chip" key={id}>{parent?.code.replace('TASK ', '') ?? id}<button type="button" aria-label="移除依赖" onClick={() => patchDraft({ dependsOn: draft.dependsOn.filter((item) => item !== id) })}><X size={10} /></button></span>
                  }) : <span className="pdl-empty-inline">无</span>}
                  <div className="pdl-popover-wrap">
                    <button type="button" className="pdl-chip pdl-chip-add" onClick={() => setMenu(menu === 'deps' ? null : 'deps')}><Plus size={11} />添加</button>
                    {menu === 'deps' ? <div className="pdl-popover">{tasks.filter((item) => item.id !== task.id && !draft.dependsOn.includes(item.id)).map((item) => <button key={item.id} type="button" onClick={() => { patchDraft({ dependsOn: [...draft.dependsOn, item.id] }); setMenu(null) }}>{item.code} · {item.title}</button>)}</div> : null}
                  </div>
                </div>
              </section>

              <section className="pdl-inspector-section">
                <div className="pdl-inspector-section-head"><FieldLabel>验收标准</FieldLabel><span>{draft.criteria.length} 项</span></div>
                <div className="pdl-criteria">
                  {draft.criteria.map((criterion, index) => (
                    <div className="pdl-criterion" key={`${task.id}-edit-${index}`}>
                      <span className="pdl-criterion-dot" />
                      <input value={criterion} onChange={(event) => patchDraft({ criteria: draft.criteria.map((item, itemIndex) => itemIndex === index ? event.target.value : item) })} onBlur={() => patchDraft({ criteria: draft.criteria.filter((item) => item.trim()) })} aria-label={`验收标准 ${index + 1}`} />
                      <button type="button" aria-label="删除验收标准" onClick={() => patchDraft({ criteria: draft.criteria.filter((_, itemIndex) => itemIndex !== index) })}><X size={11} /></button>
                    </div>
                  ))}
                  <button type="button" className="pdl-add-row" onClick={() => patchDraft({ criteria: [...draft.criteria, ''] })}><Plus size={12} />添加验收标准</button>
                </div>
              </section>

              <section className="pdl-inspector-section">
                <div className="pdl-inspector-section-head"><FieldLabel>预期交付物</FieldLabel><span>{draft.artifacts.length} 个</span></div>
                <div className="pdl-chip-row">
                  {draft.artifacts.map((artifact, index) => <span className="pdl-chip" key={`${artifact}-${index}`}>{artifact}<button type="button" aria-label="移除交付物" onClick={() => patchDraft({ artifacts: draft.artifacts.filter((_, itemIndex) => itemIndex !== index) })}><X size={10} /></button></span>)}
                  <div className="pdl-popover-wrap">
                    <button type="button" className="pdl-chip pdl-chip-add" onClick={() => setMenu(menu === 'artifacts' ? null : 'artifacts')}><Plus size={11} />添加</button>
                    {menu === 'artifacts' ? <div className="pdl-popover"><input autoFocus placeholder="输入后回车" onKeyDown={(event) => { if (event.key === 'Enter' && event.currentTarget.value.trim()) { patchDraft({ artifacts: [...draft.artifacts, event.currentTarget.value.trim()] }); event.currentTarget.value = ''; setMenu(null) } }} /></div> : null}
                  </div>
                </div>
              </section>

              <section className="pdl-inspector-section">
                <FieldLabel>能力要求</FieldLabel>
                <div className="pdl-chip-row">
                  {['plan', 'typescript', 'react', 'motion', 'svg', 'elk', 'accessibility'].map((capability) => {
                    const active = draft.capabilities.includes(capability)
                    return <button key={capability} type="button" className={`pdl-chip${active ? ' is-active' : ''}`} onClick={() => patchDraft({ capabilities: active ? draft.capabilities.filter((item) => item !== capability) : [...draft.capabilities, capability] })}>{capability}</button>
                  })}
                </div>
              </section>

              <section className="pdl-inspector-section">
                <button type="button" className="pdl-approval-toggle" onClick={() => patchDraft({ requiresApproval: !draft.requiresApproval })}>
                  <span className={`pdl-switch${draft.requiresApproval ? ' is-on' : ''}`}><i /></span>执行前人工审批
                </button>
              </section>

              <section className="pdl-inspector-danger">
                <div><FieldLabel>危险操作</FieldLabel><p>删除本地原型任务，不可撤销。</p></div>
                <button type="button" className="pdl-text-danger" onClick={() => onDelete(task.id)}><Trash2 size={13} />删除任务</button>
              </section>
            </div>
          )}
        </OverlayScrollArea>
    </InspectorShell>
  )
}
