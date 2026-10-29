import { afterEach, describe, expect, it } from 'vitest'
import { now } from '@projectos/contracts'
import type { LlmProvider } from '@projectos/provider-interfaces'
import { buildReviewSnapshot } from '../packages/application/src/review-snapshot.js'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { PlannerService } from '../apps/runtime/src/planner.js'
import type { PlannerModelSource } from '../apps/runtime/src/planner-provider.js'
import { ReplanService } from '../apps/runtime/src/replan-service.js'
import { ReplanAutopilot } from '../apps/runtime/src/replan-autopilot.js'
import { ReviewCoordinator } from '../apps/runtime/src/review-coordinator.js'
import { TaskContractPreflightService } from '../apps/runtime/src/task-contract-preflight.js'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { ActionCenter } from '../apps/runtime/src/action-center.js'
import { collectReviewSnapshot } from '../apps/runtime/src/review-snapshot-collector.js'
import { createGitProject, FakeProvider, logger, planWithTasks, setup, waitFor } from './helpers/r1-fixture.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function task(key: string, overrides: Record<string, unknown> = {}) {
  return {
    key,
    title: `任务 ${key}`,
    description: `完成 ${key} 的验证。`,
    role: 'developer',
    dependsOn: [],
    acceptanceCriteria: ['命令退出码为 0'],
    expectedArtifacts: ['代码 diff'],
    rationale: '完成需求所需的实现步骤。',
    requiresApproval: true,
    ...overrides,
  }
}

function modelSource(provider: LlmProvider): PlannerModelSource {
  return {
    resolve: () => ({
      provider,
      connectionId: 'aic_p288',
      connectionName: '测试 AI 连接',
      model: 'fake-p288-model',
      protocol: 'openai-chat',
    }),
  }
}

function makeHarness() {
  const fake = new FakeProvider(() => ({ text: '复审完成' }))
  const harness = setup(fake)
  const planner = new PlannerService({ store: harness.store, modelSource: modelSource(fake), logger, maxRepairAttempts: 1 })
  const grants = new PlanGrantService(harness.store, logger)
  const replans = new ReplanService(harness.store, harness.orchestration, planner, grants, logger)
  const lifecycle = new LifecycleService(harness.store)
  const actions = new ActionCenter(harness.store, lifecycle)
  const preflight = new TaskContractPreflightService(harness.store)
  const reviews = new ReviewCoordinator(harness.store, harness.services, grants, harness.scheduler, logger)
  const autopilot = new ReplanAutopilot(
    harness.store,
    replans,
    harness.orchestration,
    grants,
    harness.scheduler,
    actions,
    preflight,
    lifecycle,
    reviews,
    logger,
  )
  cleanups.push(harness.close)
  return { ...harness, planner, grants, replans, lifecycle, actions, preflight, reviews, autopilot }
}

function issueGrant(harness: ReturnType<typeof makeHarness>, planId: string) {
  return harness.grants.issue({
    planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['.'],
    maxRuns: 4,
    maxToolCalls: 80,
    ttlHours: 1,
    allowOverBudget: false,
    note: '测试授权',
    confirm: true,
  })
}

/** Test fixture: walk a task to a status through the persistence layer. */
function forceStatus(harness: ReturnType<typeof makeHarness>, taskId: string, to: string): void {
  const path: Record<string, string[]> = {
    done: ['ready', 'running', 'review', 'done'],
    review: ['ready', 'running', 'review'],
  }
  let card = harness.store.read.getTaskCard(taskId)!
  for (const step of path[to] ?? []) {
    if (card.status === step) continue
    card = harness.store.read.getTaskCard(taskId)!
    const updated = harness.store.moveTask(taskId, card.version, step as never)
    card = harness.store.read.getTaskCard(updated.id)!
  }
}

function pausePlan(harness: ReturnType<typeof makeHarness>, planId: string, error: string, workspaceRoot: string): void {
  const plan = harness.store.read.getPlanRevision(planId)!
  harness.store.updatePlanRevision({
    ...plan,
    execution: {
      status: 'paused',
      concurrency: 1,
      startedAt: now(),
      updatedAt: now(),
      error,
      runIds: [],
      workspaceRef: workspaceRoot,
      branch: null,
      diffArtifactId: null,
      mergedAt: null,
      maxRetries: 2,
      retries: {},
      nextAttemptAt: {},
      retryForRun: {},
      maxEvidenceRetries: 1,
      evidenceRetries: {},
      evidenceRetryForRun: {},
      requireWorktree: false,
      allowedPaths: ['.'],
    } as never,
  })
}

