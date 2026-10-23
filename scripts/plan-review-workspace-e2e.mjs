import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

const root = process.cwd()
const checked = []
function check(name, condition) {
  if (!condition) throw new Error(`FAIL  ${name}`)
  checked.push(name)
  console.log(`PASS  ${name}`)
}

const dataDir = mkdtempSync(join(tmpdir(), 'projectos-workspace-e2e-'))
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
  args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'projectos-workspace-user-'))}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60000,
})

try {
  const page = await app.firstWindow()
  await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
  await page.evaluate((id) => { location.hash = `#/projects/${id}/orchestration` }, projectId)
  await page.waitForSelector('.po-orch-canvas', { timeout: 30000 })

  await page.getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('[data-testid="plan-workbench-dialog"] textarea', { timeout: 10000 })
  await page.locator('[data-testid="plan-workbench-dialog"] textarea').fill('游戏内7层地图都更换风格，每层一个不一样的风格')
  await page.getByRole('radio', { name: /本地规则/ }).click()
  await page.waitForTimeout(650)
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-review-workspace"]', { timeout: 20000 })

  check('workspace replaces the plan dialog', await page.locator('[data-testid="plan-workbench-dialog"]').count() === 0)
  check('header uses 工作项/阶段/待复核', (await page.locator('.pdl-metrics').innerText()).includes('工作项') && (await page.locator('.pdl-metrics').innerText()).includes('待复核'))
  check('approved stage route renders', await page.locator('.pdl-stop').count() === 4)
  check('real task rows render', await page.locator('.pdl-task-row').count() === 4)
  check('task list stays grouped by real stage', await page.locator('.pdl-stage-group').count() === 4)

  await page.locator('.pdl-task-row').first().click()
  await page.waitForSelector('.pdl-inspector', { timeout: 5000 })
  check('task inspector opens', await page.locator('.pdl-inspector').count() === 1)
  check('inspector exposes real plan approval actions', await page.locator('[data-testid="inspector-approve"]').count() === 1 && await page.locator('[data-testid="inspector-reject"]').count() === 1)
  const titleInput = page.locator('.pdl-title-input')
  const original = await titleInput.inputValue()
  await titleInput.fill(`${original}（验收编辑）`)
  const inspectorScroll = page.locator('.pdl-inspector-scroll')
  const scrollBefore = await inspectorScroll.evaluate((node) => ({ top: node.scrollTop, client: node.clientHeight, height: node.scrollHeight }))
  if (scrollBefore.height > scrollBefore.client) {
    const scrollBox = await inspectorScroll.boundingBox()
    await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + 80)
    await page.mouse.wheel(0, 450)
    await page.waitForTimeout(250)
    check('inspector wheel scroll reaches the content', await inspectorScroll.evaluate((node) => node.scrollTop) > scrollBefore.top)
  }
  const closeBox = await page.locator('[aria-label="关闭任务检查器"]').boundingBox()
  await page.mouse.click(Math.round(closeBox.x + closeBox.width / 2), Math.round(closeBox.y + closeBox.height / 2))
  await page.waitForTimeout(700)
  check('inspector close button hit target matches the icon', await page.locator('.pdl-inspector').count() === 0)
  check('inspector edits reach the real draft', (await page.locator('.pdl-task-row').first().innerText()).includes('（验收编辑）'))

  await page.getByRole('tab', { name: '任务依赖' }).click()
  await page.waitForSelector('.pdl-dag', { timeout: 10000 })
  check('approved dependency map renders', await page.locator('.react-flow__node').count() === 4)
  check('dependency edges render', await page.locator('.pdl-dag svg path').count() >= 3)
  await page.locator('.react-flow__node').first().click()
  await page.waitForSelector('.pdl-inspector', { timeout: 5000 })
  await page.locator('[aria-label="关闭任务检查器"]').click()

  await page.getByRole('button', { name: '返回阶段路线' }).click()
  await page.getByRole('button', { name: '批准计划' }).click()
  await page.waitForSelector('[data-testid="plan-review-workspace"]', { state: 'hidden', timeout: 15000 })
  check('real approve closes the workspace', await page.locator('[data-testid="plan-review-workspace"]').count() === 0)

  console.log(`\nPLAN WORKSPACE E2E PASS — ${checked.length} checks`)
} finally {
  await app.close()
}


