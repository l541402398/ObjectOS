import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import type { SqliteStore } from '@projectos/persistence'

/**
 * ADR-0057 — expired approvals must not park a run forever.
 *
 * A tool approval whose `expires_at` passed stayed `pending` in SQLite. The Run stayed parked, the
 * work center said "无需操作" (the item was hidden as stale) and the journey said "执行暂停，等待恢复"
 * while nothing could ever resume it. The decision API only expired it when a human happened to click.
 *
 * This sweep settles those approvals at every autonomy pass: the approval becomes `expired`, the tool
 * call is denied, the parked run fails with a clear message and the task is blocked, so the journey
 * shows a real, recoverable state instead of a silent wait.
 */
export function expireStaleApprovals(
  store: SqliteStore,
  logger: { warn: (payload: unknown, message: string) => void },
  at = Date.now(),
): number {
  const rows = store.db
    .prepare(
      `SELECT id, project_id, run_id, tool_call_id, title
       FROM approvals
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`,
    )
    .all(at) as Array<{ id: string; project_id: string; run_id: string; tool_call_id: string | null; title: string }>
  if (rows.length === 0) return 0

  const parked = new Set<string>(['waiting_approval', 'waiting_tool', 'running', 'suspended'])
  let expired = 0
  for (const row of rows) {
    try {
      const run = store.read.getRun(row.run_id)
      const runParked = run ? parked.has(run.status) : false
      store.transaction(() => {
        store.expireApproval(row.id, '审批已过期，操作未执行；需要重新发起')
        if (row.tool_call_id) {
          store.updateToolCall(row.tool_call_id, {
            status: 'denied',
            error: '审批已过期，操作未执行',
            finishedAt: at,
          })
        }
        if (run && runParked) {
          store.updateRun(run.id, {
            status: 'failed',
            error: '审批已过期，操作未执行；请重新开始，或让 AI 重新规划后再次申请授权',
            finishedAt: at,
          })
          store.appendEvent(row.project_id, run.id, PROJECT_EVENT_TYPES.runStatusChanged, {
            status: 'failed',
            runId: run.id,
            sessionId: run.sessionId,
            reason: 'approval_expired',
          })
          if (run.taskId) {
            store.updateTaskAttemptStatus(run.id, 'failed')
            store.appendEvent(row.project_id, run.taskId, PROJECT_EVENT_TYPES.taskMoved, {
              status: 'blocked',
              reason: '审批已过期，运行未继续',
            })
          }
        }
        store.appendEvent(row.project_id, row.id, PROJECT_EVENT_TYPES.approvalDecided, {
          decision: 'expired',
          runId: row.run_id,
          sessionId: run?.sessionId ?? null,
          reason: 'approval_ttl',
        })
      })
      expired += 1
      logger.warn(
        { approvalId: row.id, runId: run?.id ?? null, title: row.title },
        'expired a pending approval whose TTL passed and settled its run',
      )
    } catch (error) {
      logger.warn({ err: error, approvalId: row.id }, 'failed to expire a stale approval')
    }
  }
  return expired
}
