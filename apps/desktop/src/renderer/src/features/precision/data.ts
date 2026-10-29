/**
 * A0 DESIGN PROTOTYPE data.
 *
 * Every record in this file is demo data for the Precision Workspace prototype route
 * (`#/precision-lab`). It is NOT read from SQLite/IPC, it does not create requirements, and it must
 * never be presented as real project state. The prototype is intentionally isolated from the
 * production shell; see docs/org-upgrade/reports/A0-report.md.
 */

export type Tone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral'
export type OrgKind = 'enterprise' | 'lab' | 'personal'
export type GateStatus = 'pending' | 'approved' | 'changes'

export interface OrganizationSummary {
  id: string
  name: string
  slug: string
  kind: OrgKind
  caption: string
  role: string
  members: number
  projects: number
}

export interface ProjectSummary {
  id: string
  orgId: string
  key: string
  name: string
  description: string
  activeRequirements: number
  status: '进行中' | '稳定交付' | '本地模式'
  tone: Tone
  branch: string
  updated: string
}

export interface StageDef {
  id: string
  label: string
}

export const STAGES: StageDef[] = [
  { id: 'demand', label: '需求' },
  { id: 'demand_review', label: '需求审核' },
  { id: 'design', label: '技术设计' },
  { id: 'design_review', label: '设计审核' },
  { id: 'dev', label: '开发' },
  { id: 'test', label: '测试' },
  { id: 'review', label: '代码审查' },
  { id: 'delivery', label: '交付' },
]

export interface GateDefinition {
  id: string
  title: string
  role: string
  docVersion: string
  hash: string
  required: string[]
}

export interface GateState {
  status: GateStatus
  decidedBy?: string
  decidedAt?: string
  note?: string
}

export interface AuditEvent {
  id: string
  time: string
  actor: string
  actorKind: 'human' | 'agent' | 'system'
  action: string
  detail?: string
  tone?: Tone
}

export interface AcceptanceItem {
  id: string
  text: string
  met: boolean
}

export interface EvidenceItem {
  id: string
  title: string
  kind: '测试' | 'Review' | 'Diff' | '门禁' | '构建'
  status: 'PASS' | 'FAIL' | '待执行'
  hash: string
  time: string
}

export interface RequirementSummary {
  id: string
  title: string
  projectId: string
  orgId: string
  owner: string
  ownerInitial: string
  stageIndex: number
  tone: Tone
  template: string
  updated: string
  branch: string
  baseCommit: string
  gate: GateDefinition | null
  goal: string
  scope: string[]
  acceptance: AcceptanceItem[]
  events: AuditEvent[]
  evidence: EvidenceItem[]
  nextStep: string
}

export interface AttentionItem {
  id: string
  kind: 'gate' | 'asset'
  requirementId?: string
  title: string
  meta: string
  tone: Tone
}

export const ORGANIZATIONS: OrganizationSummary[] = [
  {
    id: 'org-starsea',
    name: '星海研发中心',
    slug: 'star-sea',
    kind: 'enterprise',
    caption: 'Enterprise workspace',
    role: '组织管理员',
    members: 5,
    projects: 2,
  },
  {
    id: 'org-polaris',
    name: '北辰实验室',
    slug: 'polaris',
    kind: 'lab',
    caption: 'Research lab',
    role: '项目维护者',
    members: 3,
    projects: 1,
  },
  {
    id: 'org-personal',
    name: '个人工作区',
    slug: 'personal',
    kind: 'personal',
    caption: '本地单用户模式',
    role: '本机所有者',
    members: 1,
    projects: 1,
  },
]

