import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Outlet, useLocation, useNavigate, useParams, useNavigation } from 'react-router-dom'
import { App as AntApp, Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import {
  ApartmentOutlined,
  AppstoreOutlined,
  ReadOutlined,
  SafetyCertificateOutlined,
  BellOutlined,
  BorderOutlined,
  CloseOutlined,
  CodeOutlined,
  CompressOutlined,
  DownOutlined,
  ExpandOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  ArrowLeftOutlined,
  MinusOutlined,
  MoonOutlined,
  ProjectOutlined,
  RobotOutlined,
  RocketOutlined,
  CloudUploadOutlined,
  CloudServerOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  SunOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { productNavigation } from './product-navigation'
import { useCompactNavigation } from '../hooks/useCompactNavigation'
import { PopoverShell } from '../next-ui/overlay/overlay-shell'
import type { RuntimeStatus } from '@projectos/contracts'
import {
  AppShell,
  EmptyState,
  ProgressBar,
  SidebarNavigation,
  StatusPill,
  toneForStatus,
} from '@projectos/ui'
import { BootError, BootScreen } from './BootScreen'
import { GoalJourneyBar } from './GoalJourneyBar'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { SettingsModal } from '../features/settings/SettingsModal'
import { ActionCenterButton } from './ActionCenterPanel'
import { useBootstrap, useProjectOverview } from '../lib/queries'
import { useResolvedTheme, useUiStore } from '../stores/ui'
import { stageLabel } from '../lib/labels'
import { truncate } from '../lib/format'
import { pageLabel, currentPageKey, pageGroup, palettePages, PAGES } from '../page-registry'

const PAGE_LABELS: Record<string, string> = Object.fromEntries(PAGES.map((page) => [page.key, page.label]))

const NAV_PATHS: Record<string, string> = Object.fromEntries(
  PAGES.filter((page) => page.key !== 'center' && page.key !== 'design-lab').map((page) => [page.key, page.path]),
)

/** Registry order + icon per page; the nav itself still decides which pages belong in the sidebar. */
const PAGE_ICONS: Record<string, ReactNode> = {
  work: <ThunderboltOutlined />,
  tasks: <UnorderedListOutlined />,
  agents: <RobotOutlined />,
  approvals: <SafetyCertificateOutlined />,
  runs: <HistoryOutlined />,
  orchestration: <ApartmentOutlined />,
  releases: <RocketOutlined />,
  deployments: <CloudUploadOutlined />,
  connections: <CloudServerOutlined />,
  overview: <AppstoreOutlined />,
  versions: <ApartmentOutlined />,
  knowledge: <ReadOutlined />,
  'project-settings': <SettingOutlined />,
  workspace: <CodeOutlined />,
  collaboration: <SendOutlined />,
  operations: <SafetyCertificateOutlined />,
  health: <SafetyCertificateOutlined />,
  notifications: <BellOutlined />,
}

function Logo() {
  return (
    <span className="po-logo" aria-hidden="true">
      <Sparkles size={18} strokeWidth={1.65} />
    </span>
  )
}

export default function AppLayout() {
  const navigate = useNavigate()
  const navigation = useNavigation()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { notification } = AntApp.useApp()
  const params = useParams<{ projectId?: string }>()
  const projectId = params.projectId ?? null
  const bootstrap = useBootstrap()
  const overview = useProjectOverview(projectId)
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const themeMode = useUiStore((state) => state.themeMode)
  const setThemeMode = useUiStore((state) => state.setThemeMode)
  const setLastProjectId = useUiStore((state) => state.setLastProjectId)
  const openSettings = useUiStore((state) => state.openSettings)
  const settingsPending = useUiStore((state) => state.settingsPendingSection)
  const resolvedTheme = useResolvedTheme()
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const narrow = useCompactNavigation()
  const compact = collapsed || narrow
  const isMac = window.projectos.system.platform === 'darwin'

  const currentProject = useMemo(
    () => bootstrap.data?.projects.find((project) => project.id === projectId) ?? null,
    [bootstrap.data, projectId],
  )

  const activeKey = currentPageKey(location.pathname)

  /**
   * ADR-0045 — hierarchy + history navigation.
   *
   * The app had a titlebar path, but it read as decoration (tertiary 11px text) and offered no way
   * back to the previously visited inner page: 运行审计 → 审批 meant going through the sidebar again.
   * The breadcrumb now carries the nav group, marks the current page, and a back control walks the
   * in-app history.
   */
  const activeGroup = pageGroup(activeKey)
  const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0
  const canGoBack = historyIndex > 0

  useEffect(() => {
    if (projectId) setLastProjectId(projectId)
  }, [projectId, setLastProjectId])

  useEffect(() => {
    let active = true
    window.projectos.runtime
      .status()
      .then((status) => {
        if (active) setRuntimeStatus(status)
      })
      .catch(() => undefined)
    const unsubscribe = window.projectos.runtime.onStatus((status) => {
      setRuntimeStatus(status)
      if (status.status === 'ready') {
        void queryClient.invalidateQueries()
      }
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [queryClient])

  useEffect(() => {
    const unsubscribe = window.projectos.runtime.onEvent(({ event }) => {
      if (event.type === 'runtime.log' || event.type === 'run.delta') return
      if (event.type === 'provider.changed') {
        void queryClient.invalidateQueries({ queryKey: ['providerSettings'] })
        // A new/changed model connection changes what the journey can do next.
        void queryClient.invalidateQueries({ queryKey: ['work', 'journey'] })
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      if ('projectId' in event) {
        const eventProjectId = event.projectId
        void queryClient.invalidateQueries({ queryKey: ['overview', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['board', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['sessions', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['runs', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['collaboration', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['events', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['workspace', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['approvals', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['approvals', 'all'] })
        void queryClient.invalidateQueries({ queryKey: ['action-center', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['lifecycle', eventProjectId] })
        void queryClient.invalidateQueries({ queryKey: ['gate-overview', eventProjectId] })
        // ADR-0053: the journey bar follows real business events, not only the 5s fallback poll.
        void queryClient.invalidateQueries({ queryKey: ['work', 'journey'] })
      }
      void queryClient.invalidateQueries({ queryKey: ['task'] })
      void queryClient.invalidateQueries({ queryKey: ['run'] })
      // Once a human decision lands, re-evaluate gates and let the coordinator advance
      // any phase that is now legally allowed. This is what removes the manual
      // module-hopping: nobody has to press "推进阶段" after approving evidence.
      if (event.type === 'approval.changed' && event.status !== 'pending' && 'projectId' in event) {
        const eventProjectId = event.projectId
        void window.projectos.actions
          .tick(eventProjectId)
          .then((result) => {
            if (result.advanced.length > 0) {
              void queryClient.invalidateQueries({ queryKey: ['lifecycle', eventProjectId] })
              void queryClient.invalidateQueries({ queryKey: ['gate-overview', eventProjectId] })
              void queryClient.invalidateQueries({ queryKey: ['action-center', eventProjectId] })
              notification.success({
                key: `auto-advance-${eventProjectId}`,
                message: '系统已自动推进版本阶段',
                description: result.advanced.map((entry) => `${entry.from} → ${entry.to}`).join('、'),
                placement: 'bottomRight',
                duration: 5,
              })
            }
          })
          .catch(() => undefined)
      }
      if (event.type === 'approval.changed' && event.status === 'pending') {
        const approvalId = encodeURIComponent(String(event.approvalId))
        notification.warning({
          key: `approval-${event.approvalId}`,
          message: '有操作在等待你的授权',
          description: '打开对应审批，查看真实 Diff 与作用范围后决定。',
          placement: 'bottomRight',
          duration: 8,
          btn: projectId
            ? (
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  notification.destroy(`approval-${event.approvalId}`)
                  navigate(`/projects/${projectId}/approvals?approval=${approvalId}`)
                }}
              >
                查看审批
              </Button>
            )
            : undefined,
        })
      }
    })
    return unsubscribe
  }, [notification, queryClient])

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        openSettings('ai-connections')
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openSettings])

  const handleNavigate = useCallback(
    (key: string): void => {
      if (key === 'center') {
        navigate('/')
        return
      }
      if (key === 'settings') {
        openSettings('ai-connections')
        return
      }
      if (key === 'organization') {
        openSettings('organization')
        return
      }
      if (key === 'design-lab') {
        navigate('/design-lab')
        return
      }
      if (key === 'notifications') {
        navigate('/notifications')
        return
      }
      if (!projectId) return
      const versionId = new URLSearchParams(location.search).get('version')
      const suffix = (key === 'releases' || key === 'deployments') && versionId ? `?version=${versionId}` : ''
      navigate(`/projects/${projectId}${NAV_PATHS[key] ?? ''}${suffix}`)
    },
    [location.search, navigate, openSettings, projectId],
  )

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = []
    if (projectId) {
      // ADR-0049: the palette is generated from the page registry, so a page cannot be shipped
      // without an entry (and a deleted page cannot leave a dead command behind).
      for (const page of palettePages()) {
        list.push({
          id: page.key,
          label: page.label,
          group: page.group === '全局' ? '全局' : (currentProject?.name ?? '项目'),
          icon: PAGE_ICONS[page.key] ?? <AppstoreOutlined />,
          run: () => handleNavigate(page.key),
        })
      }
      list.push(
        {
          id: 'new-task',
          label: '新建任务',
          hint: '在任务看板打开创建面板',
          group: currentProject?.name ?? '项目',
          icon: <ProjectOutlined />,
          shortcut: 'N',
          run: () => navigate(`/projects/${projectId}/tasks?new=1`),
        },
        {
          id: 'reveal',
          label: '在文件管理器中打开项目',
          group: currentProject?.name ?? '项目',
          icon: <FolderOpenOutlined />,
          run: () => window.projectos.app.revealPath(currentProject?.rootPath ?? ''),
        },
      )
    }
    list.push(
      { id: 'center', label: '项目中心', group: '全局', icon: <AppstoreOutlined />, shortcut: 'G', run: () => navigate('/') },
      { id: 'settings', label: '设置', group: '全局', icon: <SettingOutlined />, shortcut: isMac ? '⌘,' : 'Ctrl+,', run: () => openSettings('ai-connections') },
      { id: 'organization', label: '账号与组织', group: '全局', icon: <ApartmentOutlined aria-hidden />, run: () => openSettings('organization') },
      { id: 'theme-light', label: '切换到浅色主题', group: '外观', icon: <SunOutlined />, run: () => setThemeMode('light') },
      { id: 'theme-dark', label: '切换到深色主题', group: '外观', icon: <MoonOutlined />, run: () => setThemeMode('dark') },
      { id: 'theme-system', label: '跟随系统主题', group: '外观', icon: <SwapOutlined />, run: () => setThemeMode('system') },
    )
    return list
  }, [currentProject, handleNavigate, isMac, navigate, openSettings, projectId, setThemeMode])

  if (bootstrap.isLoading) return <BootScreen />
  if (bootstrap.isError) {
    return <BootError error={bootstrap.error} onRetry={() => void bootstrap.refetch()} />
  }

  const projects = bootstrap.data?.projects ?? []
  const pendingApprovals = bootstrap.data?.pendingApprovals ?? []
  const runtime = runtimeStatus ?? bootstrap.data?.runtime ?? null
  const runtimeTone = runtime ? toneForStatus(runtime.status === 'ready' ? 'success' : runtime.status) : 'neutral'
  const taskBadge = currentProject ? currentProject.stats.tasksReview || currentProject.stats.tasksRunning : 0
  const approvalBadge = pendingApprovals.filter((approval) => !projectId || approval.projectId === projectId).length

  const navGroups = productNavigation(Boolean(projectId && currentProject), taskBadge, approvalBadge)

  const projectMenuItems: MenuProps['items'] = [
    ...projects.map((project) => ({
      key: project.id,
      label: (
        <div className="po-project-menu-item">
          <span>{project.name}</span>
          <span className="po-muted po-caption">{stageLabel(project.currentStage)}</span>
        </div>
      ),
    })),
    ...(projects.length > 0 ? [{ type: 'divider' as const }] : []),
    { key: '__center', label: '所有项目', icon: <AppstoreOutlined /> },
  ]

  const themeItems: MenuProps['items'] = [
    { key: 'light', label: '浅色', icon: <SunOutlined /> },
    { key: 'dark', label: '深色', icon: <MoonOutlined /> },
    { key: 'system', label: '跟随系统', icon: <SwapOutlined /> },
  ]

  const titlebar = (
    <div className={`po-titlebar-inner ${isMac ? 'is-mac' : ''}`.trim()}>
      <div className="po-titlebar-left">
        <PopoverShell ariaLabel="主导航" open={narrow && navigationOpen} onOpenChange={(open) => { if (narrow) setNavigationOpen(open) }} className="po-navigation-menu" align="start" trigger={
          <button type="button" className="po-icon-button" onClick={() => { if (!narrow) toggleSidebar() }} aria-label="切换侧边栏" aria-expanded={narrow ? navigationOpen : !collapsed}>
            {compact ? <ExpandOutlined aria-hidden /> : <CompressOutlined aria-hidden />}
          </button>
        }>
          <SidebarNavigation groups={navGroups.map((group) => ({ ...group, placement: 'main', collapsible: false }))} activeKey={activeKey} onSelect={(key) => { setNavigationOpen(false); handleNavigate(key) }} />
        </PopoverShell>
        <button type="button" className="po-titlebar-brand" onClick={() => navigate('/')} aria-label="ProjectOS 项目中心">
          <Logo /><span>PROJECTOS</span>
        </button>
        <button
          type="button"
          className="po-crumb-back"
          onClick={() => navigate(-1)}
          disabled={!canGoBack}
          aria-label="返回上一页"
          title={canGoBack ? '返回上一页' : '没有可返回的上一页'}
        >
          <ArrowLeftOutlined />
        </button>
        <nav className="po-crumbs" aria-label="导航路径">
          {currentProject ? (
            <>
              <button type="button" className="po-crumb-link" onClick={() => navigate(`/projects/${currentProject.id}`)}>
                {truncate(currentProject.name, 30)}
              </button>
            </>
          ) : null}
          {currentProject && activeGroup ? (
            <>
              <span className="po-crumb-sep" aria-hidden>›</span>
              <span className="po-crumb-group">{activeGroup}</span>
            </>
          ) : null}
          {currentProject ? <span className="po-crumb-sep" aria-hidden>›</span> : null}
          <span className="po-crumb-page" aria-current="page">{PAGE_LABELS[activeKey] ?? '页面不存在'}</span>
        </nav>
      </div>
      <button type="button" className="po-command-trigger" onClick={() => setCommandOpen(true)} aria-label="搜索或跳转">
        <SearchOutlined aria-hidden />
        <span>搜索或跳转</span>
        <kbd>{isMac ? '⌘ K' : 'Ctrl K'}</kbd>
      </button>
      <div className="po-titlebar-right">
        <Tooltip
          title={
            runtime
              ? `${runtime.status} · pid ${runtime.pid ?? '—'}${runtime.message ? ` · ${runtime.message}` : ''}`
              : 'Runtime 状态未知'
          }
        >
          <span className="po-runtime-indicator">
            <StatusPill tone={runtimeTone} dot>
              {runtime?.status === 'ready'
                ? '本机就绪'
                : runtime?.status === 'restarting'
                  ? '正在重启'
                  : runtime?.status === 'starting'
                    ? '正在启动'
                    : runtime?.status === 'failed'
                      ? '服务异常'
                      : '尚未就绪'}
            </StatusPill>
          </span>
        </Tooltip>
        <ActionCenterButton projectId={projectId} />
        <Dropdown
          menu={{
            items: themeItems,
            selectedKeys: [themeMode],
            onClick: ({ key }) => setThemeMode(key as 'light' | 'dark' | 'system'),
          }}
          trigger={['click']}
          placement="bottomRight"
        >
          <button type="button" className="po-icon-button" aria-label="主题">
            {resolvedTheme === 'dark' ? <MoonOutlined /> : <SunOutlined />}
          </button>
        </Dropdown>
        {!isMac ? (
          <div className="po-window-controls">
            <button
              type="button"
              className="po-window-button"
              onClick={() => void window.projectos.app.minimize()}
              aria-label="最小化"
            >
              <MinusOutlined />
            </button>
            <button
              type="button"
              className="po-window-button"
              onClick={() => {
                void window.projectos.app.toggleMaximize().then((result) => setMaximized(result.maximized))
              }}
              aria-label={maximized ? '还原' : '最大化'}
            >
              {maximized ? <BorderOutlined /> : <BorderOutlined />}
            </button>
            <button
              type="button"
              className="po-window-button is-close"
              onClick={() => void window.projectos.app.close()}
              aria-label="关闭"
            >
              <CloseOutlined />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )

  const sidebar = (
    <div className="po-sidebar-inner">
      <div className="po-project-switcher">
        <Dropdown
          menu={{
            items: projectMenuItems,
            onClick: ({ key }) => {
              if (key === '__center') navigate('/')
              else navigate(`/projects/${key}`)
            },
          }}
          trigger={['click']}
          placement="bottomLeft"
        >
          <button type="button" className="po-project-button" aria-label={`切换项目：${currentProject?.name ?? '所有项目'}`} title={currentProject?.name ?? '选择项目'}>
            <span className="po-project-button-icon" aria-hidden>
              {currentProject ? currentProject.name.slice(0, 1).toUpperCase() : <ProjectOutlined />}
            </span>
            <span className="po-project-button-text">
              <strong>{currentProject ? truncate(currentProject.name, 22) : projects.length ? '所有项目' : '选择项目'}</strong>
              <span>
                {currentProject
                  ? `${stageLabel(currentProject.currentStage)} · ${Math.round(currentProject.stats.progress * 100)}%`
                  : `${projects.length} 个本地项目`}
              </span>
            </span>
            <DownOutlined className="po-project-button-arrow" />
          </button>
        </Dropdown>
        {currentProject ? (
          <div className="po-project-progress">
            <ProgressBar value={currentProject.stats.progress} height={4} />
          </div>
        ) : null}
      </div>
      <SidebarNavigation
        groups={navGroups}
        activeKey={activeKey}
        activeGroupTitle={pageGroup(activeKey)}
        onSelect={handleNavigate}
        collapsed={compact}
      />
    </div>
  )

  const statusbar = (
    <>
      <span className="po-status-item">
        <FolderOpenOutlined />
        <span className="po-status-path">{currentProject?.rootPath ?? '本地工作区'}</span>
      </span>
      {overview.data?.git ? (
        <span className="po-status-item">
          <span className="po-git-branch">⑂ {overview.data.git.branch}</span>
          <span className={overview.data.git.clean ? 'po-status-ok' : 'po-status-dirty'}>
            {overview.data.git.clean ? '干净' : `${overview.data.git.changedFiles} 个变更`}
          </span>
        </span>
      ) : null}
      {currentProject ? (
        <span className="po-status-item">
          <span className="po-status-label">阶段</span>
          {stageLabel(currentProject.currentStage)}
        </span>
      ) : null}
      <span className="po-status-spacer" />
      <span className="po-status-item">本地工作区</span>
    </>
  )

  return (
    <>
      <AppShell
        header={titlebar}
        sidebar={sidebar}
        footer={statusbar}
        collapsed={compact}
        subheader={<GoalJourneyBar projectId={projectId} />}
      >
        {navigation.state === 'loading' ? <div className="po-route-progress" role="status" aria-live="polite">正在打开{pageLabel(currentPageKey(navigation.location?.pathname ?? ''))}…</div> : null}
        {settingsPending ? <div className="po-route-progress" role="status">正在读取设置…</div> : null}
        {projectId && !currentProject ? (
          <div className="po-page">
            <EmptyState
              icon={<ProjectOutlined />}
              title="项目不存在或已被移除"
              description="返回项目中心选择其他项目，或创建新的本地项目。"
              action={<Button onClick={() => navigate('/')}>返回项目中心</Button>}
            />
          </div>
        ) : (
          <Outlet />
        )}
      </AppShell>
      <CommandPalette open={commandOpen} commands={commands} onClose={() => setCommandOpen(false)} />
      <SettingsModal />
    </>
  )
}






