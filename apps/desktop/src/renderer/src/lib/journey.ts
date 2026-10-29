import type { JourneyStage, ProjectJourney } from '@projectos/contracts'

/** Shared journey presentation helpers (ADR-0053), so the bar and the project center cannot drift. */

export const JOURNEY_STATE_LABEL: Record<JourneyStage['state'], string> = {
  done: '已完成',
  active: '进行中',
  blocked: '需要处理',
  pending: '未开始',
  skipped: '不适用',
}

export const JOURNEY_OWNER_LABEL: Record<ProjectJourney['nextAction']['owner'], string> = {
  user: '需要你操作',
  ai: 'AI 正在处理',
  system: '系统处理中',
  none: '无需操作',
}

/**
 * The current stage is the furthest one reached: a blocked stage wins over an earlier active one, and
 * an active stage wins over the setup stage that only exists to explain an unborn repository.
 */
export function currentJourneyStage(stages: JourneyStage[]): JourneyStage | null {
  const reversed = [...stages].reverse()
  return reversed.find((stage) => stage.state === 'blocked') ?? reversed.find((stage) => stage.state === 'active') ?? stages[stages.length - 1] ?? null
}

export function journeyProgress(stages: JourneyStage[]): { done: number; total: number } {
  return { done: stages.filter((stage) => stage.state === 'done').length, total: stages.length }
}
