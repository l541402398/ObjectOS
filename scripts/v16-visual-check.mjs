import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const out = join(root, 'docs', 'v1.6')
mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-v16-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
await page.waitForTimeout(1800)
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; localStorage.setItem('projectos.theme', 'dark') })
await page.waitForTimeout(700)
await page.screenshot({ path: join(out, 'round1-project-center-dark.png') })
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
await page.evaluate((id) => { location.hash = `#/projects/${id}` }, projectId)
await page.waitForTimeout(1400)
await page.screenshot({ path: join(out, 'round1-overview-dark.png') })
await page.locator('.po-nav-item').filter({ hasText: '设置' }).first().click()
await page.waitForTimeout(800)
await page.screenshot({ path: join(out, 'round1-settings-dark.png') })
console.log('V1.6 ROUND1 SCREENSHOTS OK')
await app.close()

