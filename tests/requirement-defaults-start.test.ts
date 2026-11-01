import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { CreateTaskInputSchema } from '@projectos/contracts'
import { RequirementFlowService } from '../apps/runtime/src/requirement-flow.js'
import { RequirementWorkService } from '../apps/runtime/src/requirement-work.js'
import { createGitProject, FakeProvider, setup, waitFor } from './helpers/r1-fixture.js'

// ADR-0077: requirement default owners, explicit batch application and revocable start intents.
const SIX = ['stage-1', 'stage-2', 'stage-3', 'stage-4', 'stage-5', 'stage-6']
const OWNERS = ['agt_product', 'agt_reviewer', 'agt_architect', 'agt_reviewer', 'agt_engineer', 'agt_qa']
const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

async function fixture(options: { template?: string; assignments?: Record<string, string>; mode?: 'manual' | 'ai'; fake?: FakeProvider } = {}) {
  const fake = options.fake ?? new FakeProvider(() => ({ text: '未执行' }))
  const h = setup(fake)
  const work = new RequirementWorkService(h.store, h.dataDir)
  const model = { resolve: () => ({ provider: fake, connectionId: null, connectionName: null, model: 'fake', protocol: 'test' }) }
  let flow = new RequirementFlowService(h.store, h.services, h.runner, work, model)
  cleanups.push(() => { flow.dispose(); h.close(); rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  const project = await createGitProject(h.services, h.dataDir, 'defaults')
  const requirement = h.services.projects.createRequirement({ projectId: project.id, title: '批量安排', body: '减少重复分配', source: 'local', acceptanceCriteria: ['一次配置'],
    workflow: { templateVersionId: options.template ?? 'wfv_standard1', assignmentMode: options.mode ?? 'manual', assignments: options.assignments ?? {} } })
  const task = (title: string, dependsOn: string[] = []) => h.services.tasks.create(CreateTaskInputSchema.parse({ projectId: project.id, requirementId: requirement.id, title, acceptanceCriteria: ['完成'], dependsOn }))
  const restart = () => { flow.dispose(); flow = new RequirementFlowService(h.store, h.services, h.runner, work, model); return flow }
  const binding = () => flow.view(requirement.id).binding!
  return { ...h, project, requirement, task, work, get flow() { return flow }, restart, binding, fake }
}

const runsFor = (f: Awaited<ReturnType<typeof fixture>>, taskId: string) => Number(f.store.db.prepare('SELECT COUNT(*) AS n FROM agent_runs WHERE task_id=?').get(taskId)!.n)
const preparations = (f: Awaited<ReturnType<typeof fixture>>, taskId: string) => Number(f.store.db.prepare('SELECT COUNT(*) AS n FROM task_workspace_preparations WHERE task_id=?').get(taskId)!.n)
const approveWorkspace = async (f: Awaited<ReturnType<typeof fixture>>, taskId: string) => { await f.work.decide(f.flow.task(taskId).pendingApprovalId!, 'approved', '仅准备工作区') }

/** Records a fact the integration service would write; unit scope only (the real path is in requirement-integration tests). */
function markIntegrated(f: Awaited<ReturnType<typeof fixture>>, taskId: string) {
  f.store.db.exec('PRAGMA foreign_keys=OFF')
  try {
    f.store.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(taskId)
    const version = f.store.read.getTask(taskId)!.version
    const head = execFileSync('git', ['-C', f.store.read.getProject(f.project.id)!.rootPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    f.store.db.prepare(`INSERT INTO task_integration_operations(id,task_id,requirement_id,kind,approval_id,run_id,tool_call_id,status,snapshot_json,result_commit,created_at,updated_at)
      VALUES(?,?,?,'integrate',?,?,?,'completed',?,?,?,?)`).run(`tio_${taskId}`, taskId, f.requirement.id, `apr_${taskId}`, `run_${taskId}`, `tc_${taskId}`, JSON.stringify({ taskVersion: version }), head, Date.now(), Date.now())
  } finally { f.store.db.exec('PRAGMA foreign_keys=ON') }
}

describe('requirement default owners (ADR-0077)', () => {
  it('shares six-stage defaults across three tasks, keeps a single-task override and never rebuilds instances', async () => {
    const f = await fixture()
    const [a, b, c] = [f.task('任务 A'), f.task('任务 B'), f.task('任务 C')]
    const before = f.store.db.prepare('SELECT id FROM task_flow_steps ORDER BY id').all().map(row => row.id)
    const overrideStep = f.flow.task(c.id).steps.find(step => step.nodeId === 'stage-3')!
    f.flow.assign({ stepId: overrideStep.id, expectedVersion: overrideStep.version, agentId: 'agt_engineer' })
    const requirementVersion = f.store.read.getRequirement(f.requirement.id)!.version
    const saved = f.flow.setDefaults({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, assignments: Object.fromEntries(SIX.map((node, i) => [node, OWNERS[i]!])) })
    expect(saved.binding?.assignments).toMatchObject({ 'stage-1': 'agt_product', 'stage-6': 'agt_qa' })
    expect(f.store.read.getRequirement(f.requirement.id)!.version).toBe(requirementVersion)
    expect(f.store.db.prepare('SELECT id FROM task_flow_steps ORDER BY id').all().map(row => row.id)).toEqual(before)
    expect(f.flow.task(a.id).steps.every(step => step.agentId === null)).toBe(true)

    const preview = f.flow.previewAssignments(f.requirement.id)
    expect(preview.items.filter(item => item.action === 'fill')).toHaveLength(17)
    expect(preview.items.find(item => item.stepId === overrideStep.id)).toMatchObject({ action: 'replaceable', source: 'manual', defaultAgentId: 'agt_architect' })
    const applied = f.flow.applyAssignments({ requirementId: f.requirement.id, expectedBindingVersion: preview.bindingVersion, token: preview.token, replaceStepIds: [] })
    expect(applied).toMatchObject({ filled: 17, replaced: 0 })
    for (const id of [a.id, b.id]) expect(f.flow.task(id).steps.map(step => step.agentId)).toEqual(OWNERS)
    expect(f.flow.task(c.id).steps.find(step => step.nodeId === 'stage-3')).toMatchObject({ agentId: 'agt_engineer', assignmentSource: 'manual' })
    expect(f.flow.task(a.id).steps.every(step => step.assignmentSource === 'default')).toBe(true)
    // The old preview is stale after the change; it must not be replayed.
    expect(() => f.flow.applyAssignments({ requirementId: f.requirement.id, expectedBindingVersion: preview.bindingVersion, token: preview.token, replaceStepIds: [] })).toThrow(/重新预览/)
    // New tasks inherit the requirement defaults directly.
    expect(f.flow.task(f.task('任务 D').id).steps.map(step => [step.agentId, step.assignmentSource])).toEqual(OWNERS.map(owner => [owner, 'default']))
    // An explicit, listed replacement is the only way to change a human choice.
    const second = f.flow.previewAssignments(f.requirement.id)
    expect(() => f.flow.applyAssignments({ requirementId: f.requirement.id, expectedBindingVersion: second.bindingVersion, token: second.token, replaceStepIds: [f.flow.task(a.id).steps[0]!.id] })).toThrow(/只能替换/)
    f.flow.applyAssignments({ requirementId: f.requirement.id, expectedBindingVersion: second.bindingVersion, token: second.token, replaceStepIds: [overrideStep.id] })
    expect(f.flow.task(c.id).steps.find(step => step.nodeId === 'stage-3')).toMatchObject({ agentId: 'agt_architect', assignmentSource: 'default' })
  })

  it('rejects stale binding versions, unknown nodes and unavailable Agents without partial writes', async () => {
    const f = await fixture()
    const version = f.binding().version
    expect(() => f.flow.setDefaults({ requirementId: f.requirement.id, expectedBindingVersion: version + 5, assignments: { 'stage-1': 'agt_product' } })).toThrow(/刷新/)
    expect(() => f.flow.setDefaults({ requirementId: f.requirement.id, expectedBindingVersion: version, assignments: { 'stage-x': 'agt_product' } })).toThrow(/不存在/)
    f.store.db.prepare("UPDATE agents SET builtin=0,status='disabled' WHERE id='agt_architect'").run()
    expect(() => f.flow.setDefaults({ requirementId: f.requirement.id, expectedBindingVersion: version, assignments: { 'stage-1': 'agt_product', 'stage-3': 'agt_architect' } })).toThrow(/不可用/)
    expect(f.binding()).toMatchObject({ version, assignments: {} })
  })

  it('does not change started steps', async () => {
    const f = await fixture({ template: 'wfv_document1', assignments: { 'stage-1': 'agt_product', 'stage-2': 'agt_reviewer' } })
    const task = f.task('已开始')
    const step = f.flow.task(task.id).steps[0]!
    f.store.db.prepare("UPDATE task_flow_steps SET status='running',attempt=1 WHERE id=?").run(step.id)
    f.flow.setDefaults({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, assignments: { 'stage-1': 'agt_architect' } })
    const preview = f.flow.previewAssignments(f.requirement.id)
    expect(preview.items.find(item => item.stepId === step.id)?.action).toBe('locked')
    expect(() => f.flow.applyAssignments({ requirementId: f.requirement.id, expectedBindingVersion: preview.bindingVersion, token: preview.token, replaceStepIds: [step.id] })).toThrow(/只能替换/)
  })
})

describe('requirement start intents (ADR-0077)', () => {
  const docs = { template: 'wfv_document1', assignments: { 'stage-1': 'agt_product', 'stage-2': 'agt_reviewer' } }

  it('starts eligible tasks once even when the same or a different request is submitted concurrently', async () => {
    const f = await fixture(docs)
    const [a, b] = [f.task('任务 A'), f.task('任务 B')]
    const version = f.binding().version
    const [first, again, other] = await Promise.all([
      f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: version, requestKey: 'start-request-1' }),
      f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: version, requestKey: 'start-request-1' }),
      f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: version, requestKey: 'start-request-2' }),
    ])
    expect(first.intent.items.map(item => item.outcome)).toEqual(['waiting_approval', 'waiting_workspace'])
    expect(again).toMatchObject({ replayed: true, intent: { id: first.intent.id } })
    expect(other.intent.items.map(item => item.outcome)).toEqual(['waiting_approval', 'waiting_workspace'])
    expect([preparations(f, a.id), preparations(f, b.id)]).toEqual([1, 0])
    expect(f.fake.calls).toHaveLength(0)
    const replay = await f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: version, requestKey: 'start-request-1' })
    expect(replay).toMatchObject({ replayed: true, intent: { id: first.intent.id } })
    expect(preparations(f, a.id)).toBe(1)
    expect(f.flow.view(f.requirement.id).startIntent?.id).toBe(other.intent.id)
    // Once the first workspace (and the shared integration worktree) exists, the queued task asks once.
    await approveWorkspace(f, a.id)
    await f.flow.advance(f.project.id)
    expect([preparations(f, a.id), preparations(f, b.id)]).toEqual([1, 1])
    expect(runsFor(f, b.id)).toBe(1)
    expect(f.flow.view(f.requirement.id).startIntent?.items.find(item => item.taskId === b.id)?.outcome).toBe('waiting_approval')
  }, 30_000)

  it('reports missing owners, unavailable Agents and stale versions explicitly', async () => {
    const f = await fixture({ template: 'wfv_document1', assignments: { 'stage-1': 'agt_product' } })
    const missing = f.task('缺少审核人')
    const result = await f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, requestKey: 'missing-owner-1' })
    expect(result.intent.items[0]).toMatchObject({ taskId: missing.id, status: 'skipped', outcome: 'needs_assignment' })
    expect(result.intent.items[0]!.reason).toContain('需求审核')
    expect(preparations(f, missing.id)).toBe(0)
    const step = f.flow.task(missing.id).steps[1]!
    f.flow.assign({ stepId: step.id, expectedVersion: step.version, agentId: 'agt_architect' })
    f.store.db.prepare("UPDATE agents SET builtin=0,status='disabled' WHERE id='agt_architect'").run()
    const invalid = await f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, requestKey: 'invalid-agent-1' })
    expect(invalid.intent.items[0]).toMatchObject({ outcome: 'invalid_agent', status: 'skipped' })
    await expect(f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version + 1, requestKey: 'stale-binding-1' })).rejects.toThrow(/刷新/)
    expect(f.store.db.prepare("SELECT COUNT(*) AS n FROM requirement_flow_start_intents WHERE request_key='stale-binding-1'").get()!.n).toBe(0)
    expect(runsFor(f, missing.id)).toBe(0)
  })

  it('waits for dependencies across a restart and continues only inside an unchanged scope', async () => {
    const f = await fixture(docs)
    const a = f.task('前置'), b = f.task('后续', [a.id])
    const started = await f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, requestKey: 'dependency-run-1' })
    expect(started.intent.items.find(item => item.taskId === b.id)).toMatchObject({ status: 'waiting', outcome: 'waiting_dependency' })
    expect(started.intent.status).toBe('active')
    const flow = f.restart()
    await flow.advance(f.project.id)
    expect(preparations(f, b.id)).toBe(0)
    expect(flow.task(b.id).status).toBe('idle')
    await approveWorkspace(f, a.id)
    markIntegrated(f, a.id)
    await flow.advance(f.project.id)
    expect(preparations(f, b.id)).toBe(1)
    expect(flow.view(f.requirement.id).startIntent).toMatchObject({ status: 'completed', items: expect.arrayContaining([expect.objectContaining({ taskId: b.id, outcome: 'waiting_approval' })]) })
  })

  it('does not continue after the intent is revoked, a task is paused or its owners change', async () => {
    const f = await fixture(docs)
    const a = f.task('前置'), revoked = f.task('撤销后', [a.id]), paused = f.task('暂停后', [a.id]), changed = f.task('改负责人', [a.id])
    await f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, requestKey: 'scope-run-1' })
    f.flow.pause(paused.id)
    const step = f.flow.task(changed.id).steps[0]!
    f.flow.assign({ stepId: step.id, expectedVersion: step.version, agentId: 'agt_architect' })
    await approveWorkspace(f, a.id)
    markIntegrated(f, a.id)
    await f.flow.advance(f.project.id)
    expect(preparations(f, paused.id)).toBe(0)
    expect(preparations(f, changed.id)).toBe(0)
    expect(preparations(f, revoked.id)).toBe(1)
    const items = f.flow.view(f.requirement.id).startIntent!.items
    expect(items.find(item => item.taskId === paused.id)).toMatchObject({ status: 'cancelled', outcome: 'paused' })
    expect(items.find(item => item.taskId === changed.id)).toMatchObject({ status: 'cancelled', outcome: 'scope_changed' })
  })

  it('stops automatic progress when revoked and does not mark waiting work complete', async () => {
    const f = await fixture(docs)
    const a = f.task('前置'), b = f.task('后续', [a.id])
    await f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, requestKey: 'revoke-run-1' })
    const view = f.flow.stopAll({ requirementId: f.requirement.id, reason: '人工停止' })
    expect(view.startIntent).toMatchObject({ status: 'revoked', revokedReason: '人工停止' })
    expect(view.tasks.find(task => task.taskId === a.id)?.status).toBe('paused')
    expect(view.startIntent!.items.find(item => item.taskId === b.id)).toMatchObject({ status: 'cancelled', outcome: 'revoked' })
    await approveWorkspace(f, a.id)
    markIntegrated(f, a.id)
    await f.flow.advance(f.project.id)
    expect(preparations(f, b.id)).toBe(0)
    expect(f.flow.task(b.id).status).toBe('idle')
    expect(f.flow.task(a.id).steps.every(step => step.status !== 'completed')).toBe(true)
  })

  it('runs nodes only after the separate workspace approval; one Run per node with repeated starts', async () => {
    const fake = new FakeProvider(call => call.hasToolResult ? { text: '已保存' } : { tool: { name: 'create_artifact', args: { title: '需求文档', kind: 'document', body: '完整正文', metadata: { artifactType: 'workflow_result' } } } })
    const f = await fixture({ ...docs, fake })
    const a = f.task('任务 A')
    const first = await f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, requestKey: 'approval-run-1' })
    expect(first.intent.items[0]!.outcome).toBe('waiting_approval')
    expect(fake.calls).toHaveLength(0)
    await f.work.decide(f.flow.task(a.id).pendingApprovalId!, 'approved', '仅准备工作区')
    await f.flow.advance(f.project.id)
    const runId = f.flow.task(a.id).steps[0]!.runId!
    await f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, requestKey: 'approval-run-2' })
    await waitFor(() => f.store.read.getRun(runId)?.status === 'completed')
    expect(f.flow.task(a.id).steps[0]).toMatchObject({ runId, attempt: 1 })
  }, 30_000)

  it('autonomous AI assignment fills missing owners before a requested start', async () => {
    const fake = new FakeProvider(call => {
      const data = JSON.parse(call.messages.at(-1)!.content) as { steps: Array<{ id: string }> }
      return { text: JSON.stringify({ assignments: data.steps.map(step => ({ stepId: step.id, agentId: 'agt_reviewer' })) }) }
    })
    const f = await fixture({ template: 'wfv_document1', mode: 'ai', assignments: { 'stage-1': 'agt_product' }, fake })
    const task = f.task('AI 补全')
    const result = await f.flow.startAll({ requirementId: f.requirement.id, expectedBindingVersion: f.binding().version, requestKey: 'ai-start-run-1' })
    expect(result.intent.items[0]!.outcome).toBe('waiting_approval')
    expect(f.flow.task(task.id).steps.map(step => [step.agentId, step.assignmentSource])).toEqual([['agt_product', 'default'], ['agt_reviewer', 'ai']])
  })
})
