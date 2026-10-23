import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

const root = process.cwd()
const results = []
function check(name, condition) {
  if (!condition) throw new Error(`FAIL  ${name}`)
  results.push(name)
  console.log(`PASS  ${name}`)
}

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'projectos-phase5-')),
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'projectos-phase5-user-'))}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60000,
})

try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)

  await page.evaluate((id) => { location.hash = `#/projects/${id}` }, projectId)
  await page.waitForSelector('.po-ux-overview', { timeout: 20000 })
  check('overview renders approved workspace header', await page.locator('.po-ux-overview-head h1').count() === 1)
  check('overview keeps all lifecycle stages', await page.locator('.po-ux-lifecycle .po-stage').count() === 8)
  check('overview keeps real metrics', await page.locator('.po-ux-metric-strip .po-metric').count() === 4)
  check('overview keeps milestones', await page.locator('.po-milestone').count() >= 1)

  await page.evaluate((id) => { location.hash = `#/projects/${id}/tasks` }, projectId)
  await page.waitForSelector('.po-ux-board', { timeout: 20000 })
  check('board renders approved execution header', await page.locator('.po-ux-board-head h1').innerText() === '任务看板')
  check('board keeps five real columns', await page.locator('.po-board-column').count() === 5)
  const before = await page.locator('.po-task-tile').count()
  check('board keeps real task cards', before >= 10)
  await page.getByPlaceholder('搜索任务、描述或标签').fill('编辑器')
  await page.waitForTimeout(350)
  const filtered = await page.locator('.po-task-tile').count()
  check('board search filters real tasks', filtered > 0 && filtered < before)
  await page.getByPlaceholder('搜索任务、描述或标签').fill('')
  await page.waitForTimeout(250)

  await page.locator('.po-task-tile').first().click()
  await page.waitForTimeout(450)
  check('board task inspector opens', await page.locator('[role="dialog"]').count() >= 1)
  check('no page errors', errors.length === 0)

  console.log(`\nPHASE 5 PAGES E2E PASS — ${results.length} checks`)
} finally {
  await app.close()
}
