import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const outDir = join(root, 'docs', 'screenshots')
mkdirSync(outDir, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-workcenter-shots-'))
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')
const errors = []
let app

async function launch(width, height) {
  const env = {
    ...process.env,
    PROJECTOS_DATA_DIR: dataDir,
    PROJECTOS_SEED_DEMO: '1',
    PROJECTOS_WINDOW_WIDTH: String(width),
    PROJECTOS_WINDOW_HEIGHT: String(height),
  }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: desktopDir, env, timeout: 30_000 })
  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.po-project-card, .v16-project-visual', { timeout: 30_000 })
  return page
}

async function theme(page, mode) {
  const current = await page.evaluate(() => document.documentElement.dataset.theme)
  if (current === mode) return
  await page.click('button[aria-label="主题"]')
  await page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: mode === 'light' ? '浅色' : '深色' }).click()
  await page.waitForFunction((next) => document.documentElement.dataset.theme === next, mode)
  await page.waitForTimeout(350)
}

async function shot(page, name) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await page.mouse.move(2, 2)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  if (overflow) throw new Error(`${name}: horizontal overflow`)
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  const bytes = statSync(file).size
  if (bytes < 8_000) throw new Error(`${name}: empty screenshot`)
  console.log(`captured ${name} (${Math.round(bytes / 1024)} KB)`)
}

try {
  for (const [width, height] of [[1440, 900], [1024, 768]]) {
    const page = await launch(width, height)
    const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
    await page.evaluate((next) => { location.hash = `#/projects/${next}/work` }, projectId)
    await page.waitForSelector('.po-work-center', { timeout: 30_000 })
    await page.waitForTimeout(900)
    await theme(page, 'light')
    await shot(page, `${width}x${height}-light-work-center`)
    await page.evaluate(async (next) => {
      const lifecycle = await window.projectos.lifecycle.overview(next)
      const plan = await window.projectos.plans.generate(next, '为 Markdown 编辑器增加自动保存状态提示，并补充真实测试', {
        mode: 'local',
        maxTasks: 6,
        allowRuleFallback: true,
      })
      await window.projectos.plans.update({ planId: plan.id, versionId: lifecycle.versions[0]?.id })
    }, projectId)
    await page.evaluate((next) => { location.hash = `#/projects/${next}/work` }, projectId)
    await page.reload()
    await page.waitForSelector('.po-work-center', { timeout: 30_000 })
    await page.waitForTimeout(900)
    await shot(page, `${width}x${height}-light-work-center-plan`)
    await page.evaluate((next) => { location.hash = `#/projects/${next}/versions` }, projectId)
    await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
    await page.waitForTimeout(700)
    await shot(page, `${width}x${height}-light-versions`)
    await theme(page, 'dark')
    await shot(page, `${width}x${height}-dark-versions`)
    await page.evaluate((next) => { location.hash = `#/projects/${next}/work` }, projectId)
    await page.waitForSelector('.po-work-center', { timeout: 30_000 })
    await page.waitForTimeout(500)
    await shot(page, `${width}x${height}-dark-work-center`)
    await shot(page, `${width}x${height}-dark-work-center-plan`)
    await app.close()
    app = undefined
  }
  if (errors.length) throw new Error(`renderer errors: ${errors.join(' | ')}`)
  console.log('WORK CENTER SCREENSHOTS PASS')
} finally {
  try { await app?.close() } catch { /* ignore */ }
  rmSync(dataDir, { recursive: true, force: true })
}
