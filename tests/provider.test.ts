import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OpenAiCompatibleProvider } from '@projectos/provider-openai-compatible'
import type { ProviderStreamEvent } from '@projectos/provider-interfaces'

let server: Server
let baseUrl = ''
let authHeader = ''
let requestCount = 0

function sse(res: import('node:http').ServerResponse, chunks: unknown[]): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
  res.write('data: [DONE]\n\n')
  res.end()
}

beforeAll(async () => {
  server = createServer((req, res) => {
    authHeader = req.headers.authorization ?? ''
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      const parsed = JSON.parse(body) as {
        stream?: boolean
        messages?: Array<{ role: string; content: string }>
      }
      requestCount += 1
      if (!parsed.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
        return
      }
      const lastUser = [...(parsed.messages ?? [])].reverse().find((message) => message.role === 'user')
      if (lastUser?.content.includes('tool-test')) {
        sse(res, [
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_abc',
                      function: { name: 'write_file', arguments: '{"path":"a.txt",' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: '"content":"hello"}' } }],
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        ])
        return
      }
      sse(res, [
        { choices: [{ delta: { content: 'Hello' } }] },
        { choices: [{ delta: { content: ' world' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      ])
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no server address')
  baseUrl = `http://127.0.0.1:${address.port}/v1`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

describe('OpenAI-compatible provider', () => {
  it('streams text deltas and usage', async () => {
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'fake-model', apiKey: 'test-key' })
    const events: ProviderStreamEvent[] = []
    for await (const event of provider.stream(
      { messages: [{ role: 'user', content: 'hello' }], tools: [] },
      new AbortController().signal,
    )) {
      events.push(event)
    }
    const text = events
      .filter((event): event is Extract<ProviderStreamEvent, { type: 'text.delta' }> => event.type === 'text.delta')
      .map((event) => event.text)
      .join('')
    expect(text).toBe('Hello world')
    expect(authHeader).toBe('Bearer test-key')
    const usage = events.find((event) => event.type === 'usage')
    expect(usage).toMatchObject({ inputTokens: 5, outputTokens: 2 })
  })

  it('assembles streamed tool call arguments', async () => {
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'fake-model', apiKey: 'test-key' })
    const events: ProviderStreamEvent[] = []
    for await (const event of provider.stream(
      { messages: [{ role: 'user', content: 'tool-test' }], tools: [] },
      new AbortController().signal,
    )) {
      events.push(event)
    }
    const toolCall = events.find((event) => event.type === 'tool.call')
    expect(toolCall).toMatchObject({
      type: 'tool.call',
      call: { id: 'call_abc', name: 'write_file', arguments: '{"path":"a.txt","content":"hello"}' },
    })
  })

  it('tests the connection with a non-streaming request', async () => {
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'fake-model', apiKey: 'test-key' })
    const before = requestCount
    const result = await provider.test(new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(requestCount).toBe(before + 1)
  })

  it('returns a clear error without a key', async () => {
    const provider = new OpenAiCompatibleProvider({ baseUrl, model: 'fake-model', apiKey: '' })
    await expect(async () => {
      for await (const _event of provider.stream(
        { messages: [{ role: 'user', content: 'hi' }], tools: [] },
        new AbortController().signal,
      )) {
        // no-op
      }
    }).rejects.toThrow(/API Key/)
  })
})
