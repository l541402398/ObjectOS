/** Review recording. Startup wait is held only by the test so the animation can be seen. */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const out = resolve('docs/design/startup-journey/recording')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-startup-recording-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60000, recordVideo: { dir: join(profile, 'video'), size: { width: 1440, height: 900 } } })
const page = await app.firstWindow(), video = page.video(), win = await app.browserWindow(page), steps = [], errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.waitForSelector('.po-shell', { timeout: 60000 })
  const id = (await page.evaluate(() => window.projectos.projects.list())).projects[0].id
  await page.evaluate(id => { location.hash = `#/projects/${id}/agents` }, id)
  await page.locator('.aco-canvas').waitFor()
  await page.emulateMedia({ colorScheme: 'light' })
  await page.context().addInitScript(() => {
    const original = document.fonts.load.bind(document.fonts)
    const gate = new Promise(resolve => { window.__releaseBoot = resolve })
    document.fonts.load = async (...args) => { const result = await original(...args); await gate; return result }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.po-boot-artwork').waitFor(); await page.waitForTimeout(4000)
  steps.push('Full optical startup; font gate held for 4 seconds by the recording only')
  await page.evaluate(() => window.__releaseBoot()); await page.locator('.aco-canvas').waitFor()
  await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(2000)
  steps.push('Complete product with all nine stages and explicit current phase')
  await page.getByTestId('journey-toggle').click(); await page.waitForTimeout(2000)
  await page.keyboard.press('Escape'); steps.push('Journey details and keyboard dismissal')
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(1500)
  await win.evaluate(w => { w.setSize(1024, 900); w.webContents.setZoomFactor(1.25) })
  await page.waitForTimeout(500); await page.locator('.react-flow__controls-fitview').click(); await page.waitForTimeout(2500)
  steps.push('Dark theme and 1024 / 125% readable stage path')
  await page.getByTestId('journey-next').click(); await page.waitForTimeout(1800)
  steps.push('Actual next action destination')
} catch (error) { errors.push(String(error)) }
finally {
  await app.close().catch(() => {})
  if (video) await video.saveAs(join(out, 'startup-and-journey.webm'))
  else errors.push('Video unavailable')
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ status: errors.length ? 'FAIL' : 'PASS', steps, errors }, null, 2))
  if (errors.length) process.exitCode = 1
}
