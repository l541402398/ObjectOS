import type { AgentCapability } from '@projectos/contracts'

/**
 * ADR-0026 — a task must be fulfillable *before* the scheduler executes it.
 *
 * Planner/Replanner output is model text: it can name an artifact nobody can produce, assign a
 * task to an Agent without the capability to do it, depend on a key that does not exist, or ask
 * for work that the granted budget cannot pay for. Today those defects surface only at runtime,
 * as a paused plan or an evidence-retry loop.
 *
 * This preflight runs after planning/replanning and before execution. It never deletes tests,
 * reviews or quality gates to make a plan pass: an unfulfillable contract is a *plan* defect,
 * repaired through the existing Planner/Replanner (reassign, re-scope) or escalated to the user
 * as a concrete todo.
 */

export type TaskContractRepair = 'reassign-agent' | 'replan' | 'user' | 'none'

export interface TaskContractGap {
  code:
    | 'unknown-work-type'
    | 'no-expected-artifacts'
    | 'unmappable-artifact'
    | 'unassigned'
    | 'agent-disabled'
    | 'agent-not-in-project'
    | 'missing-capability'
    | 'missing-tool'
    | 'evidence-not-recognized'
    | 'missing-dependency'
    | 'self-dependency'
    | 'dependency-cycle'
    | 'diagnostic-needs-negative-evidence'
    | 'no-execution-budget'
    | 'no-tool-budget'
    | 'agent-outside-grant'
    | 'quality-gate-downgrade'
  field: string
  message: string
  /** `fatal` blocks execution; `repairable` is auto-fixable via the named repair. */
  severity: 'fatal' | 'repairable'
  repair: TaskContractRepair
}

export interface TaskContractAgent {
  id: string
  name: string
  capabilities: AgentCapability[]
  enabled: boolean
  visibleInProject: boolean
}

export interface TaskContractInput {
  task: {
    key?: string
    title: string
    role: string
    agentId: string | null
    workType?: string | null
    expectedArtifacts: string[]
    acceptanceCriteria: string[]
    requiredCapabilities?: string[]
    hardCapabilities?: string[]
    dependsOn: string[]
    blockedBy?: string[]
  }
  agents: TaskContractAgent[]
  /** Real tool names the assigned Agent actually gets (`toolCatalogForAgent` ∩ permissions). */
  availableTools?: string[] | null
  /** Known task keys, for dependency existence. Omit when unknown. */
  knownKeys?: string[] | null
  grant?: { maxRuns: number; usedRuns: number; maxToolCalls: number; usedToolCalls: number; allowedAgentIds: string[] } | null
  /** Agent → task edges already resolved; used for cycle detection when available. */
  graph?: Array<{ key: string; dependsOn: string[] }> | null
}

export interface TaskContractPreflight {
  ok: boolean
  gaps: TaskContractGap[]
  /** Requirements the completion engine will actually check, for the report/UI. */
  requirements: Array<{ label: string; requirement: 'review' | 'code' | 'test' | 'diagnostic' | 'design' | 'artifact' }>
}

const WORK_TYPES = /^(development|design|review|test|diagnostic|analysis|documentation|research|planning|release|coordination|custom)$/i
const DIAGNOSTIC = /^(diagnostic|diagnosis|verification-diagnostic)$/i

/**
 * The same expectation→requirement mapping `evaluateCompletion` uses. Kept here so a plan can be
 * rejected for "nobody can ever produce this evidence" instead of discovering it after a run.
 */
export function requirementForExpectation(expectation: string): 'review' | 'code' | 'test' | 'design' | 'artifact' {
  if (/审查|评审|review/i.test(expectation)) return 'review'
  if (/test\.js|未修改|哈希|hash|diff|代码|实现|变更|code/i.test(expectation)) return 'code'
  if (/test|测试|验收/i.test(expectation)) return 'test'
  if (/adr|设计|架构|方案|实施|design|architecture/i.test(expectation)) return 'design'
  return 'artifact'
}

/** Tools the Agent must actually have to produce a real artifact of this kind. */
function requiredToolsFor(requirement: ReturnType<typeof requirementForExpectation>, role: string): string[] {
  if (requirement === 'code') return ['write_file']
  if (requirement === 'test') return ['run_tests']
  if (requirement === 'review') return ['create_artifact']
  if (requirement === 'design' || requirement === 'artifact') return ['create_artifact']
  return role === 'reviewer' ? ['create_artifact'] : []
}