export const PROJECTS: ProjectSummary[] = [
  {
    id: 'proj-osp',
    orgId: 'org-starsea',
    key: 'OSP',
    name: 'ProjectOS Core',
    description: '组织协作、Agent 调度与可配置流程引擎',
    activeRequirements: 14,
    status: '进行中',
    tone: 'accent',
    branch: 'v2.0-org-a0',
    updated: '今天 10:28',
  },
  {
    id: 'proj-wsdk',
    orgId: 'org-starsea',
    key: 'WSDK',
    name: 'Workspace SDK',
    description: '执行端、工具权限、Worktree 与安全边界',
    activeRequirements: 6,
    status: '稳定交付',
    tone: 'ok',
    branch: 'v1.6-ux',
    updated: '昨天 18:42',
  },
  {
    id: 'proj-lab',
    orgId: 'org-polaris',
    key: 'LAB',
    name: 'Agent Sandbox',
    description: '评测沙箱、配额与提示词实验',
    activeRequirements: 3,
    status: '进行中',
    tone: 'accent',
    branch: 'lab/eval-2',
    updated: '今天 09:12',
  },
  {
    id: 'proj-local',
    orgId: 'org-personal',
    key: 'LOCAL',
    name: '本地工作区',
    description: '离线项目、个人 Agent 与本地知识库',
    activeRequirements: 2,
    status: '本地模式',
    tone: 'neutral',
    branch: 'local/main',
    updated: '10月27日',
  },
]

const gateDesignReview: GateDefinition = {
  id: 'gate-design-review',
  title: '设计审核',
  role: '项目 Maintainer',
  docVersion: 'v1.2',
  hash: 'sha256:9f2c41d8…7be0',
  required: ['设计文档 v1.2 已冻结', '影响范围与回滚路径', '测试与验收策略'],
}

