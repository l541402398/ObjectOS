import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { newId, now, type AppError, type Run } from '@projectos/contracts'
import { FakeProvider, createGitProject, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const USER = { kind: 'user' as const, id: 'local-user', name: '你' }
const INTRUDER = { kind: 'user' as const, id: 'other-user', name: '其他用户' }
const AGENT = { kind: 'agent' as const, id: 'agt_engineer', name: 'Kai' }

function attempt(fn: () => unknown): AppError {
  try {
    fn()
  } catch (error) {
    return error as AppError
  }
  throw new Error('expected an error')
}

function seedCompletedRun(
  harness: ReturnType<typeof setup>,
  projectId: string,
  taskId: string,
  options: { agentId?: string; toolName?: string; args?: Record<string, unknown>; filePath?: string } = {},
): Run {
  const session = harness.services.sessions.create(
    { projectId, agentId: options.agentId ?? 'agt_engineer', title: `seed-${taskId}` },
    { kind: 'system', id: 'test', name: 'test' },
  )
  const run = harness.store.createRun({
    id: newId('run'),
    projectId,
    taskId,
    sessionId: session.id,
    agentId: options.agentId ?? 'agt_engineer',
    attempt: 1,
    status: 'completed',
    error: null,
    summary: 'seeded',
    inputTokens: 0,
    outputTokens: 0,
    checkpointId: null,
    startedAt: now(),
    finishedAt: now(),
    createdAt: now(),
  })
  if (options.toolName) {
    const call = harness.store.createToolCall({
      runId: run.id,
      toolName: options.toolName,
      idempotencyKey: `${run.id}:1`,
      status: 'running',
      argsHash: 'seed',
      args: options.args ?? {},
    })
    harness.store.updateToolCall(call.id, {
      status: 'completed',
      result: { exitCode: 0 },
      finishedAt: now(),
    })
  }
  if (options.filePath) {
    harness.store.replaceRunFileChanges(run.id, [
      { path: options.filePath, changeType: 'added', baselineHash: null, afterHash: 'seed' },
    ])
  }
  return run
}

function createTask(harness: ReturnType<typeof setup>, projectId: string, extra: Record<string, unknown> = {}) {
  return harness.services.tasks.create({
    projectId,
    title: '验收任务',
    description: '',
    priority: 2,
    acceptanceCriteria: ['完成'],
    labels: [],
    assigneeAgentId: null,
    milestoneId: null,
    dependsOn: [],
    dueAt: null,
    ...extra,
  } as never)
}

function moveToReview(harness: ReturnType<typeof setup>, taskId: string) {
  for (const to of ['ready', 'running', 'review'] as const) {
    const task = harness.store.read.getTask(taskId)!
    harness.services.tasks.move({ taskId, expectedVersion: task.version, to, note: 'seed' }, USER)
  }
}

function acceptanceArtifact(harness: ReturnType<typeof setup>, projectId: string, taskId: string) {
  return harness.store.read
    .listArtifacts(projectId, taskId)
    .find((artifact) => artifact.title.startsWith('验收记录'))!
}

describe('R2.1 P0-04 risk-tiered human acceptance', () => {
  it('completes a normal task with a recorded owner, time and reason', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r21-normal')
    const task = createTask(harness, project.id)
    moveToReview(harness, task.id)
    const before = Date.now()
    const done = harness.services.tasks.move(
      { taskId: task.id, expectedVersion: harness.store.read.getTask(task.id)!.version, to: 'done', note: '人工确认为正常低风险任务' },
      USER,
    )
    expect(done.status).toBe('done')
    const record = acceptanceArtifact(harness, project.id, task.id)
    const metadata = record.metadata as Record<string, unknown>
    expect(metadata.acceptanceMode).toBe('human')
    expect(metadata.riskLevel).toBe('normal')
    expect(metadata.operator).toMatchObject({ id: 'local-user', kind: 'user' })
    expect(Number(metadata.decidedAt)).toBeGreaterThanOrEqual(before)
    expect(String(metadata.reason)).toContain('正常低风险')
    console.log(`[r21-normal] task=${task.id} risk=normal operator=local-user artifact=${record.id}`)
  })

  it('requires explicit high-risk confirmation and extra evidence, and audits overridden requirements', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r21-high')
    const task = createTask(harness, project.id, {
      title: '高风险实现任务',
      labels: ['developer'],
      expectedArtifacts: ['测试报告'],
    })
    moveToReview(harness, task.id)
    seedCompletedRun(harness, project.id, task.id, {
      toolName: 'write_file',
      args: { path: 'src/feature.ts', content: 'x' },
      filePath: 'src/feature.ts',
    })
    const version = () => harness.store.read.getTask(task.id)!.version
    const noConfirm = attempt(() =>
      harness.services.tasks.move(
        { taskId: task.id, expectedVersion: version(), to: 'done', note: '只写理由但未做安全确认' },
        USER,
      ),
    )
    expect(noConfirm.code).toBe('CONFLICT')
    expect(String(noConfirm.message)).toMatch(/高风险/)
    const noOverride = attempt(() =>
      harness.services.tasks.move(
        {
          taskId: task.id,
          expectedVersion: version(),
          to: 'done',
          acceptance: { reason: '确认实现内容与风险', confirmHighRisk: true, override: false },
        },
        USER,
      ),
    )
    expect(noOverride.code).toBe('CONFLICT')
    expect(String(noOverride.message)).toMatch(/覆盖/)
    const done = harness.services.tasks.move(
      {
        taskId: task.id,
        expectedVersion: version(),
        to: 'done',
        acceptance: { reason: '确认为预期实现且风险已复核', confirmHighRisk: true, override: true },
      },
      USER,
    )
    expect(done.status).toBe('done')
    const metadata = acceptanceArtifact(harness, project.id, task.id).metadata as Record<string, unknown>
    expect(metadata.riskLevel).toBe('high')
    expect(metadata.override).toBe(true)
    expect((metadata.overriddenRequirements as string[]).join('；')).toMatch(/测试报告/)
    expect((metadata.evidence as Record<string, unknown>).attributedFiles).toBe(1)
    console.log(`[r21-high] task=${task.id} risk=high override=true evidenceFiles=1`)
  })

  it('rejects a high-risk task when no persisted extra evidence exists', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r21-no-evidence')
    const task = createTask(harness, project.id, { priority: 1 })
    moveToReview(harness, task.id)
    const error = attempt(() =>
      harness.services.tasks.move(
        {
          taskId: task.id,
          expectedVersion: harness.store.read.getTask(task.id)!.version,
          to: 'done',
          acceptance: { reason: '紧急任务直接确认', confirmHighRisk: true, override: true },
        },
        USER,
      ),
    )
    expect(error.code).toBe('CONFLICT')
    expect(String(error.message)).toMatch(/额外|证据/)
    expect(harness.store.read.getTask(task.id)?.status).toBe('review')
    console.log(`[r21-no-evidence] task=${task.id} blocked=${error.message.slice(0, 40)}`)
  })

  it('requires an approved acceptance Approval for critical risk and audits the approval id', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r21-critical')
    const task = createTask(harness, project.id, { title: '认证模块改造' })
    moveToReview(harness, task.id)
    seedCompletedRun(harness, project.id, task.id, {
      toolName: 'write_file',
      args: { path: 'src/auth/session.ts', content: 'x' },
      filePath: 'src/auth/session.ts',
    })
    const direct = attempt(() =>
      harness.services.tasks.move(
        {
          taskId: task.id,
          expectedVersion: harness.store.read.getTask(task.id)!.version,
          to: 'done',
          acceptance: { reason: '直接确认关键风险改造', confirmHighRisk: true, override: true },
        },
        USER,
      ),
    )
    expect(direct.code).toBe('APPROVAL_REQUIRED')

    const requested = harness.services.tasks.requestAcceptance(
      { taskId: task.id, reason: '认证改造已完成，需要独立验收审批' },
      USER,
    )
    const duplicate = harness.services.tasks.requestAcceptance(
      { taskId: task.id, reason: '重复申请应复用待审批记录' },
      USER,
    )
    expect(duplicate.approvalId).toBe(requested.approvalId)
    const pendingConfirm = attempt(() =>
      harness.services.tasks.confirmAcceptance(
        { taskId: task.id, approvalId: requested.approvalId },
        USER,
      ),
    )
    expect(pendingConfirm.code).toBe('APPROVAL_REQUIRED')

    harness.services.tasks.decideAcceptance(
      { approvalId: requested.approvalId, decision: 'rejected', note: '证据不足' },
      USER,
    )
    const rejected = attempt(() =>
      harness.services.tasks.confirmAcceptance(
        { taskId: task.id, approvalId: requested.approvalId },
        USER,
      ),
    )
    expect(rejected.code).toBe('CONFLICT')
    expect(harness.store.read.getTask(task.id)?.status).toBe('review')

    const second = harness.services.tasks.requestAcceptance(
      { taskId: task.id, reason: '补充说明后重新申请验收审批' },
      USER,
    )
    harness.services.tasks.decideAcceptance(
      { approvalId: second.approvalId, decision: 'approved', note: '已核对认证改动' },
      USER,
    )
    const done = harness.services.tasks.confirmAcceptance(
      { taskId: task.id, approvalId: second.approvalId, note: '审批通过后完成' },
      USER,
    )
    expect(done.status).toBe('done')
    const metadata = acceptanceArtifact(harness, project.id, task.id).metadata as Record<string, unknown>
    expect(metadata.riskLevel).toBe('critical')
    expect(metadata.approvalId).toBe(second.approvalId)
    console.log(`[r21-critical] approval=${second.approvalId} rejectedThenApproved=true task=done`)
  })

  it('enforces owner permission and prevents Agent acceptance spoofing', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r21-permission')
    const task = createTask(harness, project.id, { labels: ['developer'] })
    moveToReview(harness, task.id)
    const intruder = attempt(() =>
      harness.services.tasks.move(
        {
          taskId: task.id,
          expectedVersion: harness.store.read.getTask(task.id)!.version,
          to: 'done',
          note: '试图以其他用户身份完成',
          acceptance: { reason: '越权验收尝试', confirmHighRisk: false, override: true },
        },
        INTRUDER,
      ),
    )
    expect(intruder.code).toBe('FORBIDDEN')

    const agentTry = attempt(() =>
      harness.services.tasks.move(
        {
          taskId: task.id,
          expectedVersion: harness.store.read.getTask(task.id)!.version,
          to: 'done',
          note: 'Agent 声称完成',
        },
        AGENT,
      ),
    )
    expect(agentTry.code).toBe('CONFLICT')

    harness.store.createArtifact({
      id: newId('art'),
      projectId: project.id,
      taskId: task.id,
      runId: null,
      kind: 'document',
      title: '伪造人工验收',
      uri: null,
      contentHash: null,
      gitCommit: null,
      metadata: { acceptanceMode: 'human', createdBy: 'user' },
      verifiedAt: now(),
      body: 'Agent 写入的伪造验收元数据',
      isDemo: false,
      createdAt: now(),
    })
    const spoof = attempt(() =>
      harness.services.tasks.move(
        { taskId: task.id, expectedVersion: harness.store.read.getTask(task.id)!.version, to: 'done', note: '再次声称完成' },
        AGENT,
      ),
    )
    expect(spoof.code).toBe('CONFLICT')
    expect(harness.store.read.getTask(task.id)?.status).toBe('review')
    console.log(`[r21-permission] intruder=${intruder.code} agent=${agentTry.code} metadataSpoof=${spoof.code}`)
  })

  it('keeps legacy acceptance artifacts readable and rejects duplicate completion', async () => {
    const harness = setup(new FakeProvider(() => ({ text: 'unused' })))
    cleanups.push(harness.close)
    const project = await createGitProject(harness.services, harness.dataDir, 'r21-history')
    const task = createTask(harness, project.id)
    moveToReview(harness, task.id)
    harness.services.tasks.move(
      { taskId: task.id, expectedVersion: harness.store.read.getTask(task.id)!.version, to: 'done', note: '历史人工验收记录' },
      USER,
    )
    harness.store.db.exec(
      `UPDATE artifacts SET metadata_json = '{}' WHERE task_id = '${task.id}' AND title LIKE '验收记录%'`,
    )
    const legacy = acceptanceArtifact(harness, project.id, task.id)
    expect(legacy.metadata).toEqual({})
    expect(harness.store.read.getTask(task.id)?.status).toBe('done')
    const duplicate = attempt(() =>
      harness.services.tasks.move(
        { taskId: task.id, expectedVersion: harness.store.read.getTask(task.id)!.version, to: 'done', note: '重复完成' },
        USER,
      ),
    )
    expect(duplicate.code).toBe('CONFLICT')
    writeFileSync(join(project.rootPath, 'history-marker.txt'), 'legacy', 'utf8')
    console.log(`[r21-history] legacyArtifact=${legacy.id} metadata={} duplicate=${duplicate.code}`)
  })
})
