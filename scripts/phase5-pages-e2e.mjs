import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

const root = process.cwd()
const results = []
function check(name, condition) {
  if (!condition) throw new Error(`FAIL  ${name}`)
  results.push(name)
  console.log(`PASS  ${name}`)
}

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'projectos-phase5-')),
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'projectos-phase5-user-'))}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60000,
})

try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)

  await page.evaluate((id) => { location.hash = `#/projects/${id}` }, projectId)
  await page.waitForSelector('.po-ux-overview', { timeout: 20000 })
  check('overview renders approved workspace header', await page.locator('.po-ux-overview-head h1').count() === 1)
  check('overview keeps all lifecycle stages', await page.locator('.po-ux-lifecycle .po-stage').count() === 8)
  check('overview keeps real metrics', await page.locator('.po-ux-metric-strip .po-metric').count() === 4)
  check('overview keeps milestones', await page.locator('.po-milestone').count() >= 1)

  await page.evaluate(() => { location.hash = '#/' })
  await page.waitForSelector('.po-ux-center', { timeout: 20000 })
  check('project center renders portfolio header', await page.locator('.po-ux-center-head h1').innerText() === '项目中心')
  check('project center keeps project cards', await page.locator('.v16-project-visual').count() >= 1)
  check('project center keeps portfolio stats', await page.locator('.v16-stat-card').count() === 4)

  await page.evaluate((id) => { location.hash = `#/projects/${id}/approvals` }, projectId)
  await page.waitForSelector('.po-ux-approvals', { timeout: 20000 })
  check('approvals renders decision header', await page.locator('.po-ux-approvals-head h1').innerText() === '审批中心')
  check('approvals keeps pending/real cards', await page.locator('.v16-approval-card').count() >= 1)
  await page.getByRole('button', { name: '全部' }).click()
  await page.waitForTimeout(200)
  check('approvals filter still works', await page.locator('.v16-filter-tabs button.is-active').innerText() === '全部')

  await page.evaluate((id) => { location.hash = `#/projects/${id}/agents` }, projectId)
  await page.waitForSelector('.po-ux-agents', { timeout: 20000 })
  check('agent workbench renders console header', await page.locator('.po-ux-agents-head h1').innerText() === 'Agent 工作台')
  check('agent workbench keeps real chat session', await page.locator('.v17-session-switch').count() === 1 && await page.locator('.po-chat-pane').count() === 1)
  check('agent workbench keeps run inspector', await page.locator('.po-agent-workspace').count() === 1)

  await page.evaluate((id) => { location.hash = `#/projects/${id}/collaboration` }, projectId)
  await page.waitForSelector('.po-ux-collab', { timeout: 20000 })
  check('collaboration renders cross-session header', await page.locator('.po-ux-collab-head h1').innerText() === '跨会话中心')
  check('collaboration keeps real inbox rows', await page.locator('.po-inbox-row').count() >= 1)
  check('collaboration keeps four signals', await page.locator('.po-metric').count() === 4)

  await page.evaluate((id) => { location.hash = `#/projects/${id}/resources` }, projectId)
  await page.waitForSelector('.po-ux-resources', { timeout: 20000 })
  check('resources renders inventory header', await page.locator('.po-ux-resources-head h1').innerText() === '资源中心')
  check('resources keeps four real resource cards', await page.locator('.v16-resource-cards .v16-glass-card').count() === 4)
  await page.waitForSelector('.v16-resource-file', { timeout: 10000 })
  check('resources keeps real file inventory', await page.locator('.v16-resource-file').count() >= 5)

  await page.evaluate((id) => { location.hash = `#/projects/${id}/operations` }, projectId)
  await page.waitForSelector('.po-ux-ops', { timeout: 20000 })
  check('operations renders health console', await page.locator('.po-ux-ops .po-page-header h1').innerText() === '健康检查与修复')
  check('operations keeps three real panels', await page.locator('.po-operations-grid .po-operations-card').count() === 3)
  check('operations keeps real check action', await page.getByRole('button', { name: '运行健康检查' }).count() === 1)

  await page.evaluate((id) => { location.hash = `#/projects/${id}/tasks` }, projectId)
  await page.waitForSelector('.po-ux-board', { timeout: 20000 })
  check('board renders approved execution header', await page.locator('.po-ux-board-head h1').innerText() === '任务看板')
  check('board keeps five real columns', await page.locator('.po-board-column').count() === 5)
  const before = await page.locator('.po-task-tile').count()
  check('board keeps real task cards', before >= 10)
  await page.getByPlaceholder('搜索任务、描述或标签').fill('编辑器')
  await page.waitForTimeout(350)
  const filtered = await page.locator('.po-task-tile').count()
  check('board search filters real tasks', filtered > 0 && filtered < before)
  await page.getByPlaceholder('搜索任务、描述或标签').fill('')
  await page.waitForTimeout(250)

  await page.locator('.po-task-tile').first().click()
  await page.waitForTimeout(450)
  check('board task inspector opens', await page.locator('[role="dialog"]').count() >= 1)
  check('no page errors', errors.length === 0)

  console.log(`\nPHASE 5 PAGES E2E PASS — ${results.length} checks`)
} finally {
  await app.close()
}