export const REQUIREMENTS: RequirementSummary[] = [
  {
    id: 'REQ-124',
    title: '统一项目生命周期与智能审查',
    projectId: 'proj-osp',
    orgId: 'org-starsea',
    owner: '林可',
    ownerInitial: '林',
    stageIndex: 3,
    tone: 'warn',
    template: '标准研发 v2',
    updated: '10月29日',
    branch: 'feature/REQ-124-review-flow',
    baseCommit: '9e2f82a',
    gate: gateDesignReview,
    goal: '把项目生命周期收敛为一条可审计的需求旅程：需求、设计、开发、测试、审查与交付共享同一份证据链，任何一个门禁都不能被流程模板隐式跳过。',
    scope: [
      '需求旅程与项目聚合视图共用同一份状态投影，不维护第二套进度',
      '设计审核通过后才允许创建开发 Worktree 与执行计划',
      '门禁证据绑定内容 hash，文档变更后旧审批自动失效',
    ],
    acceptance: [
      { id: 'ac-1', text: '设计审核通过后，Scheduler 才允许创建执行计划', met: true },
      { id: 'ac-2', text: '审批记录包含内容 hash、审批角色与时间', met: true },
      { id: 'ac-3', text: '文档修订后旧审批自动标记为过期', met: false },
      { id: 'ac-4', text: '1440 / 1024 与深色主题下无溢出', met: false },
    ],
    events: [
      {
        id: 'ev-1',
        time: '10:28',
        actor: 'Sage',
        actorKind: 'agent',
        action: '生成设计文档 v1.2',
        detail: '架构 Agent · 11 个章节 · 内容 hash 已冻结',
        tone: 'accent',
      },
      {
        id: 'ev-2',
        time: '10:26',
        actor: 'Plan Scheduler',
        actorKind: 'system',
        action: '草拟 4 阶段 / 11 项任务的执行计划',
        detail: '等待设计审核通过后才会请求执行授权',
        tone: 'neutral',
      },
      {
        id: 'ev-3',
        time: '10:22',
        actor: 'Local Worker',
        actorKind: 'system',
        action: '预留需求 Worktree 与 feature 分支',
        detail: 'base 9e2f82a · 尚未写入任何源码',
        tone: 'ok',
      },
      {
        id: 'ev-4',
        time: '10:18',
        actor: 'Avery',
        actorKind: 'agent',
        action: '汇总需求并请求设计审核',
        detail: '需求文档 v1.1 · 3 条验收标准',
        tone: 'neutral',
      },
    ],
    evidence: [
      { id: 'evd-1', title: '设计文档 v1.2 内容快照', kind: '门禁', status: 'PASS', hash: 'sha256:9f2c41d8', time: '10:28' },
      { id: 'evd-2', title: '需求文档 v1.1 审核记录', kind: 'Review', status: 'PASS', hash: 'sha256:2b71c0aa', time: '10:18' },
      { id: 'evd-3', title: '设计评审 Diff（3 个章节）', kind: 'Diff', status: 'PASS', hash: 'sha256:7d10e3f2', time: '10:27' },
      { id: 'evd-4', title: '开发阶段测试与构建', kind: '测试', status: '待执行', hash: '—', time: '—' },
    ],
    nextStep: '由项目 Maintainer 完成设计审核，之后才会创建执行计划。',
  },
  {
    id: 'REQ-123',
    title: '组织共享 Agent 资产版本化',
    projectId: 'proj-osp',
    orgId: 'org-starsea',
    owner: '周言',
    ownerInitial: '周',
    stageIndex: 4,
    tone: 'accent',
    template: '标准研发 v2',
    updated: '10月28日',
    branch: 'feature/REQ-123-agent-assets',
    baseCommit: 'bb16a2a',
    gate: null,
    goal: '组织级 Agent、Skill 与 MCP 定义以不可变版本发布，项目绑定明确版本，Run 启动时冻结快照，运行中的资产更新不会改变已开始的 Run。',
    scope: ['资产版本与项目绑定的数据契约', '发布审批与撤销', 'Run 快照冻结与审计'],
    acceptance: [
      { id: 'ac-1', text: '发布后的资产版本不可修改，只能新建版本', met: true },
      { id: 'ac-2', text: 'Run 详情可追溯到冻结的资产版本与 checksum', met: true },
      { id: 'ac-3', text: '撤销版本后新 Run 无法再绑定', met: false },
    ],
    events: [
      { id: 'ev-1', time: '16:40', actor: 'Kai', actorKind: 'agent', action: '提交资产解析器改动', detail: '3 个文件 · 等待测试', tone: 'accent' },
      { id: 'ev-2', time: '15:12', actor: '周言', actorKind: 'human', action: '确认资产版本冻结策略', detail: '版本号语义与撤销规则', tone: 'neutral' },
    ],
    evidence: [
      { id: 'evd-1', title: '单元测试：资产版本冻结', kind: '测试', status: 'PASS', hash: 'sha256:c41a90d1', time: '16:52' },
      { id: 'evd-2', title: '代码审查（进行中）', kind: 'Review', status: '待执行', hash: '—', time: '—' },
    ],
    nextStep: '开发执行中：Kai 正在隔离 Worktree 内实现资产解析器，测试通过后进入代码审查。',
  },
  {
    id: 'REQ-122',
    title: '修复授权后工作流恢复异常',
    projectId: 'proj-wsdk',
    orgId: 'org-starsea',
    owner: '陈哲',
    ownerInitial: '陈',
    stageIndex: 7,
    tone: 'ok',
    template: '快速修复 v1',
    updated: '10月28日',
    branch: 'fix/REQ-122-resume-after-approval',
    baseCommit: '5a59547',
    gate: null,
    goal: '审批通过后 Runtime 不再重复挂起：恢复执行时使用审批时冻结的上下文，并对未知副作用保持对账而不是盲目重试。',
    scope: ['恢复流程与幂等键', '审批上下文冻结', '失败对账提示'],
    acceptance: [
      { id: 'ac-1', text: '审批通过后 500ms 内恢复执行', met: true },
      { id: 'ac-2', text: '重复恢复请求不会产生第二次工具调用', met: true },
      { id: 'ac-3', text: '真实测试退出码为 0', met: true },
    ],
    events: [
      { id: 'ev-1', time: '17:20', actor: 'Local Worker', actorKind: 'system', action: '合并到 main 并完成回归验证', detail: 'commit 5a59547 · 6 项测试 PASS', tone: 'ok' },
      { id: 'ev-2', time: '16:04', actor: '陈哲', actorKind: 'human', action: '批准交付门禁', detail: '证据快照与目标分支 HEAD 一致', tone: 'ok' },
    ],
    evidence: [
      { id: 'evd-1', title: '真实测试 r1-budgets', kind: '测试', status: 'PASS', hash: 'sha256:88be20fa', time: '16:58' },
      { id: 'evd-2', title: '合并后回归', kind: '构建', status: 'PASS', hash: 'sha256:0d31b7c9', time: '17:20' },
    ],
    nextStep: '已验证交付：合并与回归证据已归档，可以开始下一条需求。',
  },
  {
    id: 'REQ-121',
    title: '需求级特性分支隔离',
    projectId: 'proj-osp',
    orgId: 'org-starsea',
    owner: '宋楠',
    ownerInitial: '宋',
    stageIndex: 1,
    tone: 'warn',
    template: '高风险流程 v3',
    updated: '10月27日',
    branch: 'feature/REQ-121-worktree-isolation',
    baseCommit: '9e2f82a',
    gate: {
      id: 'gate-demand-review',
      title: '需求审核',
      role: '项目 Maintainer',
      docVersion: 'v0.4',
      hash: 'sha256:51ab99e0…2c73',
      required: ['范围与非目标', '受影响模块清单', '分支命名与 baseCommit'],
    },
    goal: '每条需求拥有独立的 Worktree、feature 分支与写锁，多个需求并行时互不覆盖；合并按串行门禁执行并记录目标分支真实 HEAD。',
    scope: ['Worktree 生命周期', '写锁与 fencing token', '并行冲突与串行合并'],
    acceptance: [
      { id: 'ac-1', text: '同一需求仅存在一个有效写租约', met: true },
      { id: 'ac-2', text: '合并前校验目标分支 HEAD 未变化', met: false },
      { id: 'ac-3', text: '冲突时给出可执行的下一步', met: false },
    ],
    events: [
      { id: 'ev-1', time: '10月27日 14:02', actor: 'Avery', actorKind: 'agent', action: '起草需求文档 v0.4', detail: '等待项目 Maintainer 审核', tone: 'warn' },
      { id: 'ev-2', time: '10月27日 11:36', actor: '林可', actorKind: 'human', action: '选择高风险流程 v3', detail: '涉及 Git 写入与并发租约', tone: 'neutral' },
    ],
    evidence: [
      { id: 'evd-1', title: '需求文档内容快照', kind: '门禁', status: 'PASS', hash: 'sha256:51ab99e0', time: '10月27日' },
    ],
    nextStep: '等待项目 Maintainer 审核需求文档；通过后进入技术设计。',
  },
  {
    id: 'REQ-120',
    title: '项目与成员权限矩阵',
    projectId: 'proj-wsdk',
    orgId: 'org-starsea',
    owner: '林可',
    ownerInitial: '林',
    stageIndex: 4,
    tone: 'accent',
    template: '标准研发 v2',
    updated: '10月26日',
    branch: 'feature/REQ-120-permission-matrix',
    baseCommit: 'd026336',
    gate: null,
    goal: '用可扩展的权限策略替代角色硬编码：组织角色、项目角色与高风险操作授权分开判断，后端对每次访问强制校验组织与项目作用域。',
    scope: ['权限策略检查器', '组织/项目双层作用域', '越权负向测试'],
    acceptance: [
      { id: 'ac-1', text: '组织管理员不会自动获得本机命令执行权限', met: true },
      { id: 'ac-2', text: '跨组织对象访问返回 403 且不泄露存在性', met: true },
      { id: 'ac-3', text: '前端隐藏按钮不能作为唯一防线', met: true },
    ],
    events: [
      { id: 'ev-1', time: '10月26日 15:10', actor: 'Kai', actorKind: 'agent', action: '实现权限策略检查器', detail: '策略单测 18 项', tone: 'accent' },
      { id: 'ev-2', time: '10月26日 09:44', actor: '林可', actorKind: 'human', action: '确认默认角色矩阵', detail: 'Owner / Maintainer / Contributor / Reviewer / Viewer', tone: 'neutral' },
    ],
    evidence: [
      { id: 'evd-1', title: '权限策略单测', kind: '测试', status: 'PASS', hash: 'sha256:aa7312c4', time: '10月26日' },
    ],
    nextStep: '开发执行中：等待权限策略测试稳定后进入代码审查。',
  },
  {
    id: 'REQ-208',
    title: '评测沙箱隔离与配额',
    projectId: 'proj-lab',
    orgId: 'org-polaris',
    owner: '许知',
    ownerInitial: '许',
    stageIndex: 5,
    tone: 'accent',
    template: '标准研发 v2',
    updated: '今天 09:12',
    branch: 'lab/REQ-208-sandbox-quota',
    baseCommit: 'cfa26ef',
    gate: null,
    goal: '为 Agent 评测提供隔离的临时沙箱与硬性配额，避免评测任务占用正式项目目录或无限消耗模型调用。',
    scope: ['沙箱目录与清理', '调用配额与预算', '评测结果归档'],
    acceptance: [
      { id: 'ac-1', text: '沙箱不可访问项目根目录之外的路径', met: true },
      { id: 'ac-2', text: '超预算时立即停止并保留证据', met: true },
    ],
    events: [
      { id: 'ev-1', time: '09:12', actor: 'Nova', actorKind: 'agent', action: '运行 12 组评测', detail: '8 PASS · 4 超时', tone: 'accent' },
    ],
    evidence: [
      { id: 'evd-1', title: '评测运行摘要', kind: '测试', status: 'PASS', hash: 'sha256:31da77be', time: '09:12' },
    ],
    nextStep: '测试执行中：2 组超时用例需要调整预算阈值。',
  },
  {
    id: 'REQ-207',
    title: '提示词版本回滚',
    projectId: 'proj-lab',
    orgId: 'org-polaris',
    owner: '许知',
    ownerInitial: '许',
    stageIndex: 2,
    tone: 'neutral',
    template: '快速修复 v1',
    updated: '10月28日',
    branch: 'lab/REQ-207-prompt-rollback',
    baseCommit: 'cfa26ef',
    gate: null,
    goal: '提示词模板支持版本化与一键回滚，回滚操作记录操作者、原因与受影响评测。',
    scope: ['版本存储', '回滚审计', '评测差异'],
    acceptance: [
      { id: 'ac-1', text: '回滚后评测结果可对比', met: false },
      { id: 'ac-2', text: '回滚不会影响正在运行的评测', met: false },
    ],
    events: [
      { id: 'ev-1', time: '10月28日 17:02', actor: 'Sage', actorKind: 'agent', action: '起草技术设计 v0.2', detail: '等待内部评审', tone: 'neutral' },
    ],
    evidence: [
      { id: 'evd-1', title: '设计草稿', kind: '门禁', status: '待执行', hash: '—', time: '—' },
    ],
    nextStep: '技术设计中：设计文档尚未进入正式审核。',
  },
  {
    id: 'REQ-031',
    title: '离线项目导入校验',
    projectId: 'proj-local',
    orgId: 'org-personal',
    owner: '本机用户',
    ownerInitial: '本',
    stageIndex: 4,
    tone: 'accent',
    template: '本地流程',
    updated: '10月27日',
    branch: 'local/REQ-031-import-check',
    baseCommit: '9e2f82a',
    gate: null,
    goal: '在没有组织服务器的情况下导入本地项目：校验项目结构、Git 状态与已有 Agent 配置，不修改用户原有文件。',
    scope: ['目录安全校验', 'Git 状态探测', '只读导入'],
    acceptance: [
      { id: 'ac-1', text: '导入不移动、不覆盖用户源码', met: true },
      { id: 'ac-2', text: '符号链接逃逸被拒绝', met: true },
    ],
    events: [
      { id: 'ev-1', time: '10月27日 20:18', actor: 'Local Worker', actorKind: 'system', action: '完成本地导入预检', detail: '3 个风险项 · 0 个阻断', tone: 'accent' },
    ],
    evidence: [
      { id: 'evd-1', title: '导入预检报告', kind: '构建', status: 'PASS', hash: 'sha256:5e0c9a11', time: '10月27日' },
    ],
    nextStep: '本地模式：所有状态保存在本机 SQLite，不依赖组织服务器。',
  },
]

