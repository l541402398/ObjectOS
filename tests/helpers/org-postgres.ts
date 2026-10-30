import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { dirname, join, resolve, sep } from 'node:path'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createOrganizationPool } from '../../apps/server/src/postgres-store.js'

export async function reserveOrganizationTestPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return port
}

/** Actual isolated PostgreSQL process, not a mock or an in-memory compatibility implementation. */
export async function startOrganizationTestDatabase() {
  if (process.getuid?.() === 0) throw new Error('Isolated PostgreSQL tests require a non-root OS user')
  const require = createRequire(import.meta.url)
  const embeddedRequire = createRequire(require.resolve('embedded-postgres'))
  const platform = process.platform === 'win32' ? 'windows' : process.platform
  const binaryModule = embeddedRequire.resolve(`@embedded-postgres/${platform}-${process.arch}`)
  const binaries = (await import(pathToFileURL(binaryModule).href)) as { initdb: string; postgres: string }
  const directory = mkdtempSync(join(tmpdir(), 'projectos-org-a1-pg-'))
  const control = join(dirname(binaries.postgres), process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl')
  const port = await reserveOrganizationTestPort()
  const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/postgres`
  const pool = createOrganizationPool(databaseUrl)
  let running = false
  const stop = async () => {
    await pool.end()
    if (running) {
      execFileSync(control, ['stop', '-D', directory, '-m', 'fast', '-w'], {
        windowsHide: true,
        timeout: 20_000,
        stdio: 'ignore',
      })
      running = false
    }
    const expected = resolve(tmpdir()) + sep
    if (!resolve(directory).startsWith(expected) || !directory.includes('projectos-org-a1-pg-'))
      throw new Error('Refusing to clean an unexpected PostgreSQL test directory')
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  try {
    execFileSync(
      binaries.initdb,
      ['-D', directory, '-A', 'trust', '-U', 'postgres', '--locale=C', '--encoding=UTF8'],
      { windowsHide: true, timeout: 40_000, stdio: 'pipe' },
    )
    // Ignore stdio here: the server daemon can inherit pipe handles on Windows even after pg_ctl exits.
    execFileSync(
      control,
      [
        'start',
        '-D',
        directory,
        '-l',
        join(directory, 'postgres.log'),
        '-o',
        `-h 127.0.0.1 -p ${port}`,
        '-w',
      ],
      { windowsHide: true, timeout: 40_000, stdio: 'ignore' },
    )
    running = true
    await pool.query('SELECT 1')
    return { databaseUrl, pool, stop }
  } catch (error) {
    const logPath = join(directory, 'postgres.log')
    const detail = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-2400) : ''
    if (existsSync(join(directory, 'postmaster.pid'))) running = true
    await stop()
    throw new Error(
      `Isolated PostgreSQL startup failed: ${error instanceof Error ? error.message : String(error)}${detail ? '\n' + detail : ''}`,
    )
  }
}
