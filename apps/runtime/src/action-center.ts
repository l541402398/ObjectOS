import type { SqliteStore } from '@projectos/persistence'
import type { LifecycleService } from './lifecycle.js'

/**
 * Unified Action Center.
 *
 * ProjectOS already persists every fact a human needs to act on (approvals,
 * approval requests, gate evaluations, task acceptance, deployment execution
 * state, failed runs). The product defect was that the UI asked the user to
 * navigate modules and guess what to do next, and that the notification bell
 * sent everything to the Agent chat page.
 *
 * This read model maps those existing facts into ONE actionable list with an
 * exact destination per item. It never writes business state and never
 * duplicates approval/status truth: every item carries the id of the real row.
 */

export type ActionKind =
  | 'tool_approval'
  | 'task_acceptance'
  | 'delivery_approval'
  | 'replan_scope'
  | 'plan_delivery'
  | 'version_gate'
  | 'deployment_reconciliation'
  | 'run_failure'

export type ActionRisk = 'low' | 'medium' | 'high'

export interface ActionItem {
  id: string
  kind: ActionKind
  projectId: string
  title: string
  reason: string
  /** The concrete decision the human must make. */
  requiredDecision: string
  /** What the system resumes once the decision lands. */
  resume: string
  risk: ActionRisk
  /** Exact in-app destination, query included. */
  route: string
  approvalId: string | null
  versionId: string | null
  runId: string | null
  taskId: string | null
  deploymentId: string | null
  /** Set for replan scope approvals so the UI can open the exact proposal. */
  proposalId?: string | null
  planId?: string | null
  createdAt: number
  /** True when the underlying object can no longer be acted on. */
  stale: boolean
}

export type ProjectAutonomyMode = 'assist' | 'autonomous' | 'managed'

export interface ProjectAutonomySettings {
  mode: ProjectAutonomyMode
  /** Phases that may advance without a human click when their gate passes. */
  autoAdvancePhases: string[]
  /**
   * ADR-0026 policies. Each one is an explicit user decision about how far the product may
   * go on its own; all default to the conservative value except the ones the product needs to
   * drive work at all.
   */
  /** Start an approved plan that already has an active execution grant. */
  autoStartPlans: boolean
  /** Apply a revision that stays inside the live grant envelope; never expands it. */
  autoApplyReplans: boolean
  /** Merge a completed plan's worktree without a click, when every delivery condition holds. */
  autoDeliver: boolean
  /** How many policy-authorized revisions a project may apply before a human must look. */
  maxAutoReplans: number
}

const AUTONOMY_KEY = (projectId: string): string => `autonomy.mode.${projectId}`

const DEFAULT_AUTONOMY: ProjectAutonomySettings = {
  // Autonomous by default: ProjectOS is meant to drive work. Only gate-passing
  // lifecycle hops advance on their own; production deploys, credential changes and
  // out-of-scope writes still require independent human authorization.
  mode: 'autonomous',
  // Only lifecycle hops that are already gate-protected are auto-advanced; external
  // deployment and credential operations are never in this list.
  autoAdvancePhases: ['discovery', 'build', 'verify', 'release_candidate'],
  // Starting work the user already approved and granted is the product's job.
  autoStartPlans: true,
  // Revisions are applied only inside the envelope the user granted (ADR-0026).
  autoApplyReplans: true,
  // Merging into the user's branch is a separate, higher-risk step: opt-in only.
  autoDeliver: false,
  maxAutoReplans: 3,
}

const PHASE_LABEL: Record<string, string> = {
  planned: '已计划', discovery: '需求/发现', build: '开发中', verify: '验证中',
  release_candidate: '候选发布', released: '已发布', maintenance: '维护中', retired: '已退役',
}

interface Row {
  [key: string]: unknown
}

/**
 * ADR-0041 — one explicit mapping from the policy API payload to the persisted update.
 *
 * A pure function so the transport layer cannot quietly forward a subset again; the dispatcher and
 * the test use exactly this.
 */
