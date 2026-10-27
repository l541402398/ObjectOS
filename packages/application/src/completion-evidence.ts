import type { Artifact, RunDetail, TaskCard } from '@projectos/contracts'

export type CompletionRequirementId = 'design' | 'code' | 'test' | 'review' | 'artifact' | 'human'

export interface CompletionRequirement {
  id: CompletionRequirementId
  label: string
  satisfied: boolean
  evidence: string[]
  missing: string[]
}

export type ToolOutcomeStatus = 'completed' | 'failed' | 'denied' | 'skipped' | 'not_applicable'

export interface CompletionToolOutcome {
  name: string
  status: ToolOutcomeStatus
  runId: string
  detail: string | null
}

export interface QualityGateEvidence {
  outcome: 'passed' | 'failed' | 'error' | 'skipped' | 'not_applicable'
  passed: boolean
  skipped: boolean
  checks: Array<{ name: string; status: string; exitCode: number | null }>
}

export interface CompletionEvidenceInput {
  task: TaskCard
  artifacts: Artifact[]
  runs: RunDetail[]
  qualityGate?: QualityGateEvidence | null
  workspaceRoot?: string | null
  fileExists?: (relativePath: string) => boolean
  changedFiles?: string[]
  actorKind: 'user' | 'agent' | 'system'
  humanNote?: string | null
}

export interface CompletionDecision {
  ok: boolean
  role: string
  requirements: CompletionRequirement[]
  toolOutcomes: CompletionToolOutcome[]
  reasons: string[]
}

function roleOf(task: TaskCard): string {
  return task.labels.find((label) => ['architect', 'developer', 'reviewer', 'tester'].includes(label)) ?? 'custom'
}

function artifactText(artifact: Artifact): string {
  return `${artifact.title}\n${artifact.body ?? ''}\n${artifact.uri ?? ''}`.toLowerCase()
}

function hasKind(artifacts: Artifact[], kinds: Artifact['kind'][]): Artifact[] {
  return artifacts.filter((artifact) => kinds.includes(artifact.kind) && Boolean(artifact.body?.trim() || artifact.uri))
}

function matchesText(artifacts: Artifact[], pattern: RegExp): Artifact[] {
  return artifacts.filter((artifact) => pattern.test(artifactText(artifact)))
}

function metadataOf(artifact: Artifact): Record<string, unknown> {
  return artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
    ? (artifact.metadata as Record<string, unknown>)
    : {}
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function nonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function stringArrayField(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function completedToolStatus(status: string): ToolOutcomeStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'denied') return 'denied'
  if (status === 'skipped') return 'skipped'
  if (status === 'waiting_approval' || status === 'proposed' || status === 'running') return 'not_applicable'
  return 'not_applicable'
}

function toolExitOk(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const value = result as Record<string, unknown>
  return value.exitCode === 0 || value.code === 0
}

function requirement(
  id: CompletionRequirementId,
  label: string,
  satisfied: boolean,
  evidence: string[] = [],
  missing: string[] = [],
): CompletionRequirement {
  return { id, label, satisfied, evidence, missing }
}

/**
 * Pure completion-evidence evaluator. It never mutates state and never trusts
 * the Agent's prose; it only accepts persisted Artifacts, real tool outcomes,
 * quality-gate results and verified file evidence.
 */
