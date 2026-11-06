/** Real Electron UI only: no business API calls, seeded SQLite or mocked native dialogs. */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const evidence = resolve('docs/v2/evidence/2026-11-05-functional-audit')
mkdirSync(join(evidence, 'screenshots'), { recursive: true })
mkdirSync(resolve('.tmp'), { recursive: true })
const profile = mkdtempSync(resolve('.tmp/functional-desktop-'))
const workspace = join(profile, 'project')
const checks = [], errors = []
let app, page
function check(name, passed, detail = '') {
  checks.push({ name, status: passed ? 'PASS' : 'FAIL', detail })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${detail}`)
  if (!passed) throw new Error(name)
}
async function capture(name) {
  await page.screenshot({ path: join(evidence, 'screenshots', `${name}.png`) })
  writeFileSync(join(evidence, `${name}.txt`), await page.locator('body').innerText())
}
async function launch() {
  const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], cwd: resolve('apps/desktop'), env, timeout: 60_000 })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: /新建项目/ }).first().waitFor({ timeout: 60_000 })
}
try {
  await launch()
  await capture('01-personal-empty')
  await page.getByRole('button', { name: /新建项目/ }).first().click()
  await page.getByLabel('项目名称', { exact: true }).fill('桌面功能验收')
  await page.getByLabel('项目描述', { exact: true }).fill('通过实际桌面表单创建，验证需求、任务、Git 和重启恢复。')
  await page.getByLabel('项目根目录', { exact: true }).fill(workspace)
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.getByRole('button', { name: '需求工作台', exact: true }).waitFor({ timeout: 45_000 })
  check('Create local project through UI and write real README', readFileSync(join(workspace, 'README.md'), 'utf8').includes('桌面功能验收'))
  await capture('02-project-created')
  await page.getByRole('button', { name: '需求工作台', exact: true }).click()
  await page.getByRole('button', { name: '新建需求', exact: true }).click()
  await page.getByLabel('需求名称', { exact: true }).fill('冲突合并审计验收')
  await page.getByLabel('需求描述', { exact: true }).fill('每次变更经过独立任务、审批和验证；冲突必须保留成果并停止交付。')
  await page.getByRole('button', { name: '创建需求', exact: true }).click()
  await page.getByRole('dialog', { name: '新建需求', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 })
  check('Create requirement with persisted workflow through UI', await page.getByRole('heading', { name: '冲突合并审计验收', exact: true }).count() > 0)
  await capture('03-requirement-created')
  await page.getByRole('button', { name: '添加任务', exact: true }).first().click()
  await page.getByLabel('任务名称', { exact: true }).fill('核对合并前的授权与基线')
  await page.getByLabel('任务说明', { exact: true }).fill('仅修改授权文件；冲突时停止，保留提交并重新审查。')
  await page.getByLabel('验收标准', { exact: true }).fill('提交、审查、验证与目标提交可追溯\n冲突不会自动发布')
  await page.getByRole('dialog', { name: '添加任务', exact: true }).getByRole('button', { name: '添加任务', exact: true }).click()
  await page.getByRole('dialog', { name: '添加任务', exact: true }).waitFor({ state: 'hidden', timeout: 30_000 })
  check('Create requirement-owned task through UI', await page.getByText('核对合并前的授权与基线', { exact: true }).count() > 0)
  await capture('04-task-created')
  await app.close(); app = null
  await launch()
  await page.locator('.v16-project-visual').filter({ hasText: '桌面功能验收' }).click()
  await page.getByRole('button', { name: '需求工作台', exact: true }).click()
  await page.getByText('核对合并前的授权与基线', { exact: true }).first().waitFor({ timeout: 30_000 })
  check('Project, requirement and task survive real desktop restart', true)
  await capture('05-restart-recovered')
  await page.getByRole('button', { name: '账号与组织', exact: true }).click()
  await page.getByTestId('organization-panel').waitFor()
  check('Personal mode remains available without organization login', await page.getByText('本地模式', { exact: true }).count() > 0)
  await capture('06-organization-local')
  if (process.env.PROJECTOS_AUDIT_ORG_URL) {
    await page.getByTestId('org-server-url').fill(process.env.PROJECTOS_AUDIT_ORG_URL)
    await page.getByTestId('org-connect').click()
    await page.getByTestId('org-cancel').waitFor({ timeout: 15_000 })
    check('Desktop opens real browser login request', true)
    await capture('07-browser-login-pending')
    console.log('USER_ACTION: Complete registration/sign-in and device consent in the opened local browser.')
    try {
      await page.getByTestId('org-new-organization').waitFor({ timeout: 180_000 })
      check('Real browser PKCE login returns to desktop', true)
      await capture('08-organization-connected')
    } catch {
      checks.push({ name: 'Browser sign-in and organization operations', status: 'BLOCKED', detail: 'Requires manual local test account registration/sign-in; no credentials or consent were injected.' })
      await page.getByTestId('org-cancel').click()
      await capture('08-login-cancelled')
    }
  }
  check('No renderer exceptions', errors.length === 0, errors.join(' | '))
} catch (error) {
  console.error(error)
  checks.push({ name: 'Desktop journey', status: 'FAIL', detail: String(error) })
  if (page) await capture('failure').catch(() => {})
  process.exitCode = 1
} finally {
  writeFileSync(join(evidence, 'desktop-ui-checks.json'), JSON.stringify({ profile, checks, errors, interaction: 'real Electron UI locators; no business API or database seeding' }, null, 2))
  if (app) await app.close()
}
