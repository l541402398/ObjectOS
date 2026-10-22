import type { Artifact, RunDetail, TaskCard } from '@projectos/contracts'
import type { CompletionDecision } from './completion-evidence.js'

/**
 * Risk-tiered human acceptance.
 *
 * The risk level is derived only from persisted execution facts (ToolCalls,
 * attributed file changes, run status) — never from an Agent-written risk label
 * or Artifact metadata. ProjectOS has exactly one real human actor (`local-user`,
 * the local project owner); there is no invented admin/approver role.
 */
export type AcceptanceRisk = 'normal' | 'high' | 'critical'

export interface AcceptanceEvidence {
  runs: number
  verifiedArtifacts: number
  successfulTools: string[]
  attributedFiles: number
}

export interface HumanAcceptancePolicy {
  riskLevel: AcceptanceRisk
  reasons: string[]
  evidence: AcceptanceEvidence
  requiresExtraEvidence: boolean
  hasExtraEvidence: boolean
  requiresApproval: boolean
  canAcceptDirectly: boolean
  unsatisfiedRequirements: string[]
}

const CRITICAL_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)(secrets?|credentials)(\/|\.|$)/i,
  /(^|\/)id_rsa(\.|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)(auth|authentication|permission|permissions|security|crypto)(\/|\.|$)/i,
  /(^|\/)(migrations?|schema)(\/|\.|$)/i,
  /(^|\/)package\.json$/i,
  /(^|\/)electron-builder\.ya?ml$/i,
  /(^|\/)\.github\/workflows\//i,
]

const CRITICAL_TOOLS = new Set(['git_commit', 'runtime.execute', 'runtime.acp'])
const WRITE_OR_PROCESS_TOOLS = new Set([
  'write_file',
  'run_command',
  'run_tests',
  'runtime.execute',
  'runtime.acp',
  'git_commit',
])
const DESTRUCTIVE_COMMAND = /(rm\s+-rf|remove-item\s+-recurse|del\s+\/[sf]|format\s+[a-z]:|drop\s+database|git\s+reset\s+--hard|git\s+push\s+--force|npm\s+publish|curl[^|]*\|\s*(sh|bash))/i

function commandOf(args: Record<string, unknown> | null | undefined): string {
  if (!args || typeof args !== 'object') return ''
  return typeof args.command === 'string' ? args.command : ''
}

export function evaluateHumanAcceptance(input: {
  task: TaskCard
  artifacts: Artifact[]
  runs: RunDetail[]
  automatic: CompletionDecision
}): HumanAcceptancePolicy {
  const { task, artifacts, runs, automatic } = input
  const reasons: string[] = []
  let risk: AcceptanceRisk = 'normal'
  const escalate = (current: AcceptanceRisk, next: AcceptanceRisk, reason: string): AcceptanceRisk => {
    reasons.push(reason)
    if (next === 'critical') return 'critical'
    if (next === 'high' && current !== 'critical') return 'high'
    return current
  }

  const successfulTools = new Set<string>()
  let attributedFiles = 0
  for (const detail of runs) {
    for (const call of detail.toolCalls) {
      if (call.status !== 'completed') continue
      if (WRITE_OR_PROCESS_TOOLS.has(call.toolName)) successfulTools.add(call.toolName)
      if (CRITICAL_TOOLS.has(call.toolName)) {
        risk = escalate(risk, 'critical', `执行了高风险工具：${call.toolName}`)
      }
      if (call.toolName === 'write_file' || call.toolName === 'run_command') {
        const path = typeof call.args.path === 'string' ? call.args.path.replace(/\\/g, '/') : ''
        if (path && CRITICAL_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
          risk = escalate(risk, 'critical', `修改了受保护/安全敏感路径：${path}`)
        }
        if (call.toolName === 'run_command' && commandOf(call.args).match(DESTRUCTIVE_COMMAND)) {
          risk = escalate(risk, 'critical', `执行了破坏性命令：${commandOf(call.args).slice(0, 120)}`)
        }
      }
    }
    for (const change of detail.fileChanges) {
      attributedFiles += 1
      if (change.changeType === 'deleted') {
        risk = escalate(risk, 'high', `删除了文件：${change.path}`)
      }
      if (CRITICAL_PATH_PATTERNS.some((pattern) => pattern.test(change.path))) {
        risk = escalate(risk, 'critical', `文件变更涉及安全敏感路径：${change.path}`)
      }
    }
  }
  if (successfulTools.size > 0) {
    risk = escalate(risk, 'high', `包含写文件/进程执行/外部 Runtime：${[...successfulTools].join(', ')}`)
  }
  if (attributedFiles > 0) {
    risk = escalate(risk, 'high', `本次任务变更了 ${attributedFiles} 个文件`)
  }
  if (runs.some((detail) => detail.run.status === 'needs_reconciliation')) {
    risk = escalate(risk, 'critical', '存在待人工核对的 Run，副作用未完全确认')
  }
  if (task.priority === 1) {
    risk = escalate(risk, 'high', '紧急优先级任务')
  }

  const verifiedArtifacts = artifacts.filter(
    (artifact) => artifact.verifiedAt !== null && artifact.kind !== 'document',
  ).length
  const evidence: AcceptanceEvidence = {
    runs: runs.length,
    verifiedArtifacts,
    successfulTools: [...successfulTools],
    attributedFiles,
  }
  const hasExtraEvidence = verifiedArtifacts > 0 || successfulTools.size > 0 || attributedFiles > 0
  const unsatisfiedRequirements = automatic.requirements
    .filter((requirement) => !requirement.satisfied)
    .map((requirement) => `${requirement.label}：${requirement.missing.join('；') || '未满足'}`)

  return {
    riskLevel: risk,
    reasons,
    evidence,
    requiresExtraEvidence: risk !== 'normal',
    hasExtraEvidence,
    requiresApproval: risk === 'critical',
    canAcceptDirectly: risk !== 'critical',
    unsatisfiedRequirements,
  }
}

export function acceptanceAuditMetadata(input: {
  policy: HumanAcceptancePolicy
  reason: string
  actor: { kind: string; id: string; name: string }
  decidedAt: number
  approvalId: string | null
  override: boolean
}): Record<string, unknown> {
  return {
    acceptanceMode: 'human',
    riskLevel: input.policy.riskLevel,
    riskReasons: input.policy.reasons,
    operator: { id: input.actor.id, name: input.actor.name, kind: input.actor.kind },
    decidedAt: input.decidedAt,
    reason: input.reason,
    evidence: input.policy.evidence,
    unsatisfiedRequirements: input.policy.unsatisfiedRequirements,
    override: input.override,
    overriddenRequirements: input.override ? input.policy.unsatisfiedRequirements : [],
    approvalId: input.approvalId,
  }
}
