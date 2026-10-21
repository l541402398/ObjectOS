import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v17-notify-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v17-notify-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
await page.evaluate((id) => { location.hash = `#/projects/${id}/orchestration` }, projectId)
await page.waitForSelector('.po-orch-canvas')
await page.getByRole('button', { name: /生成计划/ }).first().click()
await page.waitForSelector('.po-plan-modal')
await page.locator('.po-plan-modal textarea').first().fill('实现计划确认通知与多 Agent 协作')
await page.getByRole('button', { name: '生成草稿' }).click()
await page.waitForSelector('.po-plan-task', { timeout: 15000 })
await page.getByRole('button', { name: /批准并创建任务/ }).click()
await page.waitForSelector('.ant-notification-notice', { timeout: 15000 })
const text = await page.locator('.ant-notification-notice').last().innerText()
console.log('NOTICE', text.replace(/\n/g, ' / ').slice(0, 200))
if (!text.includes('计划已批准') || !text.includes('开始执行')) throw new Error('notification missing')
await page.screenshot({ path: join(root, 'docs/v1.7/plan-approved-notification.png') })
await page.locator('.ant-notification-notice').getByRole('button', { name: /开始执行/ }).click()
await page.waitForTimeout(2500)
console.log('START CLICK OK')
await app.close()
