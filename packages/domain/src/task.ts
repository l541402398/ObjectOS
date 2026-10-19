import { AppError } from '@projectos/contracts'
import type {
  ProjectStage,
  RunStatus,
  StageKey,
  StageStatus,
  Task,
  TaskDependency,
  TaskStatus,
} from '@projectos/contracts'
import { STAGE_KEYS } from '@projectos/contracts'

const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ['ready', 'cancelled'],
  ready: ['running', 'backlog', 'blocked', 'cancelled'],
  running: ['review', 'ready', 'blocked', 'cancelled'],
  review: ['done', 'running', 'blocked', 'cancelled'],
  done: ['review'],
  blocked: ['ready', 'backlog', 'cancelled'],
  cancelled: ['backlog'],
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to)
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new AppError('CONFLICT', `任务状态不能从 ${from} 直接变更为 ${to}`, {
      details: { from, to },
    })
  }
}

const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  created: ['queued', 'running', 'cancelled'],
  queued: ['running', 'cancelled', 'failed'],
  running: [
    'waiting_tool',
    'waiting_approval',
    'verifying',
    'completed',
    'failed',
    'cancelled',
    'suspended',
    'needs_reconciliation',
  ],
  waiting_tool: ['running', 'failed', 'cancelled', 'needs_reconciliation'],
  waiting_approval: ['running', 'failed', 'cancelled'],
  verifying: ['completed', 'failed', 'cancelled'],
  suspended: ['running', 'failed', 'cancelled', 'queued'],
  needs_reconciliation: ['running', 'completed', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
}

export function assertRunTransition(from: RunStatus, to: RunStatus): void {
  if (!RUN_TRANSITIONS[from].includes(to)) {
    throw new AppError('CONFLICT', `运行状态不能从 ${from} 变更为 ${to}`, { details: { from, to } })
  }
}

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return status === 'done' || status === 'cancelled'
}

export function isTerminalRunStatus(status: RunStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

export interface TaskDependencyGraph {
  readonly edges: readonly TaskDependency[]
}

export function createDependencyGraph(edges: TaskDependency[]): TaskDependencyGraph {
  return { edges: edges.map((edge) => ({ ...edge })) }
}

export function assertNoSelfDependency(taskId: string, dependsOnId: string): void {
  if (taskId === dependsOnId) {
    throw new AppError('CONFLICT', '任务不能依赖自身')
  }
}

/** Returns true when adding taskId → dependsOnId closes a cycle. */
export function wouldCreateCycle(edges: readonly TaskDependency[], taskId: string, dependsOnId: string): boolean {
  if (taskId === dependsOnId) return true
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.taskId) ?? []
    list.push(edge.dependsOnId)
    adjacency.set(edge.taskId, list)
  }
  const stack = [dependsOnId]
  const visited = new Set<string>()
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === taskId) return true
    if (visited.has(current)) continue
    visited.add(current)
    for (const next of adjacency.get(current) ?? []) stack.push(next)
  }
  return false
}

export function assertNoCycle(edges: readonly TaskDependency[]): void {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (edge.taskId === edge.dependsOnId) {
      throw new AppError('CONFLICT', '任务依赖图包含自环', { details: edge })
    }
    const list = adjacency.get(edge.taskId) ?? []
    list.push(edge.dependsOnId)
    adjacency.set(edge.taskId, list)
  }
  const visiting = new Set<string>()
  const done = new Set<string>()
  const visit = (id: string): void => {
    if (done.has(id)) return
    if (visiting.has(id)) {
      throw new AppError('CONFLICT', '任务依赖图存在环形依赖', { details: { taskId: id } })
    }
    visiting.add(id)
    for (const next of adjacency.get(id) ?? []) visit(next)
    visiting.delete(id)
    done.add(id)
  }
  for (const id of adjacency.keys()) visit(id)
}

export function topologicalTaskOrder(taskIds: string[], edges: readonly TaskDependency[]): string[] {
  assertNoCycle(edges)
  const indegree = new Map<string, number>(taskIds.map((id) => [id, 0]))
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    if (!indegree.has(edge.taskId) || !indegree.has(edge.dependsOnId)) continue
    indegree.set(edge.taskId, (indegree.get(edge.taskId) ?? 0) + 1)
    const list = adjacency.get(edge.dependsOnId) ?? []
    list.push(edge.taskId)
    adjacency.set(edge.dependsOnId, list)
  }
  const queue = taskIds.filter((id) => (indegree.get(id) ?? 0) === 0)
  const result: string[] = []
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(id)
    for (const next of adjacency.get(id) ?? []) {
      const value = (indegree.get(next) ?? 1) - 1
      indegree.set(next, value)
      if (value === 0) queue.push(next)
    }
  }
  return result
}

export interface CompletionCheckInput {
  task: Pick<Task, 'status' | 'acceptanceCriteria' | 'title'>
  dependencies: Array<Pick<Task, 'id' | 'status' | 'title'>>
  /** When true, the caller has already recorded a verifiable artifact for this completion. */
  hasVerifiableArtifact?: boolean
}

export interface CompletionCheckResult {
  ok: boolean
  blockers: string[]
}

