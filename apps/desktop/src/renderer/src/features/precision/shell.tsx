import { useEffect, useMemo, useState, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Command,
  FlaskConical,
  House,
  Layers3,
  ListChecks,
  LogIn,
  Moon,
  ShieldCheck,
  Sun,
  Users,
  Workflow,
  Wifi,
} from 'lucide-react'
import {
  ATTENTION,
  PROJECTS,
  STAGES,
  orgById,
  projectById,
  type AttentionItem,
  type RequirementSummary,
  type Tone,
} from './data'
import { VIEW_META, NAV_GROUPS, navKeyFor, type PrecisionView } from './navigation'
import { Avatar, Badge, Dot, SearchInput } from './ui'

const NAV_ICONS: Record<string, ReactNode> = {
  home: <House size={16} strokeWidth={1.7} />,
  layers: <Layers3 size={16} strokeWidth={1.7} />,
  list: <ListChecks size={16} strokeWidth={1.7} />,
  flow: <Workflow size={16} strokeWidth={1.7} />,
  bot: <Bot size={16} strokeWidth={1.7} />,
  users: <Users size={16} strokeWidth={1.7} />,
  pulse: <Activity size={16} strokeWidth={1.7} />,
}

function OrgMark({ initial, kind, size = 30 }: { initial: string; kind: string; size?: number }): ReactNode {
  return (
    <span className="pw-org-mark" data-kind={kind} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}>
      {initial}
    </span>
  )
}

