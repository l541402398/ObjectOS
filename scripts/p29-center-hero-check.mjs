/**
 * Capture the project center hero after removing the duplicated journey row and the unlabeled
 * percentage, at 1440 and 1024.
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const sourceData = process.argv[2]
const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-center-'))
const dataDir = join(work, 'data')
mkdirSync(dataDir, { recursive: true })
const { DatabaseSync } = await import('node:sqlite')
const source = new DatabaseSync(join(sourceData, 'projectos.db'), { readOnly: true })
source.exec(`VACUUM INTO '${join(dataDir, 'projectos.db').replace(/'/g, "''")}'`)
source.close()

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${join(work, 'ud')}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await page.waitForTimeout(1700)
  const window = await app.browserWindow(page)
  const metrics = await page.evaluate(() => {
    const hero = document.querySelector('.nx-center-hero')
    const tiny = [...(hero?.querySelectorAll('*') ?? [])]
      .filter((node) => node.children.length === 0 && (node.textContent ?? '').trim().length > 1)
      .filter((node) => parseFloat(getComputedStyle(node).fontSize) < 12).length
    return {
      hero: Boolean(hero),
      journeyRow: document.querySelectorAll('[data-testid="center-journey"]').length,
      percentText: /%/.test(hero?.textContent ?? '') ? 'has-percent' : 'no-percent',
      tiny,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      heroText: (hero?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160),
    }
  })
  console.log('METRICS', JSON.stringify(metrics))
  await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-center-hero-1440.png') })
  await window.evaluate((w) => w.setSize(1024, 700))
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-center-hero-1024.png') })
  const ok = metrics.hero && metrics.journeyRow === 0 && metrics.tiny === 0 && metrics.overflowX === 0
  console.log(`CENTER_HERO_OK=${ok}`)
  if (!ok) process.exitCode = 1
} finally {
  await app.close()
}