export function checkTaskCompletion(input: CompletionCheckInput): CompletionCheckResult {
  const blockers: string[] = []
  for (const dependency of input.dependencies) {
    if (dependency.status !== 'done') {
      blockers.push(`依赖任务「${dependency.title}」尚未完成`)
    }
  }
  if (input.task.acceptanceCriteria.length === 0) {
    blockers.push('缺少验收标准，无法标记完成')
  }
  return { ok: blockers.length === 0, blockers }
}

export function assertTaskCanComplete(input: CompletionCheckInput): void {
  const result = checkTaskCompletion(input)
  if (!result.ok) {
    throw new AppError('CONFLICT', result.blockers.join('；'), { details: result.blockers })
  }
}

export interface ProjectProgress {
  total: number
  done: number
  cancelled: number
  running: number
  review: number
  progress: number
}

export function computeProjectProgress(
  tasks: Array<Pick<Task, 'status'>>,
): ProjectProgress {
  const total = tasks.length
  const done = tasks.filter((task) => task.status === 'done').length
  const cancelled = tasks.filter((task) => task.status === 'cancelled').length
  const running = tasks.filter((task) => task.status === 'running').length
  const review = tasks.filter((task) => task.status === 'review').length
  return {
    total,
    done,
    cancelled,
    running,
    review,
    progress: total === 0 ? 0 : (done + cancelled) / total,
  }
}

export function nextStageKey(current: StageKey): StageKey {
  const index = STAGE_KEYS.indexOf(current)
  return STAGE_KEYS[Math.min(index + 1, STAGE_KEYS.length - 1)] ?? current
}

export function previousStageKey(current: StageKey): StageKey {
  const index = STAGE_KEYS.indexOf(current)
  return STAGE_KEYS[Math.max(index - 1, 0)] ?? current
}

export interface StageSignals {
  approvedRequirements: number
  acceptedDecisions: number
  milestones: number
  readyTasks: number
  reviewOrDoneTasks: number
  verifiedArtifacts: number
  releaseArtifacts: number
}

export type StageGate = {
  stage: StageKey
  status: StageStatus
  ready: boolean
  requirement: string
  blockers: string[]
}

export function evaluateStageGates(stages: ProjectStage[], signals: StageSignals): StageGate[] {
  const byKey = new Map(stages.map((stage) => [stage.stage, stage]))
  const gates: StageGate[] = []
  for (const stage of STAGE_KEYS) {
    const blockers: string[] = []
    let requirement = ''
    switch (stage) {
      case 'ideation':
        requirement = '项目目标与范围已记录'
        if (!byKey.get('ideation')?.status || byKey.get('ideation')?.status === 'pending') {
          // Ideation only requires the project itself to exist.
        }
        break
      case 'requirements':
        requirement = '至少一条已批准需求'
        if (signals.approvedRequirements < 1) blockers.push('需要至少一条已批准需求')
        break
      case 'architecture':
        requirement = '至少一条已接受架构决策（ADR）'
        if (signals.acceptedDecisions < 1) blockers.push('需要至少一条已接受 ADR')
        break
      case 'planning':
        requirement = '至少一个里程碑'
        if (signals.milestones < 1) blockers.push('需要至少一个里程碑')
        break
      case 'implementation':
        requirement = '存在就绪或执行中的任务'
        if (signals.readyTasks < 1) blockers.push('需要至少一个就绪任务')
        break
      case 'testing':
        requirement = '存在待审查或已完成任务'
        if (signals.reviewOrDoneTasks < 1) blockers.push('需要至少一个进入审查/完成状态的任务')
        break
      case 'release':
        requirement = '存在已验证交付物'
        if (signals.verifiedArtifacts < 1) blockers.push('需要至少一个已验证 Artifact')
        break
      case 'maintenance':
        requirement = '存在发布交付物'
        if (signals.releaseArtifacts < 1) blockers.push('需要至少一个发布类 Artifact')
        break
    }
    const record = byKey.get(stage)
    gates.push({
      stage,
      status: record?.status ?? 'pending',
      ready: blockers.length === 0,
      requirement,
      blockers,
    })
  }
  return gates
}

export function assertStageAdvanceAllowed(gates: StageGate[], target: StageKey): void {
  const index = STAGE_KEYS.indexOf(target)
  const blockers: string[] = []
  for (const stage of STAGE_KEYS.slice(0, index + 1)) {
    const gate = gates.find((item) => item.stage === stage)
    if (gate && !gate.ready) {
      blockers.push(...gate.blockers.map((blocker) => `${stage}: ${blocker}`))
    }
  }
  if (blockers.length > 0) {
    throw new AppError('CONFLICT', '生命周期阶段守卫未通过', { details: blockers })
  }
}

const PRIORITY_WEIGHT: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3 }

export function compareTaskPriority(a: Pick<Task, 'priority' | 'createdAt'>, b: Pick<Task, 'priority' | 'createdAt'>): number {
  const weight = (PRIORITY_WEIGHT[a.priority] ?? 3) - (PRIORITY_WEIGHT[b.priority] ?? 3)
  if (weight !== 0) return weight
  return a.createdAt - b.createdAt
}

export function stageIndex(stage: StageKey): number {
  return STAGE_KEYS.indexOf(stage)
}