export const ATTENTION: AttentionItem[] = [
  {
    id: 'att-1',
    kind: 'gate',
    requirementId: 'REQ-124',
    title: 'REQ-124 · 设计文档待审核',
    meta: '当前方案 v1.2 已冻结，等待项目 Maintainer 审核。',
    tone: 'warn',
  },
  {
    id: 'att-2',
    kind: 'asset',
    title: '组织资产授权申请',
    meta: 'Agent Sage 请求只读访问内部知识库，范围 1 个项目。',
    tone: 'accent',
  },
]

export const AGENTS = [
  { id: 'agent-avery', name: 'Avery', role: '产品 Agent · 需求整理与流程分配', version: '2.4.1', visibility: '全组织可用', status: '已发布', runs: 34 },
  { id: 'agent-sage', name: 'Sage', role: '架构 Agent · ADR、设计与评审', version: '1.9.3', visibility: '已发布', status: '已发布', runs: 21 },
  { id: 'agent-kai', name: 'Kai', role: '开发 Agent · 代码、测试与修复', version: '3.1.0', visibility: '项目已绑定', status: '运行中', runs: 47 },
  { id: 'agent-nova', name: 'Nova', role: 'Review Agent · 独立代码复审', version: '2.0.2', visibility: '全组织可用', status: '已发布', runs: 18 },
]

