/** Local-only desktop acceptance environment. No accounts or business data are seeded by API. */
import { randomBytes } from 'node:crypto'
import { startOrganizationTestDatabase, reserveOrganizationTestPort } from '../tests/helpers/org-postgres.js'
import { migrateOrganizationDatabase } from '../apps/server/src/postgres-store.js'
import { buildOrganizationServer } from '../apps/server/src/persistent-server.js'

const database = await startOrganizationTestDatabase()
let server: Awaited<ReturnType<typeof buildOrganizationServer>> | undefined
try {
  await migrateOrganizationDatabase(database.pool)
  const port = await reserveOrganizationTestPort()
  const baseURL = `http://127.0.0.1:${port}`
  server = await buildOrganizationServer({ databaseUrl: database.databaseUrl, secret: randomBytes(32).toString('hex'), baseURL })
  await server.listen({ host: '127.0.0.1', port })
  console.log(`Local organization desktop acceptance URL: ${baseURL}`)
  console.log('Isolated temporary PostgreSQL. Register/sign in through the browser UI; no production account is used.')
  console.log('Stop with Ctrl+C. This disposable environment is removed when stopped.')
  let stopping = false
  const shutdown = async () => {
    if (stopping) return
    stopping = true
    await server?.close()
    await database.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
} catch (error) {
  await server?.close()
  await database.stop()
  throw error
}
