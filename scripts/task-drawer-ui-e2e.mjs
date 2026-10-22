/**
 * Task detail drawer UI regression: tabs, light/dark, 125% zoom, outside-click
 * close without a transient "任务不存在" error.
 */
import { _electron as electron } from 'playwright-core'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-task-drawer-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-task-drawer-user-'))
const shots = join(root, 'test-results', 'task-drawer')
mkdirSync(shots, { recursive: true })
const prepare = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/r21-prepare-ui.ts', dataDir], { cwd: root, encoding: 'utf8' })
if (prepare.status !== 0) { console.error(prepare.stdout, prepare.stderr); process.exit(prepare.status ?? 1) }
const context = JSON.parse(readFileSync(join(dataDir, 'context.json'), 'utf8'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${name}: ${detail ?? 'assertion failed'}`)
}
let app = null
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); w.moveTop() })
  await page.waitForTimeout(3200)
  await page.waitForSelector('#po-main')
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}` }, { projectId: context.projectId })
  await page.waitForTimeout(900)
  await page.locator('.po-nav-item').filter({ hasText: '任务看板' }).last().click()
  await page.waitForSelector('.po-task-tile', { timeout: 15_000 })
  const tile = page.locator('.po-task-tile').filter({ hasText: 'R2.1 高风险验收任务' }).first()
  await tile.click()
  await page.waitForSelector('[data-testid="task-detail-inspector"]', { timeout: 15_000 })
  await page.waitForSelector('[data-testid="task-detail-inspector"] .po-task-detail', { timeout: 15_000 })
  await page.waitForSelector('.po-task-tabs', { timeout: 10_000 })
  await page.waitForTimeout(600)
  check('drawer: opens from the task tile', await page.locator('[data-testid="task-detail-inspector"] .pui-overlay-title').isVisible(), await page.locator('[data-testid="task-detail-inspector"] .pui-overlay-title').innerText())
  const tabs = await page.locator('.po-task-tabs .ant-tabs-tab').allInnerTexts()
  check('drawer: has 4 information tabs', tabs.length === 4, JSON.stringify(tabs))
  check('drawer: overview content is not a raw form', await page.locator('.po-detail-block').first().isVisible())
  await page.screenshot({ path: join(shots, 'drawer-overview.png') })
  await page.getByRole('tab', { name: /验收与依赖/ }).click()
  await page.waitForTimeout(250)
  const criteria = await page.locator('.po-criteria-list li').count()
  check('drawer: acceptance criteria are separate numbered rows', criteria > 0 && (await page.locator('.po-criteria-list li').first().innerText()).includes('01'), `criteria=${criteria}`)
  await page.screenshot({ path: join(shots, 'drawer-acceptance.png') })
  await page.getByRole('tab', { name: /运行与交付/ }).click()
  await page.waitForTimeout(350)
  check('drawer: run/artifact tab contains real sections', await page.getByText('每次真实 Run 的 Agent、状态与时间线').isVisible())
  await page.screenshot({ path: join(shots, 'drawer-execution.png') })
  await page.getByRole('tab', { name: /授权/ }).click()
  await page.waitForTimeout(300)
  check('drawer: approval tab is readable', await page.getByText('该任务运行期间产生的逐次审批记录').isVisible())
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, 'drawer-dark.png') })
  await page.evaluate(() => { document.documentElement.removeAttribute('data-theme') })
  await page.waitForTimeout(200)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  await page.waitForTimeout(500)
  const box = await page.locator('[data-testid="task-detail-inspector"]').boundingBox()
  const windowSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))

  check('drawer: fits at 125% zoom', Boolean(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= windowSize.width && box.y + box.height <= windowSize.height), JSON.stringify({ box, windowSize }))
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, 'drawer-dark-zoom125.png') })
  await page.evaluate(() => { document.documentElement.removeAttribute('data-theme') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  await page.waitForTimeout(300)
  // Non-modal Inspector: close from its own header; content must remain stable during the exit.
  await page.getByRole('button', { name: '关闭任务详情' }).click()
  await page.waitForTimeout(120)
  const duringClose = await page.locator('[data-testid="task-detail-inspector"]').innerText().catch(() => '')
  check('drawer: close does not show 任务不存在 during transition', !duringClose.includes('任务不存在'), duringClose.slice(-80))
  await page.waitForTimeout(600)
  check('drawer: closes from the header action', (await page.locator('[data-testid="task-detail-inspector"]').count()) === 0)
  check('drawer: no renderer page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\nTASK DRAWER UI PASS — ${results.length} checks, screenshots in ${shots}`)
} catch (error) {
  console.error('TASK DRAWER UI FAIL —', error)
  if (app) { try { const p = await app.firstWindow(); await p.screenshot({ path: join(shots, 'drawer-failure.png') }) } catch { /* ignore */ } }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