export function autonomyPolicyUpdate(input: {
  mode: ProjectAutonomyMode
  autoAdvancePhases?: string[]
  autoStartPlans?: boolean
  autoApplyReplans?: boolean
  autoDeliver?: boolean
  maxAutoReplans?: number
}): {
  mode: ProjectAutonomyMode
  autoAdvancePhases?: string[]
  autoStartPlans?: boolean
  autoApplyReplans?: boolean
  autoDeliver?: boolean
  maxAutoReplans?: number
} {
  return {
    mode: input.mode,
    ...(input.autoAdvancePhases !== undefined ? { autoAdvancePhases: input.autoAdvancePhases } : {}),
    ...(input.autoStartPlans !== undefined ? { autoStartPlans: input.autoStartPlans } : {}),
    ...(input.autoApplyReplans !== undefined ? { autoApplyReplans: input.autoApplyReplans } : {}),
    ...(input.autoDeliver !== undefined ? { autoDeliver: input.autoDeliver } : {}),
    ...(input.maxAutoReplans !== undefined ? { maxAutoReplans: input.maxAutoReplans } : {}),
  }
}

export class ActionCenter {
  constructor(
    private readonly store: SqliteStore,
    private readonly lifecycle: LifecycleService,
  ) {}

  autonomySettings(projectId: string): ProjectAutonomySettings {
    const row = this.store.db.prepare('SELECT value_json FROM app_settings WHERE key=?').get(AUTONOMY_KEY(projectId)) as { value_json: string } | undefined
    if (!row) return { ...DEFAULT_AUTONOMY }
    try {
      const parsed = JSON.parse(row.value_json) as Partial<ProjectAutonomySettings>
      const mode: ProjectAutonomyMode = parsed.mode === 'autonomous' || parsed.mode === 'managed' || parsed.mode === 'assist' ? parsed.mode : DEFAULT_AUTONOMY.mode
      return {
        mode,
        autoAdvancePhases: Array.isArray(parsed.autoAdvancePhases) ? parsed.autoAdvancePhases.filter((item): item is string => typeof item === 'string') : [...DEFAULT_AUTONOMY.autoAdvancePhases],
        autoStartPlans: parsed.autoStartPlans ?? DEFAULT_AUTONOMY.autoStartPlans,
        autoApplyReplans: parsed.autoApplyReplans ?? DEFAULT_AUTONOMY.autoApplyReplans,
        autoDeliver: parsed.autoDeliver ?? DEFAULT_AUTONOMY.autoDeliver,
        maxAutoReplans:
          typeof parsed.maxAutoReplans === 'number' && parsed.maxAutoReplans >= 0
            ? Math.min(10, Math.floor(parsed.maxAutoReplans))
            : DEFAULT_AUTONOMY.maxAutoReplans,
      }
    } catch {
      return { ...DEFAULT_AUTONOMY }
    }
  }

  setAutonomySettings(
    projectId: string,
    input: {
      mode: ProjectAutonomyMode
      autoAdvancePhases?: string[]
      autoStartPlans?: boolean
      autoApplyReplans?: boolean
      autoDeliver?: boolean
      maxAutoReplans?: number
    },
  ): ProjectAutonomySettings {
    const previous = this.autonomySettings(projectId)
    const next: ProjectAutonomySettings = {
      mode: input.mode,
      autoAdvancePhases: input.autoAdvancePhases ?? previous.autoAdvancePhases,
      autoStartPlans: input.autoStartPlans ?? previous.autoStartPlans,
      autoApplyReplans: input.autoApplyReplans ?? previous.autoApplyReplans,
      autoDeliver: input.autoDeliver ?? previous.autoDeliver,
      maxAutoReplans: input.maxAutoReplans ?? previous.maxAutoReplans,
    }
    this.store.db
      .prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at')
      .run(AUTONOMY_KEY(projectId), JSON.stringify(next), Date.now())
    // The policy itself is a business fact: record when it changes, so an autonomous action
    // can always be traced back to the policy that authorized it.
    try {
      this.store.appendEvent(projectId, projectId, 'project.autonomyPolicyChanged', {
        previous,
        next,
      })
    } catch {
      /* event logging must not break a settings write */
    }
    return next
  }

