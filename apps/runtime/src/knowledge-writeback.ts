import { createHash, randomUUID } from 'node:crypto'
import { AppError, KnowledgeDeliveryPreviewSchema, KnowledgeWritebackReceiptSchema, KnowledgeWritebackInternalSchemas,
  KnowledgeWritebackApiSchemas, newId, now, type KnowledgeWritebackReceipt } from '@projectos/contracts'
import { KnowledgeCandidateSubmitSchema, OrganizationKnowledgeContentSchema, KnowledgeTaskEvidenceSchema } from '@projectos/organization-contracts'
import type { z } from 'zod'
import type { SqliteStore } from '@projectos/persistence'
import { evaluateToolPolicy } from '@projectos/policy'
import type { RequirementIntegrationService } from './requirement-integration.js'
import type { RequirementFlowService } from './requirement-flow.js'
import type { RequirementKnowledgeService } from './organization-knowledge.js'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
type Scope = { serverUrl: string; organizationId: string; accountId: string }
const RECEIPT = 'id,requirement_id AS requirementId,server_url AS serverUrl,organization_id AS organizationId,account_id AS accountId,project_id AS projectId,status,run_id AS runId,candidate_id AS candidateId,error,created_at AS createdAt'

export class KnowledgeWritebackService {
  constructor(private readonly store: SqliteStore, private readonly integration: RequirementIntegrationService,
    private readonly knowledge: RequirementKnowledgeService, private readonly flow?: Pick<RequirementFlowService, 'view'>) {
    for (const row of store.db.prepare("SELECT id,server_url,organization_id,account_id FROM knowledge_writebacks WHERE status='sending'").all())
      this.finish({ scope: { serverUrl: String(row.server_url), organizationId: String(row.organization_id), accountId: String(row.account_id) }, id: String(row.id), outcome: { kind: 'unknown' } })
  }
  private capture(requirementId: string) {
    const requirement = this.store.read.getRequirement(requirementId)
    if (!requirement) throw new AppError('NOT_FOUND', '需求不存在')
    const allTasks = this.store.read.listTasks(requirement.projectId).filter(task => task.requirementId === requirementId).sort((a, b) => a.id.localeCompare(b.id))
    const tasks = allTasks.filter(task => task.status !== 'cancelled'), blockers: string[] = []
    if (['rejected', 'archived'].includes(requirement.status)) blockers.push('已拒绝或归档的需求不能新增知识验收')
    if (!tasks.length) blockers.push('需求至少需要一个已验收任务')
    if (tasks.length > 20) blockers.push('一次知识验收最多支持 20 个任务，请拆分需求')
    const bound = Boolean(this.store.db.prepare('SELECT requirement_id FROM requirement_flow_bindings WHERE requirement_id=?').get(requirementId))
    if (bound && !this.flow) blockers.push('流程验收服务暂不可用')
    const flow = bound ? this.flow?.view(requirementId) : undefined
    const evidence: Array<z.infer<typeof KnowledgeTaskEvidenceSchema> & { targetHead: string; fingerprint: string }> = []
    for (const task of tasks.slice(0, 20)) {
      try {
        const item = this.integration.knowledgeEvidence(task.id)
        const taskFlow = flow?.tasks.find(item => item.taskId === task.id)
        if (bound && (!taskFlow || !taskFlow.steps.length || taskFlow.steps.some(step => step.status !== 'completed' || step.stale))) throw new Error('流程节点未完成或产物已过期')
        const { targetHead, fingerprint, ...proof } = item
        evidence.push({ targetHead, fingerprint, ...KnowledgeTaskEvidenceSchema.parse({ ...proof, workflowRunIds: taskFlow?.steps.map(step => step.runId).filter((id): id is string => Boolean(id)) ?? [] }) })
      } catch { blockers.push(`任务「${task.title}」尚缺当前验收、审查、实际测试、流程完成或合入证据`) }
    }
    if (evidence.length && !this.store.db.prepare("SELECT id FROM task_integration_operations WHERE requirement_id=? AND status='completed' AND kind='integrate' AND result_commit=? LIMIT 1").get(requirementId, evidence[0]!.targetHead)) blockers.push('需求分支包含尚未纳入验收记录的提交')
    if (evidence.some(item => item.targetHead !== evidence[0]?.targetHead)) blockers.push('任务成果指向不同的需求集成版本')
    if (this.store.db.prepare("SELECT id FROM task_integration_operations WHERE requirement_id=? AND status IN ('waiting_approval','executing','needs_reconciliation') LIMIT 1").get(requirementId)) blockers.push('需求还有待处理的成果操作')
    const taskIds = new Set(tasks.map(task => task.id)), materials = flow ? new Set(flow.materials.filter(item => item.status === 'current').map(item => item.artifactId)) : null
    const artifacts = this.store.read.listArtifacts(requirement.projectId).filter(artifact => {
      if (!artifact.taskId || !taskIds.has(artifact.taskId) || !artifact.runId || artifact.isDemo || !artifact.body?.trim() || (materials && !materials.has(artifact.id))) return false
      const run = this.store.read.getRun(artifact.runId)
      return run?.status === 'completed' && run.taskId === artifact.taskId && run.projectId === requirement.projectId && this.store.read.getToolCalls(run.id).some(call =>
        call.toolName === 'create_artifact' && call.status === 'completed' && (call.result as { artifactId?: string } | null)?.artifactId === artifact.id)
    }).sort((a, b) => a.id.localeCompare(b.id))
    if (!artifacts.length) blockers.push('需要已完成运行实际生成的非演示产物')
    if (artifacts.length > 100) blockers.push('产物超过本次验收展示上限')
    const references = artifacts.map(artifact => ({ id: artifact.id, taskId: artifact.taskId!, runId: artifact.runId!, title: artifact.title, checksum: createHash('sha256').update(artifact.body!).digest('hex'), bodyChars: artifact.body!.length }))
    const binding = this.knowledge.view(requirementId)
    const snapshot = { requirementId, version: requirement.version, status: requirement.status, documents: hash({ title: requirement.title, body: requirement.body, design: requirement.technicalDesign, criteria: requirement.acceptanceCriteria }),
      tasks: allTasks.map(task => ({ id: task.id, version: task.version, status: task.status })), evidence, artifacts: references,
      bindingRevision: binding.revision, binding: binding.binding, flowVersion: flow?.binding?.version ?? null }
    return { requirement, snapshot, fingerprint: hash(snapshot), blockers, artifacts, references, evidence, binding }
  }
  preview(requirementId: string) {
    return this.previewCaptured(this.capture(requirementId))
  }
  private previewCaptured(captured: ReturnType<KnowledgeWritebackService['capture']>) {
    const requirementId = captured.requirement.id
    const acceptance = this.store.db.prepare('SELECT id,fingerprint,accepted_at AS acceptedAt,note FROM requirement_knowledge_acceptances WHERE requirement_id=? ORDER BY accepted_at DESC,rowid DESC LIMIT 1').get(requirementId)
    const receipts = this.store.db.prepare(`SELECT ${RECEIPT} FROM knowledge_writebacks WHERE requirement_id=? ORDER BY created_at DESC,rowid DESC LIMIT 50`).all(requirementId).map(row => KnowledgeWritebackReceiptSchema.parse(row))
    return KnowledgeDeliveryPreviewSchema.parse({ requirementId, fingerprint: captured.fingerprint, blockers: captured.blockers.slice(0, 100),
      artifacts: captured.references.slice(0, 100), acceptance: acceptance ? { ...acceptance, current: !captured.blockers.length && acceptance.fingerprint === captured.fingerprint } : null, receipts })
  }
  accept(raw: unknown) {
    const input = KnowledgeWritebackApiSchemas['requirement.acceptKnowledgeDelivery'].input.parse(raw)
    return this.store.transaction(() => {
      const captured = this.capture(input.requirementId)
      if (captured.blockers.length || captured.fingerprint !== input.fingerprint) throw new AppError('CONFLICT', '当前成果尚未就绪或已经改变，请刷新验收证据')
      this.store.db.prepare('INSERT OR IGNORE INTO requirement_knowledge_acceptances(id,requirement_id,fingerprint,snapshot_json,note,accepted_at) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(), input.requirementId, input.fingerprint, JSON.stringify(captured.snapshot), input.note, now())
      this.store.appendEvent(captured.requirement.projectId, input.requirementId, 'requirement.knowledge.accepted', { fingerprint: input.fingerprint, actor: 'local-owner' })
      return this.previewCaptured(captured)
    })
  }
  draft(raw: unknown) {
    const input = KnowledgeWritebackApiSchemas['requirement.knowledgeDraft'].input.parse(raw), captured = this.capture(input.requirementId)
    const selected = input.artifactIds.map(id => captured.artifacts.find(artifact => artifact.id === id))
    if (selected.some(item => !item) || new Set(input.artifactIds).size !== input.artifactIds.length) throw new AppError('CONFLICT', '所选产物不属于当前有效成果')
    const result = OrganizationKnowledgeContentSchema.safeParse({ title: captured.requirement.title.slice(0, 160),
      body: selected.map(item => `## ${item!.title}\n\n${item!.body}`).join('\n\n'), tags: ['需求成果'] })
    if (!result.success) throw new AppError('BAD_REQUEST', '整理内容超出限额或包含凭据，请减少资料或人工整理正文')
    return result.data
  }
  private checkAcceptance(id: string, requirementId: string, fingerprint: string) {
    const captured = this.capture(requirementId)
    const receipt = this.store.db.prepare('SELECT * FROM requirement_knowledge_acceptances WHERE id=? AND requirement_id=? AND fingerprint=?').get(id, requirementId, fingerprint)
    if (!receipt || captured.blockers.length || captured.fingerprint !== fingerprint) throw new AppError('CONFLICT', '验收依据已改变，请重新完成整体验收')
    return { captured, acceptance: receipt }
  }
  prepare(raw: unknown) {
    const { scope, selection } = KnowledgeWritebackInternalSchemas['runtime.knowledge.prepareWriteback'].input.parse(raw)
    return this.store.transaction(() => {
      const { captured, acceptance } = this.checkAcceptance(selection.acceptanceId, selection.requirementId, selection.fingerprint)
      const binding = captured.binding.binding
      if (binding && (binding.serverUrl !== scope.serverUrl || binding.organizationId !== scope.organizationId || binding.accountId !== scope.accountId || binding.projectId !== selection.projectId)) throw new AppError('FORBIDDEN', '成果引用属于另一个组织账号或项目')
      const artifacts = selection.artifactIds.map(id => captured.references.find(item => item.id === id))
      if (artifacts.some(item => !item)) throw new AppError('CONFLICT', '所选产物已失效')
      const payload = KnowledgeCandidateSubmitSchema.parse({ id: selection.id, projectId: selection.projectId, category: selection.category, content: selection.content,
        source: { kind: 'desktop-owner-attested', requirementId: selection.requirementId, requirementTitle: captured.requirement.title, requirementVersion: captured.requirement.version,
          acceptanceId: selection.acceptanceId, fingerprint: selection.fingerprint, acceptedAt: Number(acceptance.accepted_at), acceptanceNote: acceptance.note,
          tasks: captured.evidence.map(({ targetHead: _target, fingerprint: _fingerprint, ...item }) => item),
          artifacts: artifacts.map(item => { const { bodyChars: _chars, ...reference } = item!; return reference }),
          citations: binding?.pins.map(({ documentId, versionId, checksum }) => ({ documentId, versionId, checksum })) ?? [] } })
      const existing = this.store.db.prepare('SELECT payload_hash,status FROM knowledge_writebacks WHERE id=?').get(selection.id)
      if (existing) {
        const operation = this.get(scope, selection.id)
        if (existing.payload_hash !== hash(payload)) throw new AppError('CONFLICT', '此提交标识已绑定原内容')
        if (existing.status !== 'submitted') throw new AppError('CONFLICT', '此提交已有记录，请先核对结果')
        return operation
      }
      if (this.store.db.prepare("SELECT id FROM knowledge_writebacks WHERE requirement_id=? AND server_url=? AND organization_id=? AND account_id=? AND status IN ('sending','needs_reconciliation') LIMIT 1")
        .get(selection.requirementId, scope.serverUrl, scope.organizationId, scope.accountId)) throw new AppError('CONFLICT', '请先核对此需求已有的未知提交结果')
      const project = this.store.read.getProject(captured.requirement.projectId)!
      const args = { candidateId: selection.id, organizationId: scope.organizationId, projectId: selection.projectId, payloadHash: hash(payload) }
      if (evaluateToolPolicy({ rootPath: project.rootPath, toolName: 'submit_organization_knowledge', args }).decision !== 'require_approval') throw new AppError('POLICY_DENIED', '知识分享需要本次人工确认')
      const timestamp = now(), sessionId = newId('ses'), runId = newId('run')
      this.store.createSession({ id: sessionId, projectId: project.id, agentId: 'agt_product', title: '提交组织知识候选', status: 'active', createdAt: timestamp, updatedAt: timestamp })
      this.store.createRun({ id: runId, projectId: project.id, taskId: null, sessionId, agentId: 'agt_product', attempt: 1, status: 'running', error: null,
        summary: '人工确认后提交固定知识候选（不调用模型）', inputTokens: 0, outputTokens: 0, checkpointId: null, startedAt: timestamp, finishedAt: null, createdAt: timestamp })
      const call = this.store.createToolCall({ runId, toolName: 'submit_organization_knowledge', idempotencyKey: selection.id, status: 'running', argsHash: hash(args), args })
      this.approve(project.id, runId, call.id, args, '人工确认分享本次固定内容')
      this.store.db.prepare(`INSERT INTO knowledge_writebacks(id,requirement_id,acceptance_id,server_url,organization_id,account_id,project_id,status,payload_json,payload_hash,run_id,tool_call_id,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'sending',?,?,?,?,?,?)`).run(selection.id, selection.requirementId, selection.acceptanceId, scope.serverUrl, scope.organizationId, scope.accountId, selection.projectId,
        JSON.stringify(payload), hash(payload), runId, call.id, timestamp, timestamp)
      return this.get(scope, selection.id)
    })
  }
  private approve(projectId: string, runId: string, toolCallId: string, args: Record<string, unknown>, note: string) {
    const approval = this.store.createApproval({ projectId, runId, toolCallId, title: '分享固定知识候选到组织', detail: '本次只分享已核对的正文与验收证据，不自动发布，不上传本机目录。', request: { toolName: 'submit_organization_knowledge', args, risk: 'external' } })
    this.store.decideApproval(approval.id, 'approved', note)
    this.store.appendRunStep({ runId, kind: 'approval', title: note, payload: { approvalId: approval.id, ...args } })
  }
  get(scope: Scope, id: string) {
    const row = this.store.db.prepare(`SELECT ${RECEIPT},payload_json FROM knowledge_writebacks WHERE id=?`).get(id)
    if (!row) throw new AppError('NOT_FOUND', '提交记录不存在')
    const { payload_json, ...receipt } = row
    if (receipt.serverUrl !== scope.serverUrl || receipt.organizationId !== scope.organizationId || receipt.accountId !== scope.accountId) throw new AppError('FORBIDDEN', '提交属于另一个组织账号')
    return { receipt: KnowledgeWritebackReceiptSchema.parse(receipt), payload: KnowledgeCandidateSubmitSchema.parse(JSON.parse(String(payload_json))) }
  }
  retry(raw: unknown) {
    const input = KnowledgeWritebackInternalSchemas['runtime.knowledge.retryWriteback'].input.parse(raw)
    return this.store.transaction(() => {
      const operation = this.get(input.scope, input.id)
      if (!['needs_reconciliation', 'failed'].includes(operation.receipt.status)) throw new AppError('CONFLICT', '此提交无需重试')
      this.checkAcceptance(operation.payload.source.acceptanceId, operation.receipt.requirementId, operation.payload.source.fingerprint)
      const run = this.store.read.getRun(operation.receipt.runId)!, call = this.store.read.getToolCalls(run.id).find(call => call.toolName === 'submit_organization_knowledge')!
      this.approve(run.projectId, run.id, call.id, call.args, '人工核对后确认重新提交同一幂等标识与内容')
      this.store.updateToolCall(call.id, { status: 'running', error: null, startedAt: now(), finishedAt: null })
      this.store.updateRun(run.id, { status: 'running', error: null, finishedAt: null })
      this.store.db.prepare("UPDATE knowledge_writebacks SET status='sending',error=NULL,updated_at=? WHERE id=?").run(now(), input.id)
      return this.get(input.scope, input.id)
    })
  }
  finish(raw: unknown): KnowledgeWritebackReceipt {
    const { scope, id, outcome } = KnowledgeWritebackInternalSchemas['runtime.knowledge.finishWriteback'].input.parse(raw)
    return this.store.transaction(() => {
      const operation = this.get(scope, id)
      if (operation.receipt.status === 'submitted') return operation.receipt
      if (outcome.kind === 'submitted') {
        const candidate = outcome.result.candidate
        const received = KnowledgeCandidateSubmitSchema.parse({ id: candidate.id, projectId: candidate.projectId, category: candidate.category, content: candidate.content, source: candidate.source })
        if (candidate.organizationId !== scope.organizationId || candidate.authorId !== scope.accountId || candidate.payloadHash !== hash(operation.payload) || hash(received) !== hash(operation.payload)) throw new AppError('CONFLICT', '服务器回执与固定提交不一致，请人工核对')
      }
      const status = outcome.kind === 'submitted' ? 'submitted' : outcome.kind === 'unknown' ? 'needs_reconciliation' : 'failed'
      const error = status === 'submitted' ? null : status === 'needs_reconciliation' ? '提交结果未知，请先核对；不会自动重试' : '组织服务拒绝本次提交，请核对账号、权限与候选内容'
      const call = this.store.read.getToolCalls(operation.receipt.runId).find(call => call.toolName === 'submit_organization_knowledge')!
      this.store.db.prepare('UPDATE knowledge_writebacks SET status=?,candidate_id=?,error=?,updated_at=? WHERE id=?').run(status, status === 'submitted' ? id : null, error, now(), id)
      this.store.updateToolCall(call.id, { status: status === 'submitted' ? 'completed' : status === 'needs_reconciliation' ? 'needs_reconciliation' : 'failed', error, finishedAt: now(), result: { candidateId: status === 'submitted' ? id : null, status } })
      this.store.updateRun(operation.receipt.runId, { status: status === 'submitted' ? 'completed' : status === 'needs_reconciliation' ? 'needs_reconciliation' : 'failed', error, finishedAt: now() })
      return this.get(scope, id).receipt
    })
  }
}
