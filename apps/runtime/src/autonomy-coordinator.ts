import { newId, now, type ProjectEvent } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import type { ActionCenter } from './action-center.js'

/**
 * Event-driven autonomy coordinator.
 *
 * ProjectOS already emits durable business events (`store.appendEvent` -> committed
 * hub). This coordinator turns those events into autonomous progress without adding a
 * second scheduler: it only nudges the existing OrchestrationScheduler and the
 * existing LifecycleService transitions, and records its own bookkeeping so that
 * duplicates are idempotent and a crash mid-pass is replayed instead of lost.
 *
 * Guarantees:
 *  - idempotent: one row per (source_event_id, kind) via a unique index
 *  - durable: pending rows survive restart and are replayed on startup
 *  - single-flight: one pass per project at a time in-process
 *  - bounded: attempt counter caps retries so a poison event cannot loop forever
 */

export type CoordinationKind =
  | 'run.settled'
  | 'approval.settled'
  | 'task.settled'
  | 'evidence.settled'
  | 'gate.settled'
  | 'version.settled'
  | 'delivery.settled'
  | 'handoff.settled'

const MAX_ATTEMPTS = 3
const MAX_ROWS = 2000

/** Maps a committed event type to the coordination reason it implies. */
export function classifyEvent(type: string): CoordinationKind | null {
  if (type.startsWith('run.')) return 'run.settled'
  if (type.startsWith('approval.')) return 'approval.settled'
  if (type.startsWith('task.')) return 'task.settled'
  if (type.startsWith('artifact.') || type.startsWith('evidence.')) return 'evidence.settled'
  if (type.startsWith('gate.')) return 'gate.settled'
  if (type.startsWith('version.') || type.startsWith('iteration.')) return 'version.settled'
  if (type.startsWith('deployment.') || type.startsWith('release.') || type.startsWith('changeRequest.')) return 'delivery.settled'
  if (type.startsWith('handoff.')) return 'handoff.settled'
  return null
}

export interface CoordinationAction {
  kind: string
  detail: string
  ids: string[]
}

export interface CoordinationResult {
  projectId: string
  trigger: string
  advanced: Array<{ versionId: string; from: string; to: string }>
  nudgedPlans: string[]
  openActions: number
  completed: boolean
  actions: CoordinationAction[]
}

export class AutonomyCoordinator {
  private readonly inFlight = new Set<string>()
  private readonly queued = new Set<string>()
  private readonly timers = new Set<NodeJS.Timeout>()
  private disposed = false

  /** Stops pending debounced passes and makes the coordinator inert. */
  dispose(): void {
    this.disposed = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.inFlight.clear()
    this.queued.clear()
  }

  constructor(
    private readonly store: SqliteStore,
    private readonly actions: ActionCenter,
    private readonly scheduler: { nudgeProject: (projectId: string) => string[] } | null,
    private readonly logger: { info: (payload: unknown, message: string) => void; warn: (payload: unknown, message: string) => void },
    private readonly onProgress?: (result: CoordinationResult) => void,
  ) {}

  /** Records an event as a coordination intent. Returns false when deduplicated. */
  enqueue(event: Pick<ProjectEvent, 'id' | 'eventType' | 'projectId'>): boolean {
    const kind = classifyEvent(event.eventType)
    if (!kind) return false
    const result = this.store.db
      .prepare(
        `INSERT OR IGNORE INTO autonomy_events
         (id, project_id, source_event_id, kind, status, trigger, detail, actions_json, attempts, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?, '', '[]', 0, ?)`,
      )
      .run(newId('aev'), event.projectId, String(event.id), kind, event.eventType, now())
    const inserted = Number(result.changes) === 1
    if (inserted) this.poke(event.projectId)
    return inserted
  }

  /** Replays work that was pending when the process stopped. Safe to call once at boot. */
  replay(): number {
    const rows = this.store.db
      .prepare("SELECT DISTINCT project_id FROM autonomy_events WHERE status='pending' AND attempts < ?")
      .all(MAX_ATTEMPTS) as Array<{ project_id: string }>
    for (const row of rows) this.poke(row.project_id)
    this.store.db.prepare('DELETE FROM autonomy_events WHERE id IN (SELECT id FROM autonomy_events WHERE status != \'pending\' ORDER BY created_at ASC LIMIT MAX(0, (SELECT COUNT(*) FROM autonomy_events) - ?))').run(MAX_ROWS)
    return rows.length
  }

