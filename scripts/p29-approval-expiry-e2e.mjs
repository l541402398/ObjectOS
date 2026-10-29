/**
 * ADR-0057 verification: an expired pending approval must be settled by the autonomy pass, not park
 * the run forever. Uses a real profile copy; the sweep runs through the real tick API.
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const sourceData = process.argv[2]
const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-expiry-'))
const dataDir = join(work, 'data')
mkdirSync(dataDir, { recursive: true })
const { DatabaseSync } = await import('node:sqlite')
const source = new DatabaseSync(join(sourceData, 'projectos.db'), { readOnly: true })
source.exec(`VACUUM INTO '${join(dataDir, 'projectos.db').replace(/'/g, "''")}'`)
const row = source
  .prepare(
    `SELECT a.project_id AS projectId, a.id AS approvalId, a.run_id AS runId
     FROM approvals a WHERE a.status='pending' AND a.expires_at IS NOT NULL AND a.expires_at <= ? LIMIT 1`,
  )
  .get(Date.now())
source.close()
if (!row) {
  console.log('NO_EXPIRED_PENDING')
  process.exit(3)
}
console.log('TARGET', JSON.stringify(row))

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${join(work, 'ud')}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(1200)
  const before = await page.evaluate(async (projectId) => {
    const journey = await window.projectos.work.journey(projectId)
    return { next: journey.nextAction, execute: journey.stages.find((stage) => stage.key === 'execute') }
  }, row.projectId)
  console.log('BEFORE', JSON.stringify(before).slice(0, 400))

  const tick = await page.evaluate((projectId) => window.projectos.actions.tick(projectId), row.projectId)
  console.log('TICK_OUTCOMES', JSON.stringify(tick.outcomes ?? tick).slice(0, 300))

  // The pass is fire-and-forget; poll until the approval settles.
  await page.waitForTimeout(6000)
  const after = await page.evaluate(async ({ projectId, approvalId }) => {
    const journey = await window.projectos.work.journey(projectId)
    const approvals = await window.projectos.approvals.list({ projectId })
    const target = approvals.approvals.find((approval) => approval.id === approvalId)
    return {
      approvalStatus: target?.status ?? null,
      execute: journey.stages.find((stage) => stage.key === 'execute'),
      next: journey.nextAction,
    }
  }, { projectId: row.projectId, approvalId: row.approvalId })
  console.log('AFTER', JSON.stringify(after).slice(0, 700))

  const settled = after.approvalStatus === 'expired'
  console.log(`EXPIRY_SETTLED=${settled} NEXT_OWNER=${after.next.owner} NEXT_LABEL=${after.next.label}`)
  if (!settled) process.exitCode = 1
} finally {
  await app.close()
}
