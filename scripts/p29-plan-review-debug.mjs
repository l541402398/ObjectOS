/**
 * Debug helper for the plan review modal (not part of the deliverable).
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-dbg-'))
const dataDir = join(work, 'data')
mkdirSync(dataDir, { recursive: true })
const dir = join(work, 'proj')
mkdirSync(join(dir, 'src'), { recursive: true })
writeFileSync(join(dir, 'README.md'), '# x\n')
execFileSync('git', ['init', '-q'], { cwd: dir })
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: dir })
execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: dir })

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${join(work, 'ud')}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})
const page = await app.firstWindow()
await page.waitForSelector('.po-shell', { timeout: 60_000 })
await page.waitForTimeout(1200)
const projectId = await page.evaluate(async (rootPath) => {
  const created = await window.projectos.projects.create({ name: 'dbg', rootPath, createDirectory: false, initGit: false })
  await window.projectos.plans.generate(created.project.id, '实现便签导出为 Markdown 并自测', { mode: 'local' })
  return created.project.id
}, dir)
await page.evaluate((id) => {
  window.location.hash = `#/projects/${id}/orchestration`
}, projectId)
await page.waitForTimeout(2500)
console.log('HASH', await page.evaluate(() => window.location.hash))
const before = await page.evaluate(() => ({
  dialogs: document.querySelectorAll('.pui-overlay-dialog').length,
  approve: document.querySelectorAll('[data-testid="plan-approve"]').length,
  text: (document.querySelector('.po-main')?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300),
}))
console.log('BEFORE', JSON.stringify(before))
const row = page.getByText('实现便签导出', { exact: false }).first()
console.log('row count', await row.count())
if (await row.count()) {
  await row.click()
  await page.waitForTimeout(2000)
}
const after = await page.evaluate(() => ({
  dialogs: document.querySelectorAll('.pui-overlay-dialog').length,
  approve: document.querySelectorAll('[data-testid="plan-approve"]').length,
  approveGrant: document.querySelectorAll('[data-testid="plan-approve-and-grant"]').length,
  buttons: [...document.querySelectorAll('.pui-overlay-dialog button')].map((b) => b.textContent?.trim()).slice(0, 12),
  text: (document.querySelector('.pui-overlay-dialog')?.textContent ?? 'no-dialog').replace(/\s+/g, ' ').slice(0, 400),
}))
console.log('AFTER', JSON.stringify(after))
await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-plan-review-debug.png') })
await app.close()
