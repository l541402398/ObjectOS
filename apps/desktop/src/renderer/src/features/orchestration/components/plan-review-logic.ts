import type { PlanDraft, PlanRole, PlannedTask } from '@projectos/contracts'

export type TaskEntry = { task: PlannedTask; index: number; level: number }

export type Stage = {
  id: string
  level: number
  title: string
  roles: PlanRole[]
  entries: TaskEntry[]
  hasRisk: boolean
}

export type DependencyIssue = {
  kind: 'missing' | 'cycle'
  taskKey: string
  detail: string
}

export function planDependencyIssues(tasks: PlannedTask[]): DependencyIssue[] {
  const keys = new Set(tasks.map((task) => task.key))
  const issues: DependencyIssue[] = []
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (!keys.has(dependency)) {
        issues.push({ kind: 'missing', taskKey: task.key, detail: `前置任务「${dependency}」不存在` })
      }
    }
  }
  const state = new Map<string, 'visiting' | 'done'>()
  const visit = (key: string): void => {
    if (state.get(key) === 'done') return
    if (state.get(key) === 'visiting') {
      issues.push({ kind: 'cycle', taskKey: key, detail: '依赖关系存在循环' })
      return
    }
    state.set(key, 'visiting')
    const task = tasks.find((item) => item.key === key)
    for (const dependency of task?.dependsOn ?? []) visit(dependency)
    state.set(key, 'done')
  }
  for (const task of tasks) visit(task.key)
  return issues
}

export function hasPlanBlockingIssues(draft: PlanDraft): boolean {
  return draft.tasks.some((task) => task.assignmentBlocked) || planDependencyIssues(draft.tasks).length > 0
}

export function computeStages(tasks: PlannedTask[], roleLabels: Record<PlanRole, string>): Stage[] {
  const keys = new Set(tasks.map((task) => task.key))
  const level = new Map<string, number>()
  const visiting = new Set<string>()
  const resolve = (task: PlannedTask): number => {
    if (level.has(task.key)) return level.get(task.key) ?? 0
    if (visiting.has(task.key)) return 0
    visiting.add(task.key)
    let current = 0
    for (const dependency of task.dependsOn) {
      if (!keys.has(dependency)) continue
      const parent = tasks.find((item) => item.key === dependency)
      if (parent) current = Math.max(current, resolve(parent) + 1)
    }
    visiting.delete(task.key)
    level.set(task.key, current)
    return current
  }
  const entries = tasks.map((task, index) => ({ task, index, level: resolve(task) }))
  const byLevel = new Map<number, TaskEntry[]>()
  for (const entry of entries) {
    const list = byLevel.get(entry.level) ?? []
    list.push(entry)
    byLevel.set(entry.level, list)
  }
  return [...byLevel.entries()]
    .sort(([a], [b]) => a - b)
    .map(([currentLevel, group], order) => {
      const roles = [...new Set(group.map((entry) => entry.task.role))]
      const title = roles.length === 1 ? `${roleLabels[roles[0]!] ?? roles[0]}阶段` : `阶段 ${order + 1}`
      return {
        id: `stage-${currentLevel}-${order}`,
        level: currentLevel,
        title,
        roles,
        entries: group.sort((a, b) => a.index - b.index),
        hasRisk: group.some((entry) => entry.task.assignmentBlocked),
      }
    })
}

/**
 * Presentation-only merge of dependency levels into role stages.
 * A plan can have many execution levels with the same role; the approved
 * Design Lab journey shows one stage per role, with all of that role's tasks
 * inside one expandable task-list group.
 */
export function mergeStagesByRole(stages: Stage[]): Stage[] {
  const groups = new Map<string, Stage>()
  for (const stage of stages) {
    const key = stage.roles.length === 1 ? `role:${stage.roles[0]}` : `title:${stage.title}`
    const current = groups.get(key)
    if (!current) {
      groups.set(key, { ...stage, entries: [...stage.entries] })
      continue
    }
    current.entries.push(...stage.entries)
    current.hasRisk = current.hasRisk || stage.hasRisk
    current.level = Math.min(current.level, stage.level)
  }
  return [...groups.values()]
    .sort((a, b) => a.level - b.level)
    .map((stage, index) => ({
      ...stage,
      id: `stage-${index}`,
      entries: [...stage.entries].sort((a, b) => a.index - b.index),
    }))
}
