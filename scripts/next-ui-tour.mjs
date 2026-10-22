import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const frames = join(root, 'test-results', 'next-ui-tour-frames')
rmSync(frames, { recursive: true, force: true })
mkdirSync(frames, { recursive: true })
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'projectos-next-tour-')),
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'projectos-next-tour-user-'))],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})
const page = await app.firstWindow()
let frame = 0
async function capture(label) {
  await page.waitForTimeout(600)
  const file = join(frames, `${String(frame++).padStart(2, '0')}-${label}.png`)
  await page.screenshot({ path: file })
  console.log('frame', file)
}
async function navigate(path) {
  await page.evaluate((value) => { location.hash = value }, path)
  await page.waitForTimeout(1_100)
}

try {
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  await page.waitForTimeout(1_400)
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)

  await capture('project-center')
  await navigate(`#/projects/${projectId}/tasks`)
  await capture('task-board')
  await page.locator('.po-task-tile').first().click()
  await page.waitForSelector('[role="dialog"]', { timeout: 10_000 }).catch(() => undefined)
  await capture('task-inspector')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  await navigate(`#/projects/${projectId}/orchestration`)
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
  await capture('orchestration')
  await page.locator('.react-flow__node').nth(1).click()
  await capture('orchestration-inspector')

  await navigate(`#/projects/${projectId}/agents`)
  await capture('agent-workbench')
  await navigate(`#/projects/${projectId}/knowledge`)
  await capture('knowledge')
  await page.keyboard.press('Control+,')
  await page.waitForSelector('[data-testid="settings-dialog"]', { timeout: 5_000 }).catch(() => undefined)
  await capture('settings')
  console.log('TOUR FRAMES', frame)
} catch (error) {
  console.error('TOUR FAIL —', error)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
