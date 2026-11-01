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

export type VerificationCheckCategory = 'test' | 'lint' | 'typecheck' | 'build' | 'other'

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
  /** Optional explicit check identity from project verification config. */
  checkKey?: string
  /** Optional monotonic attempt sequence when timestamps tie. */
  attemptOrdinal?: number
}

export interface VerificationCheckVerdict {
  checkKey: string
  category: VerificationCheckCategory
  command: string
  outcome: 'passed' | 'failed' | 'stale'
  exitCode: number
  runId: string
  checkId: string
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
  /** Optional exact ToolCall ID that produced or verified this report. */
  sourceToolCallId?: string | null
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
  /** The newest real failing check (prefers unresolved per-check failures), if any. */
  lastFailure: VerificationCheck | null
  /** Per-check independent verdicts so lint pass never masks test failure. */
  checkVerdicts?: VerificationCheckVerdict[]
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
   * Optional list of required check categories or keys (e.g. ['test']).
   * When omitted, every executed check group must pass its latest attempt, and if both test and
   * non-test checks exist, a lint-only pass never masks a failed test check.
   */
  requiredChecks?: string[]
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

/** Classify a verification command into its semantic category so lint never masks test. */
export function classifyVerificationCategory(toolName: string, command: string): VerificationCheckCategory {
  const normalized = command
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^cd\s+\S+\s*&&\s*/i, '')
    .toLowerCase()
  if (/^(npm|pnpm|yarn)\s+(run\s+)?lint\b/.test(normalized)) return 'lint'
  if (/^(npm|pnpm|yarn)\s+(run\s+)?typecheck\b|^(npx\s+)?tsc\b/.test(normalized)) return 'typecheck'
  if (/^(npm|pnpm|yarn)\s+(run\s+)?build\b/.test(normalized)) return 'build'
  if (
    toolName === 'run_tests' ||
    /^(npm|pnpm|yarn)\s+(run\s+)?test\b|^(npx\s+)?(vitest|jest|mocha)\b|^node\s+--test\b/.test(normalized)
  ) {
    return 'test'
  }
  return 'other'
}

/**
 * Derive a stable per-check identity key. Different categories (test vs lint vs typecheck vs build)
 * and different command arguments/working directories get distinct keys so one cannot overwrite another.
 */
export function deriveCheckKey(check: Pick<VerificationCheck, 'toolName' | 'command' | 'checkKey'>): string {
  if (check.checkKey && check.checkKey.trim()) return check.checkKey.trim()
  const raw = check.command.trim().replace(/\s+/g, ' ').toLowerCase()
  const cdMatch = /^cd\s+(\S+)\s*&&\s*(.+)$/i.exec(raw)
  const cwdPrefix = cdMatch ? `cwd:${cdMatch[1]}::` : ''
  const body = (cdMatch ? cdMatch[2]! : raw)
    .replace(/^(npm|pnpm|yarn)\s+run\s+/, '$1 ')
  const category = classifyVerificationCategory(check.toolName, body)
  return `${category}:${cwdPrefix}${body}`
}

/**
 * Resolve whether the recorded evidence proves the current content passes.
 *
 * Ordering rules (ADR-0047 + M1 per-check isolation):
 *  - Every distinct check key (`deriveCheckKey`) is evaluated independently using its newest attempt
 *    (ordered by `attemptOrdinal` when present, then `at`). A passing `lint` check NEVER clears a
 *    failing `test` check, and a passing suite in one directory NEVER clears a failing suite in another.
 *  - A passing check only counts when it is the newest attempt for its check key AND is newer than
 *    the last content mutation (otherwise it tested older code).
 *  - An artifact (`test-report`) only counts when it is backed by a real passing check in the same
 *    run, no subsequent attempt of the same check key failed after that check, no required check
 *    group is currently failing, it is not a human/model declaration, and its content fingerprint
 *    equals the current one.
 *  - All historical failures are preserved on `failures` so audit history is never erased.
 */
