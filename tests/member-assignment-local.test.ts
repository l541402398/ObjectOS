import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AppError, ApiSchemas, CreateTaskInputSchema, AssignmentSelectionSchema, type AssignmentHostInput } from '@projectos/contracts'
import { AssignmentDetailSchema, type AssignmentCreate } from '@projectos/organization-contracts'
import { AssignmentAuthorityService } from '../apps/runtime/src/assignment-authority.js'
import { MemberAssignmentService } from '../apps/runtime/src/member-assignments.js'
import { KnowledgeWritebackService } from '../apps/runtime/src/knowledge-writeback.js'
import { RequirementKnowledgeService } from '../apps/runtime/src/organization-knowledge.js'
import { RequirementIntegrationService } from '../apps/runtime/src/requirement-integration.js'
import { RequirementWorkService } from '../apps/runtime/src/requirement-work.js'
import { RequirementFlowService } from '../apps/runtime/src/requirement-flow.js'
import { RuntimeDispatcher } from '../apps/runtime/src/dispatcher.js'
import { createRequirementFlow } from '@projectos/domain'
import { createGitProject, FakeProvider, setup, waitFor, logger } from './helpers/r1-fixture.js'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })
const scope = { serverUrl: 'https://assignments.example.test', organizationId: 'org', accountId: 'member' }
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
async function fixture(fake = new FakeProvider(() => ({ text: '不应在接收时调用模型' }))) {
  const h = setup(fake)
  cleanup.push(() => { h.close(); rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  const project = await createGitProject(h.services, h.dataDir, 'member-assignment')
  const draft: AssignmentCreate = { id: randomUUID(), projectId: 'shared_project', assigneeId: scope.accountId,
    brief: { title: '退款业务开发', body: '先明确退款业务规则和技术方案，再经人工批准开发。', acceptanceCriteria: ['退款不重复', '实际测试通过'], priority: 'high', dueAt: null } }
  let active = true
  const calls: AssignmentHostInput[] = []
  const authority = new AssignmentAuthorityService(h.store, async input => {
    calls.push(input)
    if (!active) throw new AppError('POLICY_DENIED', '分配已取消或权限已撤回')
    return { ...input.request, assigneeId: scope.accountId, briefChecksum: hash(draft.brief), revision: 2, status: 'accepted' }
  })
  const knowledge = new RequirementKnowledgeService(h.store, undefined, authority), integration = new RequirementIntegrationService(h.store)
  h.runner.setOrganizationKnowledge(knowledge)
  const writeback = new KnowledgeWritebackService(h.store, integration, knowledge)
  const service = new MemberAssignmentService(h.store, h.services, writeback, authority)
  const detail = (claim: { clientId: string; claimRef: string } | null = null) => AssignmentDetailSchema.parse({ assignment: { id: draft.id, organizationId: scope.organizationId,
    projectId: draft.projectId, projectName: '共享项目', title: draft.brief.title, priority: draft.brief.priority, dueAt: draft.brief.dueAt, brief: draft.brief,
    assignee: { id: scope.accountId, name: 'Member' }, dispatcher: { id: 'leader', name: 'Leader' }, status: claim ? 'accepted' : 'pending', revision: claim ? 2 : 1,
    briefChecksum: hash(draft.brief), creationHash: hash(draft), createdAt: 1, updatedAt: 1, canManage: false, canRespond: true, report: null, replacesId: null, claim: claim ? { ...claim, acceptedAt: 1 } : null }, history: [] })
  const prepare = () => service.prepare({ scope, selection: { kind: 'accept', id: randomUUID(), assignmentId: draft.id, expectedRevision: 1, localProjectId: project.id, confirmed: true }, detail: detail() })
  const response = (operation: Awaited<ReturnType<typeof prepare>>) => {
    if (operation.payload.type !== 'command' || operation.payload.data.action !== 'accept') throw new Error('Wrong fixture operation')
    return { kind: 'confirmed', command: { commandId: operation.receipt.id, assignmentId: draft.id, organizationId: scope.organizationId, actorId: scope.accountId, payloadHash: hash(operation.payload.data), revision: 2, status: 'accepted', newAssignmentId: null, createdAt: 1 }, detail: detail(operation.payload.data.claim) }
  }
  const accept = async () => { const op = await prepare(); const receipt = service.finish({ scope, id: op.receipt.id, outcome: response(op) }); return { op, receipt, requirementId: receipt.localRequirementId! } }
  return { ...h, fake, project, draft, service, authority, knowledge, calls, detail, prepare, response, accept, revoke: () => { active = false } }
}

describe('K4 local member acceptance, provenance and authority', () => {
  it('imports one ordinary requirement and workflow only after acknowledgement, without models, workspaces or Git writes', async () => {
    const f = await fixture(), before = execFileSync('git', ['show-ref'], { cwd: f.project.rootPath, encoding: 'utf8' })
    const operation = await f.prepare()
    expect(f.services.projects.requirements(f.project.id)).toHaveLength(0)
    expect(operation.receipt.status).toBe('sending')
    const receipt = f.service.finish({ scope, id: operation.receipt.id, outcome: f.response(operation) })
    expect(receipt.status).toBe('confirmed')
    const requirement = f.store.read.getRequirement(receipt.localRequirementId!)!
    expect(requirement).toMatchObject({ title: f.draft.brief.title, body: f.draft.brief.body, status: 'draft', acceptanceCriteria: f.draft.brief.acceptanceCriteria })
    expect(f.service.view(requirement.id).binding).toMatchObject({ assignmentId: f.draft.id, projectId: f.draft.projectId, accountId: scope.accountId })
    expect(f.store.db.prepare('SELECT template_version_id FROM requirement_flow_bindings WHERE requirement_id=?').get(requirement.id)?.template_version_id).toBe('wfv_standard1')
    expect(f.store.db.prepare('SELECT id FROM requirement_workspaces WHERE requirement_id=?').all(requirement.id)).toHaveLength(0)
    expect(f.fake.calls).toHaveLength(0)
    expect(execFileSync('git', ['show-ref'], { cwd: f.project.rootPath, encoding: 'utf8' })).toBe(before)
    expect(f.service.finish({ scope, id: operation.receipt.id, outcome: f.response(operation) }).localRequirementId).toBe(requirement.id)
    expect(f.services.projects.requirements(f.project.id)).toHaveLength(1)
    const run = f.store.db.prepare('SELECT run_id FROM organization_assignment_intents WHERE id=?').get(operation.receipt.id)!
    expect(f.store.read.getToolCalls(String(run.run_id))[0]?.status).toBe('completed')
    expect(f.store.read.listApprovalViews(f.project.id).some(a => a.status === 'approved')).toBe(true)
  })
  it('recovers interrupted intent without replay and retries only the same confirmed content', async () => {
    const f = await fixture(), operation = await f.prepare()
    const restarted = new MemberAssignmentService(f.store, f.services, new KnowledgeWritebackService(f.store, new RequirementIntegrationService(f.store), f.knowledge), f.authority)
    expect(restarted.get(scope, operation.receipt.id).receipt.status).toBe('needs_reconciliation')
    await expect(restarted.retry({ scope, id: operation.receipt.id, confirmed: false })).rejects.toThrow()
    await expect(f.prepare()).rejects.toThrow(/核对/)
    const retry = await restarted.retry({ scope, id: operation.receipt.id, confirmed: true })
    expect(retry.payload).toEqual(operation.payload)
    expect(f.fake.calls).toHaveLength(0)
    const receipt = restarted.finish({ scope, id: retry.receipt.id, outcome: f.response(operation) })
    expect(receipt.status).toBe('confirmed'); expect(f.services.projects.requirements(f.project.id)).toHaveLength(1)
  })
  it('rejects forged receipts, cross-account reads and Renderer proof fields before importing anything', async () => {
    const f = await fixture(), operation = await f.prepare(), forged = f.response(operation)
    forged.command.payloadHash = 'f'.repeat(64)
    expect(() => f.service.finish({ scope, id: operation.receipt.id, outcome: forged })).toThrow(/不一致/)
    expect(() => f.service.get({ ...scope, accountId: 'another' }, operation.receipt.id)).toThrow(/其他组织/)
    expect(f.services.projects.requirements(f.project.id)).toHaveLength(0)
    expect(AssignmentSelectionSchema.safeParse({ kind: 'accept', id: randomUUID(), assignmentId: f.draft.id, expectedRevision: 1, localProjectId: f.project.id, confirmed: true, claim: { clientId: randomUUID(), claimRef: randomUUID() } }).success).toBe(false)
    expect(Object.hasOwn(ApiSchemas, 'runtime.assignment.prepare')).toBe(false)
    expect(() => f.store.db.prepare("UPDATE organization_assignment_intents SET payload_json='{}' WHERE id=?").run(operation.receipt.id)).toThrow(/immutable/)
  })
  it('can reconcile a manually closed unknown operation without sending it again', async () => {
    const f = await fixture(), operation = await f.prepare()
    f.service.finish({ scope, id: operation.receipt.id, outcome: { kind: 'unknown' } })
    expect(f.service.close({ scope, id: operation.receipt.id, note: '已核对本机记录，暂时关闭此待办', confirmed: true }).status).toBe('closed')
    const receipt = f.service.finish({ scope, id: operation.receipt.id, outcome: f.response(operation) })
    expect(receipt.status).toBe('confirmed')
    expect(f.services.projects.requirements(f.project.id)).toHaveLength(1)
    expect(f.fake.calls).toHaveLength(0)
  })
  it('collects actual task counts, refuses unaccepted delivery and protects the assigned knowledge scope', async () => {
    const f = await fixture(), accepted = await f.accept()
    f.services.tasks.create(CreateTaskInputSchema.parse({ projectId: f.project.id, requirementId: accepted.requirementId, title: '实现退款', acceptanceCriteria: ['测试通过'] }))
    const preview = f.service.preview(accepted.requirementId, 'progress')
    expect(preview.counts).toMatchObject({ total: 1, done: 0, active: 1 })
    const operation = await f.service.prepare({ scope, selection: { kind: 'progress', id: randomUUID(), requirementId: accepted.requirementId, expectedRevision: 2, fingerprint: preview.fingerprint, artifactIds: [], note: '已经明确需求范围，等待批准开发计划', confirmed: true } })
    expect(operation.payload).toMatchObject({ type: 'command', data: { action: 'progress', counts: preview.counts } })
    expect(JSON.stringify(operation.payload)).not.toContain(f.dataDir)
    expect(AssignmentSelectionSchema.safeParse({ kind: 'progress', id: randomUUID(), requirementId: accepted.requirementId, expectedRevision: 2, fingerprint: preview.fingerprint, artifactIds: [], note: '不能由界面伪造任务进度和验收来源', confirmed: true, counts: { total: 1, done: 1 } }).success).toBe(false)
    const delivery = f.service.preview(accepted.requirementId, 'delivery')
    await expect(f.service.prepare({ scope, selection: { kind: 'delivery', id: randomUUID(), requirementId: accepted.requirementId, expectedRevision: 2, fingerprint: delivery.fingerprint, artifactIds: [], note: '没有整体验收时不得提交完成状态', confirmed: true } })).rejects.toThrow(/整体验收/)
    expect(() => f.authority.assertScope(accepted.requirementId, scope, 'different-project')).toThrow(/原接收/)
  })
  it('checks assigned planning without knowledge pins, blocks a revoked workspace approval and leaves personal work local', async () => {
    const f = await fixture(), accepted = await f.accept()
    const planner = await f.knowledge.planning(accepted.requirementId)
    expect(planner?.text).toBe(''); expect(planner?.check).toBeTypeOf('function')
    const task = f.services.tasks.create(CreateTaskInputSchema.parse({ projectId: f.project.id, requirementId: accepted.requirementId, title: '准备退款开发', acceptanceCriteria: ['遵循原始分配'] }))
    const work = new RequirementWorkService(f.store, f.dataDir, undefined, async id => { await f.authority.check(id) })
    const pending = work.request({ taskId: task.id, expectedVersion: task.version })
    f.revoke()
    await expect(planner!.check()).rejects.toThrow(/取消/)
    await expect(work.decide(pending.approvalId, 'approved', '审批时应重新检查远端分配状态')).rejects.toThrow(/取消/)
    expect(f.store.db.prepare('SELECT id FROM requirement_workspaces WHERE requirement_id=?').all(accepted.requirementId)).toHaveLength(0)
    const personal = f.services.projects.createRequirement({ projectId: f.project.id, title: '个人需求', body: '继续本地工作', source: 'local', acceptanceCriteria: [] }), count = f.calls.length
    expect(await f.knowledge.planning(personal.id)).toBeUndefined()
    expect(f.calls).toHaveLength(count)
  })
  it('rechecks assignment after a native file approval even without knowledge pins', async () => {
    const fake = new FakeProvider(call => call.index === 0 ? { tool: { name: 'write_file', args: { path: 'revoked.txt', content: 'must not be written' } } } : { text: 'done' })
    const f = await fixture(fake), accepted = await f.accept()
    const work = new RequirementWorkService(f.store, f.dataDir, undefined, async id => { await f.authority.check(id) })
    const flow = new RequirementFlowService(f.store, f.services, f.runner, work, { resolve: () => { throw new Error('Manual workflow does not allocate with a model') } })
    cleanup.push(() => flow.dispose())
    const template = flow.save({ projectId: f.project.id, name: '撤销边界测试', description: '', graph: createRequirementFlow(['development']), layout: {} })
    flow.bind({ requirementId: accepted.requirementId, expectedRequirementVersion: f.store.read.getRequirement(accepted.requirementId)!.version, templateVersionId: template.versionId, assignmentMode: 'manual', assignments: { 'stage-1': 'agt_engineer' } })
    const task = f.services.tasks.create(CreateTaskInputSchema.parse({ projectId: f.project.id, requirementId: accepted.requirementId, title: '原分配开发任务', acceptanceCriteria: ['检查撤销'] }))
    const prep = work.request({ taskId: task.id, expectedVersion: task.version })
    await work.decide(prep.approvalId, 'approved', '批准隔离工作区用于测试撤销边界')
    const state = await flow.start(task.id), run = { runId: state.steps[0]!.runId! }
    await waitFor(() => f.store.read.listApprovalViews(f.project.id, run.runId).some(a => a.status === 'pending'))
    const approval = f.store.read.listApprovalViews(f.project.id, run.runId).find(a => a.status === 'pending')!
    f.revoke(); await f.runner.decideApproval(approval.id, 'approved', '批准文件操作，仍须重新检查分配权限').catch(() => undefined)
    await waitFor(() => f.store.read.getRun(run.runId)?.status === 'failed')
    expect(existsSync(join(f.store.read.getTaskWorkspace(task.id)!.rootPath, 'revoked.txt'))).toBe(false)
    expect(fake.calls).toHaveLength(1)
    expect(JSON.stringify(f.store.read.getRunSteps(run.runId))).toContain('organizationAssignment')
  }, 30000)
  it('rejects the legacy unscoped plan chat for assigned work before any model or message, preserving personal routing', async () => {
    const f = await fixture(), accepted = await f.accept()
    const draft = f.orchestration.generatePlan(f.project.id, '分配需求的旧计划入口')
    f.store.updatePlanRevision({ ...draft, requirementId: accepted.requirementId })
    const dispatcher = new RuntimeDispatcher({ config: f.config, store: f.store, services: f.services, runner: f.runner, provider: f.provider, hub: f.hub, logger, startedAt: Date.now(), shutdown: () => {} })
    cleanup.push(() => dispatcher.shutdownOrchestrations())
    const before = f.store.read.listSessionSummaries(f.project.id).length
    const messageCount = () => f.store.read.listSessionSummaries(f.project.id).reduce((sum, session) => sum + (f.store.read.getSessionDetail(session.id, 200)?.messages.length ?? 0), 0)
    const beforeMessages = messageCount()
    await expect(dispatcher.dispatch('plan.discuss', { planId: draft.id, content: '不能通过无需求范围的旧讨论启动模型' })).rejects.toThrow(/需求流程/)
    f.revoke()
    await expect(dispatcher.dispatch('plan.discuss', { planId: draft.id, content: '分配撤销后此入口仍须关闭' })).rejects.toThrow(/需求流程/)
    expect(f.fake.calls).toHaveLength(0)
    expect(f.store.read.listSessionSummaries(f.project.id)).toHaveLength(before)
    expect(messageCount()).toBe(beforeMessages)
    const personal = f.orchestration.generatePlan(f.project.id, '个人计划讨论路由')
    const result = await dispatcher.dispatch('plan.discuss', { planId: personal.id, content: '个人讨论仍进入原来的会话处理' }) as { groupSessionId: string; status: string }
    expect(result.status).toBe('started')
    await waitFor(() => f.store.read.getSessionDetail(result.groupSessionId, 200)?.messages.some(message => message.metadata?.kind === 'group-summary') === true)
    expect(f.fake.calls.length).toBeGreaterThan(0)
  })
})
