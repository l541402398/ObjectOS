/**
 * Hard execution budgets for Agent Runs and Plans.
 *
 * These are enforced by the Runtime (not by UI copy or prompts) and are
 * snapshotted onto each Run / PlanExecution so a restart keeps the original
 * budget instead of silently granting a new one.
 */
export interface RuntimeLimits {
  /** Wall-clock limit for one Agent Run. */
  runWallClockMs: number
  /** Wall-clock limit for a whole Plan execution. */
  planWallClockMs: number
  /** Maximum assistant/tool rounds inside a single Run. */
  maxAgentSteps: number
  /** Maximum executed tool invocations inside a single Run. */
  maxToolCalls: number
  /** TTL of the global per-Agent capacity slot. */
  agentSlotTtlMs: number
  /** TTL of a Task write lease. */
  taskLeaseTtlMs: number
}

export const DEFAULT_LIMITS: RuntimeLimits = {
  runWallClockMs: 30 * 60 * 1000,
  planWallClockMs: 2 * 60 * 60 * 1000,
  maxAgentSteps: 32,
  maxToolCalls: 64,
  agentSlotTtlMs: 30 * 60 * 1000,
  taskLeaseTtlMs: 30 * 60 * 1000,
}

function intFromEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(parsed)))
}

/** Environment overrides, clamped so a bad value cannot disable enforcement. */
export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeLimits {
  return {
    runWallClockMs: intFromEnv(env.PROJECTOS_RUN_TIMEOUT_MS, DEFAULT_LIMITS.runWallClockMs, 1_000, 24 * 60 * 60 * 1000),
    planWallClockMs: intFromEnv(
      env.PROJECTOS_PLAN_TIMEOUT_MS,
      DEFAULT_LIMITS.planWallClockMs,
      1_000,
      7 * 24 * 60 * 60 * 1000,
    ),
    maxAgentSteps: intFromEnv(env.PROJECTOS_MAX_AGENT_STEPS, DEFAULT_LIMITS.maxAgentSteps, 1, 200),
    maxToolCalls: intFromEnv(env.PROJECTOS_MAX_TOOL_CALLS, DEFAULT_LIMITS.maxToolCalls, 1, 500),
    agentSlotTtlMs: intFromEnv(env.PROJECTOS_AGENT_SLOT_TTL_MS, DEFAULT_LIMITS.agentSlotTtlMs, 5_000, 24 * 60 * 60 * 1000),
    taskLeaseTtlMs: intFromEnv(env.PROJECTOS_TASK_LEASE_TTL_MS, DEFAULT_LIMITS.taskLeaseTtlMs, 5_000, 24 * 60 * 60 * 1000),
  }
}

export function resolveLimits(partial?: Partial<RuntimeLimits> | null): RuntimeLimits {
  const base = limitsFromEnv()
  if (!partial) return base
  return {
    runWallClockMs: Math.max(1_000, Math.trunc(partial.runWallClockMs ?? base.runWallClockMs)),
    planWallClockMs: Math.max(0, Math.trunc(partial.planWallClockMs ?? base.planWallClockMs)),
    maxAgentSteps: Math.max(1, Math.trunc(partial.maxAgentSteps ?? base.maxAgentSteps)),
    maxToolCalls: Math.max(1, Math.trunc(partial.maxToolCalls ?? base.maxToolCalls)),
    agentSlotTtlMs: Math.max(5_000, Math.trunc(partial.agentSlotTtlMs ?? base.agentSlotTtlMs)),
    taskLeaseTtlMs: Math.max(5_000, Math.trunc(partial.taskLeaseTtlMs ?? base.taskLeaseTtlMs)),
  }
}
