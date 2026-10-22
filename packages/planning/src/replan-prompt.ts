import type { ReplanTrigger } from '@projectos/contracts'
import { planSystemPrompt } from './planner-prompt.js'

export const REPLAN_PROMPT_VERSION = 'replan-v1'

const TRIGGER_LABEL: Record<ReplanTrigger, string> = {
  retry_exhausted: '任务重试已用尽',
  evidence_exhausted: '完成证据/补证已用尽',
  quality_gate_failed: '质量门禁失败',
  agent_unavailable: 'Agent 或 Runtime 不可用',
  artifact_invalid: '上游 Artifact 无效',
  user_requested: '用户主动请求调整',
  constraints_changed: '项目约束发生变化',
}

/**
 * Replanner system prompt. It intentionally starts from the Planner contract so
 * the model output has the same schema, but adds revision-specific safety rules.
 */
export function replanSystemPrompt(): string {
  return `${planSystemPrompt()}

## 这是执行中的“修订计划”，不是重新生成一份无关计划
- 你必须输出完整的新 revision（保留/修改/新增后的完整任务列表），不是补丁；顶层额外输出 "reason": "一句为什么需要修订"。
- 只有上下文明确证明的失败/约束才可作为修订理由；禁止编造未发生的失败、测试结果、文件变化、Artifact 或 Agent 状态。
- 已完成且验收标准/产物未变的任务应保留相同 key；不要为了显得“重新规划过”而改名或重写已完成任务。
- 已完成任务的历史 Run/Artifact 不会被删除；如果其验收标准或产物发生变化，必须安排新的执行与证据，不能仅凭标题相同就复用。
- 不要删除仍必须完成的需求来让计划“通过”；不得通过降低验收标准、隐藏失败或减少必需产物来规避问题。
- 如果现有计划仍可通过重试、补证、合法换人解决，不要提出 DAG 修订；把原因留在 assumptions/risks 中。
- 不要输出 Agent/Runtime 字段；真实 Agent 由系统重新校验能力、可用性和负载后分配。
- 你只生成提案，不能直接启动、取消或修改正在执行的 Scheduler。`
}

const TRIGGER_LABEL_TEXT = (trigger: ReplanTrigger): string => TRIGGER_LABEL[trigger] ?? trigger

export function buildReplanUserPrompt(input: {
  goal: string
  sourceRevision: number
  trigger: ReplanTrigger
  reason: string
  context: string
  maxTasks: number
}): string {
  return `## 当前需求
${input.goal}

## 当前计划
revision r${input.sourceRevision}

## 触发原因
${TRIGGER_LABEL_TEXT(input.trigger)}：${input.reason}

## 真实执行事实（只读、脱敏、按预算截断）
${input.context}

## 输出要求
1. 只输出一个 JSON 对象：{"reason": string, "assumptions": string[], "risks": string[], "tasks": [...]}。
2. tasks 是修订后的完整 DAG，最多 ${input.maxTasks} 个节点；保留节点的 key 必须与当前计划一致。
3. 每个任务继续使用 Planner 的字段：key/title/description/role/capabilities/hardCapabilities/dependsOn/acceptanceCriteria/expectedArtifacts/rationale/requiresApproval。
4. 已完成且需求未变的任务应保留；新增/修改/删除的任务必须能由触发事实解释。
5. 不得降低验收标准，不得伪造证据；新的验收/产物要求必须能被执行和验证。
6. 如果事实不足，宁可在 assumptions/risks 中说明并给保守方案，不要编造。`
}
