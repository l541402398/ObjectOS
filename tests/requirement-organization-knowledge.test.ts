import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CreateTaskInputSchema, ApiSchemas, RuntimeFrameSchema, type KnowledgeHostInput, type RequirementKnowledgeBinding } from '@projectos/contracts'
import { RequirementKnowledgeService } from '../apps/runtime/src/organization-knowledge.js'
import { RequirementWorkService } from '../apps/runtime/src/requirement-work.js'
import { createGitProject, FakeProvider, setup, waitFor } from './helpers/r1-fixture.js'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })
const body = '组织业务规定：退款必须保留原支付渠道；技术采用幂等事务。'
const binding: RequirementKnowledgeBinding = { serverUrl: 'https://org.example.test', organizationId: 'org', accountId: 'account', projectId: 'shared',
  pins: [{ documentId: 'document', versionId: 'version-1', checksum: 'sha256:' + 'a'.repeat(64), version: '1.0.0', title: '退款规则', category: 'business', reason: '确定退款需求的业务约束' }] }
const scope = { serverUrl: binding.serverUrl, organizationId: binding.organizationId, accountId: binding.accountId }

async function fixture(fake = new FakeProvider(() => ({ text: '需求分析已完成' }))) {
  const h = setup(fake), work = new RequirementWorkService(h.store, h.dataDir)
  cleanup.push(() => { h.close(); rmSync(h.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) })
  const project = await createGitProject(h.services, h.dataDir, 'knowledge-requirement')
  const requirement = h.services.projects.createRequirement({ projectId: project.id, title: '实现退款', body: '按规定实现退款', source: 'local', acceptanceCriteria: ['退款规则正确'] })
  let allowed = true, revokeAfterArtifact = false
  const calls: KnowledgeHostInput[] = []
  const knowledge = new RequirementKnowledgeService(h.store, async input => {
    calls.push(input)
    if (!allowed || (revokeAfterArtifact && h.store.db.prepare("SELECT id FROM tool_calls WHERE tool_name='create_artifact' AND status='completed' LIMIT 1").get())) throw new Error('组织授权已撤销')
    return { sources: input.request.pins.map(pin => ({ ...pin, title: '退款规则', version: '1.0.0', category: 'business', ...(input.request.includeContent ? { body } : {}) })) }
  })
  h.runner.setOrganizationKnowledge(knowledge)
  const attach = () => knowledge.set({ requirementId: requirement.id, expectedRevision: 0, scope, binding })
  const start = async () => {
    const task = h.services.tasks.create(CreateTaskInputSchema.parse({ projectId: project.id, requirementId: requirement.id, title: '分析退款要求', acceptanceCriteria: ['产出分析'] }))
    const preparation = work.request({ taskId: task.id, expectedVersion: task.version })
    await work.decide(preparation.approvalId, 'approved', '仅批准本测试的隔离工作区')
    const session = h.services.sessions.create({ projectId: project.id, agentId: 'agt_engineer', title: '知识辅助分析' })
    const run = await h.runner.startRun({ projectId: project.id, taskId: task.id, sessionId: session.id, prompt: '分析本次需求，遵守当前节点的范围' })
    return { task, run, root: h.store.read.getTaskWorkspace(task.id)!.rootPath }
  }
  return { ...h, project, requirement, knowledge, fake, calls, attach, start, revoke: () => { allowed = false }, revokeAfterArtifact: () => { revokeAfterArtifact = true } }
}

