import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-scale125-'))
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
let app

try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', '--force-device-scale-factor=1.25'],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 30_000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.v16-project-visual').count()) {
    await page.locator('.v16-project-visual').first().click()
  }
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  await page.waitForTimeout(900)
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.waitForTimeout(500)

  const metrics = await page.evaluate(() => {
    const viewport = window.innerWidth
    const doc = document.documentElement
    const focus = document.querySelector('.wc-focus')
    const cards = [...document.querySelectorAll('.wc-metrics > *')]
    const right = Math.max(...cards.map((card) => card.getBoundingClientRect().right), 0)
    return {
      devicePixelRatio: window.devicePixelRatio,
      innerWidth: viewport,
      scrollWidth: doc.scrollWidth,
      focusRight: focus?.getBoundingClientRect().right ?? null,
      lastMetricRight: right,
      metrics: cards.length,
    }
  })
  console.log('[scale125]', JSON.stringify(metrics))
  if (metrics.devicePixelRatio !== 1.25) throw new Error(`expected devicePixelRatio 1.25, got ${metrics.devicePixelRatio}`)
  if (metrics.scrollWidth > metrics.innerWidth + 1) throw new Error(`horizontal overflow: ${metrics.scrollWidth} > ${metrics.innerWidth}`)
  if (metrics.lastMetricRight && metrics.lastMetricRight > metrics.innerWidth + 1) {
    throw new Error(`metrics clipped: ${metrics.lastMetricRight} > ${metrics.innerWidth}`)
  }
  if (metrics.focusRight && metrics.focusRight > metrics.innerWidth + 1) {
    throw new Error(`focus strip clipped: ${metrics.focusRight} > ${metrics.innerWidth}`)
  }
  mkdirSync(join(root, 'docs', 'screenshots'), { recursive: true })
  for (const theme of ['light', 'dark']) {
    await page.evaluate((next) => { document.documentElement.dataset.theme = next }, theme)
    await page.waitForTimeout(500)
    const file = join(root, 'docs', 'screenshots', `1440x900-125-actual-${theme}-work-center.png`)
    await page.screenshot({ path: file })
    console.log(`[scale125] captured ${file} (${Math.round(statSync(file).size / 1024)} KB)`)
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  console.log('PHASE 1.1 125% ACTUAL SCALE PASS')
  await app.close()
} finally {
  try { await app?.close() } catch { /* ignore */ }
  rmSync(dataDir, { recursive: true, force: true })
}
