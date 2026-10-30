import { useState, type ReactElement } from 'react'
import { Check, ChevronDown, GitBranch, Plus, Trash2, X } from 'lucide-react'
import { InspectorShell, OverlayHeader, PopoverShell } from '../../next-ui/overlay/overlay-shell'
import type { LabTask } from './data'

function wouldCycle(tasks: LabTask[], taskId: string, parentId: string): boolean {
  const pending = [parentId],
    seen = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (id === taskId) return true
    if (seen.has(id)) continue
    seen.add(id)
    pending.push(...(tasks.find((item) => item.id === id)?.dependsOn ?? []))
  }
  return false
}

/** Shared plan editor; the owner supplies choices and commits through its existing callbacks. */
export function TaskInspector({
  task,
  tasks,
  onPatch,
  onClose,
  onDelete,
  onInspect,
  open = true,
  theme = 'light',
  roleChoices = ['架构', '开发', '审查', '测试'],
  agentChoices,
  selectedAgent,
  onAgentChange,
  capabilityChoices = ['plan', 'typescript', 'react', 'motion', 'svg', 'elk', 'accessibility'],
}: {
  task: LabTask
  tasks: LabTask[]
  onPatch: (id: string, patch: Partial<LabTask>) => void
  onClose: () => void
  onDelete?: () => void
  onInspect?: (id: string) => void
  open?: boolean
  theme?: 'light' | 'dark'
  roleChoices?: string[]
  agentChoices?: Array<{ value: string; label: string }>
  selectedAgent?: string | null
  onAgentChange?: (value: string) => void
  capabilityChoices?: readonly string[]
}): ReactElement {
  const [menu, setMenu] = useState<'agent' | 'deps' | 'artifacts' | null>(null)
  const [reviewed, setReviewed] = useState<Set<number>>(() => new Set())
  const [deleting, setDeleting] = useState(false),
    [artifact, setArtifact] = useState('')
  const patch = (value: Partial<LabTask>) => onPatch(task.id, value)
  const choices = tasks.filter(
    (item) => !task.dependsOn.includes(item.id) && !wouldCycle(tasks, task.id, item.id),
  )
  const roles = [...new Set([task.role, ...roleChoices])]
  const agents = agentChoices ?? [...new Set([task.agent, 'Sage', 'Kai', 'Mira', 'Nova', 'Iris'])].map((label) => ({ value: label, label }))
  const currentAgent = agentChoices ? selectedAgent ?? '' : task.agent
  const capabilities = [...new Set([...task.capabilities, ...capabilityChoices])]
  return (
    <InspectorShell
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      ariaLabel="任务检查器"
      skin="projectos"
      theme={theme}
      width={480}
      testId="design-lab-inspector"
      className="pdl-task-inspector"
    >
      <OverlayHeader
        eyebrow={task.code}
        title="任务检查器"
        closeLabel="关闭任务检查器"
        onClose={onClose}
        meta={
          <span className={`pdl-inspector-status${task.risk ? ' is-risk' : ''}`}>
            <i aria-hidden />
            {task.risk ? '需复核' : '计划任务'}
            <span>
              {task.role} · {task.agent}
            </span>
          </span>
        }
        actions={
          <button type="button" className="pdl-primary" onClick={onClose}>
            <Check size={14} aria-hidden />
            完成编辑
          </button>
        }
      />
      <div className="pdl-inspector-scroll">
        <section className="pdl-field-block pdl-inspector-overview" aria-label="任务概览">
          <label className="pdl-field-label" htmlFor="pdl-inspector-title">
            任务标题
          </label>
        <textarea
            id="pdl-inspector-title"
            className="pdl-title-input"
            value={task.title}
          rows={2}
            onChange={(event) => patch({ title: event.target.value })}
            aria-invalid={!task.title.trim()}
          />
          {!task.title.trim() ? (
            <p className="pdl-field-error" role="alert">
              请填写任务标题。
            </p>
          ) : null}
          <label className="pdl-field-label" htmlFor="pdl-inspector-description">
            任务说明
          </label>
          <textarea
            id="pdl-inspector-description"
            className="pdl-desc-input"
            value={task.description}
            onChange={(event) => patch({ description: event.target.value })}
            rows={3}
          />
        </section>
        <section className="pdl-field-block" aria-label="角色与 Agent">
          <h3 className="pdl-field-label">角色与 Agent</h3>
          <div className="pdl-role-row" role="group" aria-label="任务角色">
            {roles.map((role) => (
              <button
                key={role}
                type="button"
                className={`pdl-role${task.role === role ? ' is-active' : ''}`}
                aria-pressed={task.role === role}
                onClick={() => patch({ role })}
              >
                {role}
              </button>
            ))}
          </div>
          <PopoverShell
            ariaLabel="选择 Agent"
            open={menu === 'agent'}
            onOpenChange={(next) => setMenu(next ? 'agent' : null)}
            theme={theme}
            className="pdl-inspector-menu"
            trigger={
              <button type="button" className="pdl-select-like" aria-label="选择 Agent">
                <span>
                  <i className="pdl-avatar" aria-hidden>
                    {task.agent.slice(0, 1)}
                  </i>
                  {task.agent}
                </span>
                <ChevronDown size={14} aria-hidden />
              </button>
            }
          >
            <div role="group" aria-label="可选 Agent">
              {agents.map((agent) => (
                <button
                  key={agent.value}
                  type="button"
                  aria-pressed={currentAgent === agent.value}
                  className={currentAgent === agent.value ? 'is-active' : ''}
                  onClick={() => {
                    if (onAgentChange) onAgentChange(agent.value)
                    else patch({ agent: agent.label })
                    setMenu(null)
                  }}
                >
                  <i className="pdl-agent-initial" aria-hidden>
                    {agent.label.slice(0, 1)}
                  </i>
                  <span>{agent.label}</span>
                  {currentAgent === agent.value ? <Check size={14} aria-hidden /> : null}
                </button>
              ))}
            </div>
          </PopoverShell>
        </section>
        <section className="pdl-field-block" aria-label="前置依赖">
          <div className="pdl-field-head">
            <h3 className="pdl-field-label">前置依赖</h3>
            <span>{task.dependsOn.length} 项</span>
          </div>
          <div className="pdl-chip-row">
            {task.dependsOn.length ? (
              task.dependsOn.map((id) => {
                const parent = tasks.find((item) => item.id === id)
                return (
                  <span className="pdl-dependency-chip" key={id}>
                    <button
                      type="button"
                      onClick={() => onInspect?.(id)}
                      disabled={!onInspect}
                      title={parent?.title}
                    >
                      <GitBranch size={13} aria-hidden />
                      {parent?.code ?? id}
                    </button>
                    <button
                      type="button"
                      aria-label={`移除 ${parent?.code ?? id} 依赖`}
                      onClick={() => patch({ dependsOn: task.dependsOn.filter((item) => item !== id) })}
                    >
                      <X size={13} aria-hidden />
                    </button>
                  </span>
                )
              })
            ) : (
              <span className="pdl-empty-inline">无前置依赖</span>
            )}
            <PopoverShell
              ariaLabel="添加前置依赖"
              open={menu === 'deps'}
              onOpenChange={(next) => setMenu(next ? 'deps' : null)}
              theme={theme}
              className="pdl-inspector-menu"
              trigger={
                <button type="button" className="pdl-chip pdl-chip-add" aria-label="添加前置依赖">
                  <Plus size={13} aria-hidden />
                  添加
                </button>
              }
            >
              <div role="group" aria-label="可添加的前置任务">
                {choices.length ? (
                  choices.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        patch({ dependsOn: [...task.dependsOn, item.id] })
                        setMenu(null)
                      }}
                    >
                      <GitBranch size={14} aria-hidden />
                      <span>
                        <small>{item.code}</small>
                        {item.title}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="pdl-menu-empty">没有可添加的前置任务</p>
                )}
              </div>
            </PopoverShell>
          </div>
        </section>
        <section className="pdl-field-block" aria-label="验收标准">
          <div className="pdl-field-head">
            <h3 className="pdl-field-label">验收标准</h3>
            <span>
              {reviewed.size} / {task.criteria.length} 已核对
            </span>
          </div>
          <div className="pdl-criteria">
            {task.criteria.map((criterion, index) => (
              <div className="pdl-criterion" key={`${task.id}-${index}`}>
                <input
                  type="checkbox"
                  className="pdl-criterion-check"
                  aria-label={`核对验收标准 ${index + 1}`}
                  checked={reviewed.has(index)}
                  onChange={() =>
                    setReviewed((current) => {
                      const next = new Set(current)
                      if (next.has(index)) next.delete(index)
                      else next.add(index)
                      return next
                    })
                  }
                />
                <input
                  type="text"
                  aria-label={`验收标准 ${index + 1}`}
                  value={criterion}
                  placeholder="填写验收标准"
                  onChange={(event) => {
                    patch({
                      criteria: task.criteria.map((item, n) => (n === index ? event.target.value : item)),
                    })
                    setReviewed((current) => {
                      const next = new Set(current)
                      next.delete(index)
                      return next
                    })
                  }}
                />
                <button
                  type="button"
                  aria-label={`删除验收标准 ${index + 1}`}
                  onClick={() => {
                    patch({ criteria: task.criteria.filter((_, n) => n !== index) })
                    setReviewed(new Set())
                  }}
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="pdl-add-row"
            onClick={() => {
              patch({ criteria: [...task.criteria, ''] })
              setReviewed(new Set())
            }}
          >
            <Plus size={14} aria-hidden />
            添加验收标准
          </button>
        </section>
        <section className="pdl-field-block" aria-label="预期交付物">
          <div className="pdl-field-head">
            <h3 className="pdl-field-label">预期交付物</h3>
            <span>{task.artifacts.length} 个</span>
          </div>
          <div className="pdl-chip-row">
            {task.artifacts.map((item, index) => (
              <span className="pdl-chip" key={`${item}-${index}`}>
                {item}
                <button
                  type="button"
                  aria-label={`移除交付物 ${item}`}
                  onClick={() => patch({ artifacts: task.artifacts.filter((_, n) => n !== index) })}
                >
                  <X size={13} aria-hidden />
                </button>
              </span>
            ))}
            <PopoverShell
              ariaLabel="添加交付物"
              open={menu === 'artifacts'}
              onOpenChange={(next) => setMenu(next ? 'artifacts' : null)}
              theme={theme}
              className="pdl-inspector-menu"
              trigger={
                <button type="button" className="pdl-chip pdl-chip-add" aria-label="添加交付物">
                  <Plus size={13} aria-hidden />
                  添加
                </button>
              }
            >
              <form
                className="pdl-artifact-form"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (artifact.trim()) {
                    patch({ artifacts: [...task.artifacts, artifact.trim()] })
                    setArtifact('')
                    setMenu(null)
                  }
                }}
              >
                <label htmlFor="pdl-artifact-name">交付物名称</label>
                <input
                  id="pdl-artifact-name"
                  value={artifact}
                  onChange={(event) => setArtifact(event.target.value)}
                  maxLength={200}
                  required
                />
                <button type="submit" className="pui-overlay-button pui-overlay-button-primary">
                  添加交付物
                </button>
              </form>
            </PopoverShell>
          </div>
        </section>
        <section className="pdl-field-block" aria-label="能力要求">
          <h3 className="pdl-field-label">能力要求</h3>
          <div className="pdl-chip-row">
            {capabilities.map((capability) => {
              const selected = task.capabilities.includes(capability)
              return (
                <button
                  key={capability}
                  type="button"
                  className={`pdl-chip${selected ? ' is-active' : ''}`}
                  aria-pressed={selected}
                  onClick={() =>
                    patch({
                      capabilities: selected
                        ? task.capabilities.filter((item) => item !== capability)
                        : [...task.capabilities, capability],
                    })
                  }
                >
                  {selected ? <Check size={12} aria-hidden /> : null}
                  {capability}
                </button>
              )
            })}
          </div>
        </section>
        <section className="pdl-field-block pdl-inspector-bottom">
          <button
            type="button"
            className="pdl-approval-toggle"
            role="switch"
            aria-checked={task.requiresApproval}
            onClick={() => patch({ requiresApproval: !task.requiresApproval })}
          >
            <span className={`pdl-switch${task.requiresApproval ? ' is-on' : ''}`} aria-hidden>
              <i />
            </span>
            执行前人工审批
          </button>
          {onDelete ? (
            <div className="pdl-danger-zone">
              {deleting ? (
                <>
                  <p>确认从此计划中删除任务？</p>
                  <button type="button" className="pdl-role" onClick={() => setDeleting(false)}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="pdl-text-danger"
                    onClick={() => {
                      onDelete()
                      onClose()
                    }}
                  >
                    确认删除
                  </button>
                </>
              ) : (
                <button type="button" className="pdl-text-danger" onClick={() => setDeleting(true)}>
                  <Trash2 size={14} aria-hidden />
                  删除任务
                </button>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </InspectorShell>
  )
}
