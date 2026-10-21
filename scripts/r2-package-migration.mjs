/**
 * R2 Phase 4: packaged-app migration test with an isolated user data directory.
 *
 * 1. Builds a V18 SQLite database (real migrations 1..18) with a legacy project.
 * 2. Launches the freshly packaged ProjectOS.exe against that data dir only.
 * 3. Verifies V19/V20/V21 applied, legacy data survived and the packaged
 *    renderer exposes the R2 reassign API.
 *
 * The user's real data directory and installed app are never touched.
 */
import { _electron as electron } from 'playwright-core'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const packageDir = resolve(root, process.env.PROJECTOS_PACKAGE_DIR ?? 'release/win-unpacked')
const exe = join(packageDir, 'ProjectOS.exe')
if (!existsSync(exe)) {
  console.error('[r2-package-migration] packaged exe missing; run pnpm package:dir')
  process.exit(1)
}
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2-migrate-pkg-'))
const dbPath = join(dataDir, 'projectos.db')
mkdirSync(dataDir, { recursive: true })

const prepared = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/r2-prepare-legacy-db.ts', dbPath, dataDir],
  { cwd: root, encoding: 'utf8' },
)
if (prepared.status !== 0) {
  console.error(prepared.stdout, prepared.stderr)
  process.exit(prepared.status ?? 1)
}
console.log(prepared.stdout.trim())

const readVersions = () => {
  const db = new DatabaseSync(dbPath)
  try {
    return {
      versions: db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => Number(row.version)),
      project: db.prepare('SELECT name, version FROM projects WHERE id = ?').get('prj_r2_legacy'),
      marker: db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('r2_legacy_marker'),
      changesTable: db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'run_file_changes'")
        .get(),
      slotsTable: db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_execution_slots'")
        .get(),
      runColumns: db.prepare('PRAGMA table_info(agent_runs)').all().map((column) => column.name),
    }
  } finally {
    db.close()
  }
}

const before = readVersions()
if (Math.max(...before.versions) !== 18) throw new Error(`legacy db is not v18: ${before.versions}`)

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE
let app = null
try {
  app = await electron.launch({ executablePath: exe, args: [], env, timeout: 90_000 })
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('#po-main', { timeout: 90_000 })
  const api = await page.evaluate(() => ({
    reassign: typeof window.projectos.orchestration.reassign,
    declineReassign: typeof window.projectos.orchestration.declineReassign,
    reconcile: typeof window.projectos.runs.reconcile,
  }))
  const projectVisible = await page.evaluate(async () => {
    const result = await window.projectos.projects.list()
    return result.projects.some((project) => project.id === 'prj_r2_legacy')
  })
  if (api.reassign !== 'function' || api.declineReassign !== 'function') {
    throw new Error(`packaged renderer missing reassign APIs: ${JSON.stringify(api)}`)
  }
  if (!projectVisible) throw new Error('legacy project not visible in packaged app')
  if (errors.length > 0) throw new Error(`renderer errors: ${errors.join(' | ')}`)
  console.log(`[r2-package-migration] packaged boot API=${JSON.stringify(api)} legacyProjectVisible=true`)
} finally {
  if (app) await app.close().catch(() => undefined)
}

const after = readVersions()
const failures = []
if (Math.max(...after.versions) !== 21) failures.push(`expected v21, got ${after.versions}`)
if (!after.versions.includes(19) || !after.versions.includes(20) || !after.versions.includes(21)) {
  failures.push('missing V19/V20/V21')
}
if (after.project?.name !== 'R2 Legacy V18 Project' || Number(after.project?.version) !== 7) {
  failures.push(`legacy project lost: ${JSON.stringify(after.project)}`)
}
if (!after.marker?.value_json?.includes('"preserved":true')) failures.push('legacy app setting lost')
if (after.slotsTable?.name !== 'agent_execution_slots') failures.push('V19 slots table missing')
if (after.changesTable?.name !== 'run_file_changes') failures.push('V21 file attribution table missing')
if (!after.runColumns.includes('deadline_at') || !after.runColumns.includes('budget_json')) {
  failures.push('V20 run budget columns missing')
}
if (failures.length > 0) {
  console.error('[r2-package-migration] FAIL', failures.join('; '))
  process.exitCode = 1
} else {
  console.log(
    `[r2-package-migration] PASS versions=${after.versions.slice(-3).join(',')} legacyProject=preserved ` +
      `slots=${after.slotsTable?.name} attribution=${after.changesTable?.name} dataDir=${dataDir}`,
  )
}
rmSync(dataDir, { recursive: true, force: true })
