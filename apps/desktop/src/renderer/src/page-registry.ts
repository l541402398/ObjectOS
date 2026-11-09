/**
 * ADR-0049 — one page registry.
 *
 * The app accumulated pages that only `router.tsx` knew about: they had no sidebar entry, no command
 * palette entry and no inbound link, so they were effectively unreachable while still shipping code
 * (and, in one case, a legacy page that nothing imported at all). Router, navigation, command
 * palette and breadcrumb now share this table, and a test fails when they drift.
 *
 * Status meanings:
 *   KEEP              reachable and still the product's real surface.
 *   MERGE             capability still wanted, but its UI belongs inside another page.
 *   DEV_ONLY          kept on purpose for design/dev work; intentionally not in the product menus.
 *   REVIEW_REQUIRED   orphaned *and* owns a unique capability; needs a Phase 3 decision, not deletion.
 *   DELETE            scheduled for removal (recorded here until the code is gone).
 */

export type PageStatus = 'KEEP' | 'MERGE' | 'DEV_ONLY' | 'REVIEW_REQUIRED' | 'DELETE'
export type PageEntry = 'nav' | 'palette' | 'link' | 'deep-link' | 'none'

export interface PageDefinition {
  /** Route key used by `PAGE_LABELS` / nav selection. */
  key: string
  /** Path after `/projects/:projectId`; empty string means the project index. */
  path: string
  label: string
  group: '研发' | '交付' | '项目' | '全局'
  status: PageStatus
  /** Where a user can enter this page today. */
  entries: PageEntry[]
  /** Why it has this status; also the note shown in the audit report. */
  note: string
  /** Shorter sidebar label when it differs from the page title. */
  navLabel?: string
  /** Sidebar entry that owns this page as a secondary view (ADR-0090). */
  navParent?: string
}

export const PROJECT_PAGES: PageDefinition[] = [
  { key: 'work', path: '', label: '工作台', group: '研发', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '正在发生什么、需要我做什么：项目的唯一主页（旧 /work 重定向至此）。' },
  { key: 'requirements', path: '/requirements', label: '需求工作台', group: '研发', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '需求流程、任务分工、产出资料与独立开发工作区。' },
  { key: 'tasks', path: '/tasks', label: '任务看板', navLabel: '执行', group: '研发', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '执行视图之一：任务与验收；与 Agent 协作、计划编排、运行审计共享视图切换。' },
  { key: 'agents', path: '/agents', label: 'Agent 协作', navParent: 'tasks', group: '研发', status: 'KEEP', entries: ['palette', 'link'], note: '执行视图之一：Agent 协作图、交接与产出。' },
  { key: 'approvals', path: '/approvals', label: '审批', group: '研发', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '唯一审阅室：工具请求、交付审批与记录三个视图（旧 /approvals/center 重定向至记录）。' },
  { key: 'runs', path: '/runs', label: '运行审计', navParent: 'tasks', group: '研发', status: 'KEEP', entries: ['palette', 'link'], note: '执行视图之一：Run 时间线、工具调用与项目事件流。' },
  { key: 'orchestration', path: '/orchestration', label: '计划编排', navParent: 'tasks', group: '研发', status: 'KEEP', entries: ['palette', 'link'], note: '执行视图之一：计划 DAG、授权与交付。' },
  { key: 'connections', path: '/connections', label: '资源与连接', group: '交付', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '资源、连接 Profile 与凭据元信息。' },
  { key: 'releases', path: '/releases', label: '发布中心', group: '交付', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '版本发布与交付记录。' },
  { key: 'deployments', path: '/deployments', label: '部署中心', group: '交付', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '部署执行与对账。' },
  { key: 'overview', path: '/overview', label: '项目姿态', group: '项目', status: 'KEEP', entries: ['nav', 'palette'], note: '项目度量与阶段。' },
  { key: 'versions', path: '/versions', label: '版本与迭代', group: '项目', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '版本、迭代与门禁。' },
  { key: 'knowledge', path: '/knowledge', label: '知识与成果', group: '项目', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '知识条目与交付物。' },
  { key: 'project-settings', path: '/project-settings', label: '项目设置', group: '项目', status: 'KEEP', entries: ['nav', 'palette'], note: '项目级设置。' },
  { key: 'workspace', path: '/workspace', label: '工作区', group: '研发', status: 'KEEP', entries: ['palette', 'link'], note: '真实文件浏览与 Diff；由任务看板进入。' },
  { key: 'collaboration', path: '/collaboration', label: '跨会话中心', group: '研发', status: 'REVIEW_REQUIRED', entries: ['palette'], note: '团队策略、消息与交接的独立视图；仅命令面板可达，Phase 3 决定并入 Agent 协作或保留。' },
  { key: 'operations', path: '/operations', label: '自主运营', group: '研发', status: 'REVIEW_REQUIRED', entries: ['palette', 'link'], note: '拥有 operations.insights / getTrigger 独有能力；入口仅命令面板与项目健康页，Phase 3 决定并入工作中心。' },
  { key: 'health', path: '/health', label: '项目健康', group: '项目', status: 'REVIEW_REQUIRED', entries: ['palette', 'link'], note: 'project.metrics 指标视图；入口仅命令面板，Phase 3 决定并入项目姿态。' },
  { key: 'notifications', path: '/notifications', label: '通知中心', group: '全局', status: 'KEEP', entries: ['palette', 'link'], note: '待审批与最近活动；由 Action Center 与命令面板进入。' },
]

