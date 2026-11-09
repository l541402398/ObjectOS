// Usage: node capture.mjs <repoRoot> <outDir> <routesJson>
// routes: [{name, hash, wait, action?: 'actionCenter'}]
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, statSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const [repo, outDir, routesFile, seedFile] = process.argv.slice(2)
mkdirSync(outDir, { recursive: true })
const routes = JSON.parse(readFileSync(routesFile, 'utf8'))
const dataDir = process.env.KEEP_DATA ?? mkdtempSync(join(tmpdir(), 'projectos-v2-shots-'))
const electronPath = [
  resolve(repo, 'node_modules/.pnpm/electron@43.8.2/node_modules/electron/dist/electron'),
  resolve(repo, 'node_modules/electron/dist/electron'),
].find((p) => existsSync(p))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: electronPath, args: ['.', '--no-sandbox', '--disable-gpu'], cwd: resolve(repo, 'apps/desktop'), env, timeout: 90_000 })
const page = await app.firstWindow()
const win = await app.browserWindow(page)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.waitForSelector('.po-shell', { timeout: 90_000 })
await win.evaluate((w) => { w.setContentSize(1440, 900); w.webContents.setZoomFactor(1) })
await page.evaluate(() => document.fonts.ready)
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
console.log('project', projectId, 'data', dataDir)
if (seedFile) {
  const seed = await import(resolve(seedFile))
  await seed.default({ page, projectId, dataDir, repo })
}
const collapsed = await page.evaluate(() => document.querySelector('.po-shell')?.classList.contains('is-collapsed'))
for (const theme of (process.env.THEMES ?? 'light,dark').split(',')) {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  const current = await page.evaluate(() => document.documentElement.dataset.theme)
  if (current !== theme) {
    await page.click('button[aria-label="主题"]')
    await page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: theme === 'light' ? '浅色' : '深色' }).click()
    await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme)
    await page.waitForTimeout(400)
  }
  for (const route of routes) {
    await page.evaluate((h) => { location.hash = h }, route.hash.replace('{pid}', projectId))
    await page.waitForTimeout(900)
    if (route.wait) await page.waitForSelector(route.wait, { timeout: 30_000 }).catch(() => console.log('  wait miss', route.wait))
    if (route.before) await page.evaluate(route.before)
    if (route.click) { await page.click(route.click).catch((e) => console.log('  click miss', route.click, e.message)); await page.waitForTimeout(700) }
    for (const step of route.clicks ?? []) {
      const loc = step.text ? page.locator(step.sel).filter({ hasText: step.text }).first() : page.locator(step.sel).first()
      await loc.click({ timeout: 8000 }).catch((e) => console.log('  click miss', step.sel, step.text ?? '', e.message.split('\n')[0]))
      await page.waitForTimeout(step.delay ?? 450)
    }
    await page.waitForTimeout(route.delay ?? 600)
    if (!route.keepHover) await page.mouse.move(2, 2)
    const actualTheme = await page.evaluate(() => document.documentElement.dataset.theme)
    const file = join(outDir, `1440x900-${theme}-${route.name}.png`)
    await page.screenshot({ path: file })
    console.log('captured', file, Math.round(statSync(file).size / 1024) + 'KB', 'theme=' + actualTheme)
    if ((route.click || route.clicks) && !route.noEscape) await page.keyboard.press('Escape').catch(() => {})
  }
}
console.log('errors', JSON.stringify(errors.slice(0, 20), null, 1))
await app.close()
