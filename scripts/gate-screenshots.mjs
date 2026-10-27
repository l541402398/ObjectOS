import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const outDir = join(root, 'docs', 'screenshots')
mkdirSync(outDir, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-gate-shots-'))
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app

async function launch() {
  app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: desktopDir, env, timeout: 30_000 })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) win.webContents.setZoomFactor(1)
  })
  await page.waitForSelector('.v16-project-visual, .po-project-card', { timeout: 30_000 })
  return page
}

async function shot(page, name) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await page.mouse.move(2, 2)
  const file = join(outDir, `${name}.png`)
  await page.screenshot({ path: file })
  console.log(`captured ${name} (${Math.round(statSync(file).size / 1024)} KB)`)
}

try {
  const page = await launch()
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
  const setup = await page.evaluate(async ({ projectId }) => {
    const overview = await window.projectos.lifecycle.overview(projectId)
    const productId = overview.products[0].id
    const version = await window.projectos.lifecycle.createVersion({
      projectId,
      productId,
      version: '9.9.0',
      phase: 'planned',
      isDefault: false,
    })
    await window.projectos.lifecycle.setFocus({ projectId, subjectType: 'version', subjectId: version.id })
    return { versionId: version.id }
  }, { projectId })
  await page.evaluate((next) => { location.hash = `#/projects/${next}/versions` }, projectId)
  await page.reload()
  await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
  await page.waitForTimeout(800)
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.waitForTimeout(500)

  const failed = await page.evaluate(async ({ versionId }) => {
    try {
      await window.projectos.lifecycle.transitionVersion({ versionId, to: 'discovery' })
      return { ok: true, error: null }
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) }
    }
  }, setup)
  console.log('gate-failed', failed)
  await page.reload()
  await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
  await page.waitForTimeout(700)
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.waitForTimeout(400)
  await shot(page, '1440x900-light-versions-gate-failed')

  await page.evaluate(async ({ projectId, versionId }) => {
    await window.projectos.lifecycle.recordEvidence({
      projectId,
      subjectType: 'version',
      subjectId: versionId,
      evidenceType: 'review_record',
      verificationStatus: 'passed',
      assurance: 'self_declared',
      title: 'v9.9.0 需求发现评审',
      summary: '检查范围、目标与边界；仅作为人工评审记录。',
      provenance: { sourceSystem: 'gate-e2e', actor: 'local-user' },
    })
    await window.projectos.lifecycle.transitionVersion({ versionId, to: 'discovery' })
  }, { projectId, ...setup })
  await page.reload()
  await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
  await page.waitForTimeout(700)
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.waitForTimeout(400)
  await shot(page, '1440x900-light-versions-gate-passed')

  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(600)
  await shot(page, '1440x900-dark-versions-gate-passed')
  console.log('GATE SCREENSHOTS PASS')
  await app.close()
} finally {
  try { await app?.close() } catch { /* ignore */ }
  rmSync(dataDir, { recursive: true, force: true })
}
