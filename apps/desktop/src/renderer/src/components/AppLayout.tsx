import { useCallback, useEffect, useMemo, useState } from 'react'
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { App as AntApp, Badge, Button, Dropdown, Tooltip, type MenuProps } from 'antd'
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
  MinusOutlined,
  MoonOutlined,
  ProjectOutlined,
  RobotOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  SunOutlined,
  SwapOutlined,
  ThunderboltOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import type { RuntimeStatus } from '@projectos/contracts'
import {
  AppShell,
  EmptyState,
  ProgressBar,
  SidebarNavigation,
  StatusPill,
  toneForStatus,
  type SidebarNavGroup,
} from '@projectos/ui'
import { BootError, BootScreen } from './BootScreen'
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { SettingsModal } from '../features/settings/SettingsModal'
import { useBootstrap, useProjectOverview } from '../lib/queries'
import { useResolvedTheme, useUiStore } from '../stores/ui'
import { stageLabel } from '../lib/labels'
import { truncate } from '../lib/format'

const PAGE_LABELS: Record<string, string> = {
  work: '研发工作中心',
  versions: '版本与迭代',
  overview: '项目姿态',
  orchestration: '编排工作台',
  tasks: '任务看板',
  knowledge: '知识库',
  operations: '自主运营',
  agents: 'Agent 工作台',
  collaboration: '跨会话中心',
  workspace: '工作区',
  runs: '运行审计',
  center: '项目中心',
  notifications: '通知中心',
  resources: '资源中心',
  approvals: '审批中心',
  health: '项目健康',
  'project-settings': '项目设置',
  settings: '设置',
}

const NAV_PATHS: Record<string, string> = {
  work: '',
  versions: '/versions',
  overview: '/overview',
  orchestration: '/orchestration',
  tasks: '/tasks',
  knowledge: '/knowledge',
  operations: '/operations',
  agents: '/agents',
  collaboration: '/collaboration',
  workspace: '/workspace',
  runs: '/runs',
  'project-settings': '/project-settings',
  health: '/health',
  resources: '/resources',
  approvals: '/approvals',
}

function Logo() {
  return (
    <span className="po-logo" aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <rect x="2" y="2" width="60" height="60" rx="14" fill="#0A1220" />
        <g fill="none" stroke="#E8F6FF" strokeWidth="2.4">
          <ellipse cx="32" cy="32" rx="22" ry="8" />
          <ellipse cx="32" cy="32" rx="22" ry="8" transform="rotate(60 32 32)" />
          <ellipse cx="32" cy="32" rx="22" ry="8" transform="rotate(120 32 32)" />
        </g>
        <g fill="#5DC8FF">
          <circle cx="10" cy="32" r="1.9" />
          <circle cx="54" cy="32" r="1.9" />
        </g>
        <circle cx="32" cy="32" r="4.2" fill="#F5FAFF" />
        <circle cx="32" cy="32" r="1.8" fill="#2F8CFF" />
      </svg>
    </span>
  )
}

