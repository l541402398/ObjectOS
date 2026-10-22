import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatRequest, LlmProvider, ProviderStreamEvent } from '@projectos/provider-interfaces'
import { repairToolCallTranscript, runAgentLoop } from '@projectos/agent-runtime'

function assertProtocol(messages: ChatMessage[]): void {
  const seenToolCalls = new Set<string>()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!
    if (message.role === 'tool') {
      expect(message.toolCallId, `orphan tool at ${index}`).toBeTruthy()
      expect(seenToolCalls.has(message.toolCallId!), `tool result without assistant call: ${message.toolCallId}`).toBe(true)
      continue
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      const ids = message.toolCalls.map((call) => call.id)
      for (const id of ids) seenToolCalls.add(id)
      const following = messages.slice(index + 1, index + 1 + ids.length)
      expect(following.every((item) => item.role === 'tool'), `assistant tool_calls not followed by tool messages at ${index}`).toBe(true)
      expect(following.map((item) => item.toolCallId)).toEqual(ids)
      index += ids.length
    }
  }
}

class ScriptedProvider implements LlmProvider {
  readonly id = 'protocol-test'
  readonly model = 'protocol-test-model'
  readonly requests: ChatRequest[] = []
  constructor(private readonly script: (call: number) => ProviderStreamEvent[]) {}

  async *stream(request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
    this.requests.push(structuredClone(request))
    for (const event of this.script(this.requests.length)) yield event
  }

  async test() {
    return { ok: true, latencyMs: 0, message: 'ok' }
  }
}

describe('Agent provider protocol transcript', () => {
  it('leaves a fully paired multi-turn transcript unchanged', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'read_file', arguments: '{}' }] },
      { role: 'tool', toolCallId: 'call-1', content: '{"ok":true}' },
      { role: 'assistant', content: 'done' },
    ]
    expect(repairToolCallTranscript(messages)).toEqual(messages)
    assertProtocol(messages)
  })

  it('repairs a missing tool result after pause/crash without dropping the call', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: '', toolCalls: [
        { id: 'call-1', name: 'read_file', arguments: '{}' },
        { id: 'call-2', name: 'write_file', arguments: '{}' },
      ] },
      { role: 'tool', toolCallId: 'call-1', content: '{"ok":true}' },
      { role: 'user', content: 'continue' },
    ]
    const repaired = repairToolCallTranscript(messages)
    assertProtocol(repaired)
    const missing = repaired.find((message) => message.role === 'tool' && message.toolCallId === 'call-2')
    expect(missing?.content).toContain('missingToolResult')
    expect(repaired.find((message) => message.role === 'assistant')?.toolCalls).toHaveLength(2)
  })

  it('drops orphan tool messages and preserves successful multi-round history', async () => {
    const provider = new ScriptedProvider((call) =>
      call === 1
        ? [
            { type: 'tool.call', call: { id: 'call-1', name: 'read_file', arguments: '{}' } },
            { type: 'done', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text.delta', text: 'done' },
            { type: 'usage', inputTokens: 10, outputTokens: 2 },
            { type: 'done', finishReason: 'stop' },
          ],
    )
    const result = await runAgentLoop({
      provider,
      tools: [],
      messages: [
        { role: 'user', content: 'go' },
        { role: 'tool', toolCallId: 'orphan', content: '{"stale":true}' },
      ],
      signal: new AbortController().signal,
      executeTool: async () => ({ status: 'completed', result: { ok: true } }),
    })
    expect(result.status).toBe('completed')
    expect(provider.requests).toHaveLength(2)
    assertProtocol(provider.requests[1]!.messages)
    expect(provider.requests[1]!.messages.some((message) => message.toolCallId === 'orphan')).toBe(false)
  })

  it('records a tool failure result instead of leaving an unpaired call', async () => {
    const provider = new ScriptedProvider((call) =>
      call === 1
        ? [
            { type: 'tool.call', call: { id: 'call-fail', name: 'run_command', arguments: '{}' } },
            { type: 'done', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text.delta', text: 'tool failed' },
            { type: 'done', finishReason: 'stop' },
          ],
    )
    const result = await runAgentLoop({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      signal: new AbortController().signal,
      executeTool: async () => ({ status: 'failed', error: 'command exploded' }),
    })
    expect(result.status).toBe('completed')
    assertProtocol(provider.requests[1]!.messages)
    expect(provider.requests[1]!.messages.find((message) => message.role === 'tool')?.content).toContain('command exploded')
  })

  it('keeps an explicit denied result for approval rejection and repairs paused state on resume', async () => {
    const provider = new ScriptedProvider((call) =>
      call === 1
        ? [
            { type: 'tool.call', call: { id: 'call-denied', name: 'write_file', arguments: '{}' } },
            { type: 'done', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text.delta', text: 'ok' },
            { type: 'done', finishReason: 'stop' },
          ],
    )
    const denied = await runAgentLoop({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      signal: new AbortController().signal,
      executeTool: async () => ({ status: 'denied', error: 'user rejected' }),
    })
    expect(denied.status).toBe('completed')
    assertProtocol(provider.requests[1]!.messages)
    expect(provider.requests[1]!.messages.find((message) => message.role === 'tool')?.content).toContain('user rejected')

    const pausedProvider = new ScriptedProvider(() => [
      { type: 'tool.call', call: { id: 'call-paused', name: 'write_file', arguments: '{}' } },
      { type: 'done', finishReason: 'tool_calls' },
    ])
    const paused = await runAgentLoop({
      provider: pausedProvider,
      tools: [],
      messages: [{ role: 'user', content: 'go' }],
      signal: new AbortController().signal,
      executeTool: async () => ({ status: 'paused', approvalId: 'apr-1' }),
    })
    expect(paused.status).toBe('waiting_approval')
    const repaired = repairToolCallTranscript(paused.messages)
    assertProtocol(repaired)
    expect(repaired.find((message) => message.role === 'tool' && message.toolCallId === 'call-paused')).toBeTruthy()
  })
})
