/** 临时探针：转储演示项目的 API 原始结构。 */
import { _electron as electron } from 'playwright-core'
import { join, resolve } from 'node:path'

const dataDir = process.argv[2]
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${join(dataDir, 'userdata')}`],
  cwd: resolve('apps/desktop'),
  env,
  timeout: 60_000,
})
const page = await app.firstWindow()
await page.waitForSelector('.po-empty-title, .v16-project-visual', { timeout: 60_000 })
await page.waitForTimeout(2500)
const raw = await page.evaluate(async () => {
  const projects = await window.projectos.projects.list()
  const project = projects.projects?.[0] ?? projects[0]
  const id = project.id
  const plans = await window.projectos.plans.list(id)
  const board = await window.projectos.tasks.board(id)
  const runs = await window.projectos.runs.list(id)
  const approvals = await window.projectos.approvals.list({ projectId: id })
  return { projectId: id, plans, board, runs, approvals }
})
console.log('projectId:', raw.projectId)
console.log('plans:', JSON.stringify(raw.plans).slice(0, 1200))
console.log('board keys:', Object.keys(raw.board ?? {}))
console.log('board:', JSON.stringify(raw.board).slice(0, 1500))
console.log('runs:', JSON.stringify(raw.runs).slice(0, 800))
console.log('approvals:', JSON.stringify(raw.approvals).slice(0, 800))
await app.close()
