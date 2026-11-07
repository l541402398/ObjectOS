import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError, AssignmentBindingSchema, AssignmentInternalSchemas, AssignmentOperationSchema, AssignmentPayloadSchema,
  AssignmentProgressPreviewSchema, AssignmentReceiptSchema, AssignmentRequirementApiSchemas, newId, now,
  type AssignmentReceipt } from '@projectos/contracts'
import { AssignmentDeliverySourceSchema } from '@projectos/organization-contracts'
import { evaluateToolPolicy } from '@projectos/policy'
import type { CoreServices } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import type { KnowledgeWritebackService } from './knowledge-writeback.js'
import type { AssignmentAuthorityService } from './assignment-authority.js'

type Scope = { serverUrl: string; organizationId: string; accountId: string }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const RECEIPT = 'id,server_url AS serverUrl,organization_id AS organizationId,account_id AS accountId,assignment_id AS assignmentId,kind,status,local_requirement_id AS localRequirementId,error,created_at AS createdAt'

/** Durable human control-plane intents; local acceptance imports metadata, never executes work. */
export class MemberAssignmentService {
  constructor(private readonly store: SqliteStore, private readonly services: CoreServices,
    private readonly delivery: KnowledgeWritebackService, readonly authority: AssignmentAuthorityService) {
    for (const row of store.db.prepare("SELECT id,server_url,organization_id,account_id FROM organization_assignment_intents WHERE status='sending'").all())
      this.finish({ scope: { serverUrl: String(row.server_url), organizationId: String(row.organization_id), accountId: String(row.account_id) }, id: row.id, outcome: { kind: 'unknown' } })
  }
  view(requirementId: string) {
    if (!this.store.read.getRequirement(requirementId)) throw new AppError('NOT_FOUND', '需求不存在')
    return { binding: this.authority.binding(requirementId) }
  }
  preview(requirementId: string, mode: 'progress' | 'delivery') {
    const requirement = this.store.read.getRequirement(requirementId), binding = this.authority.binding(requirementId)
    if (!requirement || !binding) throw new AppError('NOT_FOUND', '需求没有组织成员分配记录')
    const tasks = this.store.read.listTasks(requirement.projectId).filter(task => task.requirementId === requirementId && task.status !== 'cancelled')
    const ids = new Set(tasks.map(task => task.id)), runs = this.store.db.prepare('SELECT id,task_id,status FROM agent_runs WHERE project_id=? ORDER BY id').all(requirement.projectId).filter(run => ids.has(String(run.task_id)))
    const counts = { total: tasks.length, done: tasks.filter(task => task.status === 'done').length,
      blocked: tasks.filter(task => task.status === 'blocked').length, active: tasks.filter(task => !['done', 'blocked'].includes(task.status)).length,
      runningRuns: runs.filter(run => !['completed', 'failed', 'cancelled', 'timed_out', 'budget_exhausted', 'needs_reconciliation'].includes(String(run.status))).length }
    const delivery = mode === 'delivery' ? this.delivery.preview(requirementId) : null
    const snapshot = { requirementVersion: requirement.version, tasks: tasks.map(task => ({ id: task.id, version: task.version, status: task.status })), runs, delivery }
    return AssignmentProgressPreviewSchema.parse({ requirementId, mode, counts, fingerprint: hash(snapshot), blockers: delivery?.blockers ?? [], acceptance: delivery?.acceptance ?? null, artifacts: delivery?.artifacts ?? [] })
  }
  get(scope: Scope, id: string) {
    const row = this.store.db.prepare(`SELECT ${RECEIPT},payload_json FROM organization_assignment_intents WHERE id=?`).get(id)
    if (!row) throw new AppError('NOT_FOUND', '本机操作记录不存在')
    const { payload_json, ...receipt } = row
    if (receipt.serverUrl !== scope.serverUrl || receipt.organizationId !== scope.organizationId || receipt.accountId !== scope.accountId) throw new AppError('FORBIDDEN', '操作属于其他组织账号')
    return AssignmentOperationSchema.parse({ receipt, payload: JSON.parse(String(payload_json)) })
  }
  list(scope: Scope) {
    return { operations: this.store.db.prepare(`SELECT ${RECEIPT} FROM organization_assignment_intents WHERE server_url=? AND organization_id=? AND account_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100`)
      .all(scope.serverUrl, scope.organizationId, scope.accountId).map(row => AssignmentReceiptSchema.parse(row)) }
  }
  local(scope: Scope, assignmentId: string) {
    const row = this.store.db.prepare('SELECT requirement_id FROM requirement_member_assignments WHERE server_url=? AND organization_id=? AND account_id=? AND assignment_id=?').get(scope.serverUrl, scope.organizationId, scope.accountId, assignmentId)
    const requirement = row ? this.store.read.getRequirement(String(row.requirement_id)) : null
    return { requirementId: requirement?.id ?? null, projectId: requirement?.projectId ?? null }
  }
  private project(id: string) {
    const project = this.store.read.getProject(id)
    if (!project || project.status === 'archived') throw new AppError('CONFLICT', '本地项目不存在或已归档')
    return project
  }
  private audit(projectId: string, id: string, args: Record<string, unknown>) {
    const timestamp = now(), sessionId = newId('ses'), runId = newId('run')
    this.store.createSession({ id: sessionId, projectId, agentId: 'agt_product', title: '组织分配操作', status: 'active', createdAt: timestamp, updatedAt: timestamp })
    this.store.createRun({ id: runId, projectId, taskId: null, sessionId, agentId: 'agt_product', attempt: 1, status: 'running', error: null, summary: '人工确认固定组织分配操作，不调用模型',
      inputTokens: 0, outputTokens: 0, checkpointId: null, startedAt: timestamp, finishedAt: null, createdAt: timestamp })
    const call = this.store.createToolCall({ runId, toolName: 'organization_assignment_command', idempotencyKey: id, status: 'running', argsHash: hash(args), args })
    this.approve(projectId, runId, call.id, args)
    return { runId, toolCallId: call.id }
  }
  private approve(projectId: string, runId: string, toolCallId: string, args: Record<string, unknown>) {
    const approval = this.store.createApproval({ projectId, runId, toolCallId, title: '确认本次组织分配操作', detail: '只发送已核对的固定内容，不自动执行代码、命令或 Git 操作。', request: { toolName: 'organization_assignment_command', args, risk: 'external' } })
    this.store.decideApproval(approval.id, 'approved', '用户在本机明确确认当前固定操作')
    this.store.appendRunStep({ runId, kind: 'approval', title: '本次组织分配操作已获人工确认', payload: { approvalId: approval.id, ...args } })
  }
  async prepare(raw: unknown) {
    const { scope, selection, detail } = AssignmentInternalSchemas['runtime.assignment.prepare'].input.parse(raw)
    if (selection.kind === 'progress' || selection.kind === 'delivery') await this.authority.check(selection.requirementId)
    return this.store.transaction(() => {
      let id: string, assignmentId: string, payload: z.infer<typeof AssignmentPayloadSchema>, localProjectId: string | null = null, localRequirementId: string | null = null, snapshot: string | null = null
      if (selection.kind === 'dispatch') { id = selection.draft.id; assignmentId = id; payload = { type: 'create', data: selection.draft } }
      else if (selection.kind === 'decision') { id = selection.decision.commandId; assignmentId = selection.assignmentId; payload = { type: 'command', assignmentId, data: selection.decision } }
      else if (selection.kind === 'accept') {
        id = selection.id; assignmentId = selection.assignmentId; localProjectId = selection.localProjectId
        this.project(localProjectId)
        const a = detail?.assignment
        if (!a || a.id !== assignmentId || a.organizationId !== scope.organizationId || a.assignee.id !== scope.accountId || a.revision !== selection.expectedRevision || a.status !== 'pending') throw new AppError('CONFLICT', '分配已改变，请刷新后再接收')
        const previous = this.store.db.prepare(`SELECT id FROM organization_assignment_intents WHERE server_url=? AND organization_id=? AND account_id=? AND assignment_id=? AND kind='accept' AND status='confirmed' AND local_requirement_id IS NOT NULL LIMIT 1`)
          .get(scope.serverUrl, scope.organizationId, scope.accountId, assignmentId)
        if (previous) return this.get(scope, String(previous.id))
        this.store.db.prepare('INSERT OR IGNORE INTO organization_assignment_clients(server_url,organization_id,account_id,client_id) VALUES(?,?,?,?)').run(scope.serverUrl, scope.organizationId, scope.accountId, randomUUID())
        const client = this.store.db.prepare('SELECT client_id FROM organization_assignment_clients WHERE server_url=? AND organization_id=? AND account_id=?').get(scope.serverUrl, scope.organizationId, scope.accountId)!
        payload = { type: 'command', assignmentId, data: { action: 'accept', commandId: id, expectedRevision: selection.expectedRevision, claim: { clientId: String(client.client_id), claimRef: id } } }
      } else {
        id = selection.id
        const binding = this.authority.assertScope(selection.requirementId, scope)
        if (!binding) throw new AppError('NOT_FOUND', '需求没有本机接收记录')
        assignmentId = binding.assignmentId
        const requirement = this.store.read.getRequirement(selection.requirementId)!
        localProjectId = requirement.projectId; localRequirementId = requirement.id; this.project(localProjectId)
        const preview = this.preview(selection.requirementId, selection.kind)
        if (preview.fingerprint !== selection.fingerprint) throw new AppError('CONFLICT', '进度或成果已经改变，请刷新后重新确认')
        snapshot = preview.fingerprint
        const common = { commandId: id, expectedRevision: selection.expectedRevision, claim: binding.claim, counts: preview.counts, note: selection.note }
        if (selection.kind === 'progress') payload = { type: 'command', assignmentId, data: { ...common, action: 'progress' } }
        else {
          if (!preview.acceptance?.current || preview.blockers.length || !selection.artifactIds.length || new Set(selection.artifactIds).size !== selection.artifactIds.length) throw new AppError('CONFLICT', '请先完成当前成果整体验收，并选择有效成果引用')
          const artifacts = selection.artifactIds.map(id => preview.artifacts.find(item => item.id === id))
          if (artifacts.some(item => !item)) throw new AppError('CONFLICT', '成果引用已失效')
          const stored = this.store.db.prepare('SELECT snapshot_json FROM requirement_knowledge_acceptances WHERE id=? AND requirement_id=?').get(preview.acceptance.id, selection.requirementId)!
          const evidence = z.object({ evidence: z.array(z.object({ integrationCommit: z.string().regex(/^[a-f0-9]{40,64}$/) })) }).parse(JSON.parse(String(stored.snapshot_json)))
          const source = AssignmentDeliverySourceSchema.parse({ kind: 'desktop-owner-attested', requirementVersion: requirement.version, acceptanceId: preview.acceptance.id,
            fingerprint: preview.acceptance.fingerprint, acceptedAt: preview.acceptance.acceptedAt, acceptanceNote: preview.acceptance.note,
            artifacts: artifacts.map(item => { const { bodyChars: _chars, ...reference } = item!; return reference }), commits: [...new Set(evidence.evidence.map(item => item.integrationCommit))] })
          payload = { type: 'command', assignmentId, data: { ...common, action: 'delivery', source } }
        }
      }
      payload = AssignmentPayloadSchema.parse(payload)
      const existing = this.store.db.prepare('SELECT payload_hash,status FROM organization_assignment_intents WHERE id=?').get(id)
      if (existing) {
        const operation = this.get(scope, id)
        if (existing.payload_hash !== hash(payload)) throw new AppError('CONFLICT', '操作标识已绑定原内容')
        if (existing.status !== 'confirmed') throw new AppError('CONFLICT', '已有本机记录，请先核对，或明确重试原操作')
        return operation
      }
      if (this.store.db.prepare(`SELECT id FROM organization_assignment_intents WHERE server_url=? AND organization_id=? AND account_id=? AND status IN ('sending','needs_reconciliation') AND (assignment_id=? OR kind='dispatch' OR ?='dispatch') LIMIT 1`)
        .get(scope.serverUrl, scope.organizationId, scope.accountId, assignmentId, selection.kind)) throw new AppError('CONFLICT', '请先核对已有未知操作结果')
      const args = { operationId: id, assignmentId, kind: selection.kind, payloadHash: hash(payload) }
      if (evaluateToolPolicy({ rootPath: localProjectId ? this.project(localProjectId).rootPath : '.', toolName: 'organization_assignment_command', args }).decision !== 'require_approval') throw new AppError('POLICY_DENIED', '分配操作需要本次人工确认')
      const audit = localProjectId ? this.audit(localProjectId, id, args) : null, timestamp = now()
      this.store.db.prepare(`INSERT INTO organization_assignment_intents(id,server_url,organization_id,account_id,assignment_id,kind,status,payload_json,payload_hash,local_project_id,local_requirement_id,fingerprint,run_id,tool_call_id,confirmed_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'sending',?,?,?,?,?,?,?,?,?,?)`).run(id, scope.serverUrl, scope.organizationId, scope.accountId, assignmentId, selection.kind, JSON.stringify(payload), hash(payload), localProjectId, localRequirementId, snapshot, audit?.runId ?? null, audit?.toolCallId ?? null, timestamp, timestamp, timestamp)
      return this.get(scope, id)
    })
  }
  async retry(raw: unknown) {
    const input = AssignmentInternalSchemas['runtime.assignment.retry'].input.parse(raw), operation = this.get(input.scope, input.id)
    const row = this.store.db.prepare('SELECT * FROM organization_assignment_intents WHERE id=?').get(input.id)!
    if (!['needs_reconciliation', 'closed'].includes(operation.receipt.status)) throw new AppError('CONFLICT', '此操作无需重试')
    if (row.local_project_id) this.project(String(row.local_project_id))
    if (operation.payload.type === 'command' && ['progress', 'delivery'].includes(operation.payload.data.action)) {
      const binding = this.store.db.prepare('SELECT requirement_id FROM requirement_member_assignments WHERE server_url=? AND organization_id=? AND account_id=? AND assignment_id=?').get(input.scope.serverUrl, input.scope.organizationId, input.scope.accountId, operation.receipt.assignmentId)
      if (!binding) throw new AppError('CONFLICT', '本机分配记录不存在')
      const mode = operation.payload.data.action as 'progress' | 'delivery'
      await this.authority.check(String(binding.requirement_id), mode === 'delivery' ? 'knowledge' : 'execution')
      if (this.preview(String(binding.requirement_id), mode).fingerprint !== row.fingerprint) throw new AppError('CONFLICT', '原进度或成果已改变，请先核对服务器结果')
    }
    return this.store.transaction(() => {
      if (row.run_id && row.tool_call_id) {
        const run = this.store.read.getRun(String(row.run_id))!, call = this.store.read.getToolCalls(run.id).find(call => call.id === row.tool_call_id)!
        this.approve(run.projectId, run.id, call.id, call.args)
        this.store.updateRun(run.id, { status: 'running', error: null, finishedAt: null })
        this.store.updateToolCall(call.id, { status: 'running', error: null, finishedAt: null })
      }
      this.store.db.prepare("UPDATE organization_assignment_intents SET status='sending',error=NULL,updated_at=? WHERE id=?").run(now(), input.id)
      return this.get(input.scope, input.id)
    })
  }
  close(raw: unknown) {
    const input = AssignmentInternalSchemas['runtime.assignment.close'].input.parse(raw), operation = this.get(input.scope, input.id)
    if (operation.receipt.status !== 'needs_reconciliation') throw new AppError('CONFLICT', '只可人工关闭待核对的本机记录')
    this.store.db.prepare("UPDATE organization_assignment_intents SET status='closed',error=?,updated_at=? WHERE id=?").run('人工关闭本机记录，不代表服务器成功或撤回：' + input.note, now(), input.id)
    return this.get(input.scope, input.id).receipt
  }
  finish(raw: unknown): AssignmentReceipt {
    const input = AssignmentInternalSchemas['runtime.assignment.finish'].input.parse(raw)
    return this.store.transaction(() => {
      const operation = this.get(input.scope, input.id), row = this.store.db.prepare('SELECT * FROM organization_assignment_intents WHERE id=?').get(input.id)!
      if (operation.receipt.status === 'confirmed' || (operation.receipt.status === 'closed' && input.outcome.kind === 'unknown')) return operation.receipt
      let requirementId = row.local_requirement_id ? String(row.local_requirement_id) : null, error: string | null = null
      if (input.outcome.kind === 'confirmed') {
        const { detail, command } = input.outcome, { payload } = operation
        if (payload.type === 'create') {
          const a = detail?.assignment
          if (!a || a.id !== payload.data.id || a.organizationId !== input.scope.organizationId || a.dispatcher.id !== input.scope.accountId || a.creationHash !== hash(payload.data)) throw new AppError('CONFLICT', '服务器派发回执与原内容不一致')
        } else {
          if (!command || command.commandId !== input.id || command.assignmentId !== payload.assignmentId || command.organizationId !== input.scope.organizationId || command.actorId !== input.scope.accountId || command.payloadHash !== hash(payload.data)) throw new AppError('CONFLICT', '服务器操作回执与原内容不一致')
          if (payload.data.action === 'accept') {
            const a = detail?.assignment
            if (!a || a.id !== payload.assignmentId || a.organizationId !== input.scope.organizationId || a.assignee.id !== input.scope.accountId || !a.canRespond || !a.claim || a.claim.clientId !== payload.data.claim.clientId || a.claim.claimRef !== payload.data.claim.claimRef) throw new AppError('CONFLICT', '分配接收身份或权限已改变，请人工核对')
            if (['accepted', 'in_progress'].includes(a.status)) {
              const existing = this.store.db.prepare('SELECT requirement_id FROM requirement_member_assignments WHERE server_url=? AND organization_id=? AND account_id=? AND assignment_id=?').get(input.scope.serverUrl, input.scope.organizationId, input.scope.accountId, a.id)
              if (existing) requirementId = String(existing.requirement_id)
              else {
                const project = this.project(String(row.local_project_id))
                const requirement = this.services.projects.createRequirement({ projectId: project.id, title: a.brief.title, body: a.brief.body, source: 'local', acceptanceCriteria: a.brief.acceptanceCriteria,
                  workflow: { templateVersionId: 'wfv_standard1', assignmentMode: 'manual', assignments: {} } })
                requirementId = requirement.id
                const binding = AssignmentBindingSchema.parse({ ...input.scope, assignmentId: a.id, projectId: a.projectId, requirementId, claim: payload.data.claim, briefChecksum: a.briefChecksum, acceptedAt: a.claim.acceptedAt })
                this.store.db.prepare('INSERT INTO requirement_member_assignments(requirement_id,server_url,organization_id,account_id,assignment_id,project_id,binding_json) VALUES(?,?,?,?,?,?,?)')
                  .run(requirementId, input.scope.serverUrl, input.scope.organizationId, input.scope.accountId, a.id, a.projectId, JSON.stringify(binding))
                this.store.appendEvent(project.id, requirementId, 'requirement.assignment.accepted', { assignmentId: a.id, briefChecksum: a.briefChecksum })
              }
            } else error = '服务器分配已经关闭或待验收，未创建新的本机需求'
          }
        }
      } else error = '操作结果未知，请先核对；不会自动重试'
      const status = input.outcome.kind === 'confirmed' ? 'confirmed' : 'needs_reconciliation'
      this.store.db.prepare('UPDATE organization_assignment_intents SET status=?,local_requirement_id=?,result_json=?,error=?,updated_at=? WHERE id=?').run(status, requirementId, input.outcome.kind === 'confirmed' ? JSON.stringify(input.outcome) : null, error, now(), input.id)
      if (row.run_id && row.tool_call_id) {
        this.store.updateToolCall(String(row.tool_call_id), { status: status === 'confirmed' ? 'completed' : 'needs_reconciliation', result: { operationId: input.id, status, requirementId }, error, finishedAt: now() })
        this.store.updateRun(String(row.run_id), { status: status === 'confirmed' ? 'completed' : 'needs_reconciliation', error, finishedAt: now() })
      }
      return this.get(input.scope, input.id).receipt
    })
  }
  parsePreview(raw: unknown) {
    const input = AssignmentRequirementApiSchemas['requirement.assignmentProgress'].input.parse(raw)
    return this.preview(input.requirementId, input.mode)
  }
}
