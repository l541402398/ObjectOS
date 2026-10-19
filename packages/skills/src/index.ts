import type { Agent, AgentCapability, Task } from '@projectos/contracts'

export interface SkillTrigger {
  keywords: string[]
  labels?: string[]
}

export interface SkillManifest {
  id: string
  version: string
  name: string
  description: string
  capabilities: AgentCapability[]
  triggers: SkillTrigger
  requiresTools: string[]
  permissions: string[]
  outputs: string[]
  prompt: string
}

export const BUILTIN_SKILLS: SkillManifest[] = [
  {
    id: 'skill-project-manager',
    version: '1.0.0',
    name: '项目规划',
    description: '把模糊目标拆成里程碑、依赖清晰的可验收任务，并规划 Agent 分工。',
    capabilities: ['plan', 'coordinate'],
    triggers: {
      keywords: ['计划', '规划', '里程碑', '拆分', '排期', '路线', '范围', 'roadmap', 'milestone', 'plan'],
    },
    requiresTools: ['list_tasks', 'create_task', 'create_milestone', 'handoff_task'],
    permissions: ['project:read', 'task:write', 'milestone:write'],
    outputs: ['任务列表', '里程碑', '执行顺序'],
    prompt: `先重述目标与边界，再给出里程碑。任务必须可独立验收，写明验收标准与依赖；不要把实现细节写成空泛描述。若信息不足，列出最多 3 个必须澄清的问题，同时给出可先执行的保守方案。`,
  },
  {
    id: 'skill-requirement-analyst',
    version: '1.0.0',
    name: '需求分析',
    description: '将讨论与素材收敛为结构化需求、验收标准和范围边界。',
    capabilities: ['plan', 'analyze'],
    triggers: {
      keywords: ['需求', '用户故事', '验收', '场景', '范围', 'requirement', 'acceptance', 'story'],
    },
    requiresTools: ['create_requirement', 'create_task', 'record_decision'],
    permissions: ['project:read', 'requirement:write'],
    outputs: ['需求条目', '验收标准', '范围 / 非目标'],
    prompt: `从用户目标出发写出需求正文，明确非目标与失败场景。每条验收标准必须可观察、可测试，避免“体验良好”这类不可验证表述。识别与现有 ADR 的冲突，必要时记录新决策。`,
  },
  {
    id: 'skill-architect',
    version: '1.0.0',
    name: '架构设计',
    description: '识别技术约束，比较方案并记录可追溯的架构决策。',
    capabilities: ['architect', 'analyze'],
    triggers: {
      keywords: ['架构', '设计', '技术选型', '接口', '数据模型', 'adr', 'architecture', 'schema', 'boundary'],
    },
    requiresTools: ['read_file', 'list_directory', 'record_decision', 'create_artifact'],
    permissions: ['project:read', 'workspace:read', 'decision:write'],
    outputs: ['架构决策记录', '接口 / 数据模型', '风险与回滚'],
    prompt: `先阅读现有代码与约束，再提出至少两个可选方案并比较取舍。ADR 需要包含背景、决策、替代方案、后果与迁移影响。不得凭空假设外部库 API；不确定时明确标记待验证。`,
  },
  {
    id: 'skill-developer',
    version: '1.0.0',
    name: '增量实现',
    description: '以最小可验收改动实现任务，先读后写，运行真实验证。',
    capabilities: ['implement', 'analyze'],
    triggers: {
      keywords: ['实现', '开发', '修复', '重构', '编码', '接口', 'bug', 'implement', 'feature', 'build'],
    },
    requiresTools: ['read_file', 'list_directory', 'write_file', 'run_command', 'run_tests', 'create_artifact'],
    permissions: ['project:read', 'workspace:read', 'workspace:write:approval', 'process:approval'],
    outputs: ['代码变更', '测试结果', '交付说明'],
    prompt: `先定位相关文件并阅读现有实现，再做最小改动。不要为了“完整”引入未要求的抽象。写盘前说明计划；每条写入与命令都需要审批。完成后运行与改动最相关的测试，报告命令、退出码和真实输出；如果无法运行，明确写出原因。`,
  },
  {
    id: 'skill-reviewer',
    version: '1.0.0',
    name: '代码审查',
    description: '基于任务验收标准、Git 差异与测试证据给出可执行审查结论。',
    capabilities: ['review', 'analyze'],
    triggers: {
      keywords: ['审查', '评审', 'review', 'diff', '风险', '回归', '质量'],
    },
    requiresTools: ['read_file', 'git_diff', 'git_status', 'create_artifact', 'handoff_task'],
    permissions: ['project:read', 'workspace:read', 'artifact:write'],
    outputs: ['审查报告', '阻塞项 / 建议项', '测试缺口'],
    prompt: `先核对验收标准，再检查差异中的正确性、边界条件、安全性与可维护性。区分阻塞项与非阻塞建议，引用具体文件与行为。不要修改代码；用 create_artifact 记录结论，测试缺口交给测试 Agent。`,
  },
  {
    id: 'skill-tester',
    version: '1.0.0',
    name: '验收测试',
    description: '把验收标准转为可执行检查，记录真实命令、结果和遗留风险。',
    capabilities: ['test', 'review'],
    triggers: {
      keywords: ['测试', '验证', '验收', '回归', '用例', 'test', 'qa', 'verify'],
    },
    requiresTools: ['run_tests', 'run_command', 'read_file', 'create_artifact', 'handoff_task'],
    permissions: ['project:read', 'workspace:read', 'process:approval', 'artifact:write'],
    outputs: ['测试报告', '复现步骤', '通过 / 失败结论'],
    prompt: `从验收标准逐条派生测试用例，覆盖正常路径、边界和失败路径。执行真实命令并保留输出；不得把未执行的检查写成通过。发现失败时给出最小复现与影响范围，并将任务标记为受阻或交回开发。`,
  },
]