export const MEMBERS = [
  { id: 'm-1', name: '林可', email: 'lin.ke@demo.invalid', orgRole: 'Owner', projects: '全部项目', status: '正常', initial: '林' },
  { id: 'm-2', name: '周言', email: 'zhou.yan@demo.invalid', orgRole: 'Admin', projects: 'ProjectOS Core', status: '正常', initial: '周' },
  { id: 'm-3', name: '宋楠', email: 'song.nan@demo.invalid', orgRole: 'Member', projects: 'ProjectOS Core', status: '正常', initial: '宋' },
  { id: 'm-4', name: '陈哲', email: 'chen.zhe@demo.invalid', orgRole: 'Member', projects: 'Workspace SDK', status: '正常', initial: '陈' },
  { id: 'm-5', name: '许知', email: 'xu.zhi@demo.invalid', orgRole: 'Guest', projects: 'Agent Sandbox', status: '受限', initial: '许' },
]

export const RUNS = [
  { id: 'run-4412', requirementId: 'REQ-123', agent: 'Kai', action: '隔离 Worktree 内修改 3 个文件', status: '运行中', time: '10:26:17', tone: 'accent' as Tone },
  { id: 'run-4411', requirementId: 'REQ-124', agent: 'Sage', action: '生成设计文档 v1.2 并冻结 hash', status: '已完成', time: '10:28:41', tone: 'ok' as Tone },
  { id: 'run-4410', requirementId: 'REQ-122', agent: 'Local Worker', action: '测试退出码 0，绑定内容 SHA-256', status: '已完成', time: '10:22:09', tone: 'ok' as Tone },
  { id: 'run-4409', requirementId: 'REQ-121', agent: 'Plan Scheduler', action: '等待需求审核门禁', status: '已阻塞', time: '10:18:54', tone: 'warn' as Tone },
  { id: 'run-4408', requirementId: 'REQ-120', agent: 'Kai', action: '权限策略单测 18 项', status: '已完成', time: '09:58:03', tone: 'ok' as Tone },
]