  /** Reads every open human action for a project, newest first per kind. */
  items(projectId: string): ActionItem[] {
    const now = Date.now()
    const items: ActionItem[] = []

    // 1) Tool approvals + task acceptance share the approvals table; the request
    //    marker tells them apart. Both must open the real approval with its diff.
    const approvals = this.store.db
      .prepare("SELECT * FROM approvals WHERE project_id=? AND status='pending' ORDER BY requested_at DESC")
      .all(projectId) as Row[]
    for (const row of approvals) {
      const request = this.parseJson(row.request_json)
      const kindMarker = typeof request.kind === 'string' ? request.kind : ''
      const toolName = typeof request.toolName === 'string' ? request.toolName : ''
      const expired = row.expires_at !== null && Number(row.expires_at) <= now
      if (kindMarker === 'task-acceptance') {
        const taskId = typeof request.taskId === 'string' ? request.taskId : null
        items.push({
          id: `task_acceptance:${String(row.id)}`,
          kind: 'task_acceptance',
          projectId,
          title: String(row.title || '任务等待验收'),
          reason: String(row.detail || '任务已提交验收，需要人工确认是否完成'),
          requiredDecision: '确认该任务的交付是否达到验收标准',
          resume: '验收通过后任务完成，依赖它的下游任务与其他无依赖任务继续执行',
          risk: 'medium',
          route: `/projects/${projectId}/approvals?approval=${encodeURIComponent(String(row.id))}`,
          approvalId: String(row.id),
          versionId: null, runId: row.run_id ? String(row.run_id) : null, taskId,
          deploymentId: null, createdAt: Number(row.requested_at), stale: expired,
        })
        continue
      }
      const highRisk = toolName === 'write_file' || toolName === 'run_command' || toolName === 'run_tests'
      items.push({
        id: `tool_approval:${String(row.id)}`,
        kind: 'tool_approval',
        projectId,
        title: String(row.title || `授权 ${toolName || '工具调用'}`),
        reason: String(row.detail || '高风险工具调用需要独立授权'),
        requiredDecision: `决定${toolName ? `是否允许执行 ${toolName}` : '是否授权该工具调用'}（包含文件 Diff 与作用范围）`,
        resume: '批准后该 Run 从暂停处自动继续，无需回到聊天页催促',
        risk: highRisk ? 'high' : 'medium',
        route: `/projects/${projectId}/approvals?approval=${encodeURIComponent(String(row.id))}`,
        approvalId: String(row.id),
        versionId: null, runId: row.run_id ? String(row.run_id) : null, taskId: null,
        deploymentId: null, createdAt: Number(row.requested_at), stale: expired,
      })
    }

    // 2) Delivery approvals (change request / deployment) come from approval_requests.
    const delivery = this.store.db
      .prepare("SELECT * FROM approval_requests WHERE project_id=? AND status='pending' ORDER BY requested_at DESC")
      .all(projectId) as Row[]
    for (const row of delivery) {
      const subjectType = String(row.subject_type)
      const subjectId = String(row.subject_id)
      let versionId: string | null = null
      let deploymentId: string | null = null
      let title = subjectType === 'change_request' ? '发布变更等待审批' : '部署等待独立审批'
      let reason = '需要独立的业务审批，批准后才能继续'
      let resume = '批准后可创建候选 / 登记 Release'
      if (subjectType === 'deployment') {
        const deployment = this.store.db.prepare('SELECT id, version_id, environment_id, target_id, status FROM deployments WHERE id=?').get(subjectId) as Row | undefined
        if (deployment) {
          versionId = deployment.version_id ? String(deployment.version_id) : null
          deploymentId = String(deployment.id)
          const target = deployment.target_id
            ? this.store.db.prepare('SELECT name FROM deployment_targets WHERE id=?').get(String(deployment.target_id)) as { name: string } | undefined
            : undefined
          title = `部署审批 · ${target?.name ?? '部署目标'}`
          reason = '部署会改变远端运行状态，必须独立审批后才能执行'
          resume = '批准后可在部署控制台执行，并由执行回执与远端 /health 共同确认'
        }
      } else {
        const change = this.store.db.prepare('SELECT title, version_id FROM change_requests WHERE id=?').get(subjectId) as Row | undefined
        if (change) {
          versionId = change.version_id ? String(change.version_id) : null
          title = `变更审批 · ${String(change.title ?? '')}`
          reason = '发布变更需要审批通过后才能冻结候选'
        }
      }
      const expired = row.expires_at !== null && Number(row.expires_at) <= now
      items.push({
        id: `delivery_approval:${String(row.id)}`,
        kind: 'delivery_approval',
        projectId, title, reason,
        requiredDecision: subjectType === 'deployment' ? '批准或拒绝该部署授权（目标、制品与凭据快照已绑定）' : '批准或拒绝该发布变更',
        resume,
        risk: subjectType === 'deployment' ? 'high' : 'medium',
        route: `/projects/${projectId}/approvals?approval=${encodeURIComponent(String(row.id))}&scope=delivery`,
        approvalId: String(row.id), versionId, runId: null, taskId: null, deploymentId,
        createdAt: Number(row.requested_at), stale: expired,
      })
    }

    // 3) Gate-blocked version phases: the system knows exactly what is missing.
    for (const blocked of this.lifecycle.blockedGates(projectId)) {
      items.push({
        id: `version_gate:${blocked.versionId}:${blocked.to}`,
        kind: 'version_gate',
        projectId,
        title: `版本 v${blocked.version} 无法进入${PHASE_LABEL[blocked.to] ?? blocked.to}`,
        reason: blocked.missing.join('；') || '门禁未通过',
        requiredDecision: `补齐门禁要求的证据后推进到${PHASE_LABEL[blocked.to] ?? blocked.to}`,
        resume: '门禁通过后可由系统自动推进，无需手动点击阶段按钮',
        risk: 'low',
        route: `/projects/${projectId}/versions?version=${encodeURIComponent(blocked.versionId)}`,
        approvalId: null, versionId: blocked.versionId, runId: null, taskId: null, deploymentId: null,
        createdAt: Date.now(), stale: false,
      })
    }

    // 4) Deployments whose outcome is unknown must be reconciled, never replayed.
    const deployments = this.store.db
      .prepare("SELECT * FROM deployments WHERE project_id=? AND status IN ('needs_reconciliation','unknown') ORDER BY updated_at DESC")
      .all(projectId) as Row[]
    for (const row of deployments) {
      const versionId = row.version_id ? String(row.version_id) : null
      items.push({
        id: `deployment_reconciliation:${String(row.id)}`,
        kind: 'deployment_reconciliation',
        projectId,
        title: '部署结果未知，需要核对远端事实',
        reason: String(row.notes || '远端副作用可能已生效，但本地没有收到确认'),
        requiredDecision: '发起远程对账，确认远端是否已在提供本次 Release',
        resume: '对账成功后部署按真实结果落定；不会自动重放远端操作',
        risk: 'high',
        route: `/projects/${projectId}/deployments${versionId ? `?version=${encodeURIComponent(versionId)}` : ''}&deployment=${encodeURIComponent(String(row.id))}`,
        approvalId: null, versionId, runId: null, taskId: null, deploymentId: String(row.id),
        createdAt: Number(row.updated_at), stale: false,
      })
    }

    // 5) Failed runs that need a human decision before anything can continue.
    const runs = this.store.db
      .prepare("SELECT * FROM agent_runs WHERE project_id=? AND status='failed' ORDER BY created_at DESC LIMIT 20")
      .all(projectId) as Row[]
    for (const row of runs) {
      items.push({
        id: `run_failure:${String(row.id)}`,
        kind: 'run_failure',
        projectId,
        title: 'Run 执行失败，等待处理',
        reason: String(row.error || 'Run 以失败结束'),
        requiredDecision: '决定重试、改派或终止该工作',
        resume: '处理后该任务可重新进入可执行队列，其余无依赖任务不受影响',
        risk: 'medium',
        route: `/projects/${projectId}/runs?run=${encodeURIComponent(String(row.id))}`,
        approvalId: null, versionId: null, runId: String(row.id),
        taskId: row.task_id ? String(row.task_id) : null, deploymentId: null,
        createdAt: Number(row.created_at), stale: false,
      })
    }

    // 6) Revisions the product cannot apply by itself: the delta is outside the granted
    //    envelope, so the user is asked exactly once, with the precise difference.
    const proposals = this.store.db
      .prepare("SELECT * FROM plan_replan_proposals WHERE project_id=? AND status='proposed' ORDER BY created_at DESC")
      .all(projectId) as Row[]
    for (const row of proposals) {
      const grantImpact = this.parseJson(row.grant_impact_json)
      const diff = this.parseJson(row.diff_json)
      const added = Array.isArray(diff.added)
        ? diff.added.map((item) => String((item as Row).key ?? '')).filter(Boolean)
        : []
      const removed = Array.isArray(diff.removed)
        ? diff.removed.map((item) => String((item as Row).key ?? '')).filter(Boolean)
        : []
      const expanded = Array.isArray(grantImpact.expanded) ? grantImpact.expanded.map(String) : []
      items.push({
        id: `replan_scope:${String(row.id)}`,
        kind: 'replan_scope',
        projectId,
        title: '修订需要超出当前授权范围，等待你的决定',
        reason:
          expanded.length > 0
            ? expanded.join('；')
            : `修订新增任务 ${added.join('、') || '无'}${removed.length ? `，移除 ${removed.join('、')}` : ''}`,
        requiredDecision: '批准这次范围差异（将自动应用修订并继续执行），或拒绝并保持当前计划',
        resume: '批准后产品会立即应用修订、派生同范围授权并自动恢复执行，无需回到聊天页',
        risk: 'medium',
        route: `/projects/${projectId}/plans?plan=${encodeURIComponent(String(row.plan_id))}&proposal=${encodeURIComponent(String(row.id))}`,
        approvalId: null, versionId: null, runId: null, taskId: null, deploymentId: null,
        proposalId: String(row.id), planId: String(row.plan_id),
        createdAt: Number(row.created_at), stale: false,
      })
    }

    // 7) Completed plans waiting for delivery. Only shown when the product is not allowed to
    //    merge on its own — this is a real human decision, not an "AI is working" item.
    const settings = this.autonomySettings(projectId)
    const completed = this.store.db
      .prepare(
        "SELECT * FROM plan_revisions WHERE project_id=? AND status='approved' AND json_extract(plan_json,'$.execution.status')='completed' ORDER BY updated_at DESC LIMIT 10",
      )
      .all(projectId) as Row[]
    for (const row of completed) {
      const plan = this.parseJson(row.plan_json)
      const execution = this.parseJsonValue(plan.execution)
      if (!execution || execution.mergedAt) continue
      if (!execution.branch) continue
      items.push({
        id: `plan_delivery:${String(row.id)}`,
        kind: 'plan_delivery',
        projectId,
        title: `计划 r${String(row.revision)} 已完成，等待交付`,
        reason: `分支 ${String(execution.branch)} 已完成并通过验证；项目策略${settings.autoDeliver ? '允许' : '未允许'}自动合并`,
        requiredDecision: '确认将该 Worktree 合并到目标分支（会检查冲突、越权路径与主工作区状态）',
        resume: '合并后产品会再次验证并保存交付证据；不会推送远端或部署',
        risk: 'high',
        route: `/projects/${projectId}/plans?plan=${encodeURIComponent(String(row.id))}`,
        approvalId: null, versionId: null, runId: null, taskId: null, deploymentId: null,
        proposalId: null, planId: String(row.id),
        createdAt: Number(row.updated_at), stale: false,
      })
    }

    // Rank by "who is actually blocked", then by recency. A paused Run waiting on a
    // tool approval outranks an advisory gate hint; a gate item is never "newest" just
    // because it was read now.
    const KIND_RANK: Record<ActionKind, number> = {
      tool_approval: 0,
      task_acceptance: 1,
      replan_scope: 2,
      plan_delivery: 3,
      delivery_approval: 4,
      deployment_reconciliation: 5,
      run_failure: 6,
      version_gate: 7,
    }
    return items.sort((a, b) => {
      const rank = KIND_RANK[a.kind] - KIND_RANK[b.kind]
      if (rank !== 0) return rank
      return b.createdAt - a.createdAt
    })
  }

