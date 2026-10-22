import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const out = join(root, 'docs', 'next-ui', 'screens', 'regression')
mkdirSync(out, { recursive: true })
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'projectos-next-regression-')),
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'projectos-next-regression-user-'))],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const results = []

async function navigate(path) {
  await page.evaluate((value) => { location.hash = value }, path)
  await page.waitForTimeout(1_100)
}
async function shot(name) {
  await page.screenshot({ path: join(out, `${name}.png`) })
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  results.push({ name, ...width })
  console.log(name, width)
}

try {
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  await page.waitForTimeout(1_400)
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
  const routes = [
    ['project-center', '#/'],
    ['task-board', `#/projects/${projectId}/tasks`],
    ['orchestration', `#/projects/${projectId}/orchestration`],
    ['approvals', `#/projects/${projectId}/approvals`],
    ['runs', `#/projects/${projectId}/runs`],
    ['agent-workbench', `#/projects/${projectId}/agents`],
    ['knowledge', `#/projects/${projectId}/knowledge`],
    ['health', `#/projects/${projectId}/health`],
  ]

  const prepare = async (name) => {
    if (name === 'task-board') {
      await page.locator('.po-board-column').nth(2).locator('.po-task-tile').first().hover().catch(() => undefined)
      await page.waitForTimeout(250)
    }
  }

  for (const [name, route] of routes) {
    await navigate(route)
    await prepare(name)
    await shot(`1440-${name}`)
  }

  await page.getByRole('button', { name: '主题' }).click()
  await page.getByText('深色', { exact: true }).last().click()
  await page.waitForTimeout(500)
  for (const [name, route] of routes) {
    await navigate(route)
    await prepare(name)
    await shot(`dark-${name}`)
  }

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 800))
  await page.waitForTimeout(500)
  for (const [name, route] of routes) {
    await navigate(route)
    await prepare(name)
    await shot(`1100-${name}`)
  }

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 900)
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25)
  })
  await page.waitForTimeout(600)
  for (const [name, route] of routes) {
    await navigate(route)
    await prepare(name)
    await shot(`125-${name}`)
  }

  const overflow = results.filter((item) => item.scroll > item.viewport + 1)
  console.log(`\nNEXT UI REGRESSION — ${results.length} captures, ${overflow.length} horizontal overflows, ${errors.length} page errors`)
  if (overflow.length) console.log(JSON.stringify(overflow, null, 2))
  if (overflow.length || errors.length) process.exitCode = 1
} catch (error) {
  console.error('NEXT UI REGRESSION FAIL —', error)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}


