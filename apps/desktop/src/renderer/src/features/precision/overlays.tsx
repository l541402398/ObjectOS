import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Command,
  FileText,
  GitBranch,
  Layers3,
  ListChecks,
  MessageSquare,
  Moon,
  Plus,
  ShieldCheck,
  Sun,
  Workflow,
  X,
} from 'lucide-react'
import {
  PROJECTS,
  projectById,
  requirementStatus,
  type AttentionItem,
  type GateState,
  type RequirementSummary,
} from './data'
import { Badge, Button, Field, Select, TextInput } from './ui'
import type { PrecisionView } from './navigation'

export type ApprovalSubject =
  | { kind: 'gate'; requirement: RequirementSummary }
  | { kind: 'asset'; item: AttentionItem }

export function ApprovalDrawer({
  subject,
  gate,
  theme,
  onClose,
  onDecide,
}: {
  subject: ApprovalSubject | null
  gate?: GateState
  theme: 'light' | 'dark'
  onClose: () => void
  onDecide: (decision: 'approved' | 'changes', note: string) => void
}): ReactNode {
  const [decision, setDecision] = useState<'approved' | 'changes'>('approved')
  const [note, setNote] = useState('')
  const open = subject !== null

  useEffect(() => {
    setDecision('approved')
    setNote('')
  }, [subject])

  const requirement = subject?.kind === 'gate' ? subject.requirement : null
  const alreadyDecided = Boolean(requirement && gate)
  const changeNeedsNote = decision === 'changes' && note.trim().length < 4

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <div className="pw-portal pw-theme" data-theme={theme}>
        <Dialog.Overlay className="pw-dialog-overlay" />
        <Dialog.Content className="pw-drawer" aria-describedby={undefined}>
          <div className="pw-drawer-head">
            <div>
              <span className="pw-dialog-kicker">
                {subject?.kind === 'asset' ? '资产授权' : alreadyDecided ? '审批记录' : '待审批门禁'}
              </span>
              <Dialog.Title>
                {subject?.kind === 'asset' ? subject.item.title : requirement?.gate?.title ?? '审批'}
              </Dialog.Title>
              <p className="pw-drawer-sub">
                {subject?.kind === 'asset'
                  ? 'Agent 请求只读访问内部知识库'
                  : `${requirement?.id} · ${projectById(requirement?.projectId ?? '')?.name ?? ''}`}
              </p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="pw-icon-btn" aria-label="关闭审批抽屉"><X size={16} /></button>
            </Dialog.Close>
          </div>

          <div className="pw-drawer-body">
            {subject?.kind === 'asset' ? (
              <>
                <div className="pw-approval-summary">
                  <span className="pw-approval-icon"><ShieldCheck size={18} /></span>
                  <div>
                    <strong>Agent Sage · 架构 Agent v1.9.3</strong>
                    <p>申请只读访问「内部知识库」，范围限定到 ProjectOS Core，有效期 7 天。</p>
                  </div>
                </div>
                <div className="pw-approval-block">
                  <h3>授权范围</h3>
                  <ul className="pw-check-list">
                    <li><Check size={12} /><span>只读检索：<span className="pw-mono">knowledge://osp-core/**</span></span></li>
                    <li><Check size={12} /><span>不可写入、不可导出原始文档、不可访问其他项目</span></li>
                    <li><CircleAlert size={12} /><span>授权不等于可以执行本机命令；Shell 仍需 Worker 单独授权</span></li>
                  </ul>
                </div>
                <div className="pw-approval-block">
                  <h3>风险提示</h3>
                  <p className="pw-approval-copy">
                    知识库可能包含内部设计说明。批准后 Sage 只能在自己的 Run 中读取，审计事件会记录调用者与范围；
                    撤销授权会使后续调用立即失效。
                  </p>
                </div>
              </>
            ) : requirement && requirement.gate ? (
              <>
                <div className="pw-approval-summary">
                  <Badge tone={requirementStatus(requirement, gate).tone} dot>{requirementStatus(requirement, gate).label}</Badge>
                  <p>{requirement.nextStep}</p>
                </div>

                <div className="pw-approval-block">
                  <h3>审批对象</h3>
                  <div className="pw-approval-kv">
                    <div><span>需求</span><strong>{requirement.id} · {requirement.title}</strong></div>
                    <div><span>文档版本</span><strong className="pw-mono">{requirement.gate.docVersion}</strong></div>
                    <div><span>内容 hash</span><strong className="pw-mono">{requirement.gate.hash}</strong></div>
                    <div><span>审批角色</span><strong>{requirement.gate.role}</strong></div>
                    <div><span>分支</span><strong className="pw-mono">{requirement.branch}</strong></div>
                  </div>
                </div>

                <div className="pw-approval-block">
                  <h3>本次审批范围</h3>
                  <ul className="pw-approval-checklist">
                    {requirement.gate.required.map((item) => (
                      <li key={item}><Check size={13} /><span>{item}</span><em>已核对</em></li>
                    ))}
                  </ul>
                  <p className="pw-approval-hint">
                    批准后旧内容 hash 的审批仍保留在审计记录中；若文档再次修订，本次审批自动失效。
                  </p>
                </div>

                {alreadyDecided ? (
                  <div className={`pw-decided-box is-${gate?.status}`}>
                    <strong>{gate?.status === 'approved' ? '该门禁已批准' : '已要求修改'}</strong>
                    <p>{gate?.decidedBy ?? '项目 Maintainer'} · {gate?.decidedAt ?? '刚刚'}</p>
                    {gate?.note ? <p>{gate.note}</p> : null}
                  </div>
                ) : (
                  <div className="pw-approval-block">
                    <h3>审批决定</h3>
                    <div className="pw-decision-options" role="radiogroup" aria-label="审批决定">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={decision === 'approved'}
                        className={`pw-decision-option${decision === 'approved' ? ' is-selected' : ''}`}
                        onClick={() => setDecision('approved')}
                      >
                        <CheckCircle2 size={16} />
                        <span><strong>批准设计</strong><small>门禁通过，允许创建执行计划</small></span>
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={decision === 'changes'}
                        className={`pw-decision-option${decision === 'changes' ? ' is-selected' : ''}`}
                        onClick={() => setDecision('changes')}
                      >
                        <MessageSquare size={16} />
                        <span><strong>要求修改</strong><small>保持锁定，回到设计阶段</small></span>
                      </button>
                    </div>

                    <Field label={decision === 'changes' ? '修改要求（必填）' : '审批备注（可选）'} hint="审批记录会写入审计事件，包含角色、时间与内容 hash。">
                      <textarea
                        className="pw-textarea"
                        rows={3}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder={decision === 'changes' ? '说明需要补强的设计、证据或风险' : '例如：证据与当前内容快照一致，同意进入开发'}
                        maxLength={280}
                      />
                    </Field>
                  </div>
                )}
              </>
            ) : null}
          </div>

          <div className="pw-drawer-foot">
            <span className="pw-drawer-note">原型交互 · 不写入服务器，也不启动执行</span>
            <div className="pw-drawer-actions">
              <Dialog.Close asChild><Button variant="ghost">关闭</Button></Dialog.Close>
              {subject?.kind === 'asset' ? (
                <Button
                  variant="primary"
                  icon={<Check size={14} />}
                  onClick={() => {
                    onDecide('approved', note || '原型：已模拟批准 7 天只读授权')
                  }}
                >
                  批准只读授权
                </Button>
              ) : requirement && !alreadyDecided ? (
                <Button
                  variant={decision === 'changes' ? 'danger' : 'primary'}
                  disabled={changeNeedsNote}
                  icon={decision === 'changes' ? <MessageSquare size={14} /> : <Check size={14} />}
                  onClick={() => onDecide(decision, note)}
                >
                  {decision === 'changes' ? '提交修改要求' : '批准设计'}
                </Button>
              ) : (
                <Dialog.Close asChild><Button variant="primary">完成</Button></Dialog.Close>
              )}
            </div>
          </div>
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export interface CreateRequirementInput {
  title: string
  projectId: string
  template: string
  note: string
}

export function CreateRequirementDialog({
  open,
  orgId,
  theme,
  onClose,
  onCreate,
}: {
  open: boolean
  orgId: string
  theme: 'light' | 'dark'
  onClose: () => void
  onCreate: (input: CreateRequirementInput) => void
}): ReactNode {
  const projects = useMemo(() => PROJECTS.filter((project) => project.orgId === orgId), [orgId])
  const [title, setTitle] = useState('')
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [template, setTemplate] = useState('标准研发 v2')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setNote('')
    setTouched(false)
    setProjectId(projects[0]?.id ?? '')
  }, [open, projects])

  const titleError = touched && title.trim().length < 4 ? '需求标题至少 4 个字符' : null
  const canSubmit = title.trim().length >= 4 && Boolean(projectId)

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <div className="pw-portal pw-theme" data-theme={theme}>
        <Dialog.Overlay className="pw-dialog-overlay" />
        <Dialog.Content className="pw-dialog pw-create-dialog" aria-describedby={undefined}>
          <div className="pw-dialog-head">
            <div>
              <Dialog.Title>创建需求</Dialog.Title>
              <p className="pw-drawer-sub">加入当前组织项目，选择流程模板后进入独立旅程。</p>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="pw-icon-btn" aria-label="关闭创建需求"><X size={16} /></button>
            </Dialog.Close>
          </div>

          <div className="pw-create-body">
            <Field label="需求标题" htmlFor="create-title" hint={titleError ?? '用一句话说明要解决的用户问题。'}>
              <TextInput
                id="create-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="例如：完善组织成员邀请流程"
                maxLength={70}
                autoFocus
                aria-invalid={Boolean(titleError)}
              />
            </Field>
            <div className="pw-field-row">
              <Field label="所属项目">
                <Select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name} · {project.key}</option>
                  ))}
                </Select>
              </Field>
              <Field label="研发流程">
                <Select value={template} onChange={(event) => setTemplate(event.target.value)}>
                  <option>标准研发 v2</option>
                  <option>快速修复 v1</option>
                  <option>高风险流程 v3</option>
                </Select>
              </Field>
            </div>
            <Field label="补充说明（可选）">
              <textarea
                className="pw-textarea"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="背景、约束或期望的验收方式"
                maxLength={240}
              />
            </Field>
            <div className="pw-create-preview">
              <span className="pw-create-preview-label"><Workflow size={13} /> 将创建</span>
              <div>
                <span><FileText size={12} /> 需求文档</span>
                <ArrowRight size={11} />
                <span><ShieldCheck size={12} /> 需求审核</span>
                <ArrowRight size={11} />
                <span><Layers3 size={12} /> 技术设计与开发</span>
                <ArrowRight size={11} />
                <span><CheckCircle2 size={12} /> 交付门禁</span>
              </div>
            </div>
            <p className="pw-dialog-note">
              原型交互：需求只加入当前演示会话，不写入 SQLite、不创建 Worktree、不启动 Agent。
            </p>
          </div>

          <div className="pw-dialog-actions">
            <Dialog.Close asChild><Button variant="ghost">取消</Button></Dialog.Close>
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              disabled={!canSubmit}
              onClick={() => onCreate({ title: title.trim(), projectId, template, note: note.trim() })}
            >
              创建需求
            </Button>
          </div>
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export interface CommandAction {
  id: string
  group: '导航' | '操作'
  label: string
  hint?: string
  icon: ReactNode
  run: () => void
}