/* ------------------------------------------------------------------------------------------------
 * Workflow template (workflow designer demo)
 * ---------------------------------------------------------------------------------------------- */

export type WorkflowKind =
  | 'agent_task'
  | 'document_gate'
  | 'test_gate'
  | 'review_gate'
  | 'knowledge_publish'
  | 'delivery'
  | 'human_input'

export interface WorkflowKindMeta {
  label: string
  group: '需求与设计' | '执行' | '质量门禁' | '交付与知识'
  tone: Tone
  role: string
  mandatory: boolean
  description: string
}

export const WORKFLOW_KINDS: Record<WorkflowKind, WorkflowKindMeta> = {
  agent_task: {
    label: 'Agent 任务',
    group: '执行',
    tone: 'accent',
    role: 'Developer',
    mandatory: false,
    description: '由指定 Agent 产出文档、代码或分析，必须附带真实 Run 与证据。',
  },
  human_input: {
    label: '人工确认',
    group: '执行',
    tone: 'neutral',
    role: 'Maintainer',
    mandatory: true,
    description: '需要指定人类签字确认，记录操作者与版本。',
  },
  document_gate: {
    label: '文档审核',
    group: '需求与设计',
    tone: 'warn',
    role: 'Maintainer',
    mandatory: true,
    description: '按内容 hash 审核需求或设计文档，修订后旧审批失效。',
  },
  test_gate: {
    label: '测试门禁',
    group: '质量门禁',
    tone: 'warn',
    role: 'QA',
    mandatory: true,
    description: '要求真实命令、退出码与当前代码快照绑定的测试证据。',
  },
  review_gate: {
    label: '代码审查',
    group: '质量门禁',
    tone: 'warn',
    role: 'Reviewer',
    mandatory: true,
    description: '独立 Reviewer 对当前快照出具审查结论，不可过期复用。',
  },
  knowledge_publish: {
    label: '知识沉淀',
    group: '交付与知识',
    tone: 'ok',
    role: 'Knowledge Agent',
    mandatory: false,
    description: '提取候选知识，经人工批准后才进入可检索知识库。',
  },
  delivery: {
    label: '合并交付',
    group: '交付与知识',
    tone: 'ok',
    role: 'Maintainer',
    mandatory: true,
    description: '合并、发布或部署，需要明确授权与合并后的真实验证。',
  },
}

