import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-drag2-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-drag2-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
await page.evaluate((id) => { location.hash = `#/projects/${id}/tasks` }, projectId)
await page.waitForSelector('.po-board')
await page.waitForTimeout(800)
const result = await page.evaluate(() => {
  const source = document.querySelectorAll('.po-board-column')[0]?.querySelector('.po-task-tile')
  const target = document.querySelectorAll('.po-board-column')[1]
  const title = source?.querySelector('.po-task-tile-title')?.textContent ?? ''
  if (!source || !target) throw new Error('board elements missing')
  const dataTransfer = new DataTransfer()
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  return title
})
await page.waitForTimeout(1200)
const board = await page.evaluate(async (id) => window.projectos.tasks.board(id), projectId)
const task = board.tasks.find((entry) => entry.title === result)
console.log('dragged', result, 'status', task?.status)
if (task?.status !== 'ready') throw new Error('column drop did not move task: ' + task?.status)
console.log('TASK BOARD COLUMN DROP PASS')
await app.close()