function reviewArtifact(harness: ReturnType<typeof makeHarness>, input: {
  projectId: string
  taskId: string
  reviewedObjects: string[]
  snapshot: unknown
  conclusion?: string
}) {
  return harness.services.projects.createArtifact(
    {
      projectId: input.projectId,
      taskId: input.taskId,
      kind: 'document',
      title: '代码审查 · 当前实现',
      body: '审查记录',
      uri: null,
      metadata: {
        artifactType: 'review',
        reviewedObjects: input.reviewedObjects,
        scope: input.reviewedObjects.join(','),
        findings: [],
        conclusion: input.conclusion ?? '需要修改',
        blockers: [],
        reviewSnapshot: input.snapshot,
        reviewedRevision: null,
        createdBy: 'user',
      } as never,
    },
    { kind: 'user', id: 'local-user', name: '你' },
  )
}

describe('ADR-0028 automatic re-review after a content change', () => {
  it('reopens the existing review task instead of creating a new plan revision', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-rereview', {
      test: 'node -e "process.exit(0)"',
    })
    mkdirSync(join(project.rootPath, 'src'), { recursive: true })
    writeFileSync(join(project.rootPath, 'src', 'a.mjs'), 'export const a = 1\n')
    const developer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('implement'))!.agent
    const reviewer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('review'))!.agent
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [
      task('dev', { agentId: developer.id }),
      task('review', { agentId: reviewer.id, role: 'reviewer', expectedArtifacts: ['审查报告'], dependsOn: ['dev'] }),
    ])
    issueGrant(harness, plan.id)
    const reviewTaskId = taskIds[1]!
    forceStatus(harness, taskIds[0]!, 'done')
    forceStatus(harness, reviewTaskId, 'done')
    // The review was written against the old content...
    const staleSnapshot = collectReviewSnapshot({
      workspaceRoot: project.rootPath,
      reviewedObjects: ['src/a.mjs'],
      projectId: project.id,
      planId: plan.id,
      taskId: reviewTaskId,
      reviewer: { agentId: reviewer.id, name: reviewer.name },
    })
    reviewArtifact(harness, { projectId: project.id, taskId: reviewTaskId, reviewedObjects: ['src/a.mjs'], snapshot: staleSnapshot })
    // ...and the developer then changed it.
    writeFileSync(join(project.rootPath, 'src', 'a.mjs'), 'export const a = 2\n')
    pausePlan(harness, plan.id, '审查未通过：当前内容缺少审查（只有针对旧内容的审查（1 份），当前内容没有审查，不能放行）', project.rootPath)

    const outcomes = harness.reviews.reconcileProject(project.id)
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]!.kind).toBe('scheduled')
    expect(outcomes[0]!.taskId).toBe(reviewTaskId)
    const card = harness.store.read.getTaskCard(reviewTaskId)!
    expect(['ready', 'running']).toContain(card.status)
    const resumed = harness.store.read.getPlanRevision(plan.id)!
    expect(resumed.execution?.status).toBe('running')
    expect(resumed.execution?.reReview?.taskId).toBe(reviewTaskId)
    const events = harness.store.read.listEventViews(project.id, 200)
    expect(events.some((event) => event.eventType === 'plan.review.reopened')).toBe(true)
    // No new plan revision was created.
    expect(harness.store.read.listPlanRevisions(project.id)).toHaveLength(1)
  })

  it('is idempotent: the same content fingerprint is never reviewed twice', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-rereview-idem')
    mkdirSync(join(project.rootPath, 'src'), { recursive: true })
    writeFileSync(join(project.rootPath, 'src', 'a.mjs'), 'export const a = 1\n')
    const reviewer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('review'))!.agent
    const developer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('implement'))!.agent
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [
      task('dev', { agentId: developer.id }),
      task('review', { agentId: reviewer.id, role: 'reviewer', expectedArtifacts: ['审查报告'], dependsOn: ['dev'] }),
    ])
    issueGrant(harness, plan.id)
    const reviewTaskId = taskIds[1]!
    forceStatus(harness, taskIds[0]!, 'done')
    forceStatus(harness, reviewTaskId, 'done')
    const stale = collectReviewSnapshot({ workspaceRoot: project.rootPath, reviewedObjects: ['src/a.mjs'] })
    reviewArtifact(harness, { projectId: project.id, taskId: reviewTaskId, reviewedObjects: ['src/a.mjs'], snapshot: stale })
    writeFileSync(join(project.rootPath, 'src', 'a.mjs'), 'changed\n')
    pausePlan(harness, plan.id, '审查未通过：当前内容缺少审查', project.rootPath)

    expect(harness.reviews.reconcileProject(project.id)[0]!.kind).toBe('scheduled')
    const second = harness.reviews.reconcileProject(project.id)
    expect(second[0]?.kind ?? 'in-progress').toBe('in-progress')
    const latestPlan = harness.store.read.getPlanRevision(plan.id)!
    expect(latestPlan.execution?.reReview?.fingerprint).toBeTruthy()
  })

  it('does not schedule a re-review while a verification still fails', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-rereview-failing')
    mkdirSync(join(project.rootPath, 'src'), { recursive: true })
    writeFileSync(join(project.rootPath, 'src', 'a.mjs'), 'export const a = 1\n')
    const developer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('implement'))!.agent
    const reviewer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('review'))!.agent
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [
      task('dev', { agentId: developer.id }),
      task('review', { agentId: reviewer.id, role: 'reviewer', expectedArtifacts: ['审查报告'], dependsOn: ['dev'] }),
    ])
    issueGrant(harness, plan.id)
    forceStatus(harness, taskIds[0]!, 'done')
    forceStatus(harness, taskIds[1]!, 'done')
    const stale = collectReviewSnapshot({ workspaceRoot: project.rootPath, reviewedObjects: ['src/a.mjs'] })
    reviewArtifact(harness, { projectId: project.id, taskId: taskIds[1]!, reviewedObjects: ['src/a.mjs'], snapshot: stale })
    writeFileSync(join(project.rootPath, 'src', 'a.mjs'), 'changed\n')
    // A real, failed verification for this plan: fixing comes before re-reviewing.
    const session = harness.services.sessions.create({ projectId: project.id, agentId: developer.id, title: 'failing' })
    const run = harness.store.createRun({
      id: 'run_p288_fail',
      projectId: project.id,
      taskId: taskIds[0]!,
      sessionId: session.id,
      agentId: developer.id,
      attempt: 1,
      status: 'completed',
      error: null,
      summary: null,
      inputTokens: 0,
      outputTokens: 0,
      checkpointId: null,
      startedAt: now(),
      finishedAt: now(),
      createdAt: now(),
    })
    const call = harness.store.createToolCall({
      runId: run.id,
      toolName: 'run_tests',
      idempotencyKey: 'k-fail',
      argsHash: 'h',
      args: { command: 'npm test' },
      status: 'completed',
    })
    harness.store.updateToolCall(call.id, { status: 'completed', result: { exitCode: 1 }, finishedAt: now() })
    pausePlan(harness, plan.id, '验证未通过：npm test（退出码 1）', project.rootPath)

    const outcomes = harness.reviews.reconcileProject(project.id)
    expect(outcomes[0]!.kind).toBe('needs-replan')
    expect(outcomes[0]!.reasons.join(' ')).toContain('未通过的验证')
  })

  it('reports needs-replan when the plan has no review task to reuse', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-rereview-none')
    const developer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('implement'))!.agent
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [task('dev', { agentId: developer.id })])
    issueGrant(harness, plan.id)
    forceStatus(harness, taskIds[0]!, 'done')
    pausePlan(harness, plan.id, '审查未通过：当前内容缺少审查', project.rootPath)
    const outcomes = harness.reviews.reconcileProject(project.id)
    expect(outcomes[0]!.kind).toBe('needs-replan')
    expect(outcomes[0]!.reasons.join(' ')).toContain('没有可复用的审查任务')
  })

  it('refuses to start a re-review when the execution grant is revoked', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-rereview-grant')
    mkdirSync(join(project.rootPath, 'src'), { recursive: true })
    writeFileSync(join(project.rootPath, 'src', 'a.mjs'), 'x\n')
    const developer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('implement'))!.agent
    const reviewer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('review'))!.agent
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [
      task('dev', { agentId: developer.id }),
      task('review', { agentId: reviewer.id, role: 'reviewer', expectedArtifacts: ['审查报告'], dependsOn: ['dev'] }),
    ])
    const grant = issueGrant(harness, plan.id)
    forceStatus(harness, taskIds[0]!, 'done')
    forceStatus(harness, taskIds[1]!, 'done')
    const stale = collectReviewSnapshot({ workspaceRoot: project.rootPath, reviewedObjects: ['src/a.mjs'] })
    reviewArtifact(harness, { projectId: project.id, taskId: taskIds[1]!, reviewedObjects: ['src/a.mjs'], snapshot: stale })
    writeFileSync(join(project.rootPath, 'src', 'a.mjs'), 'y\n')
    pausePlan(harness, plan.id, '审查未通过：当前内容缺少审查', project.rootPath)
    harness.grants.revoke(grant.id, '测试撤销')
    const outcomes = harness.reviews.reconcileProject(project.id)
    expect(outcomes[0]!.kind).toBe('blocked')
    expect(outcomes[0]!.reasons.join(' ')).toContain('授权')
  })

  it('does nothing when the current content already has an approving review', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-rereview-fresh')
    mkdirSync(join(project.rootPath, 'src'), { recursive: true })
    writeFileSync(join(project.rootPath, 'src', 'a.mjs'), 'current\n')
    const developer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('implement'))!.agent
    const reviewer = harness.services.projects.listAgents(project.id).find((item) => item.agent.capabilities.includes('review'))!.agent
    const { plan, taskIds } = planWithTasks(harness.orchestration, project.id, [
      task('dev', { agentId: developer.id }),
      task('review', { agentId: reviewer.id, role: 'reviewer', expectedArtifacts: ['审查报告'], dependsOn: ['dev'] }),
    ])
    issueGrant(harness, plan.id)
    forceStatus(harness, taskIds[0]!, 'done')
    forceStatus(harness, taskIds[1]!, 'done')
    const current = collectReviewSnapshot({ workspaceRoot: project.rootPath, reviewedObjects: ['src/a.mjs'] })
    reviewArtifact(harness, {
      projectId: project.id,
      taskId: taskIds[1]!,
      reviewedObjects: ['src/a.mjs'],
      snapshot: current,
      conclusion: '通过',
    })
    pausePlan(harness, plan.id, '运行中', project.rootPath)
    const outcomes = harness.reviews.reconcileProject(project.id)
    expect(outcomes).toHaveLength(0)
  })
})

