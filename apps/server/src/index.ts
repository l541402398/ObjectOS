import { Pool } from 'pg'
import { buildOrganizationServer, validateOrganizationServerOptions } from './persistent-server.js'
import { migrateOrganizationDatabase } from './postgres-store.js'

const port = Number(process.env.PORT ?? '4310')
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be a TCP port between 1 and 65535')
const options = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  secret: process.env.BETTER_AUTH_SECRET ?? '',
  baseURL: process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${port}`,
}
validateOrganizationServerOptions(options)
if (process.argv.includes('--migrate')) {
  const pool = new Pool({ connectionString: options.databaseUrl, connectionTimeoutMillis: 5_000 })
  try {
    await migrateOrganizationDatabase(pool)
    console.log('[organization-server] migration complete; schema version 1')
  } finally {
    await pool.end()
  }
} else {
  const server = await buildOrganizationServer(options)
  await server.listen({ port, host: process.env.HOST ?? '127.0.0.1' })
  console.log('[organization-server] listening with PostgreSQL persistence')
  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}
