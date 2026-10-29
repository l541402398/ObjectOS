export type PrecisionView =
  | 'overview'
  | 'projects'
  | 'requirements'
  | 'requirement'
  | 'workflow'
  | 'agents'
  | 'members'
  | 'runs'

export const VIEW_META: Record<PrecisionView, { label: string; crumb: string; description: string }> = {
  overview: { label: '工作台', crumb: '工作台', description: '组织级研发概览' },
  projects: { label: '项目中心', crumb: '项目中心', description: '组织项目与成员' },
  requirements: { label: '需求中心', crumb: '需求中心', description: '所有需求与流程实例' },
  requirement: { label: '需求工作台', crumb: '需求中心 / 需求工作台', description: '单条需求的文档、执行与门禁' },
  workflow: { label: '流程模板', crumb: '流程模板', description: '可配置流程与强制门禁' },
  agents: { label: 'Agent 中心', crumb: 'Agent 中心', description: '组织共享 Agent 资产' },
  members: { label: '成员与权限', crumb: '成员与权限', description: '组织角色与项目访问' },
  runs: { label: '运行中心', crumb: '运行中心', description: '执行、审批与审计事件' },
}

export const NAV_GROUPS: {
  id: string
  label: string
  items: { view: PrecisionView; label: string; icon: string; count?: boolean; personalHidden?: boolean }[]
}[] = [
  {
    id: 'workspace',
    label: 'Workspace / 工作空间',
    items: [
      { view: 'overview', label: '工作台', icon: 'home' },
      { view: 'projects', label: '项目中心', icon: 'layers' },
      { view: 'requirements', label: '需求中心', icon: 'list', count: true },
      { view: 'workflow', label: '流程模板', icon: 'flow' },
    ],
  },
  {
    id: 'assets',
    label: 'Assets / 组织资产',
    items: [
      { view: 'agents', label: 'Agent 中心', icon: 'bot' },
      { view: 'members', label: '成员与权限', icon: 'users', personalHidden: true },
    ],
  },
  {
    id: 'operations',
    label: 'Operations / 系统',
    items: [{ view: 'runs', label: '运行中心', icon: 'pulse' }],
  },
]

/** Which sidebar entry should look active for a given view. */
export function navKeyFor(view: PrecisionView): PrecisionView {
  return view === 'requirement' ? 'requirements' : view
}