function detectCycle(edges: Array<{ key: string; dependsOn: string[] }>): string[] | null {
  const state = new Map<string, 0 | 1 | 2>()
  const stack: string[] = []
  const byKey = new Map(edges.map((edge) => [edge.key, edge.dependsOn]))
  const visit = (key: string): string[] | null => {
    const status = state.get(key) ?? 0
    if (status === 1) return [...stack.slice(stack.indexOf(key)), key]
    if (status === 2) return null
    state.set(key, 1)
    stack.push(key)
    for (const dependency of byKey.get(key) ?? []) {
      if (!byKey.has(dependency)) continue
      const cycle = visit(dependency)
      if (cycle) return cycle
    }
    stack.pop()
    state.set(key, 2)
    return null
  }
  for (const edge of edges) {
    const cycle = visit(edge.key)
    if (cycle) return cycle
  }
  return null
}

export function preflightTaskContract(input: TaskContractInput): TaskContractPreflight {
  const gaps: TaskContractGap[] = []
  const task = input.task
  const push = (gap: TaskContractGap): void => {
    gaps.push(gap)
  }

  // 1) Work type must be one the system understands; a diagnostic task is the only task
  //    allowed to finish on negative evidence, so a typo must not silently change semantics.
  const workType = (task.workType ?? '').trim()
  if (workType && !WORK_TYPES.test(workType)) {
    push({
      code: 'unknown-work-type',
      field: 'workType',
      message: `未知 WorkType「${workType}」：CompletionDecision 无法判断该任务是否完成`,
      severity: 'repairable',
      repair: 'replan',
    })
  }

  // 2) Expected artifacts must exist and map to a requirement the completion engine checks.
  if (task.expectedArtifacts.length === 0) {
    push({
      code: 'no-expected-artifacts',
      field: 'expectedArtifacts',
      message: '任务没有声明 ExpectedArtifacts，完成依据只能退化为角色默认值',
      severity: 'repairable',
      repair: 'replan',
    })
  }
  const requirements = task.expectedArtifacts.map((expectation) => ({
    label: expectation,
    requirement: requirementForExpectation(expectation),
  }))
  for (const item of requirements) {
    if (!item.label.trim()) {
      push({
        code: 'unmappable-artifact',
        field: 'expectedArtifacts',
        message: '存在空的预期产物声明',
        severity: 'repairable',
        repair: 'replan',
      })
    }
  }

  // 3) Assignment: every executable task needs a real, enabled, visible Agent with the
  //    capabilities (and tools) the contract requires.
  const agent = task.agentId ? input.agents.find((item) => item.id === task.agentId) ?? null : null
  if (!task.agentId) {
    push({
      code: 'unassigned',
      field: 'assigneeAgentId',
      message: '任务没有分配 Agent，Scheduler 无法启动它',
      severity: 'repairable',
      repair: 'reassign-agent',
    })
  } else if (!agent) {
    push({
      code: 'agent-not-in-project',
      field: 'assigneeAgentId',
      message: `分配的 Agent ${task.agentId} 不在当前项目可见范围`,
      severity: 'repairable',
      repair: 'reassign-agent',
    })
  } else {
    if (!agent.enabled) {
      push({
        code: 'agent-disabled',
        field: 'assigneeAgentId',
        message: `Agent「${agent.name}」已停用`,
        severity: 'repairable',
        repair: 'reassign-agent',
      })
    }
    const requiredCaps = [...new Set([...(task.requiredCapabilities ?? []), ...(task.hardCapabilities ?? [])])]
    const missingCaps = requiredCaps.filter(
      (capability) => !agent.capabilities.includes(capability as AgentCapability),
    )
    if (missingCaps.length > 0) {
      push({
        code: 'missing-capability',
        field: 'requiredCapabilities',
        message: `Agent「${agent.name}」缺少能力：${missingCaps.join('、')}`,
        severity: 'repairable',
        repair: 'reassign-agent',
      })
    }
    const roleCapability: Record<string, AgentCapability | null> = {
      developer: 'implement',
      reviewer: 'review',
      tester: 'test',
      architect: 'architect',
    }
    const needed = roleCapability[task.role]
    if (needed && !agent.capabilities.includes(needed) && missingCaps.length === 0) {
      push({
        code: 'missing-capability',
        field: 'role',
        message: `任务角色为 ${task.role}，但 Agent「${agent.name}」不具备 ${needed} 能力，产物无法通过角色验收`,
        severity: 'repairable',
        repair: 'reassign-agent',
      })
    }
    if (input.availableTools) {
      const available = new Set(input.availableTools)
      const neededTools = new Set<string>()
      for (const item of requirements) {
        for (const tool of requiredToolsFor(item.requirement, task.role)) neededTools.add(tool)
      }
      const missingTools = [...neededTools].filter((tool) => !available.has(tool))
      if (missingTools.length > 0) {
        push({
          code: 'missing-tool',
          field: 'availableTools',
          message: `Agent「${agent.name}」没有履约所需工具：${missingTools.join('、')}`,
          severity: 'repairable',
          repair: 'replan',
        })
      }
    }
    if (input.grant && !input.grant.allowedAgentIds.includes(agent.id)) {
      push({
        code: 'agent-outside-grant',
        field: 'assigneeAgentId',
        message: `Agent「${agent.name}」不在当前执行授权的 Agent 范围内，不能自动开始`,
        severity: 'fatal',
        repair: 'user',
      })
    }
  }

  // 4) Dependencies: keys must exist, no self reference, no cycle.
  if (input.knownKeys) {
    const known = new Set(input.knownKeys)
    for (const dependency of task.dependsOn) {
      if (dependency === task.key) {
        push({
          code: 'self-dependency',
          field: 'dependsOn',
          message: '任务依赖自身，DAG 不合法',
          severity: 'fatal',
          repair: 'replan',
        })
        continue
      }
      if (!known.has(dependency)) {
        push({
          code: 'missing-dependency',
          field: 'dependsOn',
          message: `依赖的任务 ${dependency} 不存在`,
          severity: 'fatal',
          repair: 'replan',
        })
      }
    }
  }
  if (input.graph) {
    const cycle = detectCycle(input.graph)
    if (cycle) {
      push({
        code: 'dependency-cycle',
        field: 'dependsOn',
        message: `任务依赖成环：${cycle.join(' → ')}`,
        severity: 'fatal',
        repair: 'replan',
      })
    }
  }

  // 5) Diagnostic tasks: the only legal "negative completion" contract. It must declare a
  //    check it can actually run, otherwise completion would have no exit code to report.
  const diagnostic = DIAGNOSTIC.test(workType)
  if (diagnostic && input.availableTools && !input.availableTools.includes('run_tests') && !input.availableTools.includes('run_command')) {
    push({
      code: 'diagnostic-needs-negative-evidence',
      field: 'workType',
      message: '诊断任务需要能执行真实检查（run_tests/run_command）才能记录负向证据',
      severity: 'fatal',
      repair: 'replan',
    })
  }

  // 6) Budget: a task with no remaining Run/ToolCall budget cannot legally execute.
  if (input.grant) {
    if (input.grant.maxRuns - input.grant.usedRuns <= 0) {
      push({
        code: 'no-execution-budget',
        field: 'grant.maxRuns',
        message: '执行授权的启动次数已用尽，无法启动该任务',
        severity: 'fatal',
        repair: 'user',
      })
    }
    if (input.grant.maxToolCalls - input.grant.usedToolCalls <= 0) {
      push({
        code: 'no-tool-budget',
        field: 'grant.maxToolCalls',
        message: '执行授权的工具调用预算已用尽',
        severity: 'fatal',
        repair: 'user',
      })
    }
  }

  return {
    ok: gaps.length === 0,
    gaps,
    requirements,
  }
}

