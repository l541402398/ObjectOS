import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v17-group-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v17-group-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
await page.evaluate(async (id) => {
  const plan = await window.projectos.plans.generate(id, '实现计划群聊与多 Agent 协作')
  await window.projectos.plans.approve(plan.id)
}, projectId)
await page.evaluate((id) => { location.hash = `#/projects/${id}/agents` }, projectId)
await page.waitForSelector('.po-agent-workspace')
await page.waitForTimeout(900)
await page.locator('.po-page-actions button').filter({ hasText: '计划群聊' }).click()
await page.waitForSelector('.v17-group-drawer')
const participants = await page.locator('.v17-group-participant').count()
console.log('participants', participants)
if (participants < 2) throw new Error('participants missing')
await page.locator('.v17-group-composer textarea').fill('请各位确认接口边界。')
await page.getByRole('button', { name: /发送给全部 Agent/ }).click()
await page.waitForTimeout(1800)
const userMessages = page.locator('.v17-group-message.is-user')
const count = await userMessages.count()
const text = count ? await userMessages.first().innerText() : ''
console.log('user messages', count, text.replace(/\n/g, ' / ').slice(0, 80))
if (count !== 1) throw new Error('group user message should appear once, got ' + count)
await page.screenshot({ path: join(root, 'docs/v1.7/plan-group-chat.png') })
console.log('PLAN GROUP CHAT PASS')
await app.close()