describe('ADR-0028 snapshot authenticity boundaries', () => {
  it('distinguishes a real Git deletion from a path that never existed', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-integrity')
    mkdirSync(join(project.rootPath, 'src'), { recursive: true })
    writeFileSync(join(project.rootPath, 'src', 'gone.mjs'), 'export const gone = 1\n')
    const { execFileSync } = await import('node:child_process')
    execFileSync('git', ['add', '-A'], { cwd: project.rootPath })
    execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'gone'], {
      cwd: project.rootPath,
    })
    execFileSync('git', ['rm', '-q', 'src/gone.mjs'], { cwd: project.rootPath })

    const deleted = collectReviewSnapshot({ workspaceRoot: project.rootPath, reviewedObjects: ['src/gone.mjs'] })
    expect(deleted.files[0]?.presence).toBe('deleted')
    expect(deleted.integrity.complete).toBe(true)

    const invented = collectReviewSnapshot({ workspaceRoot: project.rootPath, reviewedObjects: ['src/never.mjs'] })
    expect(invented.files[0]?.presence).toBe('never-existed')
    expect(invented.integrity.complete).toBe(false)
    expect(invented.integrity.problems[0]?.required).toBe(true)
  })

  it('an incomplete snapshot can never approve, even if fingerprints match', async () => {
    const harness = makeHarness()
    const project = await createGitProject(harness.services, harness.dataDir, 'p288-incomplete')
    mkdirSync(join(project.rootPath, 'src'), { recursive: true })
    writeFileSync(join(project.rootPath, 'src', 'ok.mjs'), 'export const ok = 1\n')
    const snapshot = collectReviewSnapshot({
      workspaceRoot: project.rootPath,
      reviewedObjects: ['src/ok.mjs', 'src/never.mjs'],
    })
    expect(snapshot.integrity.complete).toBe(false)
    // Same incomplete snapshot on both sides: identity of hashes is not evidence.
    const fabricated = buildReviewSnapshot({
      files: snapshot.files,
      integrity: { complete: true, problems: [] },
    })
    const { reviewVerdictOf } = await import('../packages/application/src/review-verdict.js')
    const verdict = reviewVerdictOf(
      { artifactType: 'review', reviewedObjects: ['src/ok.mjs'], scope: 'x', findings: [], conclusion: '通过', blockers: [], reviewSnapshot: snapshot, verdict: 'approved' },
      { currentSnapshot: fabricated },
    )
    expect(verdict).toBe('inconclusive')
  })
})
