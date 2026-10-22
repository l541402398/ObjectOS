import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'design-lab')
mkdirSync(shots, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-perf-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-perf-user-'))
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
  PROJECTOS_START_ROUTE: 'design-lab?aurora=on',
}
delete env.ELECTRON_RUN_AS_NODE
let app = null

const sampleFps = (page) => page.evaluate(() => new Promise((resolveFps) => {
  let frames = 0
  const start = performance.now()
  const tick = (now) => {
    frames += 1
    if (now - start < 2500) requestAnimationFrame(tick)
    else resolveFps(Math.round((frames * 1000) / (now - start)))
  }
  requestAnimationFrame(tick)
}))

try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.setBackgroundThrottling(false) })
  await page.bringToFront()
  await page.waitForSelector('[data-testid="design-lab"]', { timeout: 20_000 })
  await page.waitForTimeout(1800)
  await page.screenshot({ path: join(shots, 'lab-aurora-forced.png') })
  const auroraMode = await page.locator('.pdl-root').getAttribute('data-aurora')
  const auroraFps = await sampleFps(page)
  console.log(`AURORA mode=${auroraMode} fps=${auroraFps}`)

  await page.getByRole('button', { name: '玻璃兼容性对照' }).click()
  await page.waitForSelector('.pdl-glass-probe', { timeout: 10_000 })
  await page.waitForTimeout(500)
  const libraryFps = await sampleFps(page)
  console.log(`LIQUID_GLASS_PROBE fps=${libraryFps}`)
  await page.screenshot({ path: join(shots, 'lab-liquid-glass-library.png') })
  await page.evaluate(() => { const w = document.querySelector('.pdl-glass-probe .glass__warp'); if (w) { w.style.background = 'rgba(255,255,255,.16)'; w.style.filter = 'none' } })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, 'lab-library-filter-off.png') })
} catch (error) {
  console.error('PERF PROBE FAIL', error)
  process.exitCode = 1
} finally {
  await app?.close().catch(() => {})
}

