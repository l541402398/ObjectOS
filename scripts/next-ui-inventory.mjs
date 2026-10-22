import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const out = join(root, 'docs', 'next-ui', 'screens', 'pages')
mkdirSync(out, { recursive: true })
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'projectos-next-inventory-')),
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'projectos-next-inventory-user-'))],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })

const captured = []
async function shot(name) {
  await page.waitForTimeout(700)
  const file = join(out, `${name}.png`)
  await page.screenshot({ path: file })
  captured.push(name)
  console.log('captured', name)
}
async function navigate(hash) {
  await page.evaluate((value) => { location.hash = value }, hash)
  await page.waitForTimeout(1_200)
}

try {
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  await page.waitForTimeout(1_500)
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)

  await navigate('#/')
  await shot('project-center')
  await navigate(`#/projects/${projectId}`)
  await shot('project-overview')
  await navigate(`#/projects/${projectId}/tasks`)
  await shot('task-board')
  await navigate(`#/projects/${projectId}/orchestration`)
  await shot('orchestration')
  await navigate(`#/projects/${projectId}/agents`)
  await shot('agent-workbench')
  await navigate(`#/projects/${projectId}/collaboration`)
  await shot('collaboration')
  await navigate(`#/projects/${projectId}/knowledge`)
  await shot('knowledge')
  await navigate(`#/projects/${projectId}/operations`)
  await shot('operations')
  await navigate(`#/projects/${projectId}/resources`)
  await shot('resources')
  await navigate(`#/projects/${projectId}/approvals`)
  await shot('approvals')
  await navigate(`#/projects/${projectId}/project-settings`)
  await shot('project-settings')
  await navigate(`#/projects/${projectId}/health`)
  await shot('health')
  await navigate(`#/projects/${projectId}/workspace`)
  await shot('workspace')
  await navigate(`#/projects/${projectId}/runs`)
  await shot('runs')
  await navigate('#/notifications')
  await shot('notifications')
  console.log(`\nNEXT UI INVENTORY — ${captured.length} pages, ${errors.length} errors`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  if (errors.length) process.exitCode = 1
} catch (error) {
  console.error('NEXT UI INVENTORY FAIL —', error)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
