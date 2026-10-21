import { newId, now, type PlanDraft, type PlannedTask, type ProjectSnapshot } from '@projectos/contracts'

export * from './assignment.js'

const ROLE_AGENT: Record<PlannedTask['role'], string> = {
  architect: 'agt_architect',
  developer: 'agt_engineer',
  reviewer: 'agt_reviewer',
  tester: 'agt_qa',
  custom: 'agt_product',
}

export function agentForPlanRole(role: PlannedTask['role']): string {
  return ROLE_AGENT[role]
}

/** Explicit node assignment wins; otherwise keep the legacy role default. */
export function agentForPlannedTask(task: Pick<PlannedTask, 'role' | 'agentId'>): string {
  return task.agentId ?? agentForPlanRole(task.role)
}

export function generateLocalPlan(input: {
  projectId: string
  goal: string
  revision: number
  snapshot?: ProjectSnapshot | null
}): PlanDraft {
  const goal = input.goal.trim()
  const snapshot = input.snapshot
  const stack = snapshot
    ? [...snapshot.languages, ...snapshot.frameworks.map((framework) => framework.name)].join(' / ')
    : '未扫描'
  const tasks: PlannedTask[] = [
    {
      key: 'architecture',
      title: `分析「${goal}」的架构与影响面`,
      description: `基于项目快照（${stack}）确认边界、依赖与风险，产出实施方案。`,
      role: 'architect',
      assignmentReasons: [],
      assignmentBlocked: false,
      dependsOn: [],
      acceptanceCriteria: ['列出受影响模块与文件', '记录关键取舍与风险', '给出可执行的实施步骤'],
      expectedArtifacts: ['ADR / 实施说明'],
      requiresApproval: false,
    },
    {
      key: 'implementation',
      title: `实现「${goal}」`,
      description: '按架构方案完成代码修改，补充必要测试；写入和执行命令需授权。',
      role: 'developer',
      assignmentReasons: [],
      assignmentBlocked: false,
      dependsOn: ['architecture'],
      acceptanceCriteria: ['代码可构建', '新增逻辑有测试', '不破坏现有行为'],
      expectedArtifacts: ['代码 diff', '测试结果'],
      requiresApproval: true,
    },
    {
      key: 'review',
      title: `审查「${goal}」的实现`,
      description: '检查 diff、验收标准、错误处理与测试缺口。',
      role: 'reviewer',
      assignmentReasons: [],
      assignmentBlocked: false,
      dependsOn: ['implementation'],
      acceptanceCriteria: ['逐条核对验收标准', '指出具体风险与缺失测试'],
      expectedArtifacts: ['审查报告'],
      requiresApproval: false,
    },
    {
      key: 'verification',
      title: `验证「${goal}」`,
      description: '执行项目已有检查与验收场景，记录真实命令和结果。',
      role: 'tester',
      assignmentReasons: [],
      assignmentBlocked: false,
      dependsOn: ['review'],
      acceptanceCriteria: ['记录命令、退出码与输出', '失败项进入 blocked，不标记完成'],
      expectedArtifacts: ['测试报告'],
      requiresApproval: true,
    },
  ]
  const timestamp = now()
  return {
    id: newId('pln'),
    projectId: input.projectId,
    revision: input.revision,
    status: 'draft',
    goal,
    tasks,
    assumptions: [
      snapshot ? `项目技术栈：${stack}` : '尚未扫描项目，计划基于文本目标生成。',
      '本地规则草案，不替代架构师判断。',
    ],
    risks: [
      ...(snapshot?.warnings ?? []).slice(0, 5),
      '实现范围可能随代码阅读调整，需要在批准前复核。',
    ],
    generatedBy: 'local-rules',
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: null,
    createdTaskIds: [],
    execution: null,
  }
}

export function validatePlanDraft(plan: PlanDraft): void {
  if (plan.tasks.length === 0) throw new Error('计划没有任务')
  const keys = new Set<string>()
  for (const task of plan.tasks) {
    if (keys.has(task.key)) throw new Error(`任务 key 重复：${task.key}`)
    keys.add(task.key)
  }
  for (const task of plan.tasks) {
    for (const dependency of task.dependsOn) {
      if (!keys.has(dependency)) throw new Error(`依赖不存在：${task.key} → ${dependency}`)
      if (dependency === task.key) throw new Error(`任务不能依赖自身：${task.key}`)
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byKey = new Map(plan.tasks.map((task) => [task.key, task]))
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error(`计划存在环形依赖：${key}`)
    if (visited.has(key)) return
    visiting.add(key)
    const task = byKey.get(key)
    if (!task) throw new Error(`任务不存在：${key}`)
    for (const dependency of task.dependsOn) visit(dependency)
    visiting.delete(key)
    visited.add(key)
  }
  for (const task of plan.tasks) visit(task.key)
}

export function topologicalPlanTasks(plan: PlanDraft): PlannedTask[] {
  validatePlanDraft(plan)
  const byKey = new Map(plan.tasks.map((task) => [task.key, task]))
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
  for (const task of plan.tasks) visit(task.key)
  return result
}

/** Longest dependency chain by task count. Deterministic tie-break by task order. */
export function criticalPathTasks(plan: PlanDraft): PlannedTask[] {
  validatePlanDraft(plan)
  const byKey = new Map(plan.tasks.map((task) => [task.key, task]))
  const memo = new Map<string, PlannedTask[]>()
  const visit = (key: string): PlannedTask[] => {
    const cached = memo.get(key)
    if (cached) return cached
    const task = byKey.get(key)
    if (!task) return []
    let best: PlannedTask[] = []
    for (const dependency of task.dependsOn) {
      const chain = visit(dependency)
      if (chain.length > best.length) best = chain
    }
    const result = [...best, task]
    memo.set(key, result)
    return result
  }
  let critical: PlannedTask[] = []
  for (const task of plan.tasks) {
    const chain = visit(task.key)
    if (chain.length > critical.length) critical = chain
  }
  return critical
}