export interface SkillSelection {
  skill: SkillManifest
  score: number
  reasons: string[]
}

export interface SkillSelectionInput {
  task: Pick<Task, 'title' | 'description' | 'labels'> | null
  agent: Pick<Agent, 'capabilities' | 'role'>
  limit?: number
}

export function selectSkills(input: SkillSelectionInput): SkillSelection[] {
  const haystack = `${input.task?.title ?? ''} ${input.task?.description ?? ''} ${(input.task?.labels ?? []).join(' ')}`.toLowerCase()
  const scored = BUILTIN_SKILLS.map((skill) => {
    let score = 0
    const reasons: string[] = []
    const capabilityMatches = skill.capabilities.filter((capability) => input.agent.capabilities.includes(capability))
    score += capabilityMatches.length * 3
    if (capabilityMatches.length > 0) reasons.push(`能力匹配：${capabilityMatches.join(', ')}`)
    const keywordMatches = skill.triggers.keywords.filter((keyword) => haystack.includes(keyword.toLowerCase()))
    score += keywordMatches.length * 2
    if (keywordMatches.length > 0) reasons.push(`任务关键词：${keywordMatches.slice(0, 4).join(', ')}`)
    const labelMatches = (skill.triggers.labels ?? []).filter((label) => (input.task?.labels ?? []).includes(label))
    score += labelMatches.length * 4
    if (labelMatches.length > 0) reasons.push(`标签：${labelMatches.join(', ')}`)
    if (input.agent.role.includes(skill.name)) score += 2
    return { skill, score, reasons }
  })
  const selected = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 2)
  if (selected.length === 0) {
    const fallback =
      BUILTIN_SKILLS.find((skill) => skill.capabilities.some((capability) => input.agent.capabilities.includes(capability))) ??
      BUILTIN_SKILLS[3]!
    return [{ skill: fallback, score: 0, reasons: ['按 Agent 能力回退选择'] }]
  }
  return selected
}

export function skillById(id: string): SkillManifest | undefined {
  return BUILTIN_SKILLS.find((skill) => skill.id === id)
}
