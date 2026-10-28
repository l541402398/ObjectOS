import { now, type PlanDraft } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

/**
 * ADR-0027 — a plan parked on an unanswered approval is not "running".
 *
 * Real records (docs/v2/evidence/p287-900s-forensics.md) show 9 of 20 plan executions ending
 * with exactly one pending approval and one `waiting_approval` tool call: the plan row stays
 * `running` for 850–1085 seconds with no progress event, no failure classification and no
 * reconciliation marker. Every observer — the UI, the autonomy coordinator, an E2E — then sees
 * a healthy run that never moves, and the wall clock burns with zero diagnostic output.
 *
 * Detection is evidence-based, not a blind timer:
 *   - an active Run is `waiting_approval`,
 *   - its tool calls are all parked (nothing is executing), and
 *   - nothing has been written for `idleMs`.
 * A genuinely working run (a tool call in `running`/`approved`, or recent steps) is never parked.
 */

export interface ApprovalPark {
  runId: string
  toolName: string
  approvalId: string | null
  detail: string
  waitedMs: number
}

export const APPROVAL_PARK_IDLE_MS = 15_000

export function detectApprovalPark(
  store: SqliteStore,
  plan: PlanDraft,
  options: { idleMs?: number; at?: number } = {},
): ApprovalPark | null {
  const idleMs = options.idleMs ?? APPROVAL_PARK_IDLE_MS
  const at = options.at ?? now()
  for (const taskId of plan.createdTaskIds) {
    const run = store.read.getActiveRunForTask(taskId)
    if (!run || run.status !== 'waiting_approval') continue
    const calls = store.read.getToolCalls(run.id)
    const waiting = calls.filter((call) => call.status === 'waiting_approval')
    if (waiting.length === 0) continue
    const executing = calls.filter(
      (call) => call.status === 'running' || call.status === 'approved' || call.status === 'proposed',
    )
    if (executing.length > 0) continue
    const steps = store.read.getRunSteps(run.id)
    const lastStepAt = steps.length > 0 ? Math.max(...steps.map((step) => Number(step.createdAt ?? 0))) : 0
    const lastCallAt = Math.max(0, ...waiting.map((call) => Number(call.startedAt ?? call.finishedAt ?? 0)))
    const idleSince = Math.max(lastStepAt, lastCallAt, run.startedAt ?? 0)
    if (at - idleSince < idleMs) continue
    const toolCall = waiting[0]!
    const approval = store.db
      .prepare("SELECT id FROM approvals WHERE run_id = ? AND status = 'pending' ORDER BY requested_at DESC LIMIT 1")
      .get(run.id) as { id: string } | undefined
    const command = typeof toolCall.args?.command === 'string' ? toolCall.args.command.slice(0, 80) : ''
    const path = typeof toolCall.args?.path === 'string' ? toolCall.args.path : ''
    return {
      runId: run.id,
      toolName: String(toolCall.toolName),
      approvalId: approval ? String(approval.id) : null,
      detail: `等待审批：${String(toolCall.toolName)}${command ? ` ${command}` : path ? ` ${path}` : ''}`,
      waitedMs: Math.max(0, at - idleSince),
    }
  }
  return null
}