export default function AppLayout() {
  const navigate = useNavigate()
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
  const resolvedTheme = useResolvedTheme()
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null)
  const [commandOpen, setCommandOpen] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const isMac = window.projectos.system.platform === 'darwin'

  const currentProject = useMemo(
    () => bootstrap.data?.projects.find((project) => project.id === projectId) ?? null,
    [bootstrap.data, projectId],
  )

  const activeKey = useMemo(() => {
    if (location.pathname === '/settings') return 'settings'
    if (location.pathname === '/') return 'center'
    const segment = location.pathname.split('/')[3] ?? 'work'
    return segment in PAGE_LABELS ? segment : 'work'
  }, [location.pathname])

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
      }
      void queryClient.invalidateQueries({ queryKey: ['task'] })
      void queryClient.invalidateQueries({ queryKey: ['run'] })
      if (event.type === 'approval.changed' && event.status === 'pending') {
        notification.warning({
          key: `approval-${event.approvalId}`,
          message: 'Agent 正在等待授权',
          description: '写文件或执行命令需要你的确认。前往 Agent 工作台处理。',
          placement: 'bottomRight',
          duration: 6,
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
      if (!projectId) return
      navigate(`/projects/${projectId}${NAV_PATHS[key] ?? ''}`)
    },
    [navigate, openSettings, projectId],
  )

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = []
    if (projectId) {
      list.push(
        { id: 'work', label: '研发工作中心', group: currentProject?.name ?? '项目', icon: <ThunderboltOutlined />, run: () => handleNavigate('work') },
        { id: 'overview', label: '项目姿态', group: currentProject?.name ?? '项目', icon: <AppstoreOutlined />, run: () => handleNavigate('overview') },
        { id: 'versions', label: '版本与迭代', group: currentProject?.name ?? '项目', icon: <ApartmentOutlined />, run: () => handleNavigate('versions') },
        { id: 'orchestration', label: '编排工作台', group: currentProject?.name ?? '项目', icon: <ApartmentOutlined />, run: () => handleNavigate('orchestration') },
        { id: 'tasks', label: '任务看板', group: currentProject?.name ?? '项目', icon: <UnorderedListOutlined />, run: () => handleNavigate('tasks') },
        { id: 'knowledge', label: '知识库', group: currentProject?.name ?? '项目', icon: <ReadOutlined />, run: () => handleNavigate('knowledge') },
        { id: 'operations', label: '自主运营', group: currentProject?.name ?? '项目', icon: <SafetyCertificateOutlined />, run: () => handleNavigate('operations') },
        { id: 'agents', label: 'Agent 工作台', group: currentProject?.name ?? '项目', icon: <RobotOutlined />, run: () => handleNavigate('agents') },
        { id: 'resources', label: '资源中心', group: currentProject?.name ?? '项目', icon: <FolderOpenOutlined />, run: () => handleNavigate('resources') },
        { id: 'approvals', label: '审批中心', group: currentProject?.name ?? '项目', icon: <SafetyCertificateOutlined />, run: () => handleNavigate('approvals') },
        { id: 'collaboration', label: '跨会话中心', group: currentProject?.name ?? '项目', icon: <SendOutlined />, run: () => handleNavigate('collaboration') },
        { id: 'workspace', label: '工作区', group: currentProject?.name ?? '项目', icon: <CodeOutlined />, run: () => handleNavigate('workspace') },
        { id: 'runs', label: '运行审计', group: currentProject?.name ?? '项目', icon: <HistoryOutlined />, run: () => handleNavigate('runs') },
        { id: 'health', label: '项目健康', group: currentProject?.name ?? '项目', icon: <SafetyCertificateOutlined />, run: () => handleNavigate('health') },
        { id: 'project-settings', label: '项目设置', group: currentProject?.name ?? '项目', icon: <SettingOutlined />, run: () => handleNavigate('project-settings') },
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
      { id: 'settings', label: '设置', group: '全局', icon: <SettingOutlined />, shortcut: '⌘,', run: () => openSettings('ai-connections') },
      { id: 'theme-light', label: '切换到浅色主题', group: '外观', icon: <SunOutlined />, run: () => setThemeMode('light') },
      { id: 'theme-dark', label: '切换到深色主题', group: '外观', icon: <MoonOutlined />, run: () => setThemeMode('dark') },
      { id: 'theme-system', label: '跟随系统主题', group: '外观', icon: <SwapOutlined />, run: () => setThemeMode('system') },
    )
    return list
  }, [currentProject, handleNavigate, navigate, openSettings, projectId, setThemeMode])

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

  const navGroups: SidebarNavGroup[] = []
  if (projectId && currentProject) {
    navGroups.push({
      title: '研发',
      items: [
        { key: 'work', label: '研发工作中心', icon: <ThunderboltOutlined /> },
        { key: 'tasks', label: '任务与验收', icon: <UnorderedListOutlined />, badge: taskBadge || null },
        { key: 'agents', label: 'Agent 协作', icon: <RobotOutlined />, badge: approvalBadge || null },
        { key: 'approvals', label: '审批', icon: <SafetyCertificateOutlined />, badge: approvalBadge || null },
        { key: 'runs', label: '运行审计', icon: <HistoryOutlined /> },
      ],
    })
    navGroups.push({
      title: '项目',
      items: [
        { key: 'overview', label: '项目姿态', icon: <AppstoreOutlined /> },
        { key: 'versions', label: '版本与迭代', icon: <ApartmentOutlined /> },
        { key: 'knowledge', label: '知识与成果', icon: <ReadOutlined /> },
        { key: 'project-settings', label: '项目设置', icon: <SettingOutlined /> },
      ],
    })
  }
  navGroups.push({
    title: '全局',
    items: [
      { key: 'center', label: '项目中心', icon: <ProjectOutlined /> },
      { key: 'settings', label: '设置', icon: <SettingOutlined /> },
    ],
  })

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
        <button type="button" className="po-icon-button" onClick={toggleSidebar} aria-label="切换侧边栏">
          {collapsed ? <ExpandOutlined /> : <CompressOutlined />}
        </button>
        <div className="po-crumbs">
          <button type="button" className="po-crumb-link" onClick={() => navigate('/')}>
            ProjectOS
          </button>
          {currentProject ? (
            <>
              <span className="po-crumb-sep">/</span>
              <button
                type="button"
                className="po-crumb-link is-current"
                onClick={() => navigate(`/projects/${currentProject.id}`)}
              >
                {truncate(currentProject.name, 30)}
              </button>
              <span className="po-crumb-sep">/</span>
              <span className="po-crumb-page">{PAGE_LABELS[activeKey] ?? ''}</span>
            </>
          ) : (
            <>
              <span className="po-crumb-sep">/</span>
              <span className="po-crumb-page">{PAGE_LABELS[activeKey] ?? ''}</span>
            </>
          )}
        </div>
      </div>
      <button type="button" className="po-command-trigger" onClick={() => setCommandOpen(true)}>
        <SearchOutlined />
        <span>搜索或跳转</span>
        <kbd>⌘ K</kbd>
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
                ? 'Runtime 就绪'
                : runtime?.status === 'restarting'
                  ? 'Runtime 重启中'
                  : runtime?.status === 'starting'
                    ? 'Runtime 启动中'
                    : runtime?.status === 'failed'
                      ? 'Runtime 失败'
                      : 'Runtime 未就绪'}
            </StatusPill>
          </span>
        </Tooltip>
        <Tooltip title={`${pendingApprovals.length} 个待授权请求`}>
          <button
            type="button"
            className="po-icon-button"
            onClick={() => (projectId ? navigate(`/projects/${projectId}/agents`) : navigate('/'))}
            aria-label="待授权请求"
          >
            <Badge count={pendingApprovals.length} size="small" offset={[2, -1]}>
              <BellOutlined />
            </Badge>
          </button>
        </Tooltip>
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
      <button type="button" className="po-brand" onClick={() => navigate('/')}>
        <Logo />
        <span className="po-brand-text">
          <strong>ProjectOS</strong>
          <span>AI Project OS</span>
        </span>
      </button>
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
          <button type="button" className="po-project-button">
            <span className="po-project-button-icon">
              {currentProject ? <span className="po-project-dot" /> : <ProjectOutlined />}
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
        onSelect={handleNavigate}
        collapsed={collapsed}
        footer={
          <div className="po-sidebar-footer">
            <div className="po-sidebar-runtime">
              <span className={`po-status-dot is-${runtime?.status ?? 'unknown'}`} />
              <span>本地优先</span>
              <span className="po-sidebar-runtime-version">v{bootstrap.data ? '1.7.0' : '—'}</span>
            </div>
            <Tooltip title="项目中心">
              <button type="button" className="po-icon-button" onClick={() => navigate('/')} aria-label="项目中心">
                <AppstoreOutlined />
              </button>
            </Tooltip>
          </div>
        }
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
      <span className="po-status-item">
        <span className={`po-status-dot is-${runtime?.status ?? 'unknown'}`} />
        {runtime?.status ?? 'unknown'}
        {runtime?.pid ? ` · pid ${runtime.pid}` : ''}
      </span>
      <span className="po-status-item">本地 · 无监听端口</span>
    </>
  )

  return (
    <>
      <AppShell header={titlebar} sidebar={sidebar} footer={statusbar} collapsed={collapsed}>
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