export interface WorkflowNodeDef {
  id: string
  kind: WorkflowKind
  title: string
  role: string
  mandatory: boolean
  outputs: string[]
  optional: boolean
  failurePolicy?: 'block' | 'retry' | 'manual'
}

export interface WorkflowEdgeDef {
  id: string
  source: string
  target: string
  label?: string
  conditional?: boolean
}

export const WORKFLOW_NAME = '标准研发流程'

export const DEFAULT_WORKFLOW_NODES: WorkflowNodeDef[] = [
  { id: 'n-demand', kind: 'agent_task', title: '需求文档', role: 'Product Agent', mandatory: true, outputs: ['需求文档 v1'], optional: false },
  { id: 'n-demand-review', kind: 'document_gate', title: '需求审核', role: '项目 Maintainer', mandatory: true, outputs: ['审核结论'], optional: false },
  { id: 'n-design', kind: 'agent_task', title: '技术设计', role: 'Architect', mandatory: true, outputs: ['设计文档', '影响范围'], optional: false },
  { id: 'n-design-review', kind: 'document_gate', title: '设计审核', role: '项目 Maintainer', mandatory: true, outputs: ['审核结论', '风险接受'], optional: false },
  { id: 'n-dev', kind: 'agent_task', title: '开发实现', role: 'Developer', mandatory: true, outputs: ['代码 Diff', '实施记录'], optional: false },
  { id: 'n-test', kind: 'test_gate', title: '自动化测试', role: 'QA', mandatory: true, outputs: ['命令与退出码', '测试快照'], optional: false },
  { id: 'n-review', kind: 'review_gate', title: '代码审查', role: '独立 Reviewer', mandatory: true, outputs: ['Review 结论'], optional: false },
  { id: 'n-knowledge', kind: 'knowledge_publish', title: '知识沉淀', role: 'Knowledge Agent', mandatory: false, outputs: ['知识候选'], optional: true },
  { id: 'n-delivery', kind: 'delivery', title: '合并交付', role: '项目 Maintainer', mandatory: true, outputs: ['合并 Commit', '回归证据'], optional: false },
]

export const DEFAULT_WORKFLOW_EDGES: WorkflowEdgeDef[] = [
  { id: 'e1', source: 'n-demand', target: 'n-demand-review' },
  { id: 'e2', source: 'n-demand-review', target: 'n-design', label: '高风险' },
  { id: 'e3', source: 'n-demand-review', target: 'n-dev', label: '快速修复', conditional: true },
  { id: 'e4', source: 'n-design', target: 'n-design-review' },
  { id: 'e5', source: 'n-design-review', target: 'n-dev' },
  { id: 'e6', source: 'n-dev', target: 'n-test' },
  { id: 'e7', source: 'n-test', target: 'n-review' },
  { id: 'e8', source: 'n-review', target: 'n-knowledge' },
  { id: 'e9', source: 'n-review', target: 'n-delivery' },
  { id: 'e10', source: 'n-knowledge', target: 'n-delivery' },
]

export interface WorkflowIssue {
  id: string
  severity: 'error' | 'warn'
  nodeId?: string
  message: string
}

