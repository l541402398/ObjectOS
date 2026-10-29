/**
 * Debug: compare ActionCenter items with the journey's approval detection (not a deliverable).
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const sourceData = process.argv[2]
const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-dbg-'))
const dataDir = join(work, 'data')
mkdirSync(dataDir, { recursive: true })
const { DatabaseSync } = await import('node:sqlite')
const source = new DatabaseSync(join(sourceData, 'projectos.db'), { readOnly: true })
source.exec(`VACUUM INTO '${join(dataDir, 'projectos.db').replace(/'/g, "''")}'`)
const projectRow = source.prepare('SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1').get()
const pending = source.prepare("SELECT id, status, run_id, title FROM approvals WHERE project_id = ? AND status = 'pending'").all(projectRow.id)
source.close()
console.log('PENDING ROWS', JSON.stringify(pending))

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
  const data = await page.evaluate(async (projectId) => {
    const center = await window.projectos.actions.center(projectId)
    const journey = await window.projectos.work.journey(projectId)
    return {
      items: center.items.map((item) => ({ kind: item.kind, stale: item.stale, id: item.id, approvalId: item.approvalId ?? null, title: item.title })),
      execute: journey.stages.find((stage) => stage.key === 'execute'),
      next: journey.nextAction,
      blockers: journey.blockers,
    }
  }, projectRow.id)
  console.log('CENTER', JSON.stringify(data.items).slice(0, 900))
  console.log('EXEC_OBJECTS', JSON.stringify(data.execute?.objects))
  console.log('SUITE', JSON.stringify(data.items.map((item) => item.approvalId)))
  console.log('EXECUTE', JSON.stringify(data.execute).slice(0, 600))
  console.log('NEXT', JSON.stringify(data.next).slice(0, 400))
} finally {
  await app.close()
}
