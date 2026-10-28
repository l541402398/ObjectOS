import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute, join, relative } from 'node:path'
import {
  AppError,
  newId,
  now,
  type PlanDraft,
  type PlanExecutionGrant,
  type PlanExecutionGrantIssueInput,
  type PlanExecutionGrantView,
  type PlanGrantActor,
} from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import { isProtectedPath, redactSecrets } from '@projectos/policy'
import { resolveWorkspacePath } from '@projectos/workspace'
import type { SqliteStore } from '@projectos/persistence'
import type { Logger } from './logger.js'

const LOCAL_USER: PlanGrantActor = { kind: 'user', id: 'local-user', name: '你' }
const SYSTEM_AUTOMATION: PlanGrantActor = { kind: 'system', id: 'automation', name: '自动化运营' }
const MIN_TTL_MS = 5 * 60 * 1000
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Paths that can never be covered by a plan grant. They retain the existing
 * per-call high-risk Approval. This intentionally mirrors the acceptance-risk
 * rule set rather than inventing a weaker grant path.
 */
const CRITICAL_GRANT_PATH_PATTERNS = [
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)(secrets?|credentials)(\/|\.|$)/i,
  /(^|\/)id_rsa(\.|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)(auth|authentication|permission|permissions|security|crypto)(\/|\.|$)/i,
  /(^|\/)(migrations?|schema)(\/|\.|$)/i,
  /(^|\/)package\.json$/i,
  /(^|\/)electron-builder\.ya?ml$/i,
  /(^|\/)\.github\/workflows\//i,
  /(^|\/)(\.pem|\.key|\.p12|\.pfx)$/i,
]

export function isCriticalGrantPath(path: string): boolean {
  return CRITICAL_GRANT_PATH_PATTERNS.some((pattern) => pattern.test(path.replace(/\\/g, '/')))
}

function pathKey(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '') || '.'
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isWithinAllowedPath(allowed: string, target: string): boolean {
  const a = pathKey(allowed)
  const t = pathKey(target)
  if (a === '.') return true
  return t === a || t.startsWith(`${a}/`)
}

