import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import '@projectos/design-tokens/precision.css'
import './precision.css'
import './precision-workflow.css'
import {
  ATTENTION,
  REQUIREMENTS,
  projectsForOrg,
  requirementById,
  requirementStatus,
  type AttentionItem,
  type GateState,
  type ProjectSummary,
  type RequirementSummary,
} from './data'
import { JourneyBar, Sidebar, StatusBar, TopBar } from './shell'
import type { PrecisionView } from './navigation'
import { OverviewScreen } from './screens/OverviewScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { RequirementsListScreen } from './screens/RequirementsListScreen'
import { RequirementWorkspace } from './screens/RequirementWorkspace'
import { WorkflowScreen } from './screens/WorkflowScreen'
import { AgentsScreen, MembersScreen, RunsScreen } from './screens/OrgScreens'
import {
  ApprovalDrawer,
  CommandPalette,
  CreateRequirementDialog,
  Toast,
  type ApprovalSubject,
  type CreateRequirementInput,
} from './overlays'
import { Button } from './ui'

type DemoState = 'ready' | 'empty' | 'error' | 'loading'

const VIEWS: PrecisionView[] = ['overview', 'projects', 'requirements', 'requirement', 'workflow', 'agents', 'members', 'runs']

function readParams(): URLSearchParams {
  const hash = window.location.hash
  const index = hash.indexOf('?')
  return new URLSearchParams(index >= 0 ? hash.slice(index + 1) : '')
}