  /**
   * Auto-advance pass. Reuses LifecycleService transitions (which enforce gates), so
   * nothing bypasses approval: only gate-passing, non-production lifecycle hops move.
   * In assist/managed mode nothing is advanced automatically.
   */
  tick(projectId: string): { mode: ProjectAutonomyMode; advanced: Array<{ versionId: string; from: string; to: string }> } {
    const settings = this.autonomySettings(projectId)
    const advanced: Array<{ versionId: string; from: string; to: string }> = []
    if (settings.mode !== 'autonomous') return { mode: settings.mode, advanced }
    const versions = this.lifecycle.overview(projectId).versions
    for (const version of versions) {
      if (!settings.autoAdvancePhases.includes(version.phase)) continue
      const next = this.lifecycle.nextGatedPhase(version.phase)
      if (!next) continue
      try {
        const updated = this.lifecycle.transitionVersion({ versionId: version.id, to: next })
        advanced.push({ versionId: version.id, from: version.phase, to: updated.phase })
      } catch {
        // Gate not satisfied (or a concurrent change): leave it for the action list.
      }
    }
    return { mode: settings.mode, advanced }
  }

  summary(projectId: string): {
    total: number
    needsHuman: number
    byKind: Record<string, number>
    mode: ProjectAutonomyMode
    autoAdvancedPhases: string[]
  } {
    const items = this.items(projectId)
    const byKind: Record<string, number> = {}
    for (const item of items) byKind[item.kind] = (byKind[item.kind] ?? 0) + 1
    const settings = this.autonomySettings(projectId)
    return {
      total: items.length,
      needsHuman: items.filter((item) => !item.stale).length,
      byKind,
      mode: settings.mode,
      autoAdvancedPhases: settings.autoAdvancePhases,
    }
  }

  private parseJsonValue(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
    if (typeof value !== 'string' || !value) return null
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }

  private parseJson(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string' || !value) return {}
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return {}
    }
  }
}