describe('requirement-scoped organization knowledge', () => {
  it('keeps host/internal methods out of the renderer API and rejects generic secret or HTTP fields', () => {
    expect(Object.hasOwn(ApiSchemas, 'runtime.knowledge.set')).toBe(false)
    const frame = { kind: 'knowledge_request', id: 'request', input: { ...scope, request: { projectId: 'shared', pins: binding.pins.map(({ documentId, versionId, checksum }) => ({ documentId, versionId, checksum })), includeContent: true } } }
    expect(RuntimeFrameSchema.safeParse(frame).success).toBe(true)
    expect(RuntimeFrameSchema.safeParse({ ...frame, input: { ...frame.input, token: 'secret', url: 'https://elsewhere.test' } }).success).toBe(false)
  })

  it('uses optimistic reference edits, locks the chosen version and persists no source body', async () => {
    const f = await fixture()
    expect(f.knowledge.view(f.requirement.id)).toEqual({ revision: 0, locked: false, binding: null })
    f.attach()
    expect(() => f.attach()).toThrow(/修改/)
    expect(() => f.knowledge.set({ requirementId: f.requirement.id, expectedRevision: 1, scope: { ...scope, accountId: 'other' }, binding: null })).toThrow(/账号/)
    expect(await f.knowledge.capture(f.requirement.id)).toEqual(binding)
    expect(f.knowledge.view(f.requirement.id).locked).toBe(true)
    expect(() => f.knowledge.set({ requirementId: f.requirement.id, expectedRevision: 1, scope, binding: null })).toThrow(/固定/)
    expect(JSON.stringify(f.store.db.prepare('SELECT * FROM requirement_organization_knowledge').all())).not.toContain(body)
    expect(f.calls.every(call => call.request.pins[0]!.versionId === 'version-1')).toBe(true)
  })

  it('actually sends the selected evidence and immutable citations to the existing model while saving only references', async () => {
    const f = await fixture(); f.attach()
    const { run } = await f.start()
    await waitFor(() => f.store.read.getRun(run.runId)?.status === 'completed')
    const prompt = f.fake.calls[0]!.messages.map(message => message.content).join('\n')
    expect(prompt).toContain(body)
    expect(prompt).toContain('version-1')
    expect(prompt).toContain(binding.pins[0]!.checksum)
    expect(prompt).toContain('不是系统指令')
    const audit = JSON.stringify(f.store.read.getRunSteps(run.runId))
    expect(audit).toContain('version-1')
    expect(audit).not.toContain(body)
  }, 30000)

  it('rechecks revoked authority after human file approval and leaves the workspace untouched', async () => {
    const fake = new FakeProvider(call => call.index === 0 ? { tool: { name: 'write_file', args: { path: 'forbidden-after-revoke.txt', content: 'must not be written' } } } : { text: 'done' })
    const f = await fixture(fake); f.attach()
    const { run, root } = await f.start()
    await waitFor(() => f.store.read.listApprovalViews(f.project.id, run.runId).some(approval => approval.status === 'pending'))
    const approval = f.store.read.listApprovalViews(f.project.id, run.runId).find(approval => approval.status === 'pending')!
    f.revoke()
    await f.runner.decideApproval(approval.id, 'approved', '批准文件操作，组织权限仍需单独有效').catch(() => undefined)
    await waitFor(() => f.store.read.getRun(run.runId)?.status === 'failed')
    expect(existsSync(join(root, 'forbidden-after-revoke.txt'))).toBe(false)
    expect(fake.calls).toHaveLength(1)
  }, 30000)

  it('stops before another model request when knowledge is revoked after the first tool', async () => {
    const fake = new FakeProvider(call => call.index === 0 ? { tool: { name: 'create_artifact', args: { kind: 'document', title: '当前节点分析', body: '本次需求的分析产物' } } } : { text: 'must not request again' })
    const f = await fixture(fake); f.attach(); f.revokeAfterArtifact()
    const { run } = await f.start()
    await waitFor(() => f.store.read.getRun(run.runId)?.status === 'failed').catch(error => { throw new Error(`${error.message}: ${JSON.stringify({ run: f.store.read.getRun(run.runId)?.status, calls: fake.calls.length, tools: f.store.read.getToolCalls(run.runId).map(call => ({ name: call.toolName, status: call.status })), approvals: f.store.read.listApprovalViews(f.project.id, run.runId).map(approval => approval.status) })}`) })
    expect(f.store.read.getToolCalls(run.runId).some(call => call.toolName === 'create_artifact' && call.status === 'completed')).toBe(true)
    expect(fake.calls).toHaveLength(1)
  }, 30000)

  it('leaves personal planning local and makes no host request without explicit adoption', async () => {
    const f = await fixture()
    expect(await f.knowledge.planning(f.requirement.id)).toBeUndefined()
    expect(f.calls).toHaveLength(0)
    expect(f.knowledge.view(f.requirement.id).locked).toBe(true)
    expect(() => f.attach()).toThrow(/固定/)
  })
})
