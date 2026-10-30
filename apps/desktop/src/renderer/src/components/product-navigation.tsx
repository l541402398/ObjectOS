import { Activity, BookOpen, Boxes, Building2, CloudUpload, FolderKanban, House, LayoutGrid, Rocket, Settings2, ShieldCheck, Workflow } from 'lucide-react'
import type { SidebarNavGroup } from '@projectos/ui'
import { PROJECT_PAGES, pageLabel } from '../page-registry'

const icons = {
  work: House, tasks: LayoutGrid, agents: Workflow, approvals: ShieldCheck, runs: Activity,
  releases: Rocket, deployments: CloudUpload, connections: Boxes, overview: FolderKanban,
  versions: Boxes, knowledge: BookOpen, 'project-settings': Settings2,
} as const

/** Real route registry plus the two named global Settings actions. No prototype nav targets. */
export function productNavigation(projectAvailable: boolean, taskBadge = 0, approvalBadge = 0): SidebarNavGroup[] {
  const groups: SidebarNavGroup[] = projectAvailable ? (['研发', '交付', '项目'] as const).map((group) => ({
    key: group, title: group, collapsible: true,
    items: PROJECT_PAGES.filter((page) => page.group === group && page.entries.includes('nav')).map((page) => {
      const Icon = icons[page.key as keyof typeof icons] ?? FolderKanban
      return { key: page.key, label: page.label, icon: <Icon size={19} strokeWidth={1.65} aria-hidden />, badge: page.key === 'tasks' ? taskBadge || null : page.key === 'approvals' || page.key === 'agents' ? approvalBadge || null : null }
    }),
  })) : []
  groups.push({ key: '全局', title: '全局', placement: 'footer', collapsible: false, items: [
    { key: 'center', label: pageLabel('center'), icon: <FolderKanban size={19} strokeWidth={1.65} aria-hidden /> },
    { key: 'organization', label: '账号与组织', icon: <Building2 size={19} strokeWidth={1.65} aria-hidden /> },
    { key: 'settings', label: pageLabel('settings'), icon: <Settings2 size={19} strokeWidth={1.65} aria-hidden /> },
  ] })
  return groups
}
