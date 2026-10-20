import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const out = join(root, 'docs/v1.7')
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v17-check-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v17-check-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
page.on('pageerror', (error) => console.log('PAGEERROR', error.message))
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
await page.waitForTimeout(1200)

const glass = await page.evaluate(() => {
  const sidebar = document.querySelector('.po-sidebar')
  const before = document.querySelector('.po-shell')
  const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null
  return {
    sidebarBlur: sidebarStyle?.backdropFilter ?? '',
    sidebarBackground: sidebarStyle?.backgroundColor ?? '',
    backgroundImage: before ? getComputedStyle(before, '::before').backgroundImage : '',
    windowButtons: document.querySelectorAll('[class*="window"], [aria-label*="最小化"], [aria-label*="最大化"]').length,
    controlHeight: getComputedStyle(document.documentElement).getPropertyValue('--ant-control-height').trim(),
  }
})
if (!glass.sidebarBlur.includes('blur')) throw new Error('sidebar blur missing: ' + glass.sidebarBlur)
if (!glass.backgroundImage.includes('v17-landscape')) throw new Error('v17 background missing')
await page.screenshot({ path: join(out, 'project-center-light.png') })

const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
await page.evaluate((id) => { location.hash = `#/projects/${id}/tasks` }, projectId)
await page.waitForSelector('.po-board')
await page.waitForTimeout(900)
await page.screenshot({ path: join(out, 'task-board-light.png') })

await page.locator('.po-nav-item').filter({ hasText: '设置' }).last().click()
await page.waitForTimeout(700)
await page.locator('.po-settings-nav-item').filter({ hasText: '设置概览' }).first().click()
await page.waitForTimeout(700)
const modalGlass = await page.evaluate(() => {
  const modal = document.querySelector('.po-settings-modal .ant-modal-container, .po-settings-modal .ant-modal-content')
  return modal ? getComputedStyle(modal).backdropFilter : ''
})
if (!modalGlass.includes('blur')) throw new Error('modal glass missing: ' + modalGlass)
await page.screenshot({ path: join(out, 'settings-overview-light.png') })
await page.locator('.po-settings-modal .ant-modal-close').click()
await page.waitForTimeout(400)

await page.click('button[aria-label="主题"]')
await page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: '深色' }).click()
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
await page.waitForTimeout(800)
await page.screenshot({ path: join(out, 'project-center-dark.png') })
await page.evaluate((id) => { location.hash = `#/projects/${id}/tasks` }, projectId)
await page.waitForSelector('.po-board')
await page.waitForTimeout(800)
await page.screenshot({ path: join(out, 'task-board-dark.png') })
await page.locator('.po-nav-item').filter({ hasText: '设置' }).last().click()
await page.waitForTimeout(700)
await page.locator('.po-settings-nav-item').filter({ hasText: '设置概览' }).first().click()
await page.waitForTimeout(700)
await page.screenshot({ path: join(out, 'settings-overview-dark.png') })
await page.locator('.po-settings-modal .ant-modal-close').click()

await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(1024, 768) })
await page.waitForTimeout(700)
const overflow = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
if (overflow.scroll > overflow.width + 1) throw new Error('horizontal overflow at 1024: ' + JSON.stringify(overflow))
await page.screenshot({ path: join(out, 'project-center-1024-dark.png') })

console.log('V17 VISUAL CHECK PASS')
console.log(JSON.stringify({ sidebarBlur: glass.sidebarBlur.slice(0, 60), modalGlass: modalGlass.slice(0, 60), overflow, background: 'v17-landscape' }, null, 2))
await app.close()

