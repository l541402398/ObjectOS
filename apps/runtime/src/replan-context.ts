import type {
  PlanContextSource,
  PlanDraft,
  PlanExecutionGrantView,
  ReplanTrigger,
} from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import { redactSecrets } from '@projectos/policy'

const MAX_CHARS = 14_000

export interface ReplanContext {
  text: string
  chars: number
  sources: PlanContextSource[]
  warnings: string[]
}

function clean(value: string, limit = 2_000): string {
  return redactSecrets(value.replace(/\0/g, '')).slice(0, limit)
}

function list(values: readonly string[], limit = 8): string {
  return values.slice(0, limit).map((value) => clean(value, 500)).join('；')
}

/**
 * Read-only execution facts for a replanner. It never reads file bodies or
 * secrets; tool args/results are reduced to status/error/path summaries.
 */
export function buildReplanContext(input: {
  store: SqliteStore
  plan: PlanDraft
  trigger: ReplanTrigger
  reason: string
  grant: PlanExecutionGrantView | null
  budgetChars?: number
}): ReplanContext {
  const { store, plan } = input
  const project = store.read.getProject(plan.projectId)
  if (!project) throw new Error('项目不存在')
  const tasks = store.read.listTaskCards(plan.projectId)
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const runs = store.read
    .listRunSummaries(plan.projectId, 200)
    .filter((run) => plan.createdTaskIds.includes(run.taskId ?? ''))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12)
  const runDetails = runs
    .map((run) => store.read.getRunDetail(run.id))
    .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
  const handoffs = store.read
    .listHandoffViews(plan.projectId)
    .filter((handoff) => plan.createdTaskIds.includes(handoff.sourceTaskId ?? ''))
    .slice(0, 8)
  const agents = store.read.getAgentViews(plan.projectId)
  const budget = store.read.getProjectBudget(plan.projectId)
  const usage = store.read.summarizeAIUsage(plan.projectId)
  const sources: PlanContextSource[] = []
  const warnings: string[] = []
  const sections: string[] = []

  const push = (kind: PlanContextSource['kind'], id: string, title: string, body: string): void => {
    const clipped = clean(body, Math.max(400, Math.min(3_000, body.length)))
    if (!clipped.trim()) return
    sections.push(`## ${title}\n${clipped}`)
    sources.push({ id, kind, title, chars: clipped.length, truncated: clipped.length < body.length })
  }

  push('project', project.id, '项目', [
    `名称：${project.name}`,
    `描述：${project.description || '无'}`,
    `根目录：项目工作区（绝对路径已省略）`,
    `阶段：${project.currentStage}；状态：${project.status}`,
  ].join('\n'))

  push('plan', plan.id, '当前计划', [
    `目标：${plan.goal}`,
    `revision：r${plan.revision}；状态：${plan.status}`,
    `来源：${plan.generatedBy}${plan.generation?.model ? ` / ${plan.generation.model}` : ''}`,
    `计划执行：${plan.execution ? `${plan.execution.status}；runIds=${plan.execution.runIds.length}；error=${plan.execution.error ?? '无'}` : '尚未启动'}`,
    `执行重试上限：${plan.execution?.maxRetries ?? '未启动'}；证据补证上限：${plan.execution?.maxEvidenceRetries ?? '未启动'}`,
  ].join('\n'))

  for (const [index, planned] of plan.tasks.entries()) {
    const card = taskById.get(plan.createdTaskIds[index] ?? '')
    const artifacts = card ? store.read.listArtifacts(plan.projectId, card.id) : []
    const verified = artifacts.filter((artifact) => artifact.verifiedAt !== null)
    const taskRuns = runDetails.filter((detail) => detail.run.taskId === card?.id)
    const toolLines = taskRuns.flatMap((detail) =>
      detail.toolCalls.map(
        (call) =>
          `  - ${call.toolName} ${call.status}${call.error ? `；error=${clean(call.error, 500)}` : ''}${
            typeof call.args?.path === 'string' ? `；path=${clean(call.args.path, 300)}` : ''
          }`,
      ),
    )
    push('task', `${plan.id}:${planned.key}`, `任务 ${planned.key}`, [
      `标题：${planned.title}`,
      `角色：${planned.role}；Agent：${planned.agentId ?? card?.assigneeAgentId ?? '未分配'}（${store.read.getAgent(planned.agentId ?? card?.assigneeAgentId ?? '')?.name ?? '未知'}）`,
      `状态：${card?.status ?? '未创建'}；依赖：${planned.dependsOn.join(', ') || '无'}`,
      `验收：${list(planned.acceptanceCriteria, 6)}`,
      `预期产物：${list(planned.expectedArtifacts, 6)}`,
      `Artifact：已验证 ${verified.length}；未验证 ${artifacts.length - verified.length}${
        verified.length ? `；${verified.map((artifact) => `${artifact.kind}:${clean(artifact.title, 120)}`).join(' | ')}` : ''
      }`,
      `Run：${taskRuns.map((detail) => `${detail.run.status}${detail.run.error ? `(${clean(detail.run.error, 300)})` : ''}`).join(', ') || '无'}`,
      ...(toolLines.length ? [`ToolCall：`, ...toolLines.slice(-8)] : []),
    ].join('\n'))
  }

  const fileChanges = runDetails.flatMap((detail) =>
    detail.fileChanges.map((change) => `${clean(change.path, 300)} (${change.changeType})`),
  )
  push('file', `${plan.id}:files`, '已记录的文件变化', fileChanges.length ? [...new Set(fileChanges)].slice(0, 30).join('\n') : '无已归属到本计划的文件变化')

  push('handoff', `${plan.id}:handoffs`, 'Handoff / 依赖交接', handoffs.length
    ? handoffs.map((handoff) => `${handoff.status} · ${clean(handoff.taskTitle, 200)} · ${handoff.fromAgentName} → ${handoff.toAgentName}${handoff.summary ? ` · ${clean(handoff.summary, 300)}` : ''}`).join('\n')
    : '无')

  push('agent', `${plan.id}:agents`, '当前 Agent 能力与可用性', agents.slice(0, 12).map((view) =>
    `${view.agent.name} · ${view.agent.role} · ${view.status} · capabilities=${(view.agent.capabilities ?? []).join(',')}`,
  ).join('\n'))

  push('grant', `${plan.id}:grant`, '当前计划执行授权', input.grant
    ? [
        `状态：${input.grant.status}；有效=${input.grant.valid}`,
        `actions=${input.grant.actions.join(',')}；paths=${input.grant.allowedPaths.join(',') || '无'}`,
        `任务=${input.grant.allowedTaskIds.length}；Agent=${input.grant.allowedAgentIds.join(',') || '无'}`,
        `runs=${input.grant.usedRuns}+${input.grant.reservedRuns}/${input.grant.maxRuns}；toolCalls=${input.grant.usedToolCalls}/${input.grant.maxToolCalls}`,
        `expires=${new Date(input.grant.expiresAt).toISOString()}；allowOverBudget=${input.grant.allowOverBudget}`,
        `失效原因：${input.grant.invalidReasons.join('；') || '无'}`,
      ].join('\n')
    : '未签发计划执行授权')

  push('budget', `${plan.projectId}:budget`, '预算与用量', [
    `软预算：${budget ? `${budget.softLimit} ${budget.currency}` : '未设置'}`,
    `已知费用：${usage.estimatedCost.toFixed(4)}；未知单价调用：${usage.unpricedCalls}；总 token：${usage.inputTokens + usage.outputTokens}`,
    `Planner calls=${usage.planner.calls}；Run calls=${usage.runs}`,
  ].join('\n'))

  push('decision', `${plan.id}:trigger`, '本次重规划触发', [
    `trigger=${input.trigger}`,
    `reason=${clean(input.reason, 3_000)}`,
    `事实边界：只使用本上下文中真实存在的 Run/ToolCall/Artifact/文件变化；Agent 的自然语言声明不是完成证据。`,
  ].join('\n'))

  const max = Math.max(4_000, input.budgetChars ?? MAX_CHARS)
  let text = sections.join('\n\n')
  if (text.length > max) {
    text = `${text.slice(0, max)}\n[replan context truncated at ${max} chars]`
    warnings.push(`重规划上下文超过 ${max} 字符，已截断；模型可能看不到较早的历史。`)
  }
  return { text: redactSecrets(text), chars: text.length, sources, warnings }
}
