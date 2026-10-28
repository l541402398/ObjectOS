import type { PlanGrantAction } from '@projectos/contracts'

/**
 * ADR-0026 — when may the product apply its own revision without asking again?
 *
 * ProjectOS may only continue inside the authorization the user already granted. A replan is
 * therefore compared against the *live envelope* of the current PlanExecutionGrant:
 *
 *   paths     every path the revision needs must already be authorized,
 *   agents    every Agent that would run must already be authorized,
 *   actions   the revision may not need a grant action the user never granted,
 *   budget    the remaining Run/ToolCall budget must cover the new work,
 *   time      the grant must not have expired,
 *   money     the project soft budget must not be exceeded without an explicit opt-in,
 *   quality   the revision may not delete the verification work of the previous revision.
 *
 * Anything outside the envelope is a *new* authorization and must go to the user with a precise
 * diff. Nothing here may issue, extend or fabricate a grant.
 */

export type ReplanAuthorizationDecision = 'auto-apply' | 'require-approval' | 'blocked'

export interface ReplanEnvelope {
  grantId: string
  actions: PlanGrantAction[]
  allowedPaths: string[]
  allowedAgentIds: string[]
  remainingRuns: number
  remainingToolCalls: number
  expiresAt: number
  allowOverBudget: boolean
}

export interface ReplanRequirements {
  /** Agents that will Execute in the revised revision. */
  agentsRequired: string[]
  /** Paths the revision needs to write; empty means "no new path requirement". */
  pathsRequired: string[]
  /** Tasks that must start a Run in the revised revision (informational). */
  tasksToRun: number
  /**
   * Plan starts the revision needs. `maxRuns` in a PlanExecutionGrant counts plan *starts*
   * (one reservation per `orchestration.start`), not per-task Runs, so a revision always needs
   * exactly one start and must never be measured against its task count.
   */
  startsNeeded: number
  /** Minimum tool calls the work needs (a plan with no tool budget cannot finish). */
  toolCallsNeeded: number
  /** Human-readable notes when the revision removed verification work. */
  downgradeNotes: string[]
}

export interface ReplanAuthorizationInput {
  policy: {
    mode: 'assist' | 'autonomous' | 'managed'
    autoApplyReplans: boolean
    maxAutoReplans: number
    autoReplansUsed: number
  }
  envelope: ReplanEnvelope | null
  requirements: ReplanRequirements
  projectBudget: { softLimit: number; spent: number } | null
  now: number
}

export interface ReplanAuthorization {
  decision: ReplanAuthorizationDecision
  /** The exact delta the user would be asked to authorize. */
  diffs: string[]
  reasons: string[]
}

function within(allowed: string[], required: string): boolean {
  if (allowed.includes('.')) return true
  const normalized = required.replace(/\\/g, '/').replace(/^\.\//, '')
  return allowed.some((entry) => {
    const root = entry.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
    return normalized === root || normalized.startsWith(`${root}/`)
  })
}

export function evaluateReplanAuthorization(input: ReplanAuthorizationInput): ReplanAuthorization {
  const diffs: string[] = []
  const reasons: string[] = []
  const blocked = (reason: string): ReplanAuthorization => {
    reasons.push(reason)
    return { decision: 'blocked', diffs, reasons }
  }
  const needsApproval = (reason: string): ReplanAuthorization => {
    reasons.push(reason)
    return { decision: 'require-approval', diffs, reasons }
  }

  if (!input.policy.autoApplyReplans) {
    return needsApproval('项目策略未开启“授权范围内自动应用修订”')
  }
  if (input.policy.mode !== 'autonomous') {
    return needsApproval(`项目自主模式为 ${input.policy.mode}，修订需要人工确认`)
  }
  if (input.policy.autoReplansUsed >= input.policy.maxAutoReplans) {
    return blocked(`该目标已自动修订 ${input.policy.autoReplansUsed} 次，达到上限 ${input.policy.maxAutoReplans}`)
  }
  const envelope = input.envelope
  if (!envelope) {
    diffs.push('原计划没有有效执行授权可继承')
    return needsApproval('没有可继承的执行授权，需要用户重新授权')
  }
  if (envelope.expiresAt <= input.now) {
    diffs.push(`授权已于 ${new Date(envelope.expiresAt).toISOString()} 过期`)
    return needsApproval('执行授权已过期')
  }

  const newAgents = input.requirements.agentsRequired.filter((agentId) => !envelope.allowedAgentIds.includes(agentId))
  if (newAgents.length > 0) {
    diffs.push(`新增 Agent：${newAgents.join('、')}`)
  }
  const newPaths = input.requirements.pathsRequired.filter((path) => !within(envelope.allowedPaths, path))
  if (newPaths.length > 0) {
    diffs.push(`新增写入路径：${newPaths.join('、')}`)
  }
  if (!envelope.actions.includes('workspace-write')) {
    diffs.push('原授权不包含 workspace-write')
  }
  if (input.requirements.startsNeeded > envelope.remainingRuns) {
    diffs.push(`需要 ${input.requirements.startsNeeded} 次计划启动，剩余授权 ${envelope.remainingRuns} 次`)
  }
  if (input.requirements.toolCallsNeeded > envelope.remainingToolCalls) {
    diffs.push(`需要约 ${input.requirements.toolCallsNeeded} 次工具调用，剩余授权 ${envelope.remainingToolCalls} 次`)
  }
  if (
    input.projectBudget &&
    input.projectBudget.softLimit > 0 &&
    !envelope.allowOverBudget &&
    input.projectBudget.spent > input.projectBudget.softLimit
  ) {
    diffs.push(`项目已用费用 ${input.projectBudget.spent.toFixed(4)} 超过软预算 ${input.projectBudget.softLimit}`)
  }

  if (diffs.length > 0) {
    return needsApproval(`修订超出当前授权范围：${diffs.join('；')}`)
  }

  // Deleting the verification work is never a legal "fix", even inside the envelope.
  if (input.requirements.downgradeNotes.length > 0) {
    diffs.push(...input.requirements.downgradeNotes)
    return needsApproval(`修订降低了验证要求：${input.requirements.downgradeNotes.join('；')}`)
  }

  reasons.push('修订完全落在当前执行授权范围内（路径、Agent、工具、预算、期限、验证要求）')
  return { decision: 'auto-apply', diffs, reasons }
}

/**
 * How many automatic revisions the current goal has already used. Counted from the plan
 * lineage, so a new revision (new plan id) does not reset the budget and loop forever.
 */
export function countAutoReplans(
  events: Array<{ eventType: string; payload: Record<string, unknown> }>,
): number {
  return events.filter(
    (event) => event.eventType === 'plan.replan.applied' && event.payload.authorizedBy === 'policy',
  ).length
}
