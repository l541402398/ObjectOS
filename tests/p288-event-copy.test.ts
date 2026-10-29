import { describe, expect, it } from 'vitest'
import { PROJECT_EVENT_TYPES, summarizeProjectEvent } from '../packages/domain/src/events.js'
import { eventTypeLabel } from '../apps/desktop/src/renderer/src/lib/labels.js'

const CJK = /[\u4e00-\u9fa5]/

/**
 * ADR-0038 — activity and the event stream must speak Chinese. A user reported seeing
 * `run.status.changed`, `project.event` and `tool.completed` in 项目中心 · 最近动态, which says
 * nothing about what happened. The domain summarizer is the single place that turns an event into
 * a sentence, so every known type is asserted here.
 */
describe('ADR-0038 every project event has a user-facing Chinese description', () => {
  it('never falls back to the raw dotted type for any known event', () => {
    for (const eventType of Object.values(PROJECT_EVENT_TYPES)) {
      const presentation = summarizeProjectEvent({ eventType, payload: {} })
      expect(presentation.summary, eventType).not.toBe(eventType)
      expect(presentation.summary, eventType).not.toMatch(/^[a-z]+(\.[a-zA-Z_]+)+$/)
      expect(presentation.summary, eventType).toMatch(CJK)
      expect(['neutral', 'accent', 'success', 'warning', 'danger']).toContain(presentation.tone)
    }
  })

  it('describes run lifecycle, tool calls and plan state changes in user language', () => {
    expect(
      summarizeProjectEvent({
        eventType: PROJECT_EVENT_TYPES.runStatusChanged,
        payload: { status: 'running', title: '修复求和实现' },
      }).summary,
    ).toBe('Agent 运行开始执行：修复求和实现')
    expect(
      summarizeProjectEvent({
        eventType: PROJECT_EVENT_TYPES.runStatusChanged,
        payload: { status: 'waiting_approval' },
      }).summary,
    ).toBe('Agent 运行等待你的审批')
    expect(
      summarizeProjectEvent({ eventType: PROJECT_EVENT_TYPES.toolCompleted, payload: { toolName: 'run_tests' } }).summary,
    ).toBe('工具执行完成：run_tests')
    expect(
      summarizeProjectEvent({
        eventType: PROJECT_EVENT_TYPES.planStatusChanged,
        payload: { to: 'paused', reason: 'approval.waiting', revision: 2 },
      }).summary,
    ).toBe('计划第 2 版已暂停（等待审批期间暂停）')
    expect(
      summarizeProjectEvent({
        eventType: PROJECT_EVENT_TYPES.planStatusChanged,
        payload: { to: 'running', reason: 'policy.autoStart' },
      }).summary,
    ).toBe('计划执行中（由授权策略自动开始）')
  })

  it('translates internal kinds and failure classes instead of leaking enum values', () => {
    const custom = summarizeProjectEvent({
      eventType: PROJECT_EVENT_TYPES.custom,
      payload: { kind: 'plan.autoDelivered' },
    })
    expect(custom.summary).toContain('已自动合并交付')
    expect(custom.summary).not.toContain('plan.')

    const classified = summarizeProjectEvent({
      eventType: PROJECT_EVENT_TYPES.planExecutionFailureClassified,
      payload: { failureClass: 'quality_gate', replan: true },
    })
    expect(classified.summary).toBe('执行受阻：质量门禁未通过（AI 可以尝试修订计划）')
    expect(classified.summary).not.toContain('quality_gate')
  })

  it('gives every event a short Chinese badge label, never the raw type', () => {
    for (const eventType of Object.values(PROJECT_EVENT_TYPES)) {
      const label = eventTypeLabel(eventType)
      expect(label, eventType).toMatch(CJK)
      expect(label, eventType).not.toContain('.')
    }
    expect(eventTypeLabel('something.unknown')).toBe('事件')
  })
})
