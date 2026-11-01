/**
 * Probe the settings nav surface in dark mode.
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const sourceData = process.argv[2]
const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-probe2-'))
const dataDir = join(work, 'data')
mkdirSync(dataDir, { recursive: true })
const { DatabaseSync } = await import('node:sqlite')
const source = new DatabaseSync(join(sourceData, 'projectos.db'), { readOnly: true })
source.exec(`VACUUM INTO '${join(dataDir, 'projectos.db').replace(/'/g, "''")}'`)
source.close()

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
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
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(300)
  await page.keyboard.type('深色')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  await page.keyboard.press('Control+,')
  await page.waitForTimeout(1000)
  const info = await page.evaluate(() => {
    const nav = document.querySelector('.po-settings-nav')
    const dialog = document.querySelector('.po-settings-dialog')
    const dialogStyle = dialog ? getComputedStyle(dialog) : null
    const navDbg = nav ? getComputedStyle(nav).backgroundColor : null
    const surface = nav?.closest('.pui-overlay-surface')
    const navStyle = nav ? getComputedStyle(nav) : null
    const surfaceStyle = surface ? getComputedStyle(surface) : null
    return {
      surfaceClasses: surface?.className ?? null,
      surfaceTheme: surface?.getAttribute('data-theme') ?? null,
      navClasses: nav?.className ?? null,
      navBg: navStyle?.backgroundColor ?? null,
      navBgImage: navStyle?.backgroundImage?.slice(0, 120) ?? null,
      pdlSurface2: nav ? getComputedStyle(nav).getPropertyValue('--pdl-surface-2').trim() : null,
      pdlInk: nav ? getComputedStyle(nav).getPropertyValue('--pdl-ink').trim() : null,
      surfaceBg: surfaceStyle?.backgroundColor ?? null,
      surfaceBgImage: surfaceStyle?.backgroundImage?.slice(0, 120) ?? null,
      dialogBg: dialogStyle?.backgroundColor ?? null,
      dialogBgImage: dialogStyle?.backgroundImage?.slice(0, 90) ?? null,
      navDbg,
    }
  })
  console.log(JSON.stringify(info, null, 2))
} finally {
  await app.close()
}
