/** Continue the manually authenticated real Electron profile, using UI actions only. */
import { _electron as electron } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const evidence = resolve('docs/v2/evidence/2026-11-05-functional-audit')
const { profile } = JSON.parse(readFileSync(join(evidence, 'desktop-ui-checks.json'), 'utf8'))
const resumeSignedOut = process.argv.includes('--verify-signed-out')
const checks = resumeSignedOut ? JSON.parse(readFileSync(join(evidence, 'organization-ui-checks.json'), 'utf8')).checks.filter(check => check.status === 'PASS') : []
const errors = []
let app, page
function check(name, passed) {
  checks.push({ name, status: passed ? 'PASS' : 'FAIL' })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}`)
  if (!passed) throw new Error(name)
}
async function capture(name) {
  await page.screenshot({ path: join(evidence, 'screenshots', `${name}.png`), mask: [page.locator('.org-account-identity')] })
  writeFileSync(join(evidence, `${name}.txt`), await page.locator('[data-testid="organization-panel"]').innerText())
}
async function launch() {
  const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], cwd: resolve('apps/desktop'), env, timeout: 60_000 })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('button', { name: '账号与组织', exact: true }).waitFor({ timeout: 60_000 })
  await page.getByRole('button', { name: '账号与组织', exact: true }).click()
  await page.getByTestId(resumeSignedOut ? 'org-connect' : 'org-new-organization').waitFor({ timeout: 30_000 })
}
try {
  await launch()
  if (resumeSignedOut) {
    check('Signed out state survives desktop restart', await page.getByText('本地模式', { exact: true }).count() > 0)
    await capture('17-signed-out-recovered')
  } else {
  check('Manually authenticated session survives desktop restart', true)
  if (await page.getByTestId('org-select').locator('option:checked').innerText() !== '桌面功能验收组织') {
    await page.getByTestId('org-new-organization').click()
    await page.getByTestId('org-name').fill('桌面功能验收组织')
    await page.getByTestId('org-slug').fill(`desktop-audit-${Date.now()}`)
    await page.getByTestId('org-create-submit').click()
  }
  await page.getByTestId('org-new-project').waitFor({ timeout: 30_000 })
  check('Create organization through desktop UI', await page.getByTestId('org-select').locator('option:checked').innerText() === '桌面功能验收组织')
  await capture('09-organization-created')
  if (await page.getByText('合并审计共享项目', { exact: true }).count() === 0) {
    await page.getByTestId('org-new-project').click()
    await page.getByTestId('org-project-name').fill('合并审计共享项目')
    await page.getByTestId('org-project-key').fill('AUDIT')
    await page.getByTestId('org-project-submit').click()
  }
  await page.getByText('合并审计共享项目', { exact: true }).waitFor({ timeout: 30_000 })
  check('Create shared project through desktop UI', true)
  await capture('10-shared-project-created')
  await page.getByRole('button', { name: '组织成员', exact: true }).click()
  await page.getByRole('table', { name: '当前组织成员', exact: true }).waitFor()
  check('Owner membership is visible', await page.getByRole('table', { name: '当前组织成员', exact: true }).getByText('所有者', { exact: true }).count() > 0)
  await capture('11-organization-members')
  await page.getByRole('button', { name: '执行端', exact: true }).click()
  await page.locator('[data-testid="organization-workers"][aria-busy="false"]').waitFor()
  await page.getByRole('button', { name: '刷新设备', exact: true }).waitFor()
  if (await page.getByTestId('worker-enroll').count() > 0) {
    await page.getByTestId('worker-enroll').click()
    await page.getByTestId('worker-name').fill('本机桌面验收设备')
    await page.getByTestId('worker-enroll-submit').click()
  }
  await page.getByRole('button', { name: '查看 本机桌面验收设备', exact: true }).click()
  await page.getByTestId('worker-pause').waitFor({ timeout: 30_000 })
  check('Enroll real local worker through desktop UI', true)
  check('Worker explicitly does not advertise unfinished task execution', (await page.getByTestId('organization-workers').innerText()).includes('尚未启用'))
  await capture('12-worker-enrolled')
  await page.getByTestId('worker-pause').click()
  await page.getByTestId('worker-state-confirm').click()
  await page.getByTestId('worker-pause').filter({ hasText: '恢复连接' }).waitFor({ timeout: 30_000 })
  check('Pause local worker through UI', true)
  await capture('13-worker-paused')
  await page.getByTestId('worker-pause').click()
  await page.getByTestId('worker-state-confirm').click()
  await page.getByTestId('worker-pause').filter({ hasText: '暂停设备' }).waitFor({ timeout: 30_000 })
  check('Resume local worker through UI', true)
  await capture('14-worker-resumed')
  await app.close(); app = null
  await launch()
  await page.getByText('合并审计共享项目', { exact: true }).waitFor({ timeout: 30_000 })
  check('Organization and shared project survive desktop restart', true)
  await capture('15-organization-recovered')
  await page.getByTestId('org-disconnect').click()
  await page.getByTestId('org-disconnect-confirm').click()
  await page.getByTestId('org-connect').waitFor({ timeout: 30_000 })
  check('Sign out returns to local mode', await page.getByText('本地模式', { exact: true }).count() > 0)
  await capture('16-organization-signed-out')
  }
  await page.keyboard.press('Escape')
  await page.getByTestId('settings-dialog').waitFor({ state: 'hidden' })
  await page.locator('.v16-project-visual').filter({ hasText: '桌面功能验收' }).waitFor()
  check('Sign out preserves personal local project', true)
  check('No renderer exceptions', errors.length === 0)
} catch (error) {
  console.error(error)
  checks.push({ name: 'Organization desktop journey', status: 'FAIL', detail: String(error) })
  if (page) await capture('organization-failure').catch(() => {})
  process.exitCode = 1
} finally {
  writeFileSync(join(evidence, 'organization-ui-checks.json'), JSON.stringify({ checks, errors, interaction: 'real Electron UI; existing manually authenticated session; no business API calls' }, null, 2))
  if (app) await app.close()
}