export function Sidebar({
  orgId,
  view,
  requirementCount,
  onNavigate,
  onOrgChange,
  onCommand,
  onToast,
  theme,
  onToggleTheme,
}: {
  orgId: string
  view: PrecisionView
  requirementCount: number
  onNavigate: (view: PrecisionView) => void
  onOrgChange: (orgId: string) => void
  onCommand: () => void
  onToast: (message: string) => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
}): ReactNode {
  const org = orgById(orgId)
  const [accountOpen, setAccountOpen] = useState(false)
  const [orgOpen, setOrgOpen] = useState(false)
  const active = navKeyFor(view)

  return (
    <aside className="pw-sidebar" aria-label="工作区导航">
      <div className="pw-brand">
        <span className="pw-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 2.6 20.4 7v10L12 21.4 3.6 17V7L12 2.6Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="M9 16V8h4.1a2.6 2.6 0 0 1 0 5.2H9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="15.6" cy="16.2" r="1.35" fill="currentColor" />
          </svg>
        </span>
        <span className="pw-brand-copy">
          <strong>ProjectOS</strong>
          <small>Precision Workspace</small>
        </span>
      </div>

      <Popover.Root open={orgOpen} onOpenChange={setOrgOpen}>
        <Popover.Trigger asChild>
          <button type="button" className="pw-org" aria-label={`切换组织，当前 ${org.name}`} aria-expanded={orgOpen}>
            <OrgMark initial={org.name.slice(0, 1)} kind={org.kind} />
            <span className="pw-org-copy">
              <strong>{org.name}</strong>
              <small>{org.caption}</small>
            </span>
            <ChevronDown size={15} className={orgOpen ? 'is-open' : ''} aria-hidden="true" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <div className="pw-portal pw-theme" data-theme={theme}>
          <Popover.Content className="pw-pop pw-org-pop" sideOffset={6} align="start" collisionPadding={10}>
            <div className="pw-pop-head">
              <span>切换组织</span>
              <span className="pw-pop-hint">{org.role}</span>
            </div>
            <div className="pw-org-list">
              {[orgById('org-starsea'), orgById('org-polaris'), orgById('org-personal')].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`pw-org-option${item.id === orgId ? ' is-current' : ''}`}
                  onClick={() => {
                    onOrgChange(item.id)
                    setOrgOpen(false)
                    onToast(`已切换到「${item.name}」· 演示数据已按组织隔离`)
                  }}
                >
                  <OrgMark initial={item.name.slice(0, 1)} kind={item.kind} size={26} />
                  <span className="pw-org-option-copy">
                    <strong>{item.name}</strong>
                    <small>{item.members} 位成员 · {item.projects} 个项目</small>
                  </span>
                  {item.id === orgId ? <Check size={14} className="pw-org-check" /> : null}
                </button>
              ))}
            </div>
            <div className="pw-pop-divider" />
            <button type="button" className="pw-pop-action" disabled title="组织创建属于 A1 范围，A0 不提供假入口">
              <span className="pw-pop-action-icon"><ShieldCheck size={14} /></span>
              创建组织
              <Badge tone="neutral" className="pw-tag-a1">A1</Badge>
            </button>
            <button type="button" className="pw-pop-action" disabled title="邀请与加入属于 A1 范围，A0 不提供假入口">
              <span className="pw-pop-action-icon"><LogIn size={14} /></span>
              加入组织
              <Badge tone="neutral" className="pw-tag-a1">A1</Badge>
            </button>
            <p className="pw-pop-foot">切换组织会重新校验成员与资产权限；演示数据只用于视觉验收。</p>
          </Popover.Content>
          </div>
        </Popover.Portal>
      </Popover.Root>

      <nav className="pw-nav">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !(org.kind === 'personal' && item.personalHidden))
          if (items.length === 0) return null
          return (
            <div className="pw-nav-group" key={group.id}>
              <div className="pw-nav-label">{group.label}</div>
              {items.map((item) => (
                <button
                  key={item.view}
                  type="button"
                  className={`pw-nav-item${active === item.view ? ' is-active' : ''}`}
                  aria-current={active === item.view ? 'page' : undefined}
                  onClick={() => onNavigate(item.view)}
                >
                  <span className="pw-nav-icon">{NAV_ICONS[item.icon]}</span>
                  <span>{item.label}</span>
                  {item.count && requirementCount > 0 ? <span className="pw-nav-count">{requirementCount}</span> : null}
                </button>
              ))}
            </div>
          )
        })}
      </nav>

      <div className="pw-sidebar-foot">
        <div className="pw-worker">
          <span className="pw-worker-dot" aria-hidden="true" />
          <span>Local Worker 已连接</span>
          <span className="pw-worker-version">v2.0</span>
        </div>

        <Popover.Root open={accountOpen} onOpenChange={setAccountOpen}>
          <Popover.Trigger asChild>
            <button type="button" className="pw-account" aria-expanded={accountOpen} aria-label="账号菜单">
              <Avatar name="林可" initial="林" size={28} tone="accent" />
              <span className="pw-account-copy">
                <strong>林可</strong>
                <small>{org.role}</small>
              </span>
              <ChevronDown size={14} className={accountOpen ? 'is-open' : ''} aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <div className="pw-portal pw-theme" data-theme={theme}>
            <Popover.Content className="pw-pop pw-account-pop" side="top" align="start" sideOffset={8} collisionPadding={12}>
              <div className="pw-account-head">
                <Avatar name="林可" initial="林" size={34} tone="accent" />
                <div>
                  <strong>林可</strong>
                  <small>lin.ke@demo.invalid</small>
                </div>
              </div>
              <div className="pw-pop-divider" />
              <button type="button" className="pw-pop-action" onClick={() => { setAccountOpen(false); onCommand() }}>
                <span className="pw-pop-action-icon"><Command size={14} /></span>
                命令面板
                <kbd className="pw-kbd">Ctrl K</kbd>
              </button>
              <button type="button" className="pw-pop-action" onClick={onToggleTheme}>
                <span className="pw-pop-action-icon">{theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}</span>
                {theme === 'dark' ? '切换到浅色' : '切换到深色'}
              </button>
              <button type="button" className="pw-pop-action" onClick={() => { setAccountOpen(false); onToast('原型说明：本页是 A0 设计母版，数据不写入后端') }}>
                <span className="pw-pop-action-icon"><FlaskConical size={14} /></span>
                关于此原型
              </button>
              <div className="pw-pop-divider" />
              <button type="button" className="pw-pop-action" disabled title="组织登录在 A1 实装，A0 不提供假登录">
                <span className="pw-pop-action-icon"><LogIn size={14} /></span>
                登录组织账号
                <Badge tone="neutral" className="pw-tag-a1">A1</Badge>
              </button>
              <p className="pw-pop-foot">当前为本地演示会话，不包含真实凭据。</p>
            </Popover.Content>
            </div>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </aside>
  )
}

