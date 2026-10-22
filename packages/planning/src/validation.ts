import type { PlanDraft, PlannedTask } from '@projectos/contracts'

export interface PlanTaskGraphOptions {
  maxTasks?: number
  maxDepth?: number
}

/**
 * Structural + DAG validation shared by stored-plan reads and model output.
 * Errors are written for humans (and for the bounded repair prompt), never as
 * raw Zod trees, so a malformed model answer can be corrected deterministically.
 */
export function validatePlanTaskGraph(tasks: readonly PlannedTask[], options: PlanTaskGraphOptions = {}): void {
  if (tasks.length === 0) throw new Error('计划没有任务')
  const maxTasks = options.maxTasks ?? 20
  if (tasks.length > maxTasks) throw new Error(`任务数 ${tasks.length} 超过上限 ${maxTasks}`)

  const keys = new Set<string>()
  for (const task of tasks) {
    if (!task.key.trim()) throw new Error('存在空的任务 key')
    if (keys.has(task.key)) throw new Error(`任务 key 重复：${task.key}`)
    keys.add(task.key)
  }

  const byKey = new Map(tasks.map((task) => [task.key, task]))
  for (const task of tasks) {
    const seen = new Set<string>()
    for (const dependency of task.dependsOn) {
      if (!keys.has(dependency)) throw new Error(`依赖不存在：${task.key} → ${dependency}`)
      if (dependency === task.key) throw new Error(`任务不能依赖自身：${task.key}`)
      if (seen.has(dependency)) throw new Error(`依赖重复：${task.key} → ${dependency}`)
      seen.add(dependency)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const depth = new Map<string, number>()
  const visit = (key: string, chain: string[]): number => {
    if (visiting.has(key)) throw new Error(`计划存在环形依赖：${[...chain, key].join(' → ')}`)
    const cached = depth.get(key)
    if (cached !== undefined) return cached
    const task = byKey.get(key)
    if (!task) throw new Error(`任务不存在：${key}`)
    visiting.add(key)
    let value = 1
    for (const dependency of task.dependsOn) {
      value = Math.max(value, visit(dependency, [...chain, key]) + 1)
    }
    visiting.delete(key)
    visited.add(key)
    depth.set(key, value)
    return value
  }
  let longest = 0
  for (const task of tasks) {
    longest = Math.max(longest, visit(task.key, []))
  }
  const maxDepth = options.maxDepth ?? 8
  if (longest > maxDepth) throw new Error(`依赖深度 ${longest} 超过上限 ${maxDepth}`)
}

export function validatePlanDraft(plan: PlanDraft): void {
  validatePlanTaskGraph(plan.tasks)
}

/** Topological order used by approval; throws on an invalid graph. */
export function topologicalTasks(tasks: readonly PlannedTask[]): PlannedTask[] {
  validatePlanTaskGraph(tasks)
  const byKey = new Map(tasks.map((task) => [task.key, task]))
  const result: PlannedTask[] = []
  const visited = new Set<string>()
  const visit = (key: string): void => {
    if (visited.has(key)) return
    const task = byKey.get(key)
    if (!task) return
    for (const dependency of task.dependsOn) visit(dependency)
    visited.add(key)
    result.push(task)
  }
  for (const task of tasks) visit(task.key)
  return result
}