export const GLOBAL_PAGES: PageDefinition[] = [
  { key: 'center', path: '/', label: '项目中心', group: '全局', status: 'KEEP', entries: ['nav', 'link'], note: '所有项目的入口与最近动态。' },
  { key: 'organization', path: '/organization', label: '组织工作台', group: '全局', status: 'KEEP', entries: ['nav', 'palette', 'link'], note: '需求协作、组织知识、项目与团队管理。' },
  { key: 'design-lab', path: '/design-lab', label: 'Design Lab', group: '全局', status: 'DEV_ONLY', entries: ['deep-link'], note: '已批准的视觉基线；仅供设计与回归，不进入产品菜单。' },
  { key: 'precision-lab', path: '/precision-lab', label: 'Precision Workspace', group: '全局', status: 'DEV_ONLY', entries: ['deep-link'], note: 'A0 组织升级设计母版：演示数据，仅供设计评审与视觉回归，不进入产品菜单。' },
  { key: 'settings', path: '/settings', label: '设置', group: '全局', status: 'KEEP', entries: ['link'], note: '全局设置模态，不是路由页面（旧 /settings 路由重定向到首页）。' },
]

export const PAGES: PageDefinition[] = [...PROJECT_PAGES, ...GLOBAL_PAGES]

/** Pages a user must be able to reach from the product UI. */
export function productPages(): PageDefinition[] {
  return PAGES.filter((page) => page.status === 'KEEP' || page.status === 'REVIEW_REQUIRED' || page.status === 'MERGE')
}

export function pageByKey(key: string): PageDefinition | undefined {
  return PAGES.find((page) => page.key === key)
}

export function pageLabel(key: string): string {
  return pageByKey(key)?.label ?? key
}

export function pageGroup(key: string): string {
  return pageByKey(key)?.group ?? ''
}

/** Location matching includes global routes and the retained legacy deep links. */
export function currentPageKey(pathname: string): string {
  if (pathname === '/') return 'center'
  if (pathname === '/organization') return 'organization'
  if (pathname === '/notifications') return 'notifications'
  if (/^\/settings(?:\/|$)/.test(pathname)) return 'settings'
  const project = /^\/projects\/[^/]+(\/.*)?$/.exec(pathname)
  if (!project) return 'not-found'
  const path = project[1] ?? ''
  if (path === '/work') return 'work'
  if (path === '/resources') return 'connections'
  if (path === '/approvals/center') return 'approvals'
  return PROJECT_PAGES.find((page) => page.group !== '全局' && page.path === path)?.key ?? 'not-found'
}

/** Sidebar entry that should be highlighted for a page (its parent for secondary views). */
export function navKeyFor(key: string): string {
  return pageByKey(key)?.navParent ?? key
}

/** Secondary views that share one sidebar entry, in display order. */
export function siblingViews(key: string): PageDefinition[] {
  const parent = navKeyFor(key)
  const family = PROJECT_PAGES.filter((page) => page.key === parent || page.navParent === parent)
  return family.length > 1 ? family : []
}

/** Route path segment for a project page key (empty string means the project index). */
export function pagePath(key: string): string {
  return pageByKey(key)?.path ?? ''
}

/** Pages that deserve a command-palette entry. */
export function palettePages(): PageDefinition[] {
  return productPages().filter((page) => page.entries.includes('palette'))
}
