import { AppError, AssignmentBindingSchema, type AssignmentBinding, type AssignmentHostInput, type AssignmentHostOutput } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

/** Assigned work uses the existing Runner; this is an online authority check, not an executor. */
export class AssignmentAuthorityService {
  constructor(private readonly store: SqliteStore, private readonly host?: (input: AssignmentHostInput) => Promise<AssignmentHostOutput>) {}
  binding(requirementId: string): AssignmentBinding | null {
    const row = this.store.db.prepare('SELECT binding_json FROM requirement_member_assignments WHERE requirement_id=?').get(requirementId)
    return row ? AssignmentBindingSchema.parse(JSON.parse(String(row.binding_json))) : null
  }
  assertScope(requirementId: string, scope: { serverUrl: string; organizationId: string; accountId: string }, projectId?: string) {
    const binding = this.binding(requirementId)
    if (binding && (binding.serverUrl !== scope.serverUrl || binding.organizationId !== scope.organizationId || binding.accountId !== scope.accountId || (projectId && binding.projectId !== projectId)))
      throw new AppError('FORBIDDEN', '分配需求只能使用原接收账号、组织与项目')
    return binding
  }
  async checkBinding(binding: AssignmentBinding, purpose: 'execution' | 'knowledge' = 'execution') {
    if (!this.host) throw new AppError('POLICY_DENIED', '组织分配授权通道尚未连接，不能继续执行')
    const { serverUrl, organizationId, accountId, assignmentId, projectId, claim } = binding
    const result = await this.host({ serverUrl, organizationId, accountId, request: { assignmentId, projectId, claim, purpose } })
    const allowed = purpose === 'knowledge' ? ['accepted', 'in_progress', 'ready_for_review', 'completed'] : ['accepted', 'in_progress']
    if (result.assignmentId !== assignmentId || result.projectId !== projectId || result.assigneeId !== accountId || result.claim.clientId !== claim.clientId || result.claim.claimRef !== claim.claimRef ||
      result.briefChecksum !== binding.briefChecksum || result.purpose !== purpose || !allowed.includes(result.status)) throw new AppError('POLICY_DENIED', '组织分配的接收身份、范围或状态已经失效')
  }
  async check(requirementId: string, purpose: 'execution' | 'knowledge' = 'execution') {
    const binding = this.binding(requirementId)
    if (binding) await this.checkBinding(binding, purpose)
    return binding
  }
  async checkRun(runId: string) {
    const frozen = this.store.read.getRunSteps(runId).find(step => step.payload.organizationAssignment)?.payload.organizationAssignment
    if (frozen) return this.checkBinding(AssignmentBindingSchema.parse(frozen))
    const run = this.store.read.getRun(runId), task = run?.taskId ? this.store.read.getTask(run.taskId) : null
    if (task?.requirementId) {
      const binding = this.binding(task.requirementId)
      if (binding) {
        this.store.appendRunStep({ runId, kind: 'context', title: '组织分配身份固定', payload: { organizationAssignment: binding } })
        await this.checkBinding(binding)
      }
    }
  }
}
