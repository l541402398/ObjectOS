import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenAiResponsesProvider } from '@projectos/provider-openai-responses'
import type { ProviderStreamEvent } from '@projectos/provider-interfaces'

const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
})

describe('OpenAI Responses provider', () => {
  it('streams text, function calls and usage', async () => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        const payload = JSON.parse(body)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`)
        send({ type: 'response.output_text.delta', delta: 'hello ' })
        send({ type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'write_file' } })
        send({ type: 'response.function_call_arguments.delta', item_id: 'fc_1', delta: '{"path":"a.txt"}' })
        send({ type: 'response.output_item.done', item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'write_file', arguments: '{"path":"a.txt"}' } })
        send({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 12, output_tokens: 4 } } })
        res.end()
        expect(payload.model).toBe('test-model')
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const provider = new OpenAiResponsesProvider({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'test-model', apiKey: 'key' })
    const events: ProviderStreamEvent[] = []
    for await (const event of provider.stream({ messages: [{ role: 'user', content: 'hi' }], tools: [] }, new AbortController().signal)) {
      events.push(event)
    }
    expect(events.some((event) => event.type === 'text.delta' && event.text === 'hello ')).toBe(true)
    expect(events.some((event) => event.type === 'tool.call' && event.call.name === 'write_file')).toBe(true)
    expect(events.some((event) => event.type === 'usage' && event.inputTokens === 12 && event.outputTokens === 4)).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'completed' })
  })
})
