import { spawn, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { once } from 'node:events'
import { startOrganizationTestDatabase, reserveOrganizationTestPort } from '../tests/helpers/org-postgres.ts'
const db = await startOrganizationTestDatabase()
const port = await reserveOrganizationTestPort()
const env = {
  ...process.env,
  DATABASE_URL: db.databaseUrl,
  BETTER_AUTH_SECRET: 'artifact-smoke-test-only-long-secret-0123456789abcdef',
  BETTER_AUTH_URL: `http://127.0.0.1:${port}`,
  HOST: '127.0.0.1',
  PORT: String(port),
}
let child
try {
  execFileSync(process.execPath, [resolve('apps/server/dist/index.js'), '--migrate'], {
    env,
    windowsHide: true,
    timeout: 20000,
    stdio: 'pipe',
  })
  console.log('PASS built JavaScript explicit PostgreSQL migration')
  child = spawn(process.execPath, [resolve('apps/server/dist/index.js')], {
    env,
    windowsHide: true,
    stdio: 'ignore',
  })
  let healthy = false
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`)
      const h = await r.json()
      if (r.ok && h.storage === 'postgresql' && h.schemaVersion === 3) {
        healthy = true
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!healthy) throw new Error('Built server did not become healthy')
  console.log('PASS built JavaScript PostgreSQL server /health')
} finally {
  if (child && child.exitCode === null) {
    child.kill()
    await once(child, 'exit')
  }
  await db.stop()
}
