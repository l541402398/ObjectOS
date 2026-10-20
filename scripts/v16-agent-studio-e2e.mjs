import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-create-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-create-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
await page.evaluate((id) => { location.hash = `#/projects/${id}/agents` }, projectId)
await page.waitForTimeout(1000)
await page.getByRole('button', { name: 'Agent 管理' }).click()
await page.waitForSelector('.v16-studio')
await page.locator('.v16-studio-form input').first().fill('V1.6 UI Agent')
console.log('after-fill', await page.locator('.v16-studio-form input').first().inputValue())
for (let index = 0; index < 4; index += 1) {
  console.log('tab', index, await page.locator('.v16-studio-tabs button.is-active').innerText())
  await page.getByRole('button', { name: /下一步/ }).click()
  await page.waitForTimeout(250)
}
await page.getByRole('button', { name: '创建 Agent' }).click()
await page.waitForTimeout(1200)
await page.screenshot({ path: join(root, 'docs/v1.6/round2-agent-create-result.png') })
const agents = await page.evaluate(async () => (await window.projectos.agentDefinitions.list()).agents)
console.log(agents.map((agent) => agent.name))
const created = agents.find((agent) => agent.name === 'V1.6 UI Agent')
if (!created) throw new Error('Agent was not persisted')
const taskResult = await page.evaluate(async ({ projectId, agentId }) => window.projectos.tasks.create({
  projectId,
  title: 'V1.6 Custom Agent DAG Binding',
  description: 'Verify a ProjectOS custom AgentDefinition can be assigned to a task and projected into orchestration.',
  priority: 2,
  acceptanceCriteria: ['Task is assigned to the custom agent'],
  labels: ['v1.6'],
  assigneeAgentId: agentId,
  milestoneId: null,
  dependsOn: [],
  dueAt: null,
}), { projectId, agentId: created.id })
if (taskResult.task.assigneeAgentId !== created.id) throw new Error('custom agent assignee not persisted')
const overview = await page.evaluate(async (projectId) => window.projectos.projects.overview(projectId), projectId)
const inOverview = overview.agents.find((view) => view.agent.id === created.id)
if (!inOverview) throw new Error('custom agent not visible to project orchestration')
console.log('AGENT STUDIO CREATE PASS', created.id, created.currentVersion, 'orchestration-visible=' + inOverview.status, 'capabilities=' + inOverview.agent.capabilities.join(','), 'task=' + taskResult.task.id)
await app.close()