export function resolveTestEvidence(input: TestEvidenceInput): TestEvidenceResolution {
  const checks = [...input.checks].sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at
    return (a.attemptOrdinal ?? 0) - (b.attemptOrdinal ?? 0)
  })
  const mutations = [...(input.mutations ?? [])].sort((a, b) => a.at - b.at)
  const failures = checks.filter((check) => check.exitCode !== 0)
  const successes = checks.filter((check) => check.exitCode === 0)
  const lastSuccess = successes.length > 0 ? successes[successes.length - 1]! : null
  const lastMutation = mutations.length > 0 ? mutations[mutations.length - 1]! : null
  const reasons: string[] = []

  // Group checks by their independent checkKey so lint/typecheck/build/different test suites
  // never overwrite one another.
  const groups = new Map<string, VerificationCheck[]>()
  for (const check of checks) {
    const key = deriveCheckKey(check)
    const list = groups.get(key) ?? []
    list.push(check)
    groups.set(key, list)
  }

  const checkVerdicts: VerificationCheckVerdict[] = []
  const unresolvedFailures: VerificationCheck[] = []
  const stalePassingChecks: VerificationCheck[] = []
  const currentPassingChecks: VerificationCheck[] = []

  for (const [checkKey, group] of groups.entries()) {
    const latest = group[group.length - 1]!
    const category = classifyVerificationCategory(latest.toolName, latest.command)
    if (latest.exitCode !== 0) {
      unresolvedFailures.push(latest)
      checkVerdicts.push({
        checkKey,
        category,
        command: latest.command,
        outcome: 'failed',
        exitCode: latest.exitCode,
        runId: latest.runId,
        checkId: latest.id,
        at: latest.at,
      })
    } else if (lastMutation && latest.at < lastMutation.at) {
      stalePassingChecks.push(latest)
      checkVerdicts.push({
        checkKey,
        category,
        command: latest.command,
        outcome: 'stale',
        exitCode: 0,
        runId: latest.runId,
        checkId: latest.id,
        at: latest.at,
      })
    } else {
      currentPassingChecks.push(latest)
      checkVerdicts.push({
        checkKey,
        category,
        command: latest.command,
        outcome: 'passed',
        exitCode: 0,
        runId: latest.runId,
        checkId: latest.id,
        at: latest.at,
      })
    }
  }

  // Check if any explicitly required check keys/categories are missing
  const missingRequired: string[] = []
  if (input.requiredChecks && input.requiredChecks.length > 0) {
    for (const reqKey of input.requiredChecks) {
      const matched = checkVerdicts.some(
        (v) => v.checkKey === reqKey || v.category === reqKey || sameCommand(v.command, reqKey),
      )
      if (!matched) missingRequired.push(reqKey)
    }
  }

  // Prefer the newest unresolved failure as `lastFailure` so callers inspecting `lastFailure`
  // see the active blocking failure rather than an already-fixed earlier failure.
  const lastFailure =
    unresolvedFailures.length > 0
      ? unresolvedFailures[unresolvedFailures.length - 1]!
      : failures.length > 0
        ? failures[failures.length - 1]!
        : null

  const allGroupsPassedCurrent =
    groups.size > 0 &&
    unresolvedFailures.length === 0 &&
    stalePassingChecks.length === 0 &&
    missingRequired.length === 0

  const directTrusted = allGroupsPassedCurrent

  if (unresolvedFailures.length > 0) {
    for (const failed of unresolvedFailures) {
      reasons.push(`真实命令未通过：${failed.command}（exit ${failed.exitCode}，run ${failed.runId}）`)
    }
    if (currentPassingChecks.length > 0) {
      reasons.push(
        `其余检查单独通过但不能覆盖上述失败：${currentPassingChecks.map((c) => `${c.command}（exit 0）`).join('、')}`,
      )
    }
  }
  if (stalePassingChecks.length > 0) {
    for (const staleCheck of stalePassingChecks) {
      reasons.push(
        `最近一次通过（${staleCheck.command}）之后内容又发生了变化（${lastMutation?.detail ?? 'workspace 变化'}）`,
      )
    }
  }
  if (missingRequired.length > 0) {
    reasons.push(`缺少必需检查项的执行记录：${missingRequired.join('、')}`)
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
    const matchingPassingChecks = runChecks.filter(
      (check) =>
        check.exitCode === 0 &&
        (!artifact.sourceToolCallId || check.id === artifact.sourceToolCallId) &&
        (artifact.commands.length === 0 || artifact.commands.some((command) => sameCommand(command, check.command))),
    )
    const passingRunCheck =
      matchingPassingChecks.length > 0 ? matchingPassingChecks[matchingPassingChecks.length - 1]! : null
    if (!passingRunCheck) {
      artifacts.push({ id: artifact.id, trusted: false, reason: '同一 Run 内没有成功的真实命令记录' })
      continue
    }
    // Check if the same command / checkKey subsequently failed in the same run or a later run
    const keyOfPassing = deriveCheckKey(passingRunCheck)
    const groupForPassing = groups.get(keyOfPassing) ?? []
    const latestForPassingKey = groupForPassing[groupForPassing.length - 1]
    if (latestForPassingKey && latestForPassingKey.exitCode !== 0) {
      artifacts.push({
        id: artifact.id,
        trusted: false,
        reason: `同一检查（${latestForPassingKey.command}）在后续执行中失败（exit ${latestForPassingKey.exitCode}），旧报告不能覆盖新失败`,
      })
      continue
    }
    if (unresolvedFailures.length > 0) {
      artifacts.push({
        id: artifact.id,
        trusted: false,
        reason: `存在未解除的检查失败（${unresolvedFailures.map((f) => f.command).join('、')}），报告不能单独放行`,
      })
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

  const gatePassed = input.qualityGate?.outcome === 'passed' && unresolvedFailures.length === 0
  const trusted = (gatePassed || directTrusted || trustedArtifacts > 0) && unresolvedFailures.length === 0 && missingRequired.length === 0
  const failedNow = unresolvedFailures.length > 0 || input.qualityGate?.outcome === 'failed'

  let state: TestEvidenceState
  if (trusted) {
    state = 'passed'
    if (gatePassed) reasons.push('质量门禁 passed')
    if (directTrusted) {
      for (const passCheck of currentPassingChecks) {
        reasons.push(`真实命令通过：${passCheck.command}（exit 0，run ${passCheck.runId}）`)
      }
    }
    if (trustedArtifacts > 0) reasons.push(`${trustedArtifacts} 份测试报告与当前内容及真实 Run 一致`)
  } else if (failedNow) {
    state = 'failed'
  } else if (stalePassingChecks.length > 0 || staleArtifact || artifacts.length > 0) {
    state = 'stale'
    reasons.push('存在历史测试证据，但它不描述当前内容')
  } else {
    state = 'unverified'
    reasons.push('没有任何带真实退出码的测试/检查记录')
  }

  return {
    state,
    trusted,
    failures,
    lastSuccess,
    lastFailure,
    checkVerdicts,
    reasons,
    artifacts,
    stale: state === 'stale',
  }
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
