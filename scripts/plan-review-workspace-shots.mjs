import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

const root = process.cwd()
const out = resolve(root, '../../docs/next-ui/visual-regression/plan-workspace')
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-workspace-shots-'))
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'projectos-workspace-shots-user-'))}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60000,
})

try {
  const page = await app.firstWindow()
  await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
  const id = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, id)
  await page.waitForSelector('.po-orch-canvas', { timeout: 30000 })
  await page.getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('[data-testid="plan-workbench-dialog"] textarea', { timeout: 10000 })
  await page.locator('[data-testid="plan-workbench-dialog"] textarea').fill('游戏内7层地图都更换风格，每层一个不一样的风格')
  await page.getByRole('radio', { name: /本地规则/ }).click()
  await page.waitForTimeout(650)
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-review-workspace"]', { timeout: 20000 })
  await page.waitForTimeout(700)

  await page.screenshot({ path: join(out, '1440-light-route.png') })
  await page.getByRole('tab', { name: '任务依赖' }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(out, '1440-light-dag.png') })
  await page.locator('.react-flow__node').first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, '1440-light-dag-focus.png') })
  await page.locator('[aria-label="关闭任务检查器"]').click()

  await page.getByRole('button', { name: '切换主题' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, '1440-dark-route.png') })
  await page.getByRole('button', { name: '切换主题' }).click()

  await page.getByRole('tab', { name: '阶段路线' }).click()
  await page.locator('.pdl-task-row').first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, '1440-light-inspector.png') })
  await page.locator('[aria-label="关闭任务检查器"]').click()

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 820))
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, '1100-light-route.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(out, '125-light-route.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
} finally {
  await app.close()
}