export function evaluateCompletion(input: CompletionEvidenceInput): CompletionDecision {
  const role = roleOf(input.task)
  const artifacts = input.artifacts.filter((artifact) => !artifact.isDemo)
  const toolOutcomes: CompletionToolOutcome[] = input.runs.flatMap((run) =>
    run.toolCalls.map((call) => ({
      name: call.toolName,
      status: completedToolStatus(call.status),
      runId: run.run.id,
      detail: call.error ?? null,
    })),
  )
  const completedTools = toolOutcomes.filter((item) => item.status === 'completed')
  const deniedOrFailed = toolOutcomes.filter((item) => item.status === 'denied' || item.status === 'failed')

  const writeCalls = input.runs.flatMap((run) =>
    run.toolCalls.filter((call) => call.toolName === 'write_file' && call.status === 'completed'),
  )
  const runtimeTool = completedTools.filter(
    (item) => item.name === 'runtime.execute' || item.name === 'runtime.acp',
  )
  const runTestsOk = input.runs.some((run) =>
    run.toolCalls.some((call) => call.toolName === 'run_tests' && call.status === 'completed' && toolExitOk(call.result)),
  )
  const codeArtifacts = [
    ...hasKind(artifacts, ['diff', 'code']),
    ...matchesText(artifacts, /(代码|实现|diff|变更|code|implement)/i),
  ]
  const fileExists = input.fileExists
  const fileEvidence = fileExists
    ? writeCalls.filter((call) => {
        const path = typeof call.args.path === 'string' ? call.args.path : null
        return Boolean(path) && fileExists(path!)
      })
    : writeCalls
  const changedFiles = input.changedFiles ?? []
  const hasCode =
    codeArtifacts.length > 0 ||
    fileEvidence.length > 0 ||
    (runtimeTool.length > 0 && changedFiles.length > 0)

  const verifiedTestArtifacts = artifacts.filter(
    (artifact) => artifact.kind === 'test-report' && artifact.verifiedAt !== null,
  )
  const hasTest =
    input.qualityGate?.outcome === 'passed' ||
    verifiedTestArtifacts.length > 0 ||
    runTestsOk

  const designArtifacts = artifacts.filter((artifact) => {
    const metadata = metadataOf(artifact)
    return (
      metadata.artifactType === 'design' &&
      nonEmptyString(metadata.scope) &&
      (nonEmptyArray(metadata.decisions) || nonEmptyString(metadata.decisions)) &&
      (stringArrayField(metadata.referencedFiles) || stringArrayField(metadata.references)) &&
      (artifact.runId !== null || metadata.createdBy === 'user')
    )
  })
  const hasDesign = designArtifacts.length > 0
  const reviewArtifacts = artifacts.filter((artifact) => {
    const metadata = metadataOf(artifact)
    const blockers = Array.isArray(metadata.blockers)
      ? metadata.blockers.filter((item): item is string => typeof item === 'string')
      : []
    const blocking = blockers.some((item) => !/^(无|none|no blockers?)/i.test(item.trim()))
    const conclusion = typeof metadata.conclusion === 'string' ? metadata.conclusion : ''
    const positiveConclusion = /^(通过|放行|approve|approved|pass|passed|conditionally passed)/i.test(
      conclusion.trim(),
    )
    const rejected = !positiveConclusion && /阻断|不通过|拒绝|reject|blocking|blocked|fail/i.test(conclusion)
    return (
      metadata.artifactType === 'review' &&
      nonEmptyArray(metadata.reviewedObjects) &&
      nonEmptyString(metadata.scope) &&
      nonEmptyArray(metadata.findings) &&
      nonEmptyString(metadata.conclusion) &&
      stringArrayField(metadata.blockers) &&
      !blocking &&
      !rejected &&
      (artifact.runId !== null || metadata.createdBy === 'user')
    )
  })
  const hasReview = reviewArtifacts.length > 0
  const hasArtifact = artifacts.length > 0

  const requirements: CompletionRequirement[] = []
  const expected = input.task.expectedArtifacts ?? []
  if (input.actorKind === 'user') {
    requirements.push(
      requirement('human', '人工验收确认', true, [
        input.humanNote?.trim() ? `人工说明：${input.humanNote.trim()}` : '人工验收（未填写说明）',
      ]),
    )
  } else if (expected.length > 0) {
    for (const expectation of expected) {
      if (/审查|评审|review/i.test(expectation)) {
        requirements.push(
          requirement(
            'review',
            `预期产物：${expectation}`,
            hasReview,
            hasReview ? reviewArtifacts.map((artifact) => `审查 Artifact：${artifact.title}`) : [],
            hasReview ? [] : ['缺少审查/评审 Artifact'],
          ),
        )
      } else if (/test\.js|未修改|哈希|hash|diff|代码|实现|变更|code/i.test(expectation)) {
        requirements.push(
          requirement(
            'code',
            `预期产物：${expectation}`,
            hasCode,
            hasCode ? [`代码/文件证据 ${codeArtifacts.length + fileEvidence.length + changedFiles.length} 项`] : [],
            hasCode ? [] : ['缺少代码/diff Artifact、成功的 write_file 或非空文件变更'],
          ),
        )
      } else if (/test|测试|验收/i.test(expectation)) {
        requirements.push(
          requirement(
            'test',
            `预期产物：${expectation}`,
            hasTest,
            hasTest
              ? [
                  ...(input.qualityGate?.outcome === 'passed' ? ['质量门禁 passed'] : []),
                  ...verifiedTestArtifacts.map((artifact) => `已验证测试报告：${artifact.title}`),
                  ...(runTestsOk ? ['run_tests 退出码 0'] : []),
                ]
              : [],
            hasTest ? [] : ['缺少已验证测试报告、质量门禁通过或成功的 run_tests'],
          ),
        )
      } else if (/adr|设计|架构|方案|实施|design|architecture/i.test(expectation)) {
        requirements.push(
          requirement(
            'design',
            `预期产物：${expectation}`,
            hasDesign,
            hasDesign ? designArtifacts.map((artifact) => `设计 Artifact：${artifact.title}`) : [],
            hasDesign ? [] : ['缺少设计/ADR/实施方案 Artifact'],
          ),
        )
      } else {
        requirements.push(
          requirement(
            'artifact',
            `预期产物：${expectation}`,
            hasArtifact,
            hasArtifact ? [`Artifact ${artifacts.length} 项`] : [],
            hasArtifact ? [] : ['缺少任何非 demo Artifact'],
          ),
        )
      }
    }
  } else if (role === 'architect') {
    requirements.push(
      requirement('design', '架构任务需要设计/ADR Artifact', hasDesign, designArtifacts.map((a) => `设计 Artifact：${a.title}`), hasDesign ? [] : ['缺少设计/ADR/实施方案 Artifact']),
    )
  } else if (role === 'developer') {
    requirements.push(
      requirement('code', '开发任务需要代码/文件证据', hasCode, hasCode ? ['代码/文件证据存在'] : [], hasCode ? [] : ['缺少代码/diff Artifact、成功的 write_file 或文件变更']),
    )
  } else if (role === 'reviewer') {
    requirements.push(
      requirement('review', '审查任务需要审查 Artifact', hasReview, reviewArtifacts.map((a) => `审查 Artifact：${a.title}`), hasReview ? [] : ['缺少审查/评审 Artifact']),
    )
  } else if (role === 'tester') {
    requirements.push(
      requirement('test', '测试任务需要已验证测试结果', hasTest, hasTest ? ['存在测试证据'] : [], hasTest ? [] : ['缺少已验证测试报告、质量门禁通过或成功的 run_tests']),
    )
  } else {
    requirements.push(
      requirement('artifact', '自定义任务需要至少一个非 demo Artifact', hasArtifact, hasArtifact ? [`Artifact ${artifacts.length} 项`] : [], hasArtifact ? [] : ['缺少非 demo Artifact']),
    )
  }

  const reasons: string[] = []
  for (const item of requirements) {
    if (item.satisfied) {
      reasons.push(`${item.label}：满足（${item.evidence.join('；') || '已满足'}）`)
    } else {
      reasons.push(`${item.label}：缺失（${item.missing.join('；')}）`)
    }
  }
  for (const item of deniedOrFailed) {
    reasons.push(`工具 ${item.name}：${item.status}（${item.detail ?? '无详情'}）`)
  }
  if (input.qualityGate?.outcome === 'skipped') {
    reasons.push('质量门禁：skipped（没有可执行检查，不能视为 passed）')
  } else if (input.qualityGate?.outcome === 'error') {
    reasons.push('质量门禁：error（检查无法完成）')
  }
  const ok = requirements.every((item) => item.satisfied)
  return { ok, role, requirements, toolOutcomes, reasons }
}
