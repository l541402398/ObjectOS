import {
  AppError,
  newId,
  now,
  type PlanDraft,
  type PlanExecutionGrantView,
  type PlannedTask,
  type ReplanGrantImpact,
  type ReplanProposal,
  type ReplanProposalView,
  type ReplanTrigger,
  type RevisionDiff,
} from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import {
  buildReplanUserPrompt,
  REPLAN_PROMPT_VERSION,
  replanSystemPrompt,
  topologicalPlanTasks,
} from '@projectos/planning'
import type { Logger } from './logger.js'
import type { OrchestrationService } from './orchestration.js'
import { planFingerprint, type PlanGrantService } from './plan-grant.js'
import { classifyExecutionFailure } from './failure-classifier.js'
import type { PlannerService } from './planner.js'
import { buildReplanContext } from './replan-context.js'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'

const MAX_PROPOSALS_PER_PLAN = 3
const MAX_MODEL_CALLS_PER_PLAN = 5

export class ReplanService {
  constructor(
    private readonly store: SqliteStore,
    private readonly orchestration: OrchestrationService,
    private readonly planner: PlannerService,
    private readonly grants: PlanGrantService,
    private readonly logger?: Logger,
  ) {}

  list(projectId: string, planId: string | null = null): ReplanProposalView[] {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    return this.store.read.listReplanProposals(projectId, planId).map((proposal) => this.view(proposal))
  }

  get(proposalId: string): ReplanProposalView {
    const proposal = this.store.read.getReplanProposal(proposalId)
    if (!proposal) throw new AppError('NOT_FOUND', '重规划提案不存在')
    return this.view(proposal)
  }

  async propose(input: {
    planId: string
    trigger: ReplanTrigger
    reason: string
    allowOverBudget?: boolean
    requestedBy?: string
  }): Promise<ReplanProposalView> {
    const plan = this.orchestration.getPlan(input.planId)
    if (plan.status === 'draft' || plan.status === 'rejected') {
      throw new AppError('CONFLICT', '只有已批准或执行中的计划才需要动态重规划；草稿请直接编辑')
    }
    const existing = this.store.read.getActiveReplanProposal(plan.id)
    if (existing) return this.view(existing)
    const count = this.store.read.countReplanProposals(plan.id)
    if (count >= MAX_PROPOSALS_PER_PLAN) {
      throw new AppError('CONFLICT', `该计划已达到动态重规划次数上限（${MAX_PROPOSALS_PER_PLAN}），请人工处理`)
    }
    const modelCalls = this.store.read
      .listReplanProposals(plan.projectId, plan.id)
      .reduce((sum, proposal) => sum + proposal.modelCalls, 0)
    if (modelCalls >= MAX_MODEL_CALLS_PER_PLAN) {
      throw new AppError('CONFLICT', `该计划的 Replan 模型调用预算已用尽（${MAX_MODEL_CALLS_PER_PLAN} 次）`)
    }
    this.assertTriggerFact(plan, input.trigger)
    const requestId = newId('plr')
    const proposalId = newId('rpp')
    const sourceFingerprint = planFingerprint(plan)
    const sourceRunCount = plan.execution?.runIds.length ?? 0
    const grant = this.grants.get(plan.id)
    let generation: ReplanProposal['generation'] = null
    try {
      const context = buildReplanContext({
        store: this.store,
        plan,
        trigger: input.trigger,
        reason: input.reason,
        grant,
      })
      const maxTasks = Math.max(1, Math.min(20, plan.tasks.length + 4))
      const revised = await this.planner.generateRevision({
        projectId: plan.projectId,
        planId: proposalId,
        revision: plan.revision,
        requestId,
        maxTasks,
        allowOverBudget: Boolean(input.allowOverBudget),
        system: replanSystemPrompt(),
        user: buildReplanUserPrompt({
          goal: plan.goal,
          sourceRevision: plan.revision,
          trigger: input.trigger,
          reason: input.reason,
          context: context.text,
          maxTasks,
        }),
        promptVersion: REPLAN_PROMPT_VERSION,
        contextChars: context.chars,
        contextSources: context.sources,
        warnings: context.warnings,
      })
      generation = revised.generation
      const assigned = this.orchestration.previewAssignedTasks(plan.projectId, plan.goal, revised.tasks)
      const diff = this.buildDiff(plan, assigned)
      const grantImpact = this.buildGrantImpact(plan, assigned, diff, grant)
      const timestamp = now()
      const proposal: ReplanProposal = {
        id: proposalId,
        projectId: plan.projectId,
        planId: plan.id,
        sourceRevision: plan.revision,
        sourceFingerprint,
        sourceRunCount,
        trigger: input.trigger,
        status: 'proposed',
        reason: (revised.reason || input.reason).slice(0, 4000),
        contextChars: context.chars,
        contextSources: context.sources,
        proposedTasks: assigned,
        proposedAssumptions: revised.assumptions,
        proposedRisks: revised.risks,
        diff,
        grantImpact,
        generation,
        error: null,
        requestedBy: input.requestedBy ?? 'local-user',
        requestedAt: timestamp,
        decidedAt: null,
        decidedReason: null,
        appliedPlanId: null,
        modelCalls: generation.attempts,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      this.store.createReplanProposal(proposal)
      this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.replanProposed, {
        proposalId,
        trigger: input.trigger,
        reason: proposal.reason,
        revision: plan.revision,
        added: diff.added.length,
        removed: diff.removed.length,
        modified: diff.modified.length,
        reusableArtifacts: diff.reusableArtifacts.length,
        requiresNewGrant: grantImpact.requiresNewGrant,
      })
      return this.view(proposal)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger?.warn({ err: error, planId: plan.id, trigger: input.trigger }, 'replan proposal failed')
      const timestamp = now()
      const failed: ReplanProposal = {
        id: proposalId,
        projectId: plan.projectId,
        planId: plan.id,
        sourceRevision: plan.revision,
        sourceFingerprint,
        sourceRunCount,
        trigger: input.trigger,
        status: 'failed',
        reason: input.reason,
        contextChars: 0,
        contextSources: [],
        proposedTasks: [],
        proposedAssumptions: [],
        proposedRisks: [],
        diff: emptyDiff(),
        grantImpact: emptyGrantImpact(),
        generation,
        error: message.slice(0, 8000),
        requestedBy: input.requestedBy ?? 'local-user',
        requestedAt: timestamp,
        decidedAt: timestamp,
        decidedReason: null,
        appliedPlanId: null,
        modelCalls: generation?.attempts ?? 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      this.store.createReplanProposal(failed)
      this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.replanFailed, {
        proposalId,
        trigger: input.trigger,
        error: failed.error,
      })
      return this.view(failed)
    }
  }