export function TopBar({
  orgId,
  view,
  query,
  onQuery,
  onCommand,
  theme,
  onToggleTheme,
  onNavigate,
  onOpenAttention,
}: {
  orgId: string
  view: PrecisionView
  query: string
  onQuery: (value: string) => void
  onCommand: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onNavigate: (view: PrecisionView) => void
  onOpenAttention: (item: AttentionItem) => void
}): ReactNode {
  const org = orgById(orgId)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const crumbs = VIEW_META[view].crumb.split(' / ')

  return (
    <header className="pw-topbar">
      <div className="pw-crumbs" aria-label="位置">
        <span>{org.kind === 'personal' ? '个人工作区' : '工作空间'}</span>
        {crumbs.map((crumb) => (
          <span className="pw-crumb" key={crumb}>
            <ChevronRight size={12} aria-hidden="true" />
            <strong>{crumb}</strong>
          </span>
        ))}
      </div>

      <div className="pw-top-actions">
        <span className="pw-prototype" title="A0 设计原型：使用演示数据，不连接真实后端">
          <FlaskConical size={12} aria-hidden="true" />
          <span className="pw-prototype-long">DESIGN PROTOTYPE · 演示数据</span>
          <span className="pw-prototype-short">PROTOTYPE</span>
        </span>

        <div className="pw-search-slot">
          <SearchInput value={query} onChange={onQuery} placeholder="搜索需求" label="搜索需求和项目" shortcut="Ctrl K" />
        </div>

        <button type="button" className="pw-icon-btn pw-command-trigger" aria-label="打开命令面板" title="命令面板 (Ctrl K)" onClick={onCommand}>
          <Command size={15} />
        </button>

        <button type="button" className="pw-icon-btn" aria-label={theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'} title={theme === 'dark' ? '切换到浅色' : '切换到深色'} onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <Popover.Root open={notifyOpen} onOpenChange={setNotifyOpen}>
          <Popover.Trigger asChild>
            <button type="button" className="pw-icon-btn" aria-label="查看待处理事项" title="待处理事项" aria-expanded={notifyOpen}>
              <Bell size={16} />
              <span className="pw-icon-btn-dot" aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <div className="pw-portal pw-theme" data-theme={theme}>
            <Popover.Content className="pw-pop pw-notify-pop" align="end" sideOffset={8} collisionPadding={12}>
              <div className="pw-pop-head">
                <span>待处理事项</span>
                <Badge tone="warn" dot>{ATTENTION.length}</Badge>
              </div>
              {ATTENTION.map((item) => (
                <button
                  type="button"
                  className="pw-notify-item"
                  key={item.id}
                  onClick={() => {
                    setNotifyOpen(false)
                    onOpenAttention(item)
                  }}
                >
                  <span className="pw-notify-icon" data-tone={item.tone}>
                    {item.kind === 'gate' ? <ShieldCheck size={14} /> : <Users size={14} />}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </span>
                  <ChevronRight size={13} aria-hidden="true" />
                </button>
              ))}
              <div className="pw-pop-divider" />
              <button type="button" className="pw-pop-action" onClick={() => { setNotifyOpen(false); onNavigate('runs') }}>
                <span className="pw-pop-action-icon"><Activity size={14} /></span>
                打开运行中心
                <ArrowRight size={13} />
              </button>
            </Popover.Content>
            </div>
          </Popover.Portal>
        </Popover.Root>
      </div>
    </header>
  )
}

export function JourneyBar({
  requirement,
  stageIndex,
  tone,
  statusLabel,
  onOpenRequirement,
  onOpenApproval,
}: {
  requirement: RequirementSummary
  stageIndex: number
  tone: Tone
  statusLabel: string
  onOpenRequirement: () => void
  onOpenApproval: () => void
}): ReactNode {
  const project = projectById(requirement.projectId)
  return (
    <div className="pw-journey">
      <div className="pw-journey-focus">
        <span className="pw-journey-kicker">
          当前需求 <b>{requirement.id}</b> · {project?.key ?? 'OSP'}
        </span>
        <button type="button" className="pw-journey-title" onClick={onOpenRequirement} title="打开需求工作台">
          {requirement.title}
        </button>
      </div>

      <ol className="pw-journey-steps" aria-label={`需求旅程，当前阶段 ${STAGES[stageIndex]?.label ?? ''}`}>
        {STAGES.map((stage, index) => (
          <li
            key={stage.id}
            className={`pw-journey-step${index < stageIndex ? ' is-done' : ''}${index === stageIndex ? ' is-active' : ''}`}
            aria-current={index === stageIndex ? 'step' : undefined}
            title={stage.label}
          >
            <i aria-hidden="true" />
            <span>{stage.label}</span>
          </li>
        ))}
      </ol>

      <button type="button" className={`pw-journey-action is-${tone}`} onClick={onOpenApproval}>
        {tone === 'ok' ? <Check size={13} /> : tone === 'danger' ? <CircleAlert size={13} /> : <span className="pw-journey-dot" />}
        <span>{statusLabel}</span>
        <ArrowRight size={13} aria-hidden="true" />
      </button>
    </div>
  )
}

export function StatusBar({ workerOnline = true }: { workerOnline?: boolean }): ReactNode {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const activeProjects = useMemo(() => PROJECTS.filter((project) => project.status !== '本地模式').length, [])
  return (
    <footer className="pw-statusbar">
      <span className="pw-status-left">
        <Wifi size={11} aria-hidden="true" />
        LOCAL WORKER
        <Dot tone={workerOnline ? 'ok' : 'danger'} />
        {workerOnline ? '已连接' : '离线'}
        <span className="pw-status-sep" aria-hidden="true" />
        {activeProjects} 个项目活动中
      </span>
      <span className="pw-status-right">
        <span>DESIGN PROTOTYPE · 不写入后端</span>
        <span className="pw-status-sep" aria-hidden="true" />
        <span className="pw-mono">{size.width} × {size.height}</span>
      </span>
    </footer>
  )
}