/** Deterministic, explainable validation over the actual graph — no fake "validated" flag. */
export function validateWorkflow(nodes: WorkflowNodeDef[], edges: WorkflowEdgeDef[]): WorkflowIssue[] {
  const issues: WorkflowIssue[] = []
  const ids = new Set(nodes.map((node) => node.id))
  const incoming = new Map<string, number>(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>(nodes.map((node) => [node.id, []]))

  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) {
      issues.push({ id: `edge-missing-${edge.id}`, severity: 'error', message: `连线 ${edge.id} 指向不存在的节点` })
      continue
    }
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    outgoing.get(edge.source)?.push(edge.target)
  }

  const starts = nodes.filter((node) => (incoming.get(node.id) ?? 0) === 0)
  if (starts.length !== 1) {
    issues.push({ id: 'start-count', severity: 'error', message: `流程必须有且仅有一个起点，当前 ${starts.length} 个` })
  }
  if (!nodes.some((node) => node.kind === 'delivery')) {
    issues.push({ id: 'delivery-missing', severity: 'error', message: '流程缺少合并交付节点' })
  }

  for (const node of nodes) {
    const meta = WORKFLOW_KINDS[node.kind]
    if (!node.role.trim()) {
      issues.push({ id: `role-${node.id}`, severity: 'error', nodeId: node.id, message: `「${node.title}」缺少执行角色` })
    }
    if (meta.mandatory && !node.mandatory && node.kind !== 'human_input') {
      issues.push({ id: `mandatory-${node.id}`, severity: 'error', nodeId: node.id, message: `组织强制门禁「${node.title}」不能设为可选` })
    }
    if (node.kind !== 'knowledge_publish' && node.outputs.length === 0) {
      issues.push({ id: `output-${node.id}`, severity: 'warn', nodeId: node.id, message: `「${node.title}」未声明输出，审核证据将不完整` })
    }
  }

  // Cycle detection (DFS colouring).
  const state = new Map<string, 0 | 1 | 2>(nodes.map((node) => [node.id, 0]))
  const visit = (id: string): boolean => {
    state.set(id, 1)
    for (const next of outgoing.get(id) ?? []) {
      if (state.get(next) === 1) return true
      if (state.get(next) === 0 && visit(next)) return true
    }
    state.set(id, 2)
    return false
  }
  for (const node of nodes) {
    if (state.get(node.id) === 0 && visit(node.id)) {
      issues.push({ id: 'cycle', severity: 'error', nodeId: node.id, message: '检测到循环依赖，流程无法完成' })
      break
    }
  }

  return issues
}

export function orgById(id: string): OrganizationSummary {
  return ORGANIZATIONS.find((org) => org.id === id) ?? ORGANIZATIONS[0]!
}

export function projectById(id: string): ProjectSummary | undefined {
  return PROJECTS.find((project) => project.id === id)
}

export function requirementById(id: string): RequirementSummary | undefined {
  return REQUIREMENTS.find((requirement) => requirement.id === id)
}

export function requirementsForOrg(orgId: string): RequirementSummary[] {
  return REQUIREMENTS.filter((requirement) => requirement.orgId === orgId)
}

export function requirementsForProject(projectId: string): RequirementSummary[] {
  return REQUIREMENTS.filter((requirement) => requirement.projectId === projectId)
}

export function projectsForOrg(orgId: string): ProjectSummary[] {
  return PROJECTS.filter((project) => project.orgId === orgId)
}

export function stageLabel(index: number): string {
  return STAGES[Math.min(index, STAGES.length - 1)]?.label ?? '需求'
}

export function requirementStatus(req: RequirementSummary, gate?: GateState): { label: string; tone: Tone } {
  if (gate?.status === 'approved') return { label: '门禁已批准', tone: 'ok' }
  if (gate?.status === 'changes') return { label: '需修改', tone: 'danger' }
  if (req.stageIndex === 7) return { label: '已验证交付', tone: 'ok' }
  if (req.gate) return { label: `等待${req.gate.title}`, tone: 'warn' }
  if (req.stageIndex >= 4 && req.stageIndex <= 5) return { label: '开发执行中', tone: 'accent' }
  if (req.stageIndex === 6) return { label: '代码审查中', tone: 'accent' }
  return { label: stageLabel(req.stageIndex), tone: 'neutral' }
}