  /** Runs one coordination pass synchronously. Exposed for tests and the tick API. */
  pass(projectId: string, trigger: string): CoordinationResult {
    const autonomous = this.actions.autonomySettings(projectId).mode === 'autonomous'
    const result: CoordinationResult = {
      projectId,
      trigger,
      advanced: [],
      nudgedPlans: [],
      openActions: 0,
      completed: false,
      actions: [],
    }

    // 1) Re-evaluate gates and advance only phases whose gate actually passes.
    if (autonomous) {
      const tick = this.actions.tick(projectId)
      result.advanced = tick.advanced
      if (tick.advanced.length > 0) {
        result.actions.push({
          kind: 'phase.advanced',
          detail: tick.advanced.map((entry) => `${entry.from}→${entry.to}`).join(', '),
          ids: tick.advanced.map((entry) => entry.versionId),
        })
      }
    }

    // 2) Nudge the existing scheduler: any plan that should be running gets a tick.
    if (autonomous && this.scheduler) {
      result.nudgedPlans = this.scheduler.nudgeProject(projectId)
      if (result.nudgedPlans.length > 0) {
        result.actions.push({ kind: 'scheduler.nudged', detail: '已推动执行中的计划继续调度', ids: result.nudgedPlans })
      }
    }

    // 3) Whatever still needs a human is surfaced by the action center, not re-decided here.
    const items = this.actions.items(projectId).filter((item) => !item.stale)
    result.openActions = items.length
    result.completed = items.length === 0

    this.persistResult(result)
    try {
      this.onProgress?.(result)
    } catch {
      /* progress reporting must never break coordination */
    }
    return result
  }

  /** Marks every pending row of a project as processed and stores the outcome. */
  private persistResult(result: CoordinationResult): void {
    const timestamp = now()
    this.store.db
      .prepare(
        `UPDATE autonomy_events SET status='processed', attempts=attempts+1, processed_at=?,
         actions_json=?, detail=? WHERE project_id=? AND status='pending'`,
      )
      .run(
        timestamp,
        JSON.stringify(result.actions),
        result.actions.map((action) => action.detail).join(' | ').slice(0, 4000),
        result.projectId,
      )
  }

  /** Coalesces many events into one pass per project (single-flight, no queue storms). */
  private poke(projectId: string): void {
    if (this.disposed) return
    if (this.inFlight.has(projectId)) {
      this.queued.add(projectId)
      return
    }
    this.inFlight.add(projectId)
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (this.disposed) return
      try {
        this.pass(projectId, 'event')
        while (this.queued.has(projectId)) {
          this.queued.delete(projectId)
          this.pass(projectId, 'event.coalesced')
        }
      } catch (error) {
        this.logger.warn({ err: String(error), projectId }, 'autonomy coordination pass failed')
        try {
          this.store.db
            .prepare("UPDATE autonomy_events SET attempts=attempts+1, detail=? WHERE project_id=? AND status='pending' AND attempts+1 < ?")
            .run(String(error).slice(0, 2000), projectId, MAX_ATTEMPTS)
        } catch {
          /* the store may already be closed during shutdown */
        }
      } finally {
        this.inFlight.delete(projectId)
      }
    }, 250)
    timer.unref?.()
    this.timers.add(timer)
  }

  /** Recent coordination history for the UI/diagnostics. */
  history(projectId: string, limit = 20): Array<{
    id: string
    kind: string
    trigger: string
    status: string
    detail: string
    attempts: number
    createdAt: number
  }> {
    const rows = this.store.db
      .prepare('SELECT * FROM autonomy_events WHERE project_id=? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, Math.min(Math.max(limit, 1), 100)) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      trigger: String(row.trigger),
      status: String(row.status),
      detail: String(row.detail ?? ''),
      attempts: Number(row.attempts ?? 0),
      createdAt: Number(row.created_at),
    }))
  }
}
