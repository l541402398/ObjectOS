import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-phase11-ui-'))
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
delete env.PROJECTOS_ENABLE_AUTO_QUALITY_GATE
let app
const logs = []
const log = (message) => { logs.push(message); console.log(`[phase11-ui] ${message}`) }

async function launch() {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 30_000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  return page
}

try {
  const page = await launch()
  if (await page.locator('.v16-project-visual').count()) {
    await page.locator('.v16-project-visual').first().click()
  }
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  await page.waitForTimeout(800)

  const shellText = await page.locator('body').innerText()
  for (const label of ['需求', '待审批', '待验收', '运行中', '成果']) {
    if (!shellText.includes(label)) throw new Error(`missing metric ${label}`)
  }
  if (!shellText.includes('全项目')) throw new Error('metric scope is not visible')
  const versionText = await page.locator('.po-sidebar-runtime-version').innerText()
  if (versionText !== 'v1.7.0') throw new Error(`product version mismatch: ${versionText}`)
  console.log('[phase11-ui] product version', versionText)
  log('work-center metrics/version PASS')

  await page.getByRole('button', { name: /记录需求/ }).first().click()
  await page.locator('input[placeholder="要解决什么问题？"]').fill('UI E2E 真实需求')
  await page.locator('textarea[placeholder="现状、边界、如何判定完成"]').fill('通过真实 Electron 点击创建，验收标准：能在需求列表看到。')
  await page.locator('.ant-modal-footer button').last().click()
  await page.waitForFunction(() => document.body.innerText.includes('UI E2E 真实需求'), null, { timeout: 15_000 })
  log('requirement created via UI PASS')

  await page.getByRole('button', { name: '版本与迭代', exact: true }).click()
  await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /新建版本/ }).click()
  await page.locator('input[placeholder="例如 1.1.0"]').fill('9.8.0')
  await page.locator('.ant-modal-footer button').last().click()
  await page.waitForFunction(() => document.body.innerText.includes('v9.8.0'), null, { timeout: 15_000 })
  log('version created via UI PASS')

  const versionCard = page.locator('.lc-version').filter({ hasText: 'v9.8.0' }).first()
  if (await versionCard.getByRole('button', { name: '设为当前' }).count()) {
    await versionCard.getByRole('button', { name: '设为当前' }).click()
    await page.waitForTimeout(800)
  }
  const currentCard = page.locator('.lc-version').filter({ hasText: 'v9.8.0' }).first()
  await currentCard.locator('.ant-select').click()
  await page.getByRole('option', { name: '需求/发现', exact: true }).click()
  await page.waitForSelector('.lc-gate-error', { timeout: 15_000 })
  const gateError = await page.locator('.lc-gate-error').innerText()
  if (!gateError.includes('缺少 review_record')) throw new Error(`unexpected gate error: ${gateError}`)
  log('gate failure via UI PASS')

  await page.getByRole('button', { name: /记录证据/ }).click()
  await page.locator('input[placeholder="例如：v0.1.0 验收评审记录"]').fill('v9.8.0 UI 评审记录')
  await page.locator('textarea[placeholder="实际检查了什么、结果如何"]').fill('通过真实 UI 记录评审范围；不替代外部确认。')
  await page.locator('.ant-modal-footer button').last().click()
  await page.waitForTimeout(1000)

  const refreshedCard = page.locator('.lc-version').filter({ hasText: 'v9.8.0' }).first()
  await refreshedCard.locator('.ant-select').click()
  await page.getByRole('option', { name: '需求/发现', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('最近门禁通过'), null, { timeout: 15_000 })
  const phaseText = await page.locator('.lc-version').filter({ hasText: 'v9.8.0' }).first().innerText()
  if (!phaseText.includes('需求/发现')) throw new Error('version did not enter discovery')
  log('gate pass via UI PASS')

  const countsText = await page.locator('.po-lifecycle-page').innerText()
  if (!countsText.includes('0 任务 · 0 完成')) throw new Error('version task counts missing')
  if (!countsText.includes('0 计划 · 0 成果')) throw new Error('version plan/artifact counts missing')
  log('version counts/empty-state PASS')

  await page.evaluate(() => { location.hash = location.hash.replace('/versions', '/tasks') })
  await page.waitForSelector('.po-tasks-page', { timeout: 30_000 })
  const taskPageText = await page.locator('body').innerText()
  if (!taskPageText.includes('按版本过滤')) throw new Error('task board version filter missing')
  log('task board version filter PASS')

  console.log('PHASE 1.1 UI E2E PASS')
  await app.close()
} finally {
  try { await app?.close() } catch { /* ignore */ }
  rmSync(dataDir, { recursive: true, force: true })
}