/** Stable fingerprint of the exact approved revision content. */
export function planFingerprint(plan: PlanDraft): string {
  const payload = {
    id: plan.id,
    revision: plan.revision,
    goal: plan.goal,
    createdTaskIds: plan.createdTaskIds,
    tasks: plan.tasks.map((task) => ({
      key: task.key,
      title: task.title,
      description: task.description,
      role: task.role,
      agentId: task.agentId ?? null,
      assignmentMode: task.assignmentMode ?? null,
      hardCapabilities: task.hardCapabilities ?? [],
      requiredCapabilities: task.requiredCapabilities ?? [],
      dependsOn: task.dependsOn,
      acceptanceCriteria: task.acceptanceCriteria,
      expectedArtifacts: task.expectedArtifacts,
      requiresApproval: task.requiresApproval,
    })),
  }
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function normalizeAllowedPath(projectRoot: string, input: string): string {
  const raw = input.trim().replace(/\\/g, '/')
  if (!raw) throw new AppError('BAD_REQUEST', '授权路径不能为空')
  if (isAbsolute(raw) || /^[a-zA-Z]:/.test(raw)) {
    throw new AppError('BAD_REQUEST', `授权路径必须是项目内相对路径：${raw}`)
  }
  const segments = raw.split('/')
  if (segments.some((segment) => segment === '..')) {
    throw new AppError('BAD_REQUEST', `授权路径不能包含 ..：${raw}`)
  }
  let resolved: string
  try {
    resolved = resolveWorkspacePath(projectRoot, raw === '.' ? '.' : raw, { forWrite: true })
  } catch (error) {
    throw new AppError(
      'BAD_REQUEST',
      `授权路径不在项目工作区内：${raw}（${error instanceof Error ? error.message : String(error)}）`,
    )
  }
  const relativePath = relative(projectRoot, resolved).replace(/\\/g, '/') || '.'
  if (isProtectedPath(relativePath) || (relativePath !== '.' && isCriticalGrantPath(relativePath))) {
    throw new AppError(
      'APPROVAL_REQUIRED',
      `安全敏感路径不能纳入计划授权，必须逐次审批：${relativePath}`,
    )
  }
  return relativePath
}

function resolveGrantTarget(workspaceRoot: string, rawPath: string): string {
  const raw = rawPath.trim()
  if (!raw) throw new AppError('BAD_REQUEST', '写入路径不能为空')
  let resolved: string
  try {
    resolved = resolveWorkspacePath(workspaceRoot, raw, { forWrite: true })
  } catch (error) {
    throw new AppError(
      'POLICY_DENIED',
      `路径不在授权工作区内：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return relative(workspaceRoot, resolved).replace(/\\/g, '/') || '.'
}

export interface PlanToolGrantDecision {
  decision: 'allow' | 'approval' | 'deny'
  reason: string
  grantId?: string
}

export class PlanGrantService {
  constructor(
    private readonly store: SqliteStore,
    private readonly logger?: Pick<Logger, 'info' | 'warn'>,
  ) {}

  fingerprint(plan: PlanDraft): string {
    return planFingerprint(plan)
  }

  private planFor(planId: string): PlanDraft {
    const plan = this.store.read.getPlanRevision(planId)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    return plan
  }

  /** Resolves the approved plan that owns a task, if any. */
  private planForTask(projectId: string, taskId: string | null): PlanDraft | null {
    if (!taskId) return null
    const plans = this.store.read
      .listAllPlanRevisions()
      .filter((plan) => plan.projectId === projectId && plan.status === 'approved')
      .sort((a, b) => b.revision - a.revision)
    return plans.find((item) => item.createdTaskIds.includes(taskId)) ?? null
  }

  /**
   * Called after a human approves a process tool call: remembers that this exact
   * command is approved for this plan so identical repeats do not ask again.
   */
  recordApprovedCommandForTask(input: {
    projectId: string
    taskId: string | null
    agentId: string
    toolName: string
    command: string
    approvalId: string
    workspaceRoot?: string
  }): void {
    if (input.toolName !== 'run_command' && input.toolName !== 'run_tests') return
    const plan = this.planForTask(input.projectId, input.taskId)
    if (!plan) return
    if (!this.store.read.getLatestPlanExecutionGrant(plan.id)) return
    this.recordCommandApproval({
      projectId: input.projectId,
      planId: plan.id,
      agentId: input.agentId,
      toolName: input.toolName,
      command: input.command,
      approvalId: input.approvalId,
      workspaceRoot: input.workspaceRoot,
    })
  }

  /**
   * Fingerprint of what a command will actually execute, not just its text.
   *
   * An identical command string is not identical execution: `npm test` runs whatever
   * package.json says today, and `node x.mjs` runs whatever that file contains now. The
   * fingerprint covers the tool name, the command text, package.json and the entry file
   * (when one is named), so any change to those invalidates a previously granted reuse.
   */
  executionContextFingerprint(workspaceRoot: string, toolName: string, command: string): string | null {
    const parts = [toolName, command.trim()]
    const pkgPath = join(workspaceRoot, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        parts.push(`package.json:${createHash('sha256').update(readFileSync(pkgPath)).digest('hex')}`)
      } catch {
        // An unreadable context file means we cannot prove what would run: return
        // "unverifiable" instead of a partial fingerprint that silently falls back to
        // command-string-only matching.
        return null
      }
    }
    // `node <entry>` / `node --test <entry>`: include the entry file content.
    const entry = /^node\s+(?:--test\s+)?(?!--)(\S+)/.exec(command.trim())
    const entryPath = entry?.[1]
    if (entryPath) {
      const target = isAbsolute(entryPath) ? entryPath : join(workspaceRoot, entryPath)
      if (existsSync(target)) {
        try {
          parts.push(`entry:${createHash('sha256').update(readFileSync(target)).digest('hex')}`)
        } catch {
          return null
        }
      }
    }
    // `npm test` / `pnpm run x`: what actually runs is the package.json script body, plus
    // any local files it references. The approval is bound to that, not to the command text.
    const scriptMatch = /^(?:npm|pnpm|yarn)\s+(?:run(?:-script)?\s+)?([\w:.-]+)/.exec(command.trim())
    const scriptName = scriptMatch?.[1] ?? null
    if (scriptName) {
      try {
        const pkg = existsSync(pkgPath)
          ? (JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> })
          : null
        const body = pkg?.scripts?.[scriptName]
        if (typeof body === 'string') {
          parts.push(`script:${scriptName}:${body}`)
          for (const token of body.split(/\s+/)) {
            const candidate = token.replace(/^['"]|['"]$/g, '')
            if (!/\.(mjs|cjs|js|ts|json|sh|ps1)$/i.test(candidate) || candidate.includes('*')) continue
            const file = isAbsolute(candidate) ? candidate : join(workspaceRoot, candidate)
            if (!existsSync(file)) continue
            try {
              parts.push(`scriptFile:${candidate}:${createHash('sha256').update(readFileSync(file)).digest('hex')}`)
            } catch {
              return null
            }
          }
        }
      } catch {
        return null
      }
    }
    return createHash('sha256').update(parts.join('\u0000')).digest('hex')
  }

  /**
   * Records that a human approved a specific command for a plan. Later identical calls
   * (same plan/agent/tool/normalized command) reuse it until it expires.
   */
  recordCommandApproval(input: {
    projectId: string
    planId: string
    agentId: string
    toolName: string
    command: string
    approvalId: string
    workspaceRoot?: string
    ttlMs?: number
  }): void {
    const command = input.command.trim()
    if (!command) return
    const hash = createHash('sha256').update(command).digest('hex')
    const context = input.workspaceRoot
      ? this.executionContextFingerprint(input.workspaceRoot, input.toolName, command)
      : null
    const timestamp = now()
    const ttl = Math.max(60_000, Math.min(input.ttlMs ?? 30 * 60_000, 8 * 60 * 60_000))
    this.store.db
      .prepare(
        `INSERT INTO plan_command_approvals
         (id, project_id, plan_id, agent_id, tool_name, command_hash, command_text, approval_id, uses, created_at, expires_at, context_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
         ON CONFLICT(plan_id, agent_id, tool_name, command_hash)
         DO UPDATE SET approval_id=excluded.approval_id, expires_at=excluded.expires_at, context_hash=excluded.context_hash`,
      )
      .run(newId('pca'), input.projectId, input.planId, input.agentId, input.toolName, hash, command.slice(0, 4000), input.approvalId, timestamp, timestamp + ttl, context)
  }

  private commandApproval(
    planId: string,
    agentId: string,
    toolName: string,
    command: string,
    workspaceRoot?: string,
  ): { id: string; approval_id: string | null } | null {
    const hash = createHash('sha256').update(command.trim()).digest('hex')
    const row = this.store.db
      .prepare(
        `SELECT id, approval_id, context_hash FROM plan_command_approvals
         WHERE plan_id=? AND agent_id=? AND tool_name=? AND command_hash=? AND expires_at > ?`,
      )
      .get(planId, agentId, toolName, hash, now()) as { id: string; approval_id: string | null; context_hash: string | null } | undefined
    if (!row) return null
    // Fail closed: reuse is only allowed when the execution context can be proven
    // unchanged. Without a recorded fingerprint, or without a workspace to re-derive it,
    // we cannot prove it, so the human is asked again instead of silently reusing.
    if (!workspaceRoot || !row.context_hash) {
      this.store.db.prepare('DELETE FROM plan_command_approvals WHERE id=?').run(row.id)
      return null
    }
    const current = this.executionContextFingerprint(workspaceRoot, toolName, command)
    if (row.context_hash !== current) {
      // A changed package.json script or entry file means the approved command is not the
      // command that would run now.
      this.store.db.prepare('DELETE FROM plan_command_approvals WHERE id=?').run(row.id)
      return null
    }
    return row
  }

  private consumeCommandApproval(id: string): void {
    this.store.db.prepare('UPDATE plan_command_approvals SET uses=uses+1 WHERE id=?').run(id)
  }

  private currentAgents(plan: PlanDraft): Map<string, string | null> {
    const result = new Map<string, string | null>()
    for (const taskId of plan.createdTaskIds) {
      result.set(taskId, this.store.read.getTaskCard(taskId)?.assigneeAgentId ?? null)
    }
    return result
  }

  private view(grant: PlanExecutionGrant, plan: PlanDraft): PlanExecutionGrantView {
    const reasons: string[] = []
    let status: PlanExecutionGrantView['status'] = 'active'
    if (grant.revokedAt !== null) status = 'revoked'
    else if (grant.expiresAt <= now()) status = 'expired'
    else if (grant.usedToolCalls >= grant.maxToolCalls) status = 'exhausted'

    if (status === 'revoked') reasons.push(`授权已撤销：${grant.revokedReason ?? '未填写原因'}`)
    if (status === 'expired') reasons.push('授权已过期')
    if (status === 'exhausted') reasons.push('授权工具调用次数已用尽')
    if (plan.status !== 'approved') reasons.push(`计划状态为 ${plan.status}，不是 approved`)
    if (plan.id !== grant.planId) reasons.push('授权绑定的计划 revision 不一致')
    if (plan.revision !== grant.planRevision) reasons.push('计划 revision 已变化')
    const fingerprint = planFingerprint(plan)
    if (fingerprint !== grant.planFingerprint) reasons.push('计划内容指纹已变化')
    const missingTasks = plan.createdTaskIds.filter((taskId) => !grant.allowedTaskIds.includes(taskId))
    if (missingTasks.length > 0) reasons.push(`授权未覆盖 ${missingTasks.length} 个任务`)
    const extraTasks = grant.allowedTaskIds.filter((taskId) => !plan.createdTaskIds.includes(taskId))
    if (extraTasks.length > 0) reasons.push('授权包含不属于当前计划的过期任务')

    for (const [taskId, agentId] of this.currentAgents(plan)) {
      if (!agentId) {
        reasons.push(`任务 ${taskId} 当前没有分配 Agent`)
        continue
      }
      if (!grant.allowedAgentIds.includes(agentId)) {
        reasons.push(`任务 ${taskId} 当前执行 Agent ${agentId} 不在授权范围（可能已重新分配）`)
      }
    }
    const canStart =
      status === 'active' &&
      reasons.length === 0 &&
      grant.usedRuns + grant.reservedRuns < grant.maxRuns &&
      (!plan.execution || ['failed', 'cancelled'].includes(plan.execution.status))
    return {
      ...grant,
      status,
      valid: status === 'active' && reasons.length === 0,
      invalidReasons: [...new Set(reasons)],
      canStart,
      planStatus: plan.status,
      planGoal: plan.goal,
    }
  }

  get(planId: string): PlanExecutionGrantView | null {
    const plan = this.store.read.getPlanRevision(planId)
    if (!plan) throw new AppError('NOT_FOUND', '计划不存在')
    const grant = this.store.read.getLatestPlanExecutionGrant(planId)
    return grant ? this.view(grant, plan) : null
  }

  getById(grantId: string): PlanExecutionGrantView {
    const grant = this.store.read.getPlanExecutionGrant(grantId)
    if (!grant) throw new AppError('NOT_FOUND', '计划执行授权不存在')
    return this.view(grant, this.planFor(grant.planId))
  }

  issue(input: PlanExecutionGrantIssueInput): PlanExecutionGrantView {
    const plan = this.planFor(input.planId)
    return this.issueForPlan(plan, input, LOCAL_USER)
  }

  /**
   * Internal repair plans are already covered by the existing automation grant
   * and proposal approval. This creates an explicit, auditable plan grant so the
   * scheduler and ToolHandler use the same authorization path as user plans.
   */
  issueForAutomationRepair(plan: PlanDraft, automationRunId: string): PlanExecutionGrantView {
    if (plan.createdTaskIds.length === 0) throw new AppError('CONFLICT', '修复计划没有已创建的任务')
    return this.issueForPlan(
      plan,
      {
        planId: plan.id,
        actions: ['plan.start', 'workspace-write'],
        allowedPaths: ['.'],
        maxRuns: 1,
        maxToolCalls: 100,
        ttlHours: 1,
        allowOverBudget: false,
        note: `由自动化运营授权派生（automation run ${automationRunId}）`,
        confirm: true,
      },
      SYSTEM_AUTOMATION,
    )
  }

  private issueForPlan(
    plan: PlanDraft,
    input: PlanExecutionGrantIssueInput,
    actor: PlanGrantActor,
  ): PlanExecutionGrantView {
    if (plan.status !== 'approved') {
      throw new AppError('APPROVAL_REQUIRED', '只有已批准的计划可以授予执行权限；批准计划本身不等于执行授权')
    }
    if (plan.createdTaskIds.length === 0) {
      throw new AppError('CONFLICT', '计划尚未创建任务，不能授予执行权限')
    }
    if (plan.execution?.status === 'running') {
      throw new AppError('CONFLICT', '计划正在执行中；如需变更授权，请先暂停并撤销旧授权')
    }
    if (!input.actions.includes('plan.start')) {
      throw new AppError('BAD_REQUEST', '计划执行授权必须包含 plan.start')
    }
    const project = this.store.read.getProject(plan.projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')

    const allowedPaths =
      input.actions.includes('workspace-write')
        ? [...new Set(input.allowedPaths.map((path) => normalizeAllowedPath(project.rootPath, path)))]
        : []
    if (input.actions.includes('workspace-write') && allowedPaths.length === 0) {
      throw new AppError('BAD_REQUEST', '启用 workspace-write 时必须至少选择一个项目内授权路径')
    }
    if (allowedPaths.some((path) => isCriticalGrantPath(path) || isProtectedPath(path))) {
      throw new AppError('APPROVAL_REQUIRED', '授权路径包含安全敏感位置，必须保持逐次审批')
    }

    const requestedTasks = input.allowedTaskIds ? [...new Set(input.allowedTaskIds)] : [...plan.createdTaskIds]
    const allTasksCovered =
      requestedTasks.length === plan.createdTaskIds.length &&
      plan.createdTaskIds.every((taskId) => requestedTasks.includes(taskId))
    if (!allTasksCovered) {
      throw new AppError(
        'BAD_REQUEST',
        '本期计划授权必须覆盖该 plan revision 的全部任务；需要缩小范围请先创建新 revision',
      )
    }
    const currentAgents = this.currentAgents(plan)
    const currentAgentIds = [...new Set([...currentAgents.values()].filter((agentId): agentId is string => Boolean(agentId)))]
    const unassigned = [...currentAgents.entries()].filter(([, agentId]) => !agentId)
    if (unassigned.length > 0) {
      throw new AppError('CONFLICT', '计划仍有任务没有分配 Agent，请先补齐后再授权执行')
    }
    const requestedAgents = input.allowedAgentIds ? [...new Set(input.allowedAgentIds)] : currentAgentIds
    const agentsCovered =
      requestedAgents.length === currentAgentIds.length &&
      currentAgentIds.every((agentId) => requestedAgents.includes(agentId))
    if (!agentsCovered) {
      throw new AppError(
        'BAD_REQUEST',
        '授权必须覆盖计划当前全部分配 Agent；任务重新分配后需要重新授权',
      )
    }
    if (input.allowOverBudget && input.note.trim().length < 8) {
      throw new AppError('BAD_REQUEST', '允许超出项目软预算时必须填写至少 8 个字符的说明')
    }

    const timestamp = now()
    const ttlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, input.ttlHours * 60 * 60 * 1000))
    const grant: PlanExecutionGrant = {
      id: newId('pgr'),
      projectId: plan.projectId,
      planId: plan.id,
      planRevision: plan.revision,
      planFingerprint: planFingerprint(plan),
      actor,
      actions: input.actions,
      allowedPaths,
      allowedTaskIds: [...plan.createdTaskIds],
      allowedAgentIds: currentAgentIds,
      maxRuns: input.maxRuns,
      usedRuns: 0,
      reservedRuns: 0,
      maxToolCalls: input.maxToolCalls,
      usedToolCalls: 0,
      allowOverBudget: input.allowOverBudget,
      note: input.note.trim(),
      issuedAt: timestamp,
      expiresAt: timestamp + ttlMs,
      revokedAt: null,
      revokedReason: null,
      lastUsedAt: null,
    }
    this.store.transaction(() => {
      this.store.revokeActivePlanExecutionGrants(plan.id, '被新的计划执行授权替换', timestamp)
      this.store.createPlanExecutionGrant(grant)
      this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planGrantIssued, {
        grantId: grant.id,
        planId: plan.id,
        revision: plan.revision,
        actor,
        actions: grant.actions,
        allowedPaths: grant.allowedPaths,
        allowedTaskIds: grant.allowedTaskIds,
        allowedAgentIds: grant.allowedAgentIds,
        maxRuns: grant.maxRuns,
        maxToolCalls: grant.maxToolCalls,
        expiresAt: grant.expiresAt,
        allowOverBudget: grant.allowOverBudget,
        note: grant.note,
      })
    })
    this.logger?.info(
      { grantId: grant.id, planId: plan.id, actions: grant.actions, paths: grant.allowedPaths },
      'plan execution grant issued',
    )
    return this.view(grant, plan)
  }

  revoke(grantId: string, reason: string): PlanExecutionGrantView {
    const grant = this.store.read.getPlanExecutionGrant(grantId)
    if (!grant) throw new AppError('NOT_FOUND', '计划执行授权不存在')
    if (grant.revokedAt === null) {
      const timestamp = now()
      this.store.transaction(() => {
        this.store.revokePlanExecutionGrant(grantId, reason, timestamp)
        this.store.appendEvent(grant.projectId, grant.planId, PROJECT_EVENT_TYPES.planGrantRevoked, {
          grantId,
          planId: grant.planId,
          revision: grant.planRevision,
          reason: redactSecrets(reason).slice(0, 2000),
          actor: LOCAL_USER,
        })
      })
      this.logger?.info({ grantId, planId: grant.planId }, 'plan execution grant revoked')
    }
    return this.getById(grantId)
  }

  /** Start requires an active, unconsumed grant; it never relies on UI state. */
  assertStartAllowed(plan: PlanDraft, grantId?: string | null): PlanExecutionGrantView {
    const grant = grantId
      ? this.store.read.getPlanExecutionGrant(grantId)
      : this.store.read.getLatestPlanExecutionGrant(plan.id)
    if (!grant) {
      throw new AppError(
        'APPROVAL_REQUIRED',
        '计划已批准，但尚未授予执行权限。请先设置计划执行授权（授权范围、路径、任务/Agent、有效期与上限）。',
      )
    }
    const view = this.view(grant, plan)
    if (!view.valid) {
      throw new AppError('APPROVAL_REQUIRED', `计划执行授权无效：${view.invalidReasons.join('；')}`)
    }
    if (view.status !== 'active') {
      throw new AppError('APPROVAL_REQUIRED', `计划执行授权状态为 ${view.status}，不能开始执行`)
    }
    if (view.usedRuns + view.reservedRuns >= view.maxRuns) {
      throw new AppError('APPROVAL_REQUIRED', '计划执行授权的启动次数已用尽或正在启动，请稍后重试或重新授权')
    }
    if (plan.execution?.status === 'running' || plan.execution?.status === 'paused') {
      throw new AppError('CONFLICT', '计划已经在执行中或暂停中；请使用继续执行')
    }
    if (plan.execution?.status === 'completed') {
      throw new AppError('CONFLICT', '计划已完成；如需新的执行范围，请创建新 revision 并重新授权')
    }
    return view
  }

  /** A running plan may continue only while its grant remains valid. */
  assertExecutionActive(plan: PlanDraft): PlanExecutionGrantView {
    const grant = this.store.read.getLatestPlanExecutionGrant(plan.id)
    if (!grant) {
      throw new AppError('APPROVAL_REQUIRED', '计划没有有效的执行授权，已停止调度')
    }
    const view = this.view(grant, plan)
    if (!view.valid) {
      throw new AppError('APPROVAL_REQUIRED', `执行授权失效：${view.invalidReasons.join('；')}`)
    }
    return view
  }

  /**
   * Explicit user-confirmed Handoff replacement: extend the existing grant's
   * Agent scope by exactly the confirmed substitute and keep a durable audit
   * entry. This is never called for automatic/ambiguous reassignment.
   */
  amendAgentForConfirmedReassignment(
    planId: string,
    taskId: string,
    agentId: string,
  ): PlanExecutionGrantView | null {
    const plan = this.planFor(planId)
    const grant = this.store.read.getLatestPlanExecutionGrant(planId)
    if (!grant) return null
    // This method is called after the Task assignee changed to the confirmed
    // substitute, so a full `view()` would correctly report the old Agent scope
    // as stale. Validate the immutable grant/plan identity first, extend the
    // scoped Agent list, then let normal view() re-validate current assignments.
    const reasons: string[] = []
    if (grant.revokedAt !== null) reasons.push('授权已撤销')
    if (grant.expiresAt <= now()) reasons.push('授权已过期')
    if (plan.status !== 'approved') reasons.push(`计划状态为 ${plan.status}`)
    if (plan.id !== grant.planId || plan.revision !== grant.planRevision) reasons.push('计划 revision 不一致')
    if (planFingerprint(plan) !== grant.planFingerprint) reasons.push('计划内容指纹已变化')
    if (reasons.length > 0) {
      throw new AppError('APPROVAL_REQUIRED', `计划执行授权已失效，不能确认替代 Agent：${reasons.join('；')}`)
    }
    if (!grant.allowedTaskIds.includes(taskId)) {
      throw new AppError('CONFLICT', '任务不在计划执行授权范围内，不能确认替代 Agent')
    }
    if (grant.allowedAgentIds.includes(agentId)) return this.view(grant, plan)
    const nextAgents = [...grant.allowedAgentIds, agentId]
    const updated = this.store.updatePlanExecutionGrantAgentIds(grant.id, nextAgents)
    if (!updated) {
      throw new AppError('APPROVAL_REQUIRED', '计划执行授权已过期或撤销，不能确认替代 Agent')
    }
    this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planGrantAmended, {
      grantId: grant.id,
      planId: plan.id,
      revision: plan.revision,
      taskId,
      agentId,
      previousAgentIds: grant.allowedAgentIds,
      allowedAgentIds: nextAgents,
      actor: LOCAL_USER,
      reason: '用户显式确认 Handoff 替代 Agent，有限扩展授权 Agent 范围',
    })
    return this.getById(grant.id)
  }

  findStartReservation(grantId: string, idempotencyKey: string): ReturnType<SqliteStore['findPlanGrantStartReservation']> {
    return this.store.findPlanGrantStartReservation(grantId, idempotencyKey)
  }

  reserveStart(
    plan: PlanDraft,
    grant: PlanExecutionGrantView,
    idempotencyKey: string,
  ): ReturnType<SqliteStore['reservePlanExecutionGrantStart']> {
    const existing = this.store.findPlanGrantStartReservation(grant.id, idempotencyKey)
    if (existing?.status === 'failed') {
      throw new AppError('CONFLICT', '该启动请求上次失败，预留已释放；请使用新的启动请求重试')
    }
    const reservation = this.store.reservePlanExecutionGrantStart({
      grantId: grant.id,
      planId: plan.id,
      planRevision: plan.revision,
      planFingerprint: planFingerprint(plan),
      idempotencyKey,
    })
    if (!reservation) {
      throw new AppError(
        'APPROVAL_REQUIRED',
        '计划启动配额已被占用、授权已撤销/过期或与当前 revision 不一致；本次没有启动执行。',
      )
    }
    return reservation
  }

  markStartSucceeded(reservationId: string, plan: PlanDraft): void {
    const runIds = plan.execution?.runIds ?? []
    this.store.markPlanGrantStartSucceeded(reservationId, runIds)
  }

  markStartFailed(reservationId: string, error: string): void {
    this.store.markPlanGrantStartFailed(reservationId, error)
  }

  /**
   * Settle a start that threw. If the scheduler persisted a live execution or a
   * Run exists, the start really happened (consume). A workspace/setup failure
   * that left only a failed execution with no Run releases the reservation.
   */
  settleStartFailure(reservationId: string, planId: string, error: string): 'started' | 'released' {
    const plan = this.store.read.getPlanRevision(planId)
    const execution = plan?.execution
    const hasRun = plan
      ? this.store.read
          .listRunSummaries(plan.projectId, 500)
          .some((run) => plan.createdTaskIds.includes(run.taskId ?? ''))
      : false
    const sideEffect =
      hasRun ||
      execution?.status === 'running' ||
      execution?.status === 'paused' ||
      execution?.status === 'completed' ||
      (execution?.runIds.length ?? 0) > 0
    if (sideEffect) {
      this.store.markPlanGrantStartSucceeded(reservationId, execution?.runIds ?? [])
      return 'started'
    }
    this.store.markPlanGrantStartFailed(reservationId, error)
    return 'released'
  }

  /**
   * Recovery is deliberately conservative: a stale reservation is converted to
   * success only when the plan has a real execution/run. Otherwise it is
   * released. It never blindly decrements a global counter.
   */
  recoverStartReservations(maxAgeMs = 5 * 60 * 1000): { started: number; released: number } {
    const stale = this.store.listStalePlanGrantStartReservations(now() - Math.max(30_000, maxAgeMs))
    let started = 0
    let released = 0
    for (const reservation of stale) {
      const plan = this.store.read.getPlanRevision(reservation.planId)
      const hasRuns = Boolean(
        plan &&
          this.store.read
            .listRunSummaries(plan.projectId, 500)
            .some((run) => plan.createdTaskIds.includes(run.taskId ?? '')),
      )
      const executionSideEffect =
        plan?.execution?.status === 'running' ||
        plan?.execution?.status === 'paused' ||
        plan?.execution?.status === 'completed'
      if (plan && (hasRuns || executionSideEffect || (plan.execution?.runIds.length ?? 0) > 0)) {
        if (this.store.markPlanGrantStartSucceeded(reservation.id, plan.execution?.runIds ?? [])) started += 1
      } else if (this.store.markPlanGrantStartFailed(reservation.id, '启动未完成，恢复时释放预留')) {
        released += 1
      }
    }
    return { started, released }
  }

  /** @deprecated production starts use reserveStart + markStartSucceeded/Failed. */
  consumeStart(grant: PlanExecutionGrantView, plan: PlanDraft): void {
    const consumed = this.store.consumePlanExecutionGrantStart(
      grant.id,
      plan.id,
      plan.revision,
      planFingerprint(plan),
    )
    if (!consumed) {
      throw new AppError('APPROVAL_REQUIRED', '计划执行授权已过期、撤销、用尽或与当前 revision 不一致')
    }
  }

  /**
   * Called by AgentRunner after PolicyEngine. It can only turn a
   * `require_approval` write into an allowed write; it never overrides deny or
   * process/git/external Runtime approvals.
   */
  authorizeToolCall(input: {
    projectId: string
    workspaceRoot: string
    taskId: string | null
    runId: string
    agentId: string
    toolName: string
    toolCallId: string
    args: Record<string, unknown>
  }): PlanToolGrantDecision {
    const plans = this.store.read
      .listAllPlanRevisions()
      .filter((plan) => plan.projectId === input.projectId && plan.status === 'approved')
      .sort((a, b) => b.revision - a.revision)
    const plan = input.taskId ? plans.find((item) => item.createdTaskIds.includes(input.taskId!)) ?? null : null
    if (!plan) {
      return { decision: 'approval', reason: '没有可关联的已批准计划，按工具策略逐次审批' }
    }
    const grant = this.store.read.getLatestPlanExecutionGrant(plan.id)
    if (!grant) {
      return { decision: 'approval', reason: '计划没有执行授权，按工具策略逐次审批' }
    }
    const view = this.view(grant, plan)
    // Once a grant exists, a revoked/expired/revision-mismatched grant stops all
    // side-effect tools, not only write_file. Process/Git/Runtime actions never
    // become grant-covered, but they must not be re-approved after revocation.
    if (!view.valid) {
      return { decision: 'deny', reason: `计划执行授权无效：${view.invalidReasons.join('；')}`, grantId: grant.id }
    }
    if (view.status !== 'active') {
      return { decision: 'deny', reason: `计划执行授权状态为 ${statusText(view.status)}，已停止新的副作用`, grantId: grant.id }
    }
    if (input.toolName !== 'write_file') {
      // Process tools are never covered by the grant itself. A human may, however, have
      // already approved this exact command inside this plan: re-asking for the same
      // `npm test` five times is product friction, not safety. Reuse is keyed on the
      // exact normalized command plus plan/agent/tool and a short TTL, so any change to
      // the command needs a fresh decision.
      const command = typeof input.args.command === 'string' ? input.args.command.trim() : ''
      if (command && (input.toolName === 'run_command' || input.toolName === 'run_tests')) {
        const reused = this.commandApproval(plan.id, input.agentId, input.toolName, command, input.workspaceRoot)
        if (reused) {
          this.consumeCommandApproval(reused.id)
          return {
            decision: 'allow',
            reason: `复用该计划内已批准的完全相同命令（审批 ${reused.approval_id ?? 'n/a'}，剩余有效期内）`,
            grantId: grant.id,
          }
        }
      }
      return {
        decision: 'approval',
        reason: '计划授权不覆盖进程、Git 写或外部 Runtime 操作，需逐次审批',
        grantId: grant.id,
      }
    }
    if (!view.actions.includes('workspace-write')) {
      return { decision: 'approval', reason: '计划授权未包含 workspace-write，按工具策略逐次审批', grantId: grant.id }
    }
    const taskId = input.taskId ?? ''
    if (!taskId || !view.allowedTaskIds.includes(taskId)) {
      return { decision: 'deny', reason: '任务不在计划执行授权范围内', grantId: grant.id }
    }
    if (!view.allowedAgentIds.includes(input.agentId)) {
      return { decision: 'deny', reason: '当前 Agent 不在计划执行授权范围内（可能已重新分配）', grantId: grant.id }
    }
    const card = this.store.read.getTaskCard(taskId)
    if (!card || card.assigneeAgentId !== input.agentId) {
      return { decision: 'deny', reason: '任务当前执行 Agent 与授权不一致，已停止写入', grantId: grant.id }
    }
    const rawPath = typeof input.args.path === 'string' ? input.args.path : ''
    if (!rawPath) {
      return { decision: 'approval', reason: '写入路径缺失，按工具策略逐次审批', grantId: grant.id }
    }
    let target: string
    try {
      target = resolveGrantTarget(input.workspaceRoot, rawPath)
    } catch (error) {
      return {
        decision: 'deny',
        reason: error instanceof Error ? error.message : '写入路径不在授权工作区内',
        grantId: grant.id,
      }
    }
    if (isCriticalGrantPath(target)) {
      return {
        decision: 'approval',
        reason: `安全敏感路径 ${target} 不纳入计划授权，必须逐次审批`,
        grantId: grant.id,
      }
    }
    if (!view.allowedPaths.some((allowed) => isWithinAllowedPath(allowed, target))) {
      return {
        decision: 'deny',
        reason: `路径 ${target} 不在计划授权路径范围内：${view.allowedPaths.join(', ') || '无'}`,
        grantId: grant.id,
      }
    }
    const consumed = this.store.consumePlanExecutionGrantToolCall(grant.id)
    if (!consumed) {
      return {
        decision: 'deny',
        reason: '计划执行授权的工具调用次数已用尽、已过期或已撤销',
        grantId: grant.id,
      }
    }
    this.store.appendEvent(plan.projectId, plan.id, PROJECT_EVENT_TYPES.planGrantConsumed, {
      grantId: grant.id,
      planId: plan.id,
      taskId,
      runId: input.runId,
      toolCallId: input.toolCallId,
      agentId: input.agentId,
      toolName: input.toolName,
      path: target,
    })
    return {
      decision: 'allow',
      reason: `在计划授权路径 ${target} 内执行 workspace-write`,
      grantId: grant.id,
    }
  }
}

function statusText(status: PlanExecutionGrantView['status']): string {
  if (status === 'revoked') return '已撤销'
  if (status === 'expired') return '已过期'
  if (status === 'exhausted') return '已用尽'
  return '有效'
}
