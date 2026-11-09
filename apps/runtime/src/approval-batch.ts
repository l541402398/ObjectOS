import {
  AppError,
  newId,
  now,
  type ApprovalBatchOutcome,
  type ApprovalBatchResult,
  type ApprovalView,
  type DecideApprovalsBatchInput,
} from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import { approvalKindOf, isProtectedPath, type ApprovalKind } from '@projectos/policy'
import type { SqliteStore } from '@projectos/persistence'
import { isCriticalGrantPath } from './plan-grant.js'

/**
 * ADR-0089 — batch approval decisions.
 *
 * A batch is N ordinary decisions, never a new authorization path: each id goes through the same
 * `decide` the single-item UI uses, so snapshot drift, expiry, lease and provider checks still
 * apply per item and one failure never hides another. Only *batchable* kinds (plain writes,
 * verification commands) can be approved together; Git writes, external runtime actions, protected
 * paths, arbitrary shell, task acceptance and delivery approvals are always decided one by one.
 */

const RUN_ALLOWANCE_TTL_MS = 8 * 60 * 60 * 1000
const NON_TOOL_MARKERS = new Set(['task-acceptance', 'acp-permission', 'runtime-execution'])

export function approvalKind(view: Pick<ApprovalView, 'request'>): ApprovalKind {
  const request = (view.request ?? {}) as Record<string, unknown>
  const marker = typeof request.kind === 'string' ? request.kind : ''
  if (NON_TOOL_MARKERS.has(marker)) {
    return { key: `marker:${marker}`, label: marker === 'task-acceptance' ? '任务验收' : '外部 Runtime 权限', batchable: false, reason: '该类请求必须逐次决定' }
  }
  const toolName = typeof request.toolName === 'string' ? request.toolName : ''
  const args = (request.args && typeof request.args === 'object' ? request.args : {}) as Record<string, unknown>
  return runtimeKindOf(toolName, args)
}

/** Policy kind, narrowed by the plan-grant critical-path rule (auth, migrations, manifests…). */
function runtimeKindOf(toolName: string, args: Record<string, unknown>): ApprovalKind {
  const kind = approvalKindOf(toolName, args)
  if (toolName === 'write_file' && typeof args.path === 'string' && isCriticalGrantPath(args.path)) {
    return { key: 'write_file:critical', label: '写入安全敏感文件', batchable: false, reason: '安全敏感路径必须逐次决定' }
  }
  return kind
}

export function withApprovalKind(view: ApprovalView): ApprovalView {
  return { ...view, kind: approvalKind(view) }
}

export interface ApprovalDecider {
  /** Same routing as `approval.decide`; throws on any per-item failure. */
  decide(approvalId: string, decision: 'approved' | 'rejected', note: string): Promise<void>
  /** Approvals owned by Git delivery / integration / requirement work are never batched. */
  ownedElsewhere(approvalId: string): boolean
}

export class ApprovalBatchService {
  constructor(
    private readonly store: SqliteStore,
    private readonly decider: ApprovalDecider,
  ) {}

  private pending(projectId: string): ApprovalView[] {
    return this.store.read.listApprovalViews(projectId).filter((view) => view.status === 'pending')
  }

