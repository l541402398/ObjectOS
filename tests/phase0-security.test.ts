import { describe, expect, it } from 'vitest'
import { ApiSchemas } from '@projectos/contracts'
import { assertExternalWriteAllowed } from '../apps/runtime/src/external-runner.js'
import { assertCoordinatedTaskScope } from '../apps/runtime/src/agent-runner.js'
import { autoQualityGateEnabled } from '../apps/runtime/src/quality-gate.js'

describe('Phase 0 execution boundary', () => {
  it('does not expose raw runtime prompt/execute methods through the typed API', () => {
    expect('runtime.execute' in ApiSchemas).toBe(false)
    expect('runtime.acpPrompt' in ApiSchemas).toBe(false)
  })

  it('fails closed for external Agent write mode and keeps read-only available', () => {
    expect(() => assertExternalWriteAllowed(true)).toThrowError(/写模式.*禁用/)
    expect(() => assertExternalWriteAllowed(false)).not.toThrow()
  })

  it('rejects coordination on a task from another project', () => {
    expect(() =>
      assertCoordinatedTaskScope({
        action: 'update',
        projectId: 'prj_a',
        agentId: 'agt_a',
        runTaskId: null,
        target: { id: 'tsk_b', projectId: 'prj_b', assigneeAgentId: 'agt_a' },
      }),
    ).toThrowError(/其他项目/)
  })

  it('rejects coordination on a different task in the same project/plan', () => {
    expect(() =>
      assertCoordinatedTaskScope({
        action: 'update',
        projectId: 'prj_a',
        agentId: 'agt_a',
        runTaskId: 'tsk_current',
        target: { id: 'tsk_other', projectId: 'prj_a', assigneeAgentId: 'agt_a' },
      }),
    ).toThrowError(/当前计划/)
  })

  it('rejects handoff when the run has no bound task', () => {
    expect(() =>
      assertCoordinatedTaskScope({
        action: 'handoff',
        projectId: 'prj_a',
        agentId: 'agt_a',
        runTaskId: null,
        target: { id: 'tsk_a', projectId: 'prj_a', assigneeAgentId: 'agt_a' },
      }),
    ).toThrowError(/没有运行绑定任务/)
  })

  it('does not auto-run package scripts outside the test harness', () => {
    expect(autoQualityGateEnabled({ NODE_ENV: 'production' })).toBe(false)
    expect(autoQualityGateEnabled({ NODE_ENV: 'test' })).toBe(true)
    expect(autoQualityGateEnabled({ PROJECTOS_ENABLE_AUTO_QUALITY_GATE: '1' })).toBe(true)
  })
})
