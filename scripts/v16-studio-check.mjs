import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-studio-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-studio-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
await page.waitForTimeout(1200)
await page.click('button[aria-label="主题"]')
await page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: '深色' }).click()
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
await page.waitForTimeout(500)
if (await page.locator('.po-shell.is-collapsed').count()) { await page.locator('.po-titlebar-left > .po-icon-button').first().click(); await page.waitForTimeout(400) }
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
await page.evaluate((id) => { location.hash = `#/projects/${id}/agents` }, projectId)
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Agent 管理' }).click()
await page.waitForSelector('.v16-studio', { timeout: 15000 })
await page.waitForTimeout(600)
await page.screenshot({ path: join(root, 'docs/v1.6/round2-agent-studio-dark.png') })
const tabs = page.locator('.v16-studio-tabs button')
for (let index = 0; index < 5; index += 1) {
  await tabs.nth(index).click()
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(root, `docs/v1.6/round2-agent-studio-tab${index}.png`) })
}
console.log('STUDIO SHOTS OK')
await app.close()