function initialTheme(params: URLSearchParams): 'light' | 'dark' {
  const forced = params.get('theme')
  if (forced === 'dark' || forced === 'light') return forced
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export default function PrecisionWorkspace(): ReactNode {
  const params = useMemo(() => readParams(), [])
  const createCounter = useRef(125)

  const [theme, setTheme] = useState<'light' | 'dark'>(() => initialTheme(params))
  const [view, setView] = useState<PrecisionView>(() => {
    const screen = params.get('screen') as PrecisionView | null
    return screen && VIEWS.includes(screen) ? screen : 'overview'
  })
  const [orgId, setOrgId] = useState(() => params.get('org') ?? 'org-starsea')
  const [requirements, setRequirements] = useState<RequirementSummary[]>(REQUIREMENTS)
  const [gates, setGates] = useState<Record<string, GateState>>({})
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get('req') ?? 'REQ-124')
  const [query, setQuery] = useState('')
  const [projectFilter, setProjectFilter] = useState<ProjectSummary | null>(null)
  const [demoState, setDemoState] = useState<DemoState>(() => {
    const value = params.get('state')
    return value === 'empty' || value === 'error' || value === 'loading' ? value : 'ready'
  })
  const [approval, setApproval] = useState<ApprovalSubject | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const initialTab = params.get('tab')

  const orgRequirements = useMemo(
    () => (demoState === 'empty' ? [] : requirements.filter((requirement) => requirement.orgId === orgId)),
    [demoState, orgId, requirements],
  )

  const focus = useMemo(() => {
    const selected = orgRequirements.find((requirement) => requirement.id === selectedId)
    return selected ?? orgRequirements[0] ?? null
  }, [orgRequirements, selectedId])

  const effectiveView: PrecisionView = view === 'requirement' && !focus ? 'requirements' : view

  const notify = useCallback((message: string) => setToast(message), [])

  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const previous = document.title
    document.title = 'ProjectOS · Precision Workspace (A0 design prototype)'
    return () => {
      document.title = previous
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const navigate = (next: PrecisionView): void => {
    setView(next)
    if (next === 'requirements') setProjectFilter(null)
  }

  const openRequirement = (id: string): void => {
    setSelectedId(id)
    setView('requirement')
  }

  const openProject = (project: ProjectSummary): void => {
    setProjectFilter(project)
    setView('requirements')
  }

  const changeOrg = (nextOrgId: string): void => {
    setOrgId(nextOrgId)
    setProjectFilter(null)
    setQuery('')
    setView('overview')
    setApproval(null)
    const first = requirements.find((requirement) => requirement.orgId === nextOrgId)
    setSelectedId(first?.id ?? null)
  }

  const changeQuery = (value: string): void => {
    setQuery(value)
    if (value.trim() && effectiveView !== 'requirements') setView('requirements')
  }

  const retry = (): void => {
    setDemoState('loading')
    window.setTimeout(() => {
      setDemoState('ready')
      notify('演示数据已重新载入（未请求真实服务器）')
    }, 700)
  }

  const openApprovalFor = (requirement: RequirementSummary): void => {
    if (!requirement.gate) {
      notify(`当前阶段没有人工门禁：${requirement.nextStep}`)
      return
    }
    setApproval({ kind: 'gate', requirement })
  }

  const openAttention = (item: AttentionItem): void => {
    if (item.kind === 'gate' && item.requirementId) {
      const requirement = requirementById(item.requirementId)
      if (requirement) {
        setApproval({ kind: 'gate', requirement })
        return
      }
    }
    setApproval({ kind: 'asset', item })
  }

  const decide = (decision: 'approved' | 'changes', note: string): void => {
    if (!approval) return
    if (approval.kind === 'asset') {
      setToast(`原型交互：已模拟${decision === 'approved' ? '批准' : '拒绝'}资产授权申请（未写入服务器）`)
      setApproval(null)
      return
    }
    const requirement = approval.requirement
    setGates((current) => ({
      ...current,
      [requirement.id]: {
        status: decision,
        decidedBy: '林可',
        decidedAt: '刚刚',
        note: note.trim() || undefined,
      },
    }))
    setRequirements((current) =>
      current.map((item) =>
        item.id === requirement.id
          ? {
              ...item,
              stageIndex: decision === 'approved' ? Math.min(item.stageIndex + 1, 7) : item.stageIndex,
              nextStep: decision === 'approved'
                ? '门禁已通过，可以创建执行计划与需求级 Worktree；本机执行仍需 Worker 授权。'
                : '设计文档需要修订：门禁保持锁定，修订后重新提交审批。',
            }
          : item,
      ),
    )
    setToast(decision === 'approved'
      ? `已批准 ${requirement.id} · ${requirement.gate?.title ?? '门禁'}（原型审计事件，未写入服务器）`
      : `已要求修改 ${requirement.id}，门禁保持锁定`)
    setApproval(null)
  }

  const createRequirement = (input: CreateRequirementInput): void => {
    createCounter.current += 1
    const id = `REQ-${createCounter.current}`
    const next: RequirementSummary = {
      id,
      title: input.title,
      projectId: input.projectId,
      orgId,
      owner: '林可',
      ownerInitial: '林',
      stageIndex: 0,
      tone: 'neutral',
      template: input.template,
      updated: '刚刚',
      branch: `feature/${id.toLowerCase()}-work`,
      baseCommit: '9e2f82a',
      gate: null,
      goal: input.note || input.title,
      scope: ['由原型会话创建，范围待补充'],
      acceptance: [
        { id: `${id}-ac-1`, text: '需求文档与验收标准已确认', met: false },
        { id: `${id}-ac-2`, text: '设计或实现范围已评审', met: false },
      ],
      events: [
        {
          id: `${id}-ev-1`,
          time: '刚刚',
          actor: '林可',
          actorKind: 'human',
          action: '在原型会话中创建需求',
          detail: `${input.template} · 未写入 SQLite / 未创建 Worktree`,
          tone: 'neutral',
        },
      ],
      evidence: [],
      nextStep: '等待需求文档生成与需求审核门禁。',
    }
    setRequirements((current) => [next, ...current])
    setCreateOpen(false)
    setSelectedId(id)
    setView('requirement')
    setToast('已把需求加入演示列表（原型交互，未写入真实系统）')
  }

  const content = ((): ReactNode => {
    switch (effectiveView) {
      case 'overview':
        return (
          <OverviewScreen
            orgId={orgId}
            requirements={orgRequirements}
            gates={gates}
            state={demoState}
            onOpenRequirement={openRequirement}
            onOpenAttention={openAttention}
            onNavigate={navigate}
            onCreate={() => setCreateOpen(true)}
            onRetry={retry}
          />
        )
      case 'projects':
        return (
          <ProjectsScreen
            orgId={orgId}
            onOpenProjectRequirements={openProject}
            onNavigate={navigate}
            onToast={notify}
          />
        )
      case 'requirements':
        return (
          <RequirementsListScreen
            requirements={orgRequirements}
            gates={gates}
            state={demoState}
            query={query}
            onQuery={setQuery}
            projectFilter={projectFilter}
            onClearProject={() => setProjectFilter(null)}
            onOpenRequirement={openRequirement}
            onCreate={() => setCreateOpen(true)}
            onRetry={retry}
          />
        )
      case 'requirement':
        return (
          <RequirementWorkspace
            requirements={orgRequirements}
            gates={gates}
            selectedId={selectedId}
            state={demoState}
            initialTab={initialTab === 'document' || initialTab === 'execution' || initialTab === 'evidence' ? initialTab : 'overview'}
            onSelect={setSelectedId}
            onBack={() => setView('requirements')}
            onOpenApproval={openApprovalFor}
            onToast={notify}
            onRetry={retry}
            onNavigateRuns={() => setView('runs')}
          />
        )
      case 'workflow':
        return <WorkflowScreen onToast={notify} />
      case 'agents':
        return <AgentsScreen onToast={notify} />
      case 'members':
        return <MembersScreen onToast={notify} />
      case 'runs':
        return <RunsScreen onToast={notify} />
      default:
        return null
    }
  })()

  const isFill = effectiveView === 'requirement' || effectiveView === 'workflow'
  const gate = focus ? gates[focus.id] : undefined
  const focusStatus = focus ? requirementStatus(focus, gate) : null

  return (
    <div className="pw-root pw-theme" data-theme={theme} data-screen={effectiveView}>
      <Sidebar
        orgId={orgId}
        view={effectiveView}
        requirementCount={orgRequirements.length}
        onNavigate={navigate}
        onOrgChange={changeOrg}
        onCommand={() => setCommandOpen(true)}
        onToast={notify}
        theme={theme}
        onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
      />

      <div className="pw-main">
        <TopBar
          orgId={orgId}
          view={effectiveView}
          query={query}
          onQuery={changeQuery}
          onCommand={() => setCommandOpen(true)}
          theme={theme}
          onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          onNavigate={navigate}
          onOpenAttention={openAttention}
        />

        {focus && focusStatus ? (
          <JourneyBar
            requirement={focus}
            stageIndex={gate?.status === 'approved' && focus.stageIndex === 3 ? 4 : focus.stageIndex}
            tone={focusStatus.tone}
            statusLabel={focusStatus.label}
            onOpenRequirement={() => openRequirement(focus.id)}
            onOpenApproval={() => openApprovalFor(focus)}
          />
        ) : (
          <div className="pw-journey is-empty">
            <div className="pw-journey-focus">
              <span className="pw-journey-kicker">当前组织 · {projectsForOrg(orgId).length} 个项目</span>
              <span className="pw-journey-title">还没有进行中的需求</span>
            </div>
            <div className="pw-journey-empty-hint">创建需求后会显示旅程、当前门禁与下一步。</div>
            <Button variant="ghost" onClick={() => setCreateOpen(true)}>创建需求</Button>
          </div>
        )}

        <div className={`pw-content${isFill ? ' is-fill' : ''}`}>{content}</div>

        <StatusBar workerOnline />
      </div>

      <ApprovalDrawer
        subject={approval}
        gate={approval?.kind === 'gate' ? gates[approval.requirement.id] : undefined}
        theme={theme}
        onClose={() => setApproval(null)}
        onDecide={decide}
      />
      <CreateRequirementDialog
        open={createOpen}
        orgId={orgId}
        theme={theme}
        onClose={() => setCreateOpen(false)}
        onCreate={createRequirement}
      />
      <CommandPalette
        open={commandOpen}
        theme={theme}
        onClose={() => setCommandOpen(false)}
        onNavigate={navigate}
        onToggleTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')}
        onCreate={() => setCreateOpen(true)}
        onOpenApproval={() => {
          const item = ATTENTION.find((entry) => entry.kind === 'gate') ?? ATTENTION[0]
          if (item) openAttention(item)
        }}
      />
      <Toast message={toast} onClose={() => setToast(null)} />
    </div>
  )
}