export function CommandPalette({
  open,
  actions,
  onClose,
  onNavigate,
  onToggleTheme,
  theme,
  onCreate,
  onOpenApproval,
}: {
  open: boolean
  actions?: CommandAction[]
  onClose: () => void
  onNavigate: (view: PrecisionView) => void
  onToggleTheme: () => void
  theme: 'light' | 'dark'
  onCreate: () => void
  onOpenApproval: () => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const commands = useMemo<CommandAction[]>(() => {
    if (actions) return actions
    return [
      { id: 'nav-overview', group: '导航', label: '打开研发工作台', hint: '工作台', icon: <Layers3 size={14} />, run: () => onNavigate('overview') },
      { id: 'nav-projects', group: '导航', label: '打开项目中心', hint: '项目', icon: <FileText size={14} />, run: () => onNavigate('projects') },
      { id: 'nav-requirements', group: '导航', label: '打开需求中心', hint: '需求', icon: <ListChecks size={14} />, run: () => onNavigate('requirements') },
      { id: 'nav-workflow', group: '导航', label: '打开流程模板设计器', hint: '流程', icon: <Workflow size={14} />, run: () => onNavigate('workflow') },
      { id: 'nav-runs', group: '导航', label: '打开运行与审计', hint: '运行', icon: <GitBranch size={14} />, run: () => onNavigate('runs') },
      { id: 'act-create', group: '操作', label: '创建需求', hint: '原型', icon: <Plus size={14} />, run: onCreate },
      { id: 'act-approval', group: '操作', label: '打开待审批门禁', hint: '审批', icon: <ShieldCheck size={14} />, run: onOpenApproval },
      { id: 'act-theme', group: '操作', label: theme === 'dark' ? '切换到浅色主题' : '切换到深色主题', hint: '外观', icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />, run: onToggleTheme },
    ]
  }, [actions, onCreate, onNavigate, onOpenApproval, onToggleTheme, theme])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return commands
    return commands.filter((command) => `${command.label} ${command.hint ?? ''} ${command.group}`.toLowerCase().includes(normalized))
  }, [commands, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    window.setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(filtered.length - 1, 0)))
  }, [filtered.length])

  const run = (command: CommandAction): void => {
    onClose()
    command.run()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog.Portal>
        <div className="pw-portal pw-theme" data-theme={theme}>
        <Dialog.Overlay className="pw-dialog-overlay" />
        <Dialog.Content className="pw-command" aria-describedby={undefined}>
          <Dialog.Title className="pw-sr-only">命令面板</Dialog.Title>
          <div className="pw-command-input">
            <Command size={16} aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setActive((current) => Math.min(current + 1, filtered.length - 1))
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setActive((current) => Math.max(current - 1, 0))
                }
                if (event.key === 'Enter') {
                  event.preventDefault()
                  const command = filtered[active]
                  if (command) run(command)
                }
              }}
              placeholder="输入命令或搜索页面…"
              aria-label="命令搜索"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd>ESC</kbd>
          </div>
          <div className="pw-command-list" role="listbox" aria-label="命令列表">
            {filtered.length === 0 ? (
              <p className="pw-command-empty">没有匹配的命令。尝试“需求”“流程”或“主题”。</p>
            ) : (
              filtered.map((command, index) => (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`pw-command-item${index === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <span className="pw-command-icon">{command.icon}</span>
                  <span className="pw-command-label">{command.label}</span>
                  {command.hint ? <span className="pw-command-hint">{command.hint}</span> : null}
                  <ArrowRight size={13} className="pw-command-arrow" />
                </button>
              ))
            )}
          </div>
          <div className="pw-command-foot">
            <span>↑↓ 选择</span>
            <span>↵ 打开</span>
            <span>Esc 关闭</span>
          </div>
        </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Toast({ message, onClose }: { message: string | null; onClose: () => void }): ReactNode {
  if (!message) return null
  return (
    <div className="pw-toast" role="status" aria-live="polite">
      <span className="pw-toast-icon"><Check size={13} /></span>
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="关闭提示"><X size={13} /></button>
    </div>
  )
}
