import type { ReactNode } from 'react'
import { Activity, BookOpen, Boxes, Building2, CloudUpload, FolderKanban, House, LayoutGrid, Rocket, Settings2, ShieldCheck, Workflow } from 'lucide-react'
import type { SidebarNavGroup } from '@projectos/ui'
import { PROJECT_PAGES, pageLabel } from '../page-registry'

const icons = {
  work: House, tasks: LayoutGrid, requirements: BookOpen, agents: Workflow, approvals: ShieldCheck, runs: Activity,
  releases: Rocket, deployments: CloudUpload, connections: Boxes, overview: FolderKanban,
  versions: Boxes, knowledge: BookOpen, 'project-settings': Settings2,
} as const

const LAB_ROWS = new Set(['agents', 'runs'])

export interface ProjectHubMenuItem {
  key: string
  label: string
  note: string
  icon: ReactNode
}

/** Pinned project-level secondary menu items (项目姿态, 版本与迭代, 知识与成果, 项目设置). */
export function projectHubNavigationItems(): ProjectHubMenuItem[] {
  return PROJECT_PAGES.filter((page) => page.group === '项目' && page.entries.includes('nav')).map((page) => {
    const Icon = icons[page.key as keyof typeof icons] ?? FolderKanban
    return {
      key: page.key,
      label: page.label,
      note: page.note.replace(/。$/, ''),
      icon: <Icon size={18} strokeWidth={1.65} aria-hidden />,
    }
  })
}

/** Real route registry plus the two named global Settings actions. No prototype nav targets. */
export function productNavigation(projectAvailable: boolean, taskBadge = 0, approvalBadge = 0): SidebarNavGroup[] {
  const groups: SidebarNavGroup[] = projectAvailable ? (['研发', '交付'] as const).map((group) => ({
    key: group, title: group, collapsible: true,
    // Frozen Design Lab projection: the approved pre-ADR-0090 sidebar set (agents/runs were rows then).
    items: PROJECT_PAGES.filter((page) => page.group === group && (page.entries.includes('nav') || LAB_ROWS.has(page.key))).map((page) => {
      const Icon = icons[page.key as keyof typeof icons] ?? FolderKanban
      return { key: page.key, label: page.key === 'work' ? '研发工作中心' : page.label, icon: <Icon size={19} strokeWidth={1.65} aria-hidden />, badge: page.key === 'tasks' ? taskBadge || null : page.key === 'approvals' || page.key === 'agents' ? approvalBadge || null : null }
    }),
  })) : []
  groups.push({ key: '全局', title: '全局', placement: 'footer', collapsible: false, items: [
    { key: 'center', label: pageLabel('center'), icon: <FolderKanban size={19} strokeWidth={1.65} aria-hidden /> },
    { key: 'organization', label: '账号与组织', icon: <Building2 size={19} strokeWidth={1.65} aria-hidden /> },
    { key: 'settings', label: pageLabel('settings'), icon: <Settings2 size={19} strokeWidth={1.65} aria-hidden /> },
  ] })
  return groups
}

/**
 * Production workspace navigation (ADR-0090). Secondary views (`navParent`) do not get their own
 * sidebar row: 任务看板 / Agent 协作 / 计划编排 / 运行审计 share one "执行" entry and switch with
 * view tabs. The protected Design Lab keeps the original projection above.
 */
export function workspaceNavigation(projectAvailable: boolean, taskBadge = 0, approvalBadge = 0): SidebarNavGroup[] {
  const projectGroups: SidebarNavGroup[] = projectAvailable ? (['研发', '交付'] as const).map((group) => ({
    key: group, title: group, collapsible: true,
    items: PROJECT_PAGES.filter((page) => page.group === group && page.entries.includes('nav') && !page.navParent).map((page) => {
      const Icon = page.key === 'tasks' ? Workflow : icons[page.key as keyof typeof icons] ?? FolderKanban
      return { key: page.key, label: page.navLabel ?? page.label, icon: <Icon size={19} strokeWidth={1.65} aria-hidden />, badge: page.key === 'tasks' ? taskBadge || null : page.key === 'approvals' ? approvalBadge || null : null }
    }),
  })) : []
  return [
    { key: '工作空间', title: '工作空间', collapsible: false, items: [
      { key: 'center', label: pageLabel('center'), icon: <FolderKanban size={19} strokeWidth={1.65} aria-hidden /> },
      { key: 'organization', label: pageLabel('organization'), icon: <Building2 size={19} strokeWidth={1.65} aria-hidden /> },
    ] },
    ...projectGroups,
    { key: '全局', title: '全局', placement: 'footer', collapsible: false, items: [
      { key: 'settings', label: pageLabel('settings'), icon: <Settings2 size={19} strokeWidth={1.65} aria-hidden /> },
    ] },
  ]
}
