import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const out = join(root, 'docs', 'screenshots')
mkdirSync(out, { recursive: true })
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')

async function launch(width, height, scale) {
  const dataDir = mkdtempSync(join(tmpdir(), 'projectos-phase2-shots-'))
  const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: String(width), PROJECTOS_WINDOW_HEIGHT: String(height) }
  delete env.ELECTRON_RUN_AS_NODE
  const args = scale ? ['.', `--force-device-scale-factor=${scale}`] : ['.']
  const app = await electron.launch({ executablePath: electronPath, args, cwd: desktopDir, env, timeout: 30_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.po-shell.is-collapsed').count()) {
    await page.getByRole('button', { name: '切换侧边栏' }).click()
    await page.waitForTimeout(200)
  }
  if (await page.locator('.v16-project-visual').count()) await page.locator('.v16-project-visual').first().click()
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  const ids = await page.evaluate(async () => {
    const project = (await window.projectos.projects.list()).projects[0]
    const lifecycle = await window.projectos.lifecycle.overview(project.id)
    return { projectId: project.id, versionId: lifecycle.versions[0]?.id }
  })
  return { app, page, dataDir, ids }
}

async function capture(page, name, theme) {
  await page.evaluate((next) => { document.documentElement.dataset.theme = next }, theme)
  await page.waitForTimeout(400)
  const file = join(out, `${name}.png`)
  await page.screenshot({ path: file })
  console.log(`captured ${name}`)
}

try {
  const compact = await launch(1024, 768, null)
  await compact.page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/releases` }, compact.ids)
  await compact.page.waitForSelector('.po-delivery-page', { timeout: 30_000 })
  await capture(compact.page, '1024x768-light-release-center', 'light')
  await capture(compact.page, '1024x768-dark-release-center', 'dark')
  await compact.page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/deployments` }, compact.ids)
  await compact.page.waitForSelector('.po-delivery-page', { timeout: 30_000 })
  await capture(compact.page, '1024x768-light-deployment-center', 'light')
  await capture(compact.page, '1024x768-dark-deployment-center', 'dark')
  await compact.app.close()
  rmSync(compact.dataDir, { recursive: true, force: true })

  const scaled = await launch(1440, 900, '1.25')
  await scaled.page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/releases` }, scaled.ids)
  await scaled.page.waitForSelector('.po-delivery-page', { timeout: 30_000 })
  const metrics = await scaled.page.evaluate(() => ({ dpr: devicePixelRatio, innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  if (metrics.dpr !== 1.25 || metrics.scrollWidth > metrics.innerWidth + 1) throw new Error(`125% overflow: ${JSON.stringify(metrics)}`)
  await capture(scaled.page, '1440x900-125-actual-light-release-center', 'light')
  await capture(scaled.page, '1440x900-125-actual-dark-release-center', 'dark')
  await scaled.page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/deployments` }, scaled.ids)
  await scaled.page.waitForSelector('.po-delivery-page', { timeout: 30_000 })
  await capture(scaled.page, '1440x900-125-actual-light-deployment-center', 'light')
  await capture(scaled.page, '1440x900-125-actual-dark-deployment-center', 'dark')
  console.log('PHASE 2 DELIVERY SCREENSHOTS PASS', JSON.stringify(metrics))
  await scaled.app.close()
  rmSync(scaled.dataDir, { recursive: true, force: true })
} finally {
  // Each launch owns its cleanup; failures leave temp data only for diagnostics.
}
