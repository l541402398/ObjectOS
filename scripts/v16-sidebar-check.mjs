import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const out = join(root, 'docs', 'v1.6')
mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-v16-nav-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.po-project-card', { timeout: 30000 })
await page.waitForTimeout(1500)
await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
await page.waitForTimeout(400)
const toggle = page.locator('.po-titlebar-left > .po-icon-button').first()
await toggle.click()
await page.waitForTimeout(70)
await page.screenshot({ path: join(out, 'round1-sidebar-mid-collapse.png') })
const mid = await page.evaluate(() => {
  const label = document.querySelector('.po-nav-label')
  const style = label ? getComputedStyle(label) : null
  const icon = document.querySelector('.po-nav-icon')?.getBoundingClientRect()
  return { display: style?.display, whiteSpace: style?.whiteSpace, iconX: icon?.x ?? null, shellClass: document.querySelector('.po-shell')?.className }
})
await page.waitForTimeout(420)
for (let index = 0; index < 6; index += 1) { await toggle.click(); await page.waitForTimeout(45) }
await page.waitForTimeout(500)
const final = await page.evaluate(() => {
  const shell = document.querySelector('.po-shell')
  const sidebar = document.querySelector('.po-sidebar')?.getBoundingClientRect()
  const label = document.querySelector('.po-nav-label')
  const style = label ? getComputedStyle(label) : null
  return { collapsed: shell?.classList.contains('is-collapsed'), width: sidebar?.width, labelDisplay: style?.display, labelHeight: label?.getBoundingClientRect().height }
})
await page.screenshot({ path: join(out, 'round1-sidebar-final.png') })
console.log(JSON.stringify({ mid, final }, null, 2))
if (!mid.shellClass?.includes('is-collapsed') || mid.display !== 'none') throw new Error('mid-collapse label not atomically hidden')
if (final.labelDisplay !== 'none' || (final.labelHeight ?? 0) > 1) throw new Error('final label still affects layout')
if (!final.collapsed || !final.width || final.width > 70) throw new Error('rapid toggles did not settle to compact state')
console.log('V1.6 SIDEBAR ANIMATION CHECK PASS')
await app.close()
