import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v17-plan-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v17-plan-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
const before = await page.evaluate(async (id) => (await window.projectos.sessions.list(id)).sessions.length, projectId)
const result = await page.evaluate(async (id) => {
  const plan = await window.projectos.plans.generate(id, '实现计划协作通知与多 Agent 会话')
  const approved = await window.projectos.plans.approve(plan.id)
  return { id: approved.plan.id, tasks: approved.taskIds.length, roles: [...new Set(approved.plan.tasks.map((task) => task.role))] }
}, projectId)
const after = await page.evaluate(async (id) => (await window.projectos.sessions.list(id)).sessions, projectId)
const newSessions = after.length - before
console.log('plan', result, 'newSessions', newSessions)
if (newSessions < 2) throw new Error('expected per-agent plan sessions, got ' + newSessions)
const planSessions = after.filter((session) => session.title.startsWith('计划协作'))
if (planSessions.length < 2) throw new Error('missing plan sessions')
await page.evaluate((id) => { location.hash = `#/projects/${id}/orchestration` }, projectId)
await page.waitForSelector('.v17-next-step-banner', { timeout: 15000 })
const banner = await page.locator('.v17-next-step-banner').innerText()
if (!banner.includes('计划已批准')) throw new Error('banner missing copy')
await page.screenshot({ path: join(root, 'docs/v1.7/plan-next-step.png') })
await page.evaluate((id) => { location.hash = `#/projects/${id}/agents` }, projectId)
await page.waitForTimeout(1200)
const sessionText = await page.locator('.po-session-list, .po-agent-sessions').first().innerText().catch(() => '')
console.log('PLAN COLLAB PASS', planSessions.map((session) => session.title).join(' | '))
console.log('banner', banner.split('\n').slice(0, 3).join(' / '))
await app.close()
