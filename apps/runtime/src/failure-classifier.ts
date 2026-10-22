export type ExecutionFailureClass =
  | 'provider_protocol'
  | 'provider_auth'
  | 'provider_unavailable'
  | 'tool_error'
  | 'environment'
  | 'task_design'
  | 'implementation'
  | 'quality_gate'
  | 'evidence'
  | 'agent_unavailable'
  | 'unknown'

export interface FailureClassification {
  class: ExecutionFailureClass
  /** True only when changing the task DAG/acceptance can address the cause. */
  replan: boolean
  /** Existing retry/reconcile/handoff mechanisms remain preferred. */
  action: 'retry' | 'reconcile' | 'reassign_or_replan' | 'fix_environment' | 'fix_provider' | 'human_review'
  reason: string
}

const RULES: Array<{
  class: ExecutionFailureClass
  pattern: RegExp
  replan: boolean
  action: FailureClassification['action']
  reason: string
}> = [
  {
    class: 'provider_protocol',
    pattern: /tool_calls?|tool_call_id|assistant message|invalid_request_error|required.*followed by|协议/i,
    replan: false,
    action: 'fix_provider',
    reason: 'Provider 请求/响应协议异常，修改 DAG 不能修复；应记录协议诊断并重试运行。',
  },
  {
    class: 'provider_auth',
    pattern: /401|403|unauthorized|authentication|api[ _-]?key|鉴权|密钥/i,
    replan: false,
    action: 'fix_provider',
    reason: 'Provider 鉴权/配置问题，不是任务设计问题；需要修复连接或凭据。',
  },
  {
    class: 'provider_unavailable',
    pattern: /ECONN|ETIMEDOUT|ENOTFOUND|429|502|503|rate.?limit|temporarily unavailable|服务不可用|限流/i,
    replan: false,
    action: 'retry',
    reason: 'Provider 暂时不可用/限流；优先重试或等待，不应让模型改 DAG。',
  },
  {
    class: 'environment',
    pattern: /workspace|worktree|ENOENT|EACCES|not installed|未安装|权限不足|磁盘|环境配置/i,
    replan: false,
    action: 'fix_environment',
    reason: '执行环境/Workspace 配置问题，应修复环境后重试。',
  },
  {
    class: 'agent_unavailable',
    pattern: /Agent.*(disabled|不可用|不存在|状态)|Runtime.*(unavailable|不可用)|没有 assignee|没有分配 Agent/i,
    replan: true,
    action: 'reassign_or_replan',
    reason: 'Agent/Runtime 不可用且既有合法替代无法解决，应进入替代或精炼的 Replan。',
  },
  {
    class: 'quality_gate',
    pattern: /质量门禁|quality.?gate|必需检查|required script|必需脚本/i,
    replan: true,
    action: 'reassign_or_replan',
    reason: '质量门禁失败可能需要调整任务/验收或修复测试；先检查是否可由补证/修复解决。',
  },
  {
    class: 'evidence',
    pattern: /完成依据|补证|缺少.*Artifact|缺少.*证据|evidence/i,
    replan: true,
    action: 'reassign_or_replan',
    reason: '必要证据不足且补证已耗尽，可提出更明确的证据/验收修订。',
  },
  {
    class: 'implementation',
    pattern: /测试失败|断言失败|exit code|命令失败|构建失败|实现失败|断言|任务执行失败|任务失败|重试已用尽/i,
    replan: true,
    action: 'reassign_or_replan',
    reason: '真实实施/测试失败可能需要调整实现任务或依赖；先保留重试与补证记录。',
  },
  {
    class: 'tool_error',
    pattern: /tool|工具|审批拒绝|denied|approval/i,
    replan: false,
    action: 'human_review',
    reason: '工具/审批技术失败优先人工核对或重新执行，不应默认改 DAG。',
  },
]

export function classifyExecutionFailure(error: string): FailureClassification {
  const text = error.slice(0, 8_000)
  for (const rule of RULES) {
    if (rule.pattern.test(text)) {
      return { class: rule.class, replan: rule.replan, action: rule.action, reason: rule.reason }
    }
  }
  return {
    class: 'unknown',
    replan: false,
    action: 'human_review',
    reason: '失败原因未归类；默认不在缺少真实事实时自动修改 DAG。',
  }
}