  async decideBatch(input: DecideApprovalsBatchInput): Promise<ApprovalBatchResult> {
    const pending = this.pending(input.projectId)
    const byId = new Map(pending.map((view) => [view.id, view]))
    let targets: string[]
    let anchorKind: ApprovalKind | null = null
    let anchorRunId: string | null = null
    if (input.sameKindAs) {
      const anchor = byId.get(input.sameKindAs)
      if (!anchor) throw new AppError('CONFLICT', '基准审批已处理、已过期或不属于该项目')
      anchorKind = approvalKind(anchor)
      if (!anchorKind.batchable && input.decision === 'approved') {
        throw new AppError('APPROVAL_REQUIRED', `${anchorKind.label}：${anchorKind.reason}`)
      }
      anchorRunId = anchor.runId
      targets = pending.filter((view) => view.runId === anchor.runId && approvalKind(view).key === anchorKind!.key).map((view) => view.id)
    } else {
      targets = [...new Set(input.approvalIds ?? [])]
    }

    const outcomes: ApprovalBatchOutcome[] = []
    for (const approvalId of targets) {
      const view = byId.get(approvalId)
      if (!view) {
        outcomes.push({ approvalId, status: 'skipped', reason: '已处理、已过期或不属于该项目' })
        continue
      }
      if (this.decider.ownedElsewhere(approvalId)) {
        outcomes.push({ approvalId, status: 'skipped', reason: '交付/集成审批需要单独决定' })
        continue
      }
      const kind = approvalKind(view)
      if (input.decision === 'approved' && !kind.batchable) {
        outcomes.push({ approvalId, status: 'skipped', reason: `${kind.label}：${kind.reason}` })
        continue
      }
      try {
        await this.decider.decide(approvalId, input.decision, input.note || (input.decision === 'approved' ? '批量批准' : '批量拒绝'))
        outcomes.push({ approvalId, status: input.decision, reason: kind.label })
      } catch (error) {
        outcomes.push({ approvalId, status: 'failed', reason: error instanceof Error ? error.message : String(error) })
      }
    }

    let rememberedKind: ApprovalBatchResult['rememberedKind'] = null
    if (input.rememberForRun && input.decision === 'approved' && anchorKind?.batchable && anchorRunId) {
      const anchorOutcome = outcomes.find((outcome) => outcome.approvalId === input.sameKindAs)
      if (anchorOutcome?.status === 'approved') {
        this.rememberKind(input.projectId, anchorRunId, anchorKind, input.sameKindAs!)
        rememberedKind = { runId: anchorRunId, key: anchorKind.key, label: anchorKind.label }
      }
    }

    const count = (status: ApprovalBatchOutcome['status']) => outcomes.filter((outcome) => outcome.status === status).length
    const result: ApprovalBatchResult = {
      outcomes,
      approved: count('approved'),
      rejected: count('rejected'),
      skipped: count('skipped'),
      failed: count('failed'),
      rememberedKind,
    }
    this.store.appendEvent(input.projectId, input.sameKindAs ?? targets[0] ?? input.projectId, PROJECT_EVENT_TYPES.custom, {
      kind: 'approval.batchDecided',
      decision: input.decision,
      mode: input.sameKindAs ? 'same-kind-in-run' : 'selection',
      note: input.note.slice(0, 500),
      outcomes,
      rememberedKind,
    })
    return result
  }

  private rememberKind(projectId: string, runId: string, kind: ApprovalKind, approvalId: string): void {
    const timestamp = now()
    this.store.db
      .prepare(
        `INSERT INTO run_kind_allowances (id, project_id, run_id, kind_key, kind_label, approval_id, uses, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(run_id, kind_key) DO UPDATE SET approval_id=excluded.approval_id, expires_at=excluded.expires_at`,
      )
      .run(newId('rka'), projectId, runId, kind.key, kind.label, approvalId, timestamp, timestamp + RUN_ALLOWANCE_TTL_MS)
  }
}

/**
 * Consulted by AgentRunner only when Policy says `require_approval` and the PlanGrant did not
 * already allow or deny. Returns the remembered human decision for this Run + kind, if any.
 */
export function consumeRunKindAllowance(
  store: SqliteStore,
  runId: string,
  toolName: string,
  args: Record<string, unknown>,
): { approvalId: string; label: string } | null {
  const kind = runtimeKindOf(toolName, args)
  if (!kind.batchable) return null
  if (toolName === 'write_file' && typeof args.path === 'string' && isProtectedPath(args.path)) return null
  let row: { id: string; approval_id: string; kind_label: string } | undefined
  try {
    row = store.db
      .prepare('SELECT id, approval_id, kind_label FROM run_kind_allowances WHERE run_id=? AND kind_key=? AND expires_at > ?')
      .get(runId, kind.key, now()) as typeof row
  } catch {
    return null
  }
  if (!row) return null
  store.db.prepare('UPDATE run_kind_allowances SET uses=uses+1 WHERE id=?').run(row.id)
  return { approvalId: row.approval_id, label: row.kind_label }
}
