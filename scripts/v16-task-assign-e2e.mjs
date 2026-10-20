import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-assign-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-assign-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
const agent = await page.evaluate(async () => window.projectos.agentDefinitions.upsert({
  name: 'Quick Assign Agent', role: '快速指派测试', description: '', category: 'general', avatar: '⚡', visibility: 'project',
  persona: { role: '快速指派测试', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
  skillIds: [], runtimeProfileIds: [], primaryRuntimeProfileId: null, modelRef: null,
  permissions: { tools: [], files: false, shell: false, network: false },
}))
await page.evaluate((id) => { location.hash = `#/projects/${id}/tasks` }, projectId)
await page.waitForSelector('.po-board-column')
await page.locator('.po-task-tile').first().click()
await page.waitForSelector('.po-task-assignee-row')
await page.locator('.po-task-assignee-row .ant-select').click()
await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: 'Quick Assign Agent' }).first().click()
await page.waitForTimeout(1200)
const taskId = await page.evaluate(() => document.querySelector('.po-task-detail') ? true : false)
if (!taskId) throw new Error('drawer closed')
const board = await page.evaluate(async (id) => window.projectos.tasks.board(id), projectId)
const assigned = board.tasks.find((entry) => entry.assigneeAgentId === agent.id)
if (!assigned) throw new Error('quick assign did not persist')
console.log('QUICK ASSIGN PASS', assigned.title, agent.name)
await app.close()
