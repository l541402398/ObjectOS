import { describe, expect, it } from 'vitest'
import { pickAuthorizedAgentForRole } from '../apps/runtime/src/replan-service.js'

/**
 * ADR-0040 — a revision reuses an authorized Agent *of the right role*.
 *
 * Real run: every new tester/reviewer task landed on "P288 Dev" because all three E2E Agents declare
 * the same broad capability set and the reuse picked the first authorized Agent that listed `test`.
 * The plan silently lost multi-Agent collaboration.
 */
const dev = { id: 'agt_dev', name: 'P288 Dev', role: '实现工程师', capabilities: ['implement', 'test', 'review'] }
const qa = { id: 'agt_qa_p288', name: 'P288 QA', role: '测试工程师', capabilities: ['implement', 'test', 'review'] }
const reviewer = { id: 'agt_rev_p288', name: 'P288 Reviewer', role: '审查员', capabilities: ['implement', 'test', 'review'] }

describe('ADR-0040 role-aware Agent reuse inside the authorized set', () => {
  it('prefers the Agent already assigned to a same-role task in this revision', () => {
    const picked = pickAuthorizedAgentForRole({
      agents: [dev, qa, reviewer],
      role: 'tester',
      capability: 'test',
      assignedTasks: [{ role: 'tester', agentId: qa.id }],
    })
    expect(picked?.id).toBe(qa.id)
  })

  it('prefers a role-name match when the revision has no same-role task', () => {
    const picked = pickAuthorizedAgentForRole({
      agents: [dev, qa, reviewer],
      role: 'reviewer',
      capability: 'review',
      assignedTasks: [],
    })
    expect(picked?.id).toBe(reviewer.id)
  })

  it('never picks a developer Agent for a tester role when a tester exists', () => {
    const picked = pickAuthorizedAgentForRole({
      agents: [dev, qa],
      role: 'tester',
      capability: 'test',
      assignedTasks: [],
    })
    expect(picked?.id).toBe(qa.id)
  })

  it('falls back deterministically to an id-ordered capable Agent', () => {
    const picked = pickAuthorizedAgentForRole({
      agents: [
        { id: 'agt_b', name: 'B', role: '通用', capabilities: ['test'] },
        { id: 'agt_a', name: 'A', role: '通用', capabilities: ['test'] },
      ],
      role: 'tester',
      capability: 'test',
      assignedTasks: [],
    })
    expect(picked?.id).toBe('agt_a')
  })

  it('returns null when nobody in the authorized set has the capability', () => {
    const picked = pickAuthorizedAgentForRole({
      agents: [{ id: 'agt_plan', name: 'Planner', role: '产品经理', capabilities: ['plan'] }],
      role: 'tester',
      capability: 'test',
      assignedTasks: [],
    })
    expect(picked).toBeNull()
  })
})
