import type { AgentCapability, PlanRole } from '@projectos/contracts'

/**
 * Minimal, deterministic Agent assignment resolver.
 *
 * It is deliberately a pure function: callers pass a snapshot of the current
 * AgentDefinition / Runtime / load data, so the resolver never creates a second
 * Agent registry or reads mutable state behind the scheduler's back.
 */

export interface AssignmentSkill {
  id: string
  name: string
  description: string
  capabilities: AgentCapability[]
}

export interface AssignmentCandidate {
  agentId: string
  name: string
  role: string
  category: string
  capabilities: AgentCapability[]
  status: 'active' | 'disabled' | 'archived'
  skills: AssignmentSkill[]
  missingSkillIds: string[]
  runtime: { id: string; name: string; status: string } | null
  activeTaskCount: number
}

export interface AssignmentRejection {
  agentId: string
  name: string
  reasons: string[]
}

export interface AgentAssignment {
  agentId: string | null
  blocked: boolean
  reasons: string[]
  rejected: AssignmentRejection[]
  score: number
}

export interface ResolveAssignmentInput {
  role: PlanRole
  title: string
  description: string
  explicitAgentId?: string | null
  /** Legacy role default; kept only as a tie-breaker for compatibility. */
  defaultAgentId?: string | null
  candidates: AssignmentCandidate[]
}

const ROLE_CAPABILITY: Record<PlanRole, AgentCapability> = {
  architect: 'architect',
  developer: 'implement',
  reviewer: 'review',
  tester: 'test',
  custom: 'coordinate',
}

const ROLE_CATEGORY: Record<PlanRole, string> = {
  architect: 'architecture',
  developer: 'code',
  reviewer: 'quality',
  tester: 'quality',
  custom: 'general',
}

const ROLE_KEYWORDS: Record<PlanRole, string[]> = {
  architect: ['架构', '设计', 'architect', 'architecture'],
  developer: ['开发', '工程', '实现', '编码', 'developer', 'engineer', 'implement', 'code'],
  reviewer: ['审查', '评审', 'review', 'reviewer', '质量'],
  tester: ['测试', '验收', 'tester', 'qa', 'quality'],
  custom: ['产品', '规划', '通用', '协调', 'product', 'plan', 'general', 'coordinate'],
}

function candidateBlockers(candidate: AssignmentCandidate): string[] {
  const blockers: string[] = []
  if (candidate.status !== 'active') blockers.push(`Agent 状态为 ${candidate.status}`)
  if (candidate.missingSkillIds.length > 0) {
    blockers.push(`缺少 Skill：${candidate.missingSkillIds.slice(0, 3).join(', ')}`)
  }
  if (candidate.runtime && candidate.runtime.status !== 'available') {
    blockers.push(`Runtime「${candidate.runtime.name}」不可用（${candidate.runtime.status}）`)
  }
  return blockers
}

function scoreCandidate(
  candidate: AssignmentCandidate,
  input: ResolveAssignmentInput,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 5
  const capability = ROLE_CAPABILITY[input.role]
  const category = ROLE_CATEGORY[input.role]
  const roleKeywords = ROLE_KEYWORDS[input.role]
  const haystack = `${input.title} ${input.description}`.toLowerCase()

  if (input.defaultAgentId && candidate.agentId === input.defaultAgentId) {
    score += 30
    reasons.push('角色默认 Agent')
  }
  if (candidate.capabilities.includes(capability)) {
    score += 18
    reasons.push(`能力匹配：${capability}`)
  }
  if (candidate.category === category) {
    score += 8
    reasons.push(`分类匹配：${category}`)
  }
  if (roleKeywords.some((keyword) => candidate.role.toLowerCase().includes(keyword.toLowerCase()))) {
    score += 6
    reasons.push(`角色匹配：${candidate.role}`)
  }

  let capabilitySkillBonus = 0
  let keywordSkillBonus = 0
  for (const skill of candidate.skills) {
    if (skill.capabilities.includes(capability) && capabilitySkillBonus < 18) {
      capabilitySkillBonus += 6
      reasons.push(`Skill 能力匹配：${skill.name}`)
    }
    const skillText = `${skill.name} ${skill.description}`.toLowerCase()
    if (roleKeywords.some((keyword) => skillText.includes(keyword.toLowerCase())) && keywordSkillBonus < 12) {
      keywordSkillBonus += 4
      reasons.push(`Skill 关键词匹配：${skill.name}`)
    }
  }
  score += capabilitySkillBonus + keywordSkillBonus

  if (candidate.runtime) {
    score += 6
    reasons.push(`Runtime 可用：${candidate.runtime.name}`)
  } else {
    score += 3
    reasons.push('未绑定 Runtime，使用内置 Provider')
  }

  if (candidate.activeTaskCount > 0) {
    score -= Math.min(12, candidate.activeTaskCount * 3)
    reasons.push(`当前负载：${candidate.activeTaskCount}`)
  }
  if (haystack.includes(candidate.role.toLowerCase())) {
    // The task text explicitly mentions this Agent's role; keep a small signal.
    score += 2
  }
  return { score, reasons }
}

export function resolveAgentAssignment(input: ResolveAssignmentInput): AgentAssignment {
  const explicitId = input.explicitAgentId?.trim() || null
  if (explicitId) {
    const candidate = input.candidates.find((item) => item.agentId === explicitId)
    if (!candidate) {
      return {
        agentId: explicitId,
        blocked: true,
        reasons: [`显式指定的 Agent 不存在：${explicitId}`],
        rejected: [],
        score: 0,
      }
    }
    const blockers = candidateBlockers(candidate)
    if (blockers.length > 0) {
      return {
        agentId: explicitId,
        blocked: true,
        reasons: [`显式指定：用户已选择 ${candidate.name}`, ...blockers],
        rejected: [],
        score: 0,
      }
    }
    return {
      agentId: explicitId,
      blocked: false,
      reasons: [
        `显式指定：用户已选择 ${candidate.name}`,
        candidate.runtime ? `Runtime 可用：${candidate.runtime.name}` : '未绑定 Runtime，使用内置 Provider',
        ...(candidate.activeTaskCount > 0 ? [`当前负载：${candidate.activeTaskCount}`] : []),
      ],
      rejected: [],
      score: 100,
    }
  }

  const rejected: AssignmentRejection[] = []
  const scored: Array<{ candidate: AssignmentCandidate; score: number; reasons: string[] }> = []
  for (const candidate of input.candidates) {
    const blockers = candidateBlockers(candidate)
    if (blockers.length > 0) {
      rejected.push({ agentId: candidate.agentId, name: candidate.name, reasons: blockers })
      continue
    }
    const value = scoreCandidate(candidate, input)
    scored.push({ candidate, ...value })
  }

  if (scored.length === 0) {
    const reasons =
      rejected.length === 0
        ? ['没有可用的 Agent：项目中没有任何 Agent']
        : [
            '没有可用的 Agent：',
            ...rejected
              .slice(0, 4)
              .map((item) => `${item.name}（${item.reasons.join('；')}）`),
          ]
    return { agentId: null, blocked: true, reasons, rejected, score: 0 }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (a.candidate.activeTaskCount !== b.candidate.activeTaskCount) {
      return a.candidate.activeTaskCount - b.candidate.activeTaskCount
    }
    return a.candidate.agentId.localeCompare(b.candidate.agentId)
  })
  const selected = scored[0]!
  return {
    agentId: selected.candidate.agentId,
    blocked: false,
    reasons: ['自动分配', ...selected.reasons],
    rejected,
    score: selected.score,
  }
}