/**
 * A revision must not quietly delete the verification work that made the previous revision
 * meaningful (tests, reviews, diagnostics). Returning these is *not* an automatic rejection:
 * the caller escalates, because "make the plan pass by removing the quality gate" is exactly
 * the shortcut the product must never take.
 */
export function detectContractDowngrade(input: {
  before: Array<{ key: string; title: string; role: string; expectedArtifacts: string[]; workType?: string | null }>
  after: Array<{ key: string; title: string; role: string; expectedArtifacts: string[]; workType?: string | null }>
}): string[] {
  const isVerification = (task: { role: string; expectedArtifacts: string[]; workType?: string | null }): boolean => {
    if (task.role === 'reviewer' || task.role === 'tester') return true
    if (DIAGNOSTIC.test((task.workType ?? '').trim())) return true
    return task.expectedArtifacts.some((item) => /审查|评审|review|test|测试/i.test(item))
  }
  const afterKeys = new Set(input.after.map((task) => task.key))
  const afterVerification = input.after.filter((task) => isVerification(task)).length
  const removed = input.before.filter((task) => isVerification(task) && !afterKeys.has(task.key))
  const notes: string[] = []
  if (removed.length > 0) {
    notes.push(`修订移除了验证任务：${removed.map((task) => task.key).join('、')}`)
  }
  if (afterVerification === 0 && input.before.some((task) => isVerification(task))) {
    notes.push('修订后不再有任何审查/测试任务，等于删除质量门禁')
  }
  return notes
}

