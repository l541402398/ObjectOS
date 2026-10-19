import { describe, expect, it } from 'vitest'
import { runAgentLoop, type ToolOutcome } from '@projectos/agent-runtime'
import type {
  ChatRequest,
  LlmProvider,
  ProviderStreamEvent,
  ToolCallRequest,
} from '@projectos/provider-interfaces'

class ScriptedProvider implements LlmProvider {
  readonly id = 'scripted'
  readonly model = 'scripted'
  private turn = 0
  constructor(private readonly script: Array<ProviderStreamEvent[]>) {}

  async *stream(_request: ChatRequest): AsyncIterable<ProviderStreamEvent> {
    const events = this.script[this.turn] ?? [{ type: 'done' as const, finishReason: 'stop' }]
    this.turn += 1
    for (const event of events) yield event
  }

  async test(): Promise<{ ok: boolean; latencyMs: number; message: string }> {
    return { ok: true, latencyMs: 1, message: 'ok' }
  }
}

const toolCall: ToolCallRequest = {
  id: 'call_1',
  name: 'read_file',
  arguments: '{"path":"README.md"}',
}

describe('native agent loop', () => {
  it('streams text, executes a tool, and completes on the next turn', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'text.delta', text: 'Let me look. ' },
        { type: 'tool.call', call: toolCall },
        { type: 'usage', inputTokens: 10, outputTokens: 4 },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text.delta', text: 'The file is read.' },
        { type: 'done', finishReason: 'stop' },
      ],
    ])
    const executed: string[] = []
    const result = await runAgentLoop({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'Inspect the readme' }],
      signal: new AbortController().signal,
      executeTool: async (invocation) => {
        executed.push(invocation.name)
        return { status: 'completed', result: { content: 'hello' } }
      },
    })
    expect(result.status).toBe('completed')
    expect(result.steps).toBe(2)
    expect(result.text).toContain('The file is read.')
    expect(executed).toEqual(['read_file'])
    const toolMessage = result.messages.find((message) => message.role === 'tool')
    expect(toolMessage?.content).toContain('hello')
  })

  it('pauses when a tool requires approval', async () => {
    const provider = new ScriptedProvider([
      [
        { type: 'text.delta', text: 'I need to write a file.' },
        { type: 'tool.call', call: { ...toolCall, name: 'write_file' } },
        { type: 'done', finishReason: 'tool_calls' },
      ],
    ])
    const result = await runAgentLoop({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'Implement it' }],
      signal: new AbortController().signal,
      executeTool: async (): Promise<ToolOutcome> => ({ status: 'paused', approvalId: 'apr_1' }),
    })
    expect(result.status).toBe('waiting_approval')
    expect(result.approvalId).toBe('apr_1')
    expect(result.messages.some((message) => message.role === 'assistant' && message.toolCalls?.length)).toBe(true)
  })

  it('reports provider failures without inventing completion', async () => {
    const provider: LlmProvider = {
      id: 'failing',
      model: 'failing',
      async *stream(): AsyncIterable<ProviderStreamEvent> {
        throw new Error('network down')
      },
      async test() {
        return { ok: false, latencyMs: 0, message: 'fail' }
      },
    }
    const result = await runAgentLoop({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'run' }],
      signal: new AbortController().signal,
      executeTool: async () => ({ status: 'completed', result: null }),
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('network down')
  })

  it('stops after the maximum number of tool turns', async () => {
    const provider: LlmProvider = {
      id: 'loop',
      model: 'loop',
      async *stream(): AsyncIterable<ProviderStreamEvent> {
        yield { type: 'tool.call', call: toolCall }
        yield { type: 'done', finishReason: 'tool_calls' }
      },
      async test() {
        return { ok: true, latencyMs: 1, message: 'ok' }
      },
    }
    const result = await runAgentLoop({
      provider,
      tools: [],
      messages: [{ role: 'user', content: 'loop' }],
      maxSteps: 3,
      signal: new AbortController().signal,
      executeTool: async () => ({ status: 'completed', result: 'again' }),
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('最大工具轮次')
  })
})
