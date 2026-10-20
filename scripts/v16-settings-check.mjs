import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-settings-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-settings-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
await page.waitForTimeout(1200)
await page.click('button[aria-label="主题"]')
await page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: '深色' }).click()
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
await page.waitForTimeout(500)
await page.locator('.po-nav-item').filter({ hasText: '设置' }).first().click()
await page.waitForSelector('.po-settings-dialog')
await page.waitForTimeout(700)
await page.screenshot({ path: join(root, 'docs/v1.6/round2-settings-ai-dark.png') })
for (const [name, label] of [['runtime', '运行时'], ['tools', '工具与插件'], ['team', '团队与权限'], ['system', '系统与外观']]) {
  await page.locator('.po-settings-nav-item').filter({ hasText: label }).first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(root, `docs/v1.6/round2-settings-${name}-dark.png`) })
}
console.log('SETTINGS SHOTS OK')
await app.close()