  apply(proposalId: string): { proposal: ReplanProposalView; plan: PlanDraft } {
    return this.applyAuthorized(proposalId, { kind: 'user', reasons: ['用户应用修订提案'] })
  }

  /**
   * ADR-0026 — apply a revision with an explicit authorization basis.
   *
   * `kind: 'policy'` means the product verified that the revision stays inside the user's live
   * grant envelope (paths/agents/tools/budget/expiry) and applied it without asking again. It is
   * recorded as such: it is never written as a human decision, and it never issues a human grant.
   */
  applyAuthorized(
    proposalId: string,
    basis: { kind: 'user' | 'policy'; reasons: string[] },
  ): { proposal: ReplanProposalView; plan: PlanDraft } {
    const proposal = this.store.read.getReplanProposal(proposalId)
    if (!proposal) throw new AppError('NOT_FOUND', '重规划提案不存在')
    if (proposal.status !== 'proposed') throw new AppError('CONFLICT', `重规划提案状态为 ${proposal.status}，不能应用`)
    const plan = this.orchestration.getPlan(proposal.planId)
    const assertFresh = (current: PlanDraft): void => {
      if (current.revision !== proposal.sourceRevision) {
        throw new AppError('CONFLICT', '源计划 revision 已变化，请重新生成修订提案')
      }
      if (proposal.sourceFingerprint && planFingerprint(current) !== proposal.sourceFingerprint) {
        throw new AppError('CONFLICT', '计划内容/Agent 绑定/验收要求在提案后已变化，请重新生成修订提案')
      }
      if ((current.execution?.runIds.length ?? 0) !== proposal.sourceRunCount) {
        throw new AppError('CONFLICT', '提案后出现了新的 Run，不能应用过期修订')
      }
      if (current.execution?.status === 'running') {
        throw new AppError('CONFLICT', '计划正在执行；请先暂停，并等待活动 Run 结束或取消后再应用修订')
      }
      const active = current.createdTaskIds
        .map((taskId) => this.store.read.getActiveRunForTask(taskId))
        .filter(Boolean)
      if (active.length > 0) {
        throw new AppError('CONFLICT', '仍有活动 Run 引用旧 revision；请先取消或等待其结束，再应用修订')
      }
    }
    assertFresh(plan)
    if (!this.store.claimReplanProposal(proposalId)) {
      throw new AppError('CONFLICT', '该修订提案已被另一个进程应用或状态已变化')
    }
    let revised: PlanDraft
    try {
      // Re-read after the atomic claim: the source can change between the first
      // read and the claim (new Run/Task/Agent assignment).
      assertFresh(this.orchestration.getPlan(proposal.planId))
      revised = this.orchestration.revisePlan({
        planId: plan.id,
        goal: plan.goal,
        tasks: proposal.proposedTasks,
        assumptions: proposal.proposedAssumptions,
        risks: proposal.proposedRisks,
      })
    } catch (error) {
      this.store.updateReplanProposal({
        ...proposal,
        status: 'proposed',
        updatedAt: now(),
      })
      throw error
    }
    const timestamp = now()
    const next: ReplanProposal = {
      ...proposal,
      status: 'applied',
      decidedAt: timestamp,
      decidedReason:
        basis.kind === 'policy'
          ? `系统按现有执行授权范围自动应用修订：${basis.reasons.join('；')}`.slice(0, 4000)
          : basis.reasons.join('；') || '用户应用修订提案',
      appliedPlanId: revised.id,
      updatedAt: timestamp,
    }
    this.store.updateReplanProposal(next)
    this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.replanApplied, {
      proposalId,
      sourcePlanId: plan.id,
      sourceRevision: plan.revision,
      appliedPlanId: revised.id,
      revision: revised.revision,
      authorizedBy: basis.kind === 'policy' ? 'policy' : 'user',
      authorizationBasis: basis.reasons,
    })
    return { proposal: this.view(next), plan: revised }
  }

  reject(proposalId: string, reason = '用户拒绝修订提案'): ReplanProposalView {
    const proposal = this.store.read.getReplanProposal(proposalId)
    if (!proposal) throw new AppError('NOT_FOUND', '重规划提案不存在')
    if (proposal.status !== 'proposed') throw new AppError('CONFLICT', `重规划提案状态为 ${proposal.status}，不能拒绝`)
    const timestamp = now()
    const next: ReplanProposal = {
      ...proposal,
      status: 'rejected',
      decidedAt: timestamp,
      decidedReason: reason.slice(0, 4000),
      updatedAt: timestamp,
    }
    this.store.updateReplanProposal(next)
    this.store.appendEvent(proposal.projectId, proposal.planId, PROJECT_EVENT_TYPES.replanRejected, {
      proposalId,
      reason: next.decidedReason,
    })
    return this.view(next)
  }

  recover(): number {
    return this.store.recoverApplyingReplanProposals()
  }

  private assertTriggerFact(plan: PlanDraft, trigger: ReplanTrigger): void {
    const status = plan.execution?.status
    const error = plan.execution?.error ?? ''
    const failure = classifyExecutionFailure(error)
    if (trigger === 'retry_exhausted') {
      if (status !== 'failed' && !/重试|失败/.test(error)) {
        throw new AppError('CONFLICT', '当前没有重试耗尽的执行事实，不能以 retry_exhausted 触发重规划')
      }
      if (!failure.replan) {
        throw new AppError(
          'CONFLICT',
          `该重试失败属于 ${failure.class}（${failure.action}），不应通过修改 DAG 处理：${failure.reason}`,
        )
      }
    } else if (trigger === 'evidence_exhausted') {
      if (status !== 'paused' && status !== 'failed') {
        throw new AppError('CONFLICT', '当前计划没有暂停/失败证据，不能以 evidence_exhausted 触发重规划')
      }
    } else if (trigger === 'quality_gate_failed') {
      if (!/质量门禁/.test(error)) {
        throw new AppError('CONFLICT', '当前执行事实没有质量门禁失败，不能使用该触发原因')
      }
    } else if (trigger === 'agent_unavailable') {
      if (!plan.tasks.some((task) => task.assignmentBlocked) && !/Agent|Runtime|不可用/.test(error)) {
        throw new AppError('CONFLICT', '当前没有 Agent/Runtime 不可用事实')
      }
    } else if (trigger === 'artifact_invalid') {
      if (!/Artifact|artifact|产物|证据/.test(error) && status !== 'paused') {
        throw new AppError('CONFLICT', '当前没有 Artifact 无效的执行事实')
      }
    }
  }

  private buildDiff(plan: PlanDraft, nextTasks: PlannedTask[]): RevisionDiff {
    const sourceOrdered = topologicalPlanTasks(plan)
    const sourceByKey = new Map(sourceOrdered.map((task) => [task.key, task]))
    const nextByKey = new Map(nextTasks.map((task) => [task.key, task]))
    const sourceTaskIdByKey = new Map<string, string>()
    sourceOrdered.forEach((task, index) => {
      const taskId = plan.createdTaskIds[index]
      if (taskId) sourceTaskIdByKey.set(task.key, taskId)
    })
    const kept: RevisionDiff['kept'] = []
    const added: RevisionDiff['added'] = []
    const removed: RevisionDiff['removed'] = []
    const modified: RevisionDiff['modified'] = []
    const dependencyChanges: RevisionDiff['dependencyChanges'] = []
    const agentChanges: RevisionDiff['agentChanges'] = []
    const acceptanceChanges: RevisionDiff['acceptanceChanges'] = []
    const reusableArtifacts: RevisionDiff['reusableArtifacts'] = []
    const revalidate: RevisionDiff['revalidate'] = []
    const same = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify(a) === JSON.stringify(b)
    const requirementText = (values: readonly string[]): string =>
      values.map((value) => value.trim()).join('；').replace(/\s+/g, ' ').trim()
    const sameRequirements = (a: readonly string[], b: readonly string[]): boolean =>
      requirementText(a) === requirementText(b)
    for (const task of nextTasks) {
      const old = sourceByKey.get(task.key)
      if (!old) {
        added.push({ key: task.key, title: task.title, role: task.role })
        continue
      }
      kept.push({ key: task.key, title: task.title })
      const fields: string[] = []
      if (old.title !== task.title) fields.push('title')
      if (old.description !== task.description) fields.push('description')
      if (old.role !== task.role) fields.push('role')
      if (!same(old.dependsOn, task.dependsOn)) {
        fields.push('dependsOn')
        dependencyChanges.push({ key: task.key, before: old.dependsOn, after: task.dependsOn })
      }
      if (!sameRequirements(old.acceptanceCriteria, task.acceptanceCriteria)) {
        fields.push('acceptanceCriteria')
        acceptanceChanges.push({ key: task.key, before: old.acceptanceCriteria, after: task.acceptanceCriteria })
      }
      if (!sameRequirements(old.expectedArtifacts, task.expectedArtifacts)) fields.push('expectedArtifacts')
      if (old.agentId !== task.agentId) {
        fields.push('agentId')
        agentChanges.push({
          key: task.key,
          beforeAgentId: old.agentId ?? null,
          afterAgentId: task.agentId ?? null,
          beforeAgentName: old.agentId ? this.store.read.getAgent(old.agentId)?.name ?? null : null,
          afterAgentName: task.agentId ? this.store.read.getAgent(task.agentId)?.name ?? null : null,
        })
      }
      if (fields.length > 0) modified.push({ key: task.key, fields })
      const sourceTaskId = sourceTaskIdByKey.get(task.key)
      if (!sourceTaskId) continue
      const sourceTask = this.store.read.getTask(sourceTaskId)
      const artifacts = this.store.read.listArtifacts(plan.projectId, sourceTaskId)
      const requirementsUnchanged =
        sameRequirements(old.acceptanceCriteria, task.acceptanceCriteria) &&
        sameRequirements(old.expectedArtifacts, task.expectedArtifacts) &&
        old.role === task.role
      if (sourceTask?.status === 'done' && requirementsUnchanged) {
        reusableArtifacts.push({
          taskKey: task.key,
          sourceTaskId,
          artifactIds: artifacts.map((artifact) => artifact.id),
          artifactTitles: artifacts.map((artifact) => artifact.title),
        })
      } else if (artifacts.some((artifact) => artifact.verifiedAt !== null) && !requirementsUnchanged) {
        revalidate.push({
          taskKey: task.key,
          sourceTaskId,
          reason: '验收标准或预期产物发生变化，旧 Artifact 不能直接作为新证据',
          artifactIds: artifacts.filter((artifact) => artifact.verifiedAt !== null).map((artifact) => artifact.id),
        })
      }
    }
    for (const old of sourceOrdered) {
      if (nextByKey.has(old.key)) continue
      const sourceTaskId = sourceTaskIdByKey.get(old.key) ?? null
      const sourceTask = sourceTaskId ? this.store.read.getTask(sourceTaskId) : null
      removed.push({
        key: old.key,
        title: old.title,
        sourceTaskId,
        sourceStatus: sourceTask?.status ?? null,
      })
      if (sourceTaskId) {
        const artifacts = this.store.read.listArtifacts(plan.projectId, sourceTaskId).filter((artifact) => artifact.verifiedAt !== null)
        if (artifacts.length > 0) {
          revalidate.push({
            taskKey: old.key,
            sourceTaskId,
            reason: '任务被移除，但已有已验证 Artifact；需人工确认是否仍需保留',
            artifactIds: artifacts.map((artifact) => artifact.id),
          })
        }
      }
    }
    return { kept, added, removed, modified, dependencyChanges, agentChanges, acceptanceChanges, reusableArtifacts, revalidate }
  }

  private buildGrantImpact(
    plan: PlanDraft,
    nextTasks: PlannedTask[],
    diff: RevisionDiff,
    grant: PlanExecutionGrantView | null,
  ): ReplanGrantImpact {
    const oldAgents = new Set(grant?.allowedAgentIds ?? [])
    const newAgents = [
      ...new Set(
        nextTasks
          .map((task) => task.agentId)
          .filter((id): id is string => typeof id === 'string' && !oldAgents.has(id)),
      ),
    ].map((agentId) => ({ agentId, name: this.store.read.getAgent(agentId)?.name ?? agentId }))
    const nextAgents = new Set(nextTasks.map((task) => task.agentId).filter(Boolean))
    const removedAgents = [...oldAgents]
      .filter((agentId) => !nextAgents.has(agentId))
      .map((agentId) => ({ agentId, name: this.store.read.getAgent(agentId)?.name ?? agentId }))
    const expanded: string[] = []
    if (!grant) expanded.push('原计划没有有效授权')
    if (grant && !grant.valid) expanded.push('原授权已失效/撤销/过期')
    if (newAgents.length > 0) expanded.push(`新增 Agent：${newAgents.map((agent) => agent.name).join(', ')}`)
    if (diff.added.length > 0) expanded.push(`新增任务：${diff.added.map((task) => task.key).join(', ')}`)
    if (diff.acceptanceChanges.length > 0) expanded.push('验收标准发生变化，需重新验证')
    if (diff.modified.some((item) => item.fields.includes('role'))) expanded.push('任务角色/能力要求发生变化')
    const withinOriginalScope =
      Boolean(grant?.valid) &&
      newAgents.length === 0 &&
      diff.added.length === 0 &&
      !diff.modified.some((item) => item.fields.includes('role'))
    const reasons = [
      'revision 发生变化，PlanGrant 绑定的是旧 revision/fingerprint，不能直接继承',
      ...(newAgents.length ? ['新 Agent 不在旧授权 allowedAgentIds 内'] : []),
      ...(diff.added.length ? ['新增任务不在旧授权 allowedTaskIds 内'] : []),
      ...(grant?.valid ? [] : ['旧授权不可用']),
    ]
    return {
      oldGrantId: grant?.id ?? null,
      oldGrantStatus: grant?.status ?? null,
      oldGrantValid: Boolean(grant?.valid),
      requiresNewGrant: true,
      withinOriginalScope,
      expanded,
      newAgents,
      removedAgents,
      newTasks: diff.added.map((task) => task.key),
      removedTasks: diff.removed.map((task) => task.key),
      reasons,
    }
  }

  private view(proposal: ReplanProposal): ReplanProposalView {
    const source = this.store.read.getPlanRevision(proposal.planId)
    const applied = proposal.appliedPlanId ? this.store.read.getPlanRevision(proposal.appliedPlanId) : null
    const blockedReasons: string[] = []
    if (proposal.status === 'proposed' && !source) blockedReasons.push('源计划不存在')
    if (proposal.status === 'proposed' && source && source.revision !== proposal.sourceRevision) blockedReasons.push('源计划 revision 已变化')
    if (proposal.status === 'proposed' && source?.execution?.status === 'running') blockedReasons.push('计划正在执行，需先暂停')
    if (proposal.status === 'proposed' && source?.tasks.some((task) => task.assignmentBlocked)) {
      blockedReasons.push('修订计划仍有无法分配的 Agent')
    }
    return {
      ...proposal,
      sourcePlanStatus: source?.status ?? 'rejected',
      currentPlanStatus: source?.status ?? 'rejected',
      canApply: proposal.status === 'proposed' && blockedReasons.length === 0,
      blockedReasons,
      appliedRevision: applied?.revision ?? null,
    }
  }
}

function emptyDiff(): RevisionDiff {
  return {
    kept: [],
    added: [],
    removed: [],
    modified: [],
    dependencyChanges: [],
    agentChanges: [],
    acceptanceChanges: [],
    reusableArtifacts: [],
    revalidate: [],
  }
}

function emptyGrantImpact(): ReplanGrantImpact {
  return {
    oldGrantId: null,
    oldGrantStatus: null,
    oldGrantValid: false,
    requiresNewGrant: true,
    withinOriginalScope: false,
    expanded: [],
    newAgents: [],
    removedAgents: [],
    newTasks: [],
    removedTasks: [],
    reasons: [],
  }
}
