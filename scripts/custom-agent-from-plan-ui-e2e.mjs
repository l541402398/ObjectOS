import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'custom-agent-plan')
mkdirSync(shots, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-custom-agent-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-custom-agent-user-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app = null
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForTimeout(3200)
  const workspace = join(dataDir, 'custom-project')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'custom-project', private: true }, null, 2))
  writeFileSync(join(workspace, 'README.md'), '# custom\n')
  const project = await page.evaluate(async ({ workspace }) => (await window.projectos.projects.create({ name: 'Custom Agent Project', description: '', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  await page.evaluate((id) => { location.hash = `#/projects/${id}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('.po-plan-modal textarea', { timeout: 10_000 })
  await page.locator('.po-plan-modal textarea').fill('为自定义 Agent 创建一个最小任务')
  await page.locator('.po-plan-mode-switch button').filter({ hasText: '本地规则' }).click()
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-task-list"] .po-plan-compact-task', { timeout: 20_000 })
  await page.locator('[data-testid="plan-task-list"] .po-plan-compact-task').first().click()
  await page.waitForSelector('.po-plan-task-detail', { timeout: 10_000 })
  await page.locator('.po-plan-task-detail .pui-role-option').filter({ hasText: '自定义' }).click()
  await page.waitForTimeout(800)
  const studio = page.locator('.v16-agent-studio-modal')
  console.log('studio count=' + await studio.count() + ' visible=' + await studio.isVisible().catch(() => false))
  await page.waitForSelector('.v16-agent-studio-modal', { state: 'visible', timeout: 10_000 })
  console.log('studio inputs=' + await studio.locator('input').count() + ' page inputs=' + await page.locator('.v16-agent-studio-modal input').count())
  const text = await studio.innerText()
  const hadNameField = (await page.locator('.v16-agent-studio-modal input').count()) > 0
  await page.screenshot({ path: join(shots, 'custom-agent-from-plan.png') })
  for (let step = 0; step < 4; step += 1) {
    await page.locator('.v16-agent-studio-modal').getByRole('button', { name: /下一步/ }).click()
  }
  await page.locator('.v16-agent-studio-modal').getByRole('button', { name: '创建 Agent' }).click()
  await page.waitForSelector('.v16-agent-studio-modal', { state: 'hidden', timeout: 15_000 })
  await page.waitForTimeout(1200)
  const agents = await page.evaluate(async () => (await window.projectos.agentDefinitions.list()).agents)
  console.log('agents=' + JSON.stringify(agents.map((agent) => agent.name)))
  await page.locator('[data-testid="plan-task-list"] .po-plan-compact-task').first().click()
  await page.waitForSelector('.po-plan-task-detail', { timeout: 10_000 })
  const agentSelectText = await page.locator('.po-plan-task-detail').innerText()
  await page.screenshot({ path: join(shots, 'custom-agent-assigned.png') })
  const checks = [
    ['selecting custom opens the Agent Studio', text.includes('Agent Studio') || text.includes('创建 Agent')],
    ['studio has a name field', hadNameField],
    ['created Agent is assigned back to the plan task', agentSelectText.includes('通用助理')],
  ]
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1
  else console.log(`\nCUSTOM AGENT FROM PLAN PASS — ${checks.length} checks`)
} catch (error) {
  console.error('CUSTOM AGENT FROM PLAN FAIL —', error)
  if (app) { try { const p = await app.firstWindow(); await p.screenshot({ path: join(shots, 'failure.png') }) } catch { /* ignore */ } }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
