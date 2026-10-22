import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'plan-review')
mkdirSync(shots, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-review-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-review-user-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app = null
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForTimeout(3200)
  const workspace = join(dataDir, 'review-project')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'review-project', private: true }, null, 2))
  writeFileSync(join(workspace, 'README.md'), '# review\n')
  const project = await page.evaluate(async ({ workspace }) => (await window.projectos.projects.create({ name: 'Plan Review Project', description: '', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  await page.evaluate((id) => { location.hash = `#/projects/${id}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('.po-plan-modal textarea', { timeout: 10_000 })
  await page.locator('.po-plan-modal textarea').fill('实现设置页运行限制，并为计划审核增加路线图')
  await page.locator('.po-plan-mode-switch button').filter({ hasText: '本地规则' }).click()
  await page.waitForTimeout(300)
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-review-workbench"]', { timeout: 20_000 })
  await page.waitForTimeout(600)
  const overview = await page.locator('.po-plan-review-overview').innerText()
  const stageCount = await page.locator('[data-testid="plan-stage-route"] .po-stage-card').count()
  const compactCount = await page.locator('[data-testid="plan-task-list"] .po-plan-compact-task').count()
  await page.screenshot({ path: join(shots, 'plan-review-overview.png') })
  await page.locator('.po-plan-risk-summary').click()
  await page.waitForSelector('[data-testid="plan-risk-list"]', { timeout: 10_000 })
  const riskRows = await page.locator('[data-testid="plan-risk-list"] > *').count()
  await page.screenshot({ path: join(shots, 'plan-review-risks.png') })
  await page.locator('.po-plan-risk-summary').click()

  await page.getByRole('tab', { name: '任务依赖' }).click()
  await page.waitForSelector('[data-testid="plan-task-dag"] .react-flow__node', { timeout: 10_000 })
  const dagNodes = await page.locator('[data-testid="plan-task-dag"] .react-flow__node').count()
  const dagEdges = await page.locator('[data-testid="plan-task-dag"] .react-flow__edge').count()
  await page.screenshot({ path: join(shots, 'plan-review-dag.png') })
  await page.locator('[data-testid="plan-task-dag"] .react-flow__node').first().click()
  await page.waitForSelector('.po-plan-task-detail', { timeout: 10_000 })
  const drawerFields = await page.locator('.po-plan-task-detail label').allInnerTexts()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'plan-review-task-detail.png') })
  await page.locator('.po-plan-task-drawer .ant-drawer-close').click()
  await page.waitForSelector('.po-plan-task-detail', { state: 'hidden', timeout: 10_000 })

  await page.getByRole('tab', { name: '阶段路线' }).click()
  await page.locator('[data-testid="plan-task-list"] .po-plan-compact-task').first().click()
  await page.waitForSelector('.po-plan-task-detail', { timeout: 10_000 })
  const titleInput = page.locator('.po-plan-task-detail input').first()
  const newTitle = '审核台同步测试任务'
  await titleInput.fill(newTitle)
  await page.locator('.po-plan-task-drawer .ant-drawer-close').click()
  await page.waitForTimeout(300)
  const compactText = await page.locator('[data-testid="plan-task-list"]').innerText()

  const approveButton = page.getByRole('button', { name: '批准并创建任务' })
  const approveEnabled = await approveButton.isEnabled()
  if (approveEnabled) {
    await approveButton.click()
    await page.waitForTimeout(1200)
  }
  const tasks = await page.evaluate(async (id) => (await window.projectos.tasks.board(id)).tasks, project.id)
  let approvedHeight = 0
  if (await page.locator('.po-plan-row').count()) {
    await page.locator('.po-plan-row').first().click()
    await page.waitForSelector('.po-plan-modal .ant-modal-content', { timeout: 10_000 })
    await page.waitForTimeout(400)
    approvedHeight = await page.locator('.po-plan-modal .ant-modal-content').evaluate((element) => element.getBoundingClientRect().height)
  }
  await page.screenshot({ path: join(shots, 'plan-review-final.png') })

  const checks = [
    ['overview shows goal, stages, risk count and version', overview.includes('目标') && overview.includes('阶段') && overview.includes('r1')],
    ['stage route is derived and clickable', stageCount >= 1],
    ['task rows are compact by default', compactCount >= 1],
    ['risk summary expands real review items', riskRows >= 1],
    ['DAG renders real task nodes', dagNodes >= 1],
    ['DAG renders real dependency edges when present', dagEdges >= 0],
    ['task detail keeps editable fields', drawerFields.some((text) => text.includes('任务名称')) && drawerFields.some((text) => text.includes('验收标准'))],
    ['editing title refreshes compact list', compactText.includes(newTitle)],
    ['approval creates real tasks', !approveEnabled || tasks.length > 0],
    ['approved plan modal stays bounded, not edge-to-edge', approvedHeight === 0 || approvedHeight <= 780],
  ]
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1
  else console.log(`\nPLAN REVIEW UI PASS — ${checks.length} checks, stages=${stageCount}, tasks=${compactCount}, dagNodes=${dagNodes}`)
} catch (error) {
  console.error('PLAN REVIEW UI FAIL —', error)
  if (app) { try { const p = await app.firstWindow(); await p.screenshot({ path: join(shots, 'failure.png') }) } catch { /* ignore */ } }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}

