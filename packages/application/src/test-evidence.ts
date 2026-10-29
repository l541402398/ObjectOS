/**
 * ADR-0047 — one trusted-test-evidence resolver.
 *
 * Phase 2.8.8 accepted `hasTest` as soon as a `test-report` artifact had a non-null `verifiedAt`.
 * That is a claim, not an execution: a report written by a human or by the model, or copied from an
 * earlier revision, could satisfy the completion requirement while the code was still broken (a real
 * run produced exactly that: "修复后真实复跑 exit 0" next to `src/sums.mjs` still returning `a`).
 *
 * This module is the single place that decides whether a test/verification result may be trusted for
 * the *current* content. CompletionDecision, GoalStatus and GateEvaluation all consume it, so they
 * cannot drift into weaker rules.
 *
 * It deliberately does not create a second evidence system: the inputs are the persisted ToolCalls
 * (real command + exit code + run), the mutation marks from completed `write_file` calls, and the
 * content fingerprint from the existing ReviewSnapshot machinery (ADR-0025).
 */

export type VerificationCheckKind = 'run_tests' | 'run_command'

export interface VerificationCheck {
  id: string
  runId: string
  toolName: VerificationCheckKind
  /** The exact command that executed. */
  command: string
  /** Real exit code; never inferred from prose. */
  exitCode: number
  /** When the tool call finished (falls back to started/created time). */
  at: number
}

/** A change to the workspace content that happened after a check could invalidate it. */
export interface MutationMark {
  kind: 'write' | 'commit'
  at: number
  detail?: string
}

export interface EvidenceArtifactInput {
  id: string
  kind: string
  runId: string | null
  verifiedAt: number | null
  createdAt: number
  /** Content fingerprint the artifact claims to describe (ADR-0025 format). */
  contentFingerprint: string | null
  /** `user` / `model` declarations are never execution evidence. */
  declaredBy: 'user' | 'model' | 'execution' | 'unknown'
  /** Commands the artifact says it reports, so it can be matched to a real check. */
  commands: string[]
  /** Original artifact metadata, so a caller can recompute the fingerprint for its scope. */
  metadata?: Record<string, unknown>
}

export type TestEvidenceState = 'unverified' | 'stale' | 'failed' | 'passed'

export interface TestEvidenceArtifactVerdict {
  id: string
  trusted: boolean
  reason: string
}

export interface TestEvidenceResolution {
  state: TestEvidenceState
  /** May this satisfy "the tests passed for the current content"? */
  trusted: boolean
  /** All real failures, oldest first. Never erased by a later pass (requirement 7). */
  failures: VerificationCheck[]
  /** The newest real passing check, if any. */
  lastSuccess: VerificationCheck | null
  /** The newest real failing check, if any. */
  lastFailure: VerificationCheck | null
  /** Why the state is what it is, in audit language. */
  reasons: string[]
  /** Per-artifact trust, so a UI can explain a rejected report. */
  artifacts: TestEvidenceArtifactVerdict[]
  /** True when the artifact exists but describes older content. */
  stale: boolean
}

export interface TestEvidenceInput {
  checks: VerificationCheck[]
  mutations?: MutationMark[]
  artifacts?: EvidenceArtifactInput[]
  /**
   * Recompute, for one artifact's own scope, the fingerprint of the content as it exists now.
   * Returning null means "cannot be verified", which never counts as trusted.
   */
  currentFingerprintFor?: (artifact: EvidenceArtifactInput) => string | null
  qualityGate?: { outcome: 'passed' | 'failed' | 'error' | 'skipped' | 'not_applicable' } | null
}

const VERIFICATION_COMMAND =
  /^(npm|pnpm|yarn)\s+(run\s+)?(test|build|typecheck|lint)\b|^(npx\s+)?(vitest|jest|mocha)\b|^node\s+--test\b|^(npx\s+)?tsc\b/i

/** True when a command is a real verification command (not an ad-hoc probe). */
export function isVerificationCommand(toolName: string, command: string): boolean {
  if (toolName === 'run_tests') return true
  if (toolName !== 'run_command') return false
  return VERIFICATION_COMMAND.test(command.trim())
}

/**
 * Resolve whether the recorded evidence proves the current content passes.
 *
 * Ordering rules:
 *  - a passing check only counts when it is newer than every failure of interest and newer than the
 *    last content mutation (otherwise it tested older code);
 *  - an artifact only counts when it is backed by a real passing check **in the same run**, is not a
 *    human/model declaration, and its content fingerprint equals the current one;
 *  - failures are always reported, even after a later pass, so history stays auditable.
 */
