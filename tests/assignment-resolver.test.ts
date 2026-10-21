import { describe, expect, it } from 'vitest'
import {
  resolveAgentAssignment,
  type AssignmentCandidate,
} from '@projectos/planning'

function candidate(overrides: Partial<AssignmentCandidate> & { agentId: string; name: string }): AssignmentCandidate {
  return {
    role: '开发工程师',
    category: 'code',
    capabilities: ['implement', 'analyze'],
    status: 'active',
    visibleToProject: true,
    skills: [],
    missingSkillIds: [],
    runtime: null,
    activeTaskCount: 0,
    ...overrides,
  }
}

describe('agent assignment resolver', () => {
  it('preserves an explicit user choice even when another Agent scores higher', () => {
    const result = resolveAgentAssignment({
      role: 'developer',
      title: '实现权限模块',
      description: '实现 RBAC',
      explicitAgentId: 'agt_custom',
      defaultAgentId: 'agt_engineer',
      candidates: [
        candidate({ agentId: 'agt_engineer', name: 'Kai', capabilities: ['implement'], skills: [] }),
        candidate({
          agentId: 'agt_custom',
          name: 'Custom Dev',
          capabilities: ['implement'],
          activeTaskCount: 4,
        }),
      ],
    })
    expect(result.agentId).toBe('agt_custom')
    expect(result.blocked).toBe(false)
    expect(result.reasons.join(' ')).toContain('显式指定')
  })

  it('prefers the role default and capability match for an unassigned developer task', () => {
    const result = resolveAgentAssignment({
      role: 'developer',
      title: '实现权限模块',
      description: '实现 RBAC 与审计',
      defaultAgentId: 'agt_engineer',
      candidates: [
        candidate({ agentId: 'agt_architect', name: 'Sage', role: '架构师', capabilities: ['architect'], category: 'architecture' }),
        candidate({ agentId: 'agt_engineer', name: 'Kai', capabilities: ['implement'] }),
        candidate({ agentId: 'agt_qa', name: 'Iris', role: '测试工程师', capabilities: ['test'], category: 'quality' }),
      ],
    })
    expect(result.agentId).toBe('agt_engineer')
    expect(result.blocked).toBe(false)
    expect(result.reasons.join(' ')).toContain('角色默认 Agent')
    expect(result.reasons.join(' ')).toContain('能力匹配：implement')
  })

  it('uses matched Skills and load as secondary signals', () => {
    const result = resolveAgentAssignment({
      role: 'developer',
      title: '实现权限模块',
      description: '实现 RBAC',
      candidates: [
        candidate({
          agentId: 'agt_a',
          name: 'Busy Dev',
          activeTaskCount: 3,
          skills: [{ id: 'skill-developer', name: '增量实现', description: '实现任务', capabilities: ['implement'] }],
        }),
        candidate({
          agentId: 'agt_b',
          name: 'Free Dev',
          activeTaskCount: 0,
          skills: [{ id: 'skill-developer', name: '增量实现', description: '实现任务', capabilities: ['implement'] }],
        }),
      ],
    })
    expect(result.agentId).toBe('agt_b')
    expect(result.reasons.join(' ')).toContain('Skill')
  })

  it('rejects archived, unavailable Runtime and missing Skill candidates', () => {
    const result = resolveAgentAssignment({
      role: 'developer',
      title: '实现权限模块',
      description: '',
      candidates: [
        candidate({ agentId: 'agt_archived', name: 'Archived', status: 'archived' }),
        candidate({
          agentId: 'agt_runtime',
          name: 'No Runtime',
          runtime: { id: 'rtp_missing', name: 'Missing Harness', status: 'unavailable' },
        }),
        candidate({ agentId: 'agt_skill', name: 'No Skill', missingSkillIds: ['skill-missing'] }),
      ],
    })
    expect(result.agentId).toBeNull()
    expect(result.blocked).toBe(true)
    expect(result.reasons.join(' ')).toContain('没有可用的 Agent')
    expect(result.rejected).toHaveLength(3)
  })

  it('keeps out-of-project Agents out of candidates and blocks explicit selection', () => {
    const hidden = candidate({
      agentId: 'agt_other_project',
      name: 'Other Project Agent',
      visibleToProject: false,
    })
    const auto = resolveAgentAssignment({
      role: 'developer',
      title: '实现权限模块',
      description: '',
      candidates: [hidden],
    })
    expect(auto.agentId).toBeNull()
    expect(auto.blocked).toBe(true)
    expect(auto.reasons.join(' ')).toContain('可见范围')
    const explicit = resolveAgentAssignment({
      role: 'developer',
      title: '实现权限模块',
      description: '',
      explicitAgentId: hidden.agentId,
      candidates: [hidden],
    })
    expect(explicit.blocked).toBe(true)
    expect(explicit.reasons.join(' ')).toContain('可见范围')
  })

  it('blocks approval when the explicitly selected Agent is unavailable', () => {
    const result = resolveAgentAssignment({
      role: 'developer',
      title: '实现权限模块',
      description: '',
      explicitAgentId: 'agt_runtime',
      candidates: [
        candidate({
          agentId: 'agt_runtime',
          name: 'No Runtime',
          runtime: { id: 'rtp_missing', name: 'Missing Harness', status: 'unavailable' },
        }),
      ],
    })
    expect(result.agentId).toBe('agt_runtime')
    expect(result.blocked).toBe(true)
    expect(result.reasons.join(' ')).toContain('Runtime')
  })

  it('is deterministic for equal candidates', () => {
    const candidates = [
      candidate({ agentId: 'agt_b', name: 'B' }),
      candidate({ agentId: 'agt_a', name: 'A' }),
    ]
    const first = resolveAgentAssignment({ role: 'custom', title: '协作', description: '', candidates })
    const second = resolveAgentAssignment({ role: 'custom', title: '协作', description: '', candidates })
    expect(first.agentId).toBe(second.agentId)
    expect(first.agentId).toBe('agt_a')
  })
})
