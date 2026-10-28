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
  createdAt: number
  /** True when the underlying object can no longer be acted on. */
  stale: boolean
}

export type ProjectAutonomyMode = 'assist' | 'autonomous' | 'managed'

export interface ProjectAutonomySettings {
  mode: ProjectAutonomyMode
  /** Phases that may advance without a human click when their gate passes. */
  autoAdvancePhases: string[]
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
}

const PHASE_LABEL: Record<string, string> = {
  planned: '已计划', discovery: '需求/发现', build: '开发中', verify: '验证中',
  release_candidate: '候选发布', released: '已发布', maintenance: '维护中', retired: '已退役',
}

interface Row {
  [key: string]: unknown
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
      }
    } catch {
      return { ...DEFAULT_AUTONOMY }
    }
  }

  setAutonomySettings(projectId: string, input: { mode: ProjectAutonomyMode; autoAdvancePhases?: string[] }): ProjectAutonomySettings {
    const next: ProjectAutonomySettings = {
      mode: input.mode,
      autoAdvancePhases: input.autoAdvancePhases ?? this.autonomySettings(projectId).autoAdvancePhases,
    }
    this.store.db
      .prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at')
      .run(AUTONOMY_KEY(projectId), JSON.stringify(next), Date.now())
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

    // Rank by "who is actually blocked", then by recency. A paused Run waiting on a
    // tool approval outranks an advisory gate hint; a gate item is never "newest" just
    // because it was read now.
    const KIND_RANK: Record<ActionKind, number> = {
      tool_approval: 0,
      task_acceptance: 1,
      delivery_approval: 2,
      deployment_reconciliation: 3,
      run_failure: 4,
      version_gate: 5,
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

  private parseJson(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string' || !value) return {}
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return {}
    }
  }
}
