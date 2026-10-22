export type LabStage = {
  id: string
  title: string
  subtitle: string
  role: string
  risk?: boolean
}

export type LabTask = {
  id: string
  code: string
  title: string
  description: string
  stageId: string
  role: string
  agent: string
  dependsOn: string[]
  criteria: string[]
  artifacts: string[]
  capabilities: string[]
  risk?: string
  requiresApproval: boolean
}

/** Local design-lab data. This never enters the business store or IPC. */
export const labStages: LabStage[] = [
  { id: 'architecture', title: '架构阶段', subtitle: '确认边界与风险', role: '架构' },
  { id: 'build', title: '开发阶段', subtitle: '并行实现视觉系统', role: '开发' },
  { id: 'review', title: '审查阶段', subtitle: '复核体验与可访问性', role: '审查' },
  { id: 'verify', title: '测试阶段', subtitle: '回归与交付验证', role: '测试' },
]

export const labTasks: LabTask[] = [
  {
    id: 't1',
    code: 'TASK 01',
    title: '确认计划审核的信息边界与视觉约束',
    description: '以真实 PlanDraft 字段为准，定义工作区、检查器与 DAG 的信息优先级。',
    stageId: 'architecture',
    role: '架构',
    agent: 'Sage',
    dependsOn: [],
    criteria: ['列出必须保留的业务字段', '明确原型与正式审批的边界', '记录玻璃材质的性能预算'],
    artifacts: ['边界说明', '视觉约束清单'],
    capabilities: ['plan', 'analyze', 'architect'],
    requiresApproval: false,
  },
  {
    id: 't2',
    code: 'TASK 02',
    title: '建立 PlanDraft 到视觉组件的适配层',
    description: '保持业务数据结构不变，用本地适配层驱动路线、任务列表与依赖图。',
    stageId: 'architecture',
    role: '架构',
    agent: 'Sage',
    dependsOn: ['t1'],
    criteria: ['不修改 PlannedTask 契约', '阶段由 dependsOn 推导', '演示数据与真实数据隔离'],
    artifacts: ['适配层', '数据映射说明'],
    capabilities: ['plan', 'typescript'],
    requiresApproval: true,
  },
  {
    id: 't3',
    code: 'TASK 03',
    title: '实现 SVG 阶段光路与共享布局过渡',
    description: '让路线成为空间中的连续路径，阶段切换具有可中断的共享焦点。',
    stageId: 'build',
    role: '开发',
    agent: 'Kai',
    dependsOn: ['t2'],
    criteria: ['路径在 1440 与 1100 宽度下完整', '阶段选择可键盘操作', '减少动态时保留静态路径'],
    artifacts: ['StageJourney.tsx'],
    capabilities: ['react', 'motion', 'svg'],
    risk: '路线动画依赖路径长度，需要在 reduced-motion 下静态降级。',
    requiresApproval: false,
  },
  {
    id: 't4',
    code: 'TASK 04',
    title: '重构任务检查器的结构化编辑体验',
    description: '用分组字段、chips 与渐进展开替代原始 select / textarea 堆叠。',
    stageId: 'build',
    role: '开发',
    agent: 'Kai',
    dependsOn: ['t2'],
    criteria: ['字段分组与真实任务字段一致', '验收项可增删并保持焦点', '关闭后不丢失本地编辑'],
    artifacts: ['TaskInspector.tsx', '交互状态表'],
    capabilities: ['react', 'accessibility'],
    requiresApproval: true,
  },
  {
    id: 't5',
    code: 'TASK 05',
    title: '接入 ELK 自动布局与 DAG 路径聚焦',
    description: '用分层自动布局表达并行分支，选中节点时只强调上下游路径。',
    stageId: 'build',
    role: '开发',
    agent: 'Mira',
    dependsOn: ['t3', 't4'],
    criteria: ['并行分支无重叠', '选中节点上下游高亮', '画布支持缩放、平移与适配'],
    artifacts: ['TaskGraph.tsx'],
    capabilities: ['react', 'elk', 'graph'],
    requiresApproval: false,
  },
  {
    id: 't6',
    code: 'TASK 06',
    title: '复核玻璃层次、中文排版与可访问性',
    description: '检查浅色/暗色对比、125% 缩放、长标题和键盘焦点顺序。',
    stageId: 'review',
    role: '审查',
    agent: 'Nova',
    dependsOn: ['t5'],
    criteria: ['正文对比度达到 AA', '长中文标题不溢出', '检查器可用 Esc 关闭'],
    artifacts: ['视觉复核记录'],
    capabilities: ['review', 'accessibility'],
    risk: '玻璃上的低对比辅助文字需要逐项实测，不能依赖主观判断。',
    requiresApproval: true,
  },
  {
    id: 't7',
    code: 'TASK 07',
    title: '完成 Design Lab 回归与交互录屏',
    description: '覆盖八个必选交互、浅色/暗色、1100px 与 125% 布局。',
    stageId: 'verify',
    role: '测试',
    agent: 'Iris',
    dependsOn: ['t6'],
    criteria: ['舞台切换、检查器与 DAG 联动通过', '记录真实 Electron 截图', '保留性能与兼容性报告'],
    artifacts: ['回归结果', '交互录屏'],
    capabilities: ['test', 'playwright'],
    requiresApproval: true,
  },
]

export const demoGoal = '把计划审核重构为可执行的光学玻璃工作台'
