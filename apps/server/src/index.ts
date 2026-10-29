/**
 * A0 PoC entry point: starts the organization control-plane server on 127.0.0.1 only.
 *
 * Environment:
 *  - PORT                TCP port, default 4310
 *  - BETTER_AUTH_URL     public base URL, default http://127.0.0.1:${PORT}
 *  - BETTER_AUTH_SECRET  signing secret; a development fallback is used when absent, so a missing
 *                        secret in production is a deployment error the A1 plan must remove
 */
import { buildServer } from './app.js'

export { buildServer } from './app.js'

const port = Number.parseInt(process.env.PORT ?? '4310', 10)
const baseURL = process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${port}`
const secret = process.env.BETTER_AUTH_SECRET

if (!secret) {
  console.warn('[organization-server] BETTER_AUTH_SECRET is not set; using the A0 development fallback secret.')
}

const server = await buildServer({ baseURL, ...(secret === undefined ? {} : { secret }) })

await server.listen({ port, host: '127.0.0.1' })
console.log(`[organization-server] listening on ${baseURL} (A0 PoC; in-memory data only)`)
console.log(`[organization-server] better-auth mounted at ${baseURL}/api/auth/*`)

async function shutdown(signal: string): Promise<void> {
  console.log(`[organization-server] ${signal} received, closing`)
  await server.close()
  process.exit(0)
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
