import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const out = join(root, 'docs', 'ui-review')
mkdirSync(out, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-ui-review-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-ui-review-user-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + userDataDir], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
const captured = []
async function shot(name) {
  await page.waitForTimeout(450)
  const file = join(out, `${name}.png`)
  await page.screenshot({ path: file })
  captured.push(name)
  console.log('  captured', name)
}
async function closeModal() {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
}
async function navigate(hash, selector) {
  await page.evaluate((value) => { location.hash = value }, hash)
  await page.waitForTimeout(900)
  if (selector) await page.waitForSelector(selector, { timeout: 20_000 })
  await page.waitForTimeout(350)
}

try {
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  await page.waitForTimeout(2000)
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)

  await navigate('#/', '.po-project-card')
  await shot('page-project-center')
  await page.getByRole('button', { name: '新建项目' }).first().click()
  await page.waitForSelector('.ant-modal')
  await shot('modal-new-project')
  await closeModal()

  await navigate(`#/projects/${projectId}`, '.po-overview-page')
  await shot('page-overview')
  await page.getByRole('button', { name: '新建任务' }).first().click()
  await page.waitForTimeout(700)
  if (await page.locator('.ant-modal').count()) {
    await shot('modal-new-task-from-overview')
    await closeModal()
  }

  await navigate(`#/projects/${projectId}/tasks`, '.po-task-tile')
  await shot('page-task-board')
  await page.getByRole('button', { name: '新建任务' }).first().click()
  await page.waitForSelector('.ant-modal')
  await shot('modal-new-task')
  await closeModal()
  await page.locator('.po-task-tile').first().click()
  await page.waitForTimeout(900)
  await shot('drawer-task-detail')
  await closeModal()

  await navigate(`#/projects/${projectId}/knowledge`, '.po-knowledge-search')
  await shot('page-knowledge')

  await navigate(`#/projects/${projectId}/operations`, '.po-operations-grid')
  await shot('page-operations')

  await navigate(`#/projects/${projectId}/orchestration`, '.po-orchestration-page')
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
  await shot('page-orchestration')
  const planButton = page.getByRole('button', { name: /生成计划/ }).first()
  if (await planButton.count()) {
    await planButton.click()
    await page.waitForTimeout(1200)
    await shot('modal-plan')
    await closeModal()
  }

  await navigate(`#/projects/${projectId}/agents`, '.po-agent-page')
  await shot('page-agent-workbench')
  await page.getByRole('button', { name: 'Agent 管理' }).click()
  await page.waitForTimeout(800)
  await shot('modal-agent-studio')
  await closeModal()
  await page.getByRole('button', { name: '新建会话' }).first().click()
  await page.waitForTimeout(700)
  await shot('modal-new-session')
  await closeModal()

  await navigate(`#/projects/${projectId}/collaboration`, '.po-inbox-row')
  await shot('page-cross-session')
  await navigate(`#/projects/${projectId}/workspace`, '.monaco-editor')
  await shot('page-workspace')
  await navigate(`#/projects/${projectId}/runs`, '.po-run-detail-panel')
  await shot('page-runs')

  await page.locator('.po-nav-item').filter({ hasText: '设置' }).first().click()
  await page.waitForSelector('.po-settings-dialog')
  await page.waitForTimeout(700)
  await shot('settings-ai-connections')
  await page.getByRole('button', { name: '新增连接' }).first().click()
  await page.waitForTimeout(600)
  await shot('settings-connection-editor')
  await page.locator('.po-ai-editor-top button').first().click()
  for (const [key, label] of [['models','模型目录'],['routing','Agent 路由'],['runtime','运行时'],['external','外部 Agent'],['general','通用'],['about','关于']]) {
    const item = page.locator('.po-settings-nav-item').filter({ hasText: label }).first()
    if (await item.count()) {
      await item.click()
      await page.waitForTimeout(600)
      await shot(`settings-${key}`)
    }
  }
  await page.locator('.po-settings-modal .ant-modal-close').click()
  await page.waitForTimeout(300)

  await page.keyboard.press('Control+K')
  await page.waitForTimeout(700)
  await shot('command-palette')
  await page.keyboard.press('Escape')

  if (errors.length) console.warn('renderer errors:', errors.slice(0, 5))
  console.log(`UI INVENTORY PASS — ${captured.length} images in docs/ui-review`)
  rmSync(dataDir, { recursive: true, force: true })
} catch (error) {
  console.error('UI INVENTORY FAIL —', error instanceof Error ? error.message : error)
  console.error('data kept:', dataDir)
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
}