export function resolveTestEvidence(input: TestEvidenceInput): TestEvidenceResolution {
  const checks = [...input.checks].sort((a, b) => a.at - b.at)
  const mutations = [...(input.mutations ?? [])].sort((a, b) => a.at - b.at)
  const failures = checks.filter((check) => check.exitCode !== 0)
  const successes = checks.filter((check) => check.exitCode === 0)
  const lastFailure = failures.length > 0 ? failures[failures.length - 1]! : null
  const lastSuccess = successes.length > 0 ? successes[successes.length - 1]! : null
  const lastMutation = mutations.length > 0 ? mutations[mutations.length - 1]! : null
  const reasons: string[] = []

  const afterFailure = !lastFailure || !lastSuccess ? Boolean(lastSuccess) : lastSuccess.at > lastFailure.at
  const afterMutation = !lastMutation || !lastSuccess ? true : lastSuccess.at >= lastMutation.at
  const directTrusted = Boolean(lastSuccess && afterFailure && afterMutation)
  if (lastSuccess && !afterFailure) reasons.push(`最近一次通过（${lastSuccess.command}）早于最近一次失败，不能代表当前结果`)
  if (lastSuccess && !afterMutation) {
    reasons.push(`最近一次通过（${lastSuccess.command}）之后内容又发生了变化（${lastMutation?.detail ?? 'workspace 变化'}）`)
  }

  const artifacts: TestEvidenceArtifactVerdict[] = []
  let trustedArtifacts = 0
  let staleArtifact = false
  for (const artifact of input.artifacts ?? []) {
    if (artifact.kind !== 'test-report') continue
    if (artifact.declaredBy === 'user' || artifact.declaredBy === 'model') {
      artifacts.push({ id: artifact.id, trusted: false, reason: '人工/模型声明，不是真实执行记录' })
      continue
    }
    if (artifact.verifiedAt === null) {
      artifacts.push({ id: artifact.id, trusted: false, reason: '未经验证的测试报告' })
      continue
    }
    if (!artifact.runId) {
      artifacts.push({ id: artifact.id, trusted: false, reason: '报告未关联任何真实 Run' })
      continue
    }
    const runChecks = checks.filter((check) => check.runId === artifact.runId)
    const passingRunCheck = runChecks.find(
      (check) => check.exitCode === 0 && (artifact.commands.length === 0 || artifact.commands.some((command) => sameCommand(command, check.command))),
    )
    if (!passingRunCheck) {
      artifacts.push({ id: artifact.id, trusted: false, reason: '同一 Run 内没有成功的真实命令记录' })
      continue
    }
    if (lastMutation && artifact.createdAt < lastMutation.at) {
      staleArtifact = true
      artifacts.push({ id: artifact.id, trusted: false, reason: '报告生成于最近一次内容变化之前，已过期' })
      continue
    }
    const current = input.currentFingerprintFor ? input.currentFingerprintFor(artifact) : null
    if (!artifact.contentFingerprint || !current) {
      artifacts.push({ id: artifact.id, trusted: false, reason: '报告未绑定可核对的内容指纹，无法证明当前代码' })
      continue
    }
    if (artifact.contentFingerprint !== current) {
      staleArtifact = true
      artifacts.push({ id: artifact.id, trusted: false, reason: '报告绑定的内容指纹与当前内容不一致' })
      continue
    }
    trustedArtifacts += 1
    artifacts.push({ id: artifact.id, trusted: true, reason: `与 Run ${artifact.runId} 的真实成功命令及当前内容指纹一致` })
  }

  const gatePassed = input.qualityGate?.outcome === 'passed'
  const trusted = gatePassed || directTrusted || trustedArtifacts > 0
  const failedNow = Boolean(lastFailure && (!lastSuccess || lastSuccess.at <= lastFailure.at))

  let state: TestEvidenceState
  if (trusted) {
    state = 'passed'
    if (gatePassed) reasons.push('质量门禁 passed')
    if (directTrusted) reasons.push(`真实命令通过：${lastSuccess!.command}（exit 0，run ${lastSuccess!.runId}）`)
    if (trustedArtifacts > 0) reasons.push(`${trustedArtifacts} 份测试报告与当前内容及真实 Run 一致`)
  } else if (failedNow) {
    state = 'failed'
    reasons.push(`真实命令失败：${lastFailure!.command}（exit ${lastFailure!.exitCode}，run ${lastFailure!.runId}）`)
  } else if (lastSuccess || staleArtifact || artifacts.length > 0) {
    state = 'stale'
    reasons.push('存在历史测试证据，但它不描述当前内容')
  } else {
    state = 'unverified'
    reasons.push('没有任何带真实退出码的测试/检查记录')
  }

  return { state, trusted, failures, lastSuccess, lastFailure, reasons, artifacts, stale: state === 'stale' }
}

/** Normalised command comparison: collapse whitespace and ignore leading `cd …` noise. */
export function sameCommand(left: string, right: string): boolean {
  const normalize = (value: string): string =>
    value
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^cd\s+\S+\s*&&\s*/i, '')
      .toLowerCase()
  return normalize(left) === normalize(right)
}
