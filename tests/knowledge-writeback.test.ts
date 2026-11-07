import { createHash, randomUUID } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiSchemas, CreateTaskInputSchema, KnowledgeWritebackSelectionSchema } from '@projectos/contracts'
import { canonicalKnowledgeContent } from '@projectos/organization-contracts'
import { RequirementKnowledgeService } from '../apps/runtime/src/organization-knowledge.js'
import { KnowledgeWritebackService } from '../apps/runtime/src/knowledge-writeback.js'
import { RequirementWorkService } from '../apps/runtime/src/requirement-work.js'
import { RequirementIntegrationService } from '../apps/runtime/src/requirement-integration.js'
import { gitText } from '../apps/runtime/src/requirement-git.js'
import { createGitProject, FakeProvider, setup, waitFor } from './helpers/r1-fixture.js'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })
const scope = { serverUrl: 'https://knowledge.example.test', organizationId: 'organization', accountId: 'account' }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
async function fixture() {
  const fake = new FakeProvider(call => call.hasToolResult ? { text: '已生成可复用成果' } : { tool: { name: 'create_artifact', args: { kind: 'document', title: '退款规则与技术决策', body: '业务规则：退回原支付渠道。技术决策：幂等事务。问题解决：重试不能重复退款。' } } })
  const h = setup(fake)
  cleanup.push(() => { h.close(); rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  const project = await createGitProject(h.services, h.dataDir, 'knowledge-delivery')
  const requirement = h.services.projects.createRequirement({ projectId: project.id, title: '退款能力', body: '实现并验收退款', source: 'local', acceptanceCriteria: ['退款遵循业务规则'] })
  const work = new RequirementWorkService(h.store, h.dataDir), integration = new RequirementIntegrationService(h.store), knowledge = new RequirementKnowledgeService(h.store)
  const service = new KnowledgeWritebackService(h.store, integration, knowledge)
  const task = h.services.tasks.create(CreateTaskInputSchema.parse({ projectId: project.id, requirementId: requirement.id, title: '实现退款', acceptanceCriteria: ['实际测试通过'] }))
  const ready = async () => {
    const op = work.request({ taskId: task.id, expectedVersion: task.version }); await work.decide(op.approvalId, 'approved', '测试夹具批准独立工作区')
    const root = h.store.read.getTaskWorkspace(task.id)!.rootPath
    writeFileSync(join(root, 'refund.cjs'), 'module.exports = 1\n')
    writeFileSync(join(root, 'check.test.cjs'), "require('node:test')('refund',()=>require('node:assert/strict').equal(require('./refund.cjs'),1))\n")
    const session = h.services.sessions.create({ projectId: project.id, agentId: 'agt_engineer', title: '成果说明' })
    const run = await h.runner.startRun({ projectId: project.id, taskId: task.id, sessionId: session.id, prompt: '记录退款的业务规则与技术决策' })
    await waitFor(() => h.store.read.getRun(run.runId)?.status === 'completed')
    if (h.store.read.getTask(task.id)!.status !== 'done') h.services.tasks.move({ taskId: task.id, expectedVersion: h.store.read.getTask(task.id)!.version, to: 'done', note: '本机所有者已核对实际退款成果' })
    integration.recordReview({ taskId: task.id, fingerprint: integration.preview(task.id).fingerprint, note: '已审查代码、实际测试及本次需求边界' })
    const verify = integration.request({ taskId: task.id, kind: 'verify', fingerprint: integration.preview(task.id).fingerprint, command: 'node --test check.test.cjs' })
    await integration.decide(verify.approvalId, 'approved', '批准隔离项目的实际验证')
    await waitFor(() => h.store.read.getRun(verify.runId)?.status === 'completed')
    const merge = integration.request({ taskId: task.id, kind: 'integrate', fingerprint: integration.preview(task.id).fingerprint })
    await integration.decide(merge.approvalId, 'approved', '仅批准已审查验证内容合入需求分支')
    return root
  }
  const accept = () => service.accept({ requirementId: requirement.id, fingerprint: service.preview(requirement.id).fingerprint, note: '已核对需求范围、当前成果及实际测试证据，整体验收通过', confirmed: true })
  const selection = () => { const view = service.preview(requirement.id); return KnowledgeWritebackSelectionSchema.parse({ id: randomUUID(), requirementId: requirement.id, projectId: 'shared-project',
    acceptanceId: view.acceptance!.id, fingerprint: view.fingerprint, artifactIds: [view.artifacts[0]!.id], category: 'business',
    content: service.draft({ requirementId: requirement.id, artifactIds: [view.artifacts[0]!.id] }), confirmed: true }) }
  const response = (input: ReturnType<typeof selection>) => {
    const operation = service.get(scope, input.id), payload = operation.payload
    return { candidate: { ...payload, organizationId: scope.organizationId, authorId: scope.accountId, authorName: 'Test',
      checksum: 'sha256:' + createHash('sha256').update(canonicalKnowledgeContent(payload.content)).digest('hex'), payloadHash: digest(payload),
      status: 'pending' as const, revision: 1, createdAt: Date.now(), reviewedAt: null, reviewerId: null, reviewNote: null, decisionId: null, publication: null, canReview: true }, related: [] }
  }
  return { ...h, fake, project, requirement, task, service, work, integration, knowledge, ready, accept, selection, response }
}

describe('content-bound acceptance and crash-safe knowledge writeback', () => {
  it('does not accept a generic implemented flag or renderer-created artifacts, then records real acceptance without changing requirement delivery status', async () => {
    const f = await fixture()
    f.services.projects.setRequirementStatus(f.requirement.id, 'implemented')
    expect(f.service.preview(f.requirement.id).blockers.length).toBeGreaterThan(0)
    expect(() => f.accept()).toThrow(/尚未就绪/)
    f.services.projects.setRequirementStatus(f.requirement.id, 'draft')
    f.services.projects.createArtifact({ projectId: f.project.id, taskId: f.task.id, runId: null, kind: 'document', title: '不可信产物', body: '用户声称完成', uri: null })
    expect(f.service.preview(f.requirement.id).artifacts).toHaveLength(0)
    await f.ready(); const accepted = f.accept()
    expect(accepted.blockers).toEqual([]); expect(accepted.acceptance?.current).toBe(true)
    expect(accepted.artifacts).toHaveLength(1)
    expect(f.store.read.getRequirement(f.requirement.id)?.status).toBe('draft')
  }, 40_000)
  it('exports Runtime-collected proof and selected content with an approved audited tool call, without filesystem roots or credentials', async () => {
    const f = await fixture(); await f.ready(); f.accept()
    const input = f.selection(), operation = f.service.prepare({ scope, selection: input })
    expect(operation.payload.source.tasks[0]?.verificationToolCallIds.length).toBeGreaterThan(0)
    expect(JSON.stringify(operation.payload.source)).not.toContain(f.dataDir)
    expect(JSON.stringify(operation.payload.source)).not.toContain('body')
    expect(operation.payload.content.body).toContain('业务规则')
    const calls = f.store.read.getToolCalls(operation.receipt.runId)
    expect(calls).toHaveLength(1); expect(calls[0]?.status).toBe('running')
    expect(f.store.read.listApprovalViews(f.project.id, operation.receipt.runId)[0]?.status).toBe('approved')
    expect(f.service.finish({ scope, id: input.id, outcome: { kind: 'submitted', result: f.response(input) } }).status).toBe('submitted')
    expect(f.service.prepare({ scope, selection: input }).receipt.status).toBe('submitted')
    expect(f.store.read.getToolCalls(operation.receipt.runId)[0]?.status).toBe('completed')
    expect(f.fake.calls).toHaveLength(2)
  }, 40_000)
  it('invalidates acceptance on changed artifacts or unreviewed clean commits before any submission is recorded', async () => {
    const f = await fixture(); const root = await f.ready(); f.accept()
    const input = f.selection()
    f.store.db.prepare('UPDATE artifacts SET body=? WHERE id=?').run('新的结果，旧验收应失效', input.artifactIds[0]!)
    expect(f.service.preview(f.requirement.id).acceptance?.current).toBe(false)
    expect(() => f.service.prepare({ scope, selection: input })).toThrow(/已改变/)
    expect(f.store.db.prepare('SELECT id FROM knowledge_writebacks').all()).toHaveLength(0)
    gitText(root, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'unreviewed task commit')
    expect(f.service.preview(f.requirement.id).blockers.length).toBeGreaterThan(0)
  }, 40_000)
  it('marks interrupted writes unknown and requires explicit same-id retry after fresh acceptance checks', async () => {
    const f = await fixture(); await f.ready(); f.accept(); const input = f.selection()
    const prepared = f.service.prepare({ scope, selection: input })
    const restarted = new KnowledgeWritebackService(f.store, f.integration, f.knowledge)
    expect(restarted.get(scope, input.id).receipt.status).toBe('needs_reconciliation')
    expect(f.store.read.getRun(prepared.receipt.runId)?.status).toBe('needs_reconciliation')
    expect(() => restarted.retry({ scope, id: input.id, confirmed: false })).toThrow()
    expect(() => restarted.prepare({ scope, selection: input })).toThrow(/先核对/)
    expect(() => restarted.prepare({ scope, selection: { ...input, id: randomUUID() } })).toThrow(/核对此需求/)
    const retried = restarted.retry({ scope, id: input.id, confirmed: true })
    expect(retried.payload).toEqual(prepared.payload)
    expect(f.store.read.getToolCalls(prepared.receipt.runId)).toHaveLength(1)
    expect(f.store.read.listApprovalViews(f.project.id, prepared.receipt.runId)).toHaveLength(2)
    expect(restarted.finish({ scope, id: input.id, outcome: { kind: 'submitted', result: f.response(input) } }).status).toBe('submitted')
  }, 40_000)
  it('rejects forged receipts and cross-account access and leaves stale unknown submissions unreplayed', async () => {
    const f = await fixture(); await f.ready(); f.accept(); const input = f.selection()
    f.service.prepare({ scope, selection: input })
    expect(() => f.service.get({ ...scope, accountId: 'different' }, input.id)).toThrow(/另一个/)
    const receipt = f.response(input); receipt.candidate.content = { ...receipt.candidate.content, body: '被替换的服务端正文' }
    expect(() => f.service.finish({ scope, id: input.id, outcome: { kind: 'submitted', result: receipt } })).toThrow(/不一致/)
    f.service.finish({ scope, id: input.id, outcome: { kind: 'unknown' } })
    f.work.update({ requirementId: f.requirement.id, expectedVersion: f.requirement.version, title: '新的需求范围', body: '已变更范围', technicalDesign: '', acceptanceCriteria: [] })
    expect(() => f.service.retry({ scope, id: input.id, confirmed: true })).toThrow(/已改变/)
    expect(f.service.get(scope, input.id).receipt.status).toBe('needs_reconciliation')
    expect(Object.hasOwn(ApiSchemas, 'runtime.knowledge.prepareWriteback')).toBe(false)
    expect(KnowledgeWritebackSelectionSchema.safeParse({ ...input, source: { accepted: true } }).success).toBe(false)
  }, 40_000)
})
