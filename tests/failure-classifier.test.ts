import { describe, expect, it } from 'vitest'
import { classifyExecutionFailure } from '../apps/runtime/src/failure-classifier.js'

describe('execution failure classification', () => {
  it('does not ask the Replanner to fix provider protocol errors', () => {
    const result = classifyExecutionFailure(
      "模型服务返回 400：An assistant message with 'tool_calls' must be followed by tool messages (invalid_request_error)",
    )
    expect(result.class).toBe('provider_protocol')
    expect(result.replan).toBe(false)
    expect(result.action).toBe('fix_provider')
  })

  it('distinguishes auth, rate-limit and workspace failures from task design', () => {
    expect(classifyExecutionFailure('401 unauthorized: invalid api key').class).toBe('provider_auth')
    expect(classifyExecutionFailure('provider returned 429 rate limit').class).toBe('provider_unavailable')
    expect(classifyExecutionFailure('workspace worktree ENOENT: spawn failed').class).toBe('environment')
    expect(classifyExecutionFailure('workspace worktree ENOENT: spawn failed').replan).toBe(false)
  })

  it('allows replan for unavailable agents, quality gates, evidence and real implementation failures', () => {
    expect(classifyExecutionFailure('Agent 当前状态为 disabled，不能启动新的运行').class).toBe('agent_unavailable')
    expect(classifyExecutionFailure('Agent 当前状态为 disabled，不能启动新的运行').replan).toBe(true)
    expect(classifyExecutionFailure('质量门禁未通过：test').class).toBe('quality_gate')
    expect(classifyExecutionFailure('任务缺少有效完成依据：验收 Artifact 缺失').class).toBe('evidence')
    expect(classifyExecutionFailure('测试失败：断言 exit code 1').class).toBe('implementation')
  })

  it('defaults unknown failures to human review, not automatic DAG mutation', () => {
    const result = classifyExecutionFailure('something new happened')
    expect(result.class).toBe('unknown')
    expect(result.replan).toBe(false)
    expect(result.action).toBe('human_review')
  })
})
