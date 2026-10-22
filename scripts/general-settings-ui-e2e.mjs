import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'general-settings')
mkdirSync(shots, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-general-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-general-user-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app = null
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-nav-item', { timeout: 20_000 })
  await page.waitForTimeout(2500)
  await page.locator('.po-nav-item').filter({ hasText: '设置' }).last().click()
  await page.waitForSelector('.po-settings-dialog', { timeout: 10_000 })
  await page.locator('.po-settings-nav-item').filter({ hasText: '通用与限制' }).click()
  await page.waitForSelector('[data-testid="general-settings"]', { timeout: 10_000 })
  const text = await page.locator('[data-testid="general-settings"]').innerText()
  const before = await page.evaluate(async () => window.projectos.runtime.settings.get())
  const tokenInput = page.locator('.po-setting-row').filter({ hasText: 'Planner 输出上限' }).locator('input')
  await tokenInput.fill('16384')
  await page.getByRole('button', { name: '保存运行限制' }).click()
  await page.waitForTimeout(700)
  const after = await page.evaluate(async () => window.projectos.runtime.settings.get())
  await page.screenshot({ path: join(shots, 'general-settings.png') })
  const checks = [
    ['general section is reachable', text.includes('Planner 输出上限') && text.includes('Agent 最大轮次')],
    ['default output budget is 12288', before.plannerMaxOutputTokens === 12_288],
    ['saved output budget is 16384', after.plannerMaxOutputTokens === 16_384],
    ['agent limits are editable', text.includes('Agent 最大工具调用') && text.includes('计划执行超时')],
  ]
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1
  else console.log(`\nGENERAL SETTINGS UI PASS — ${checks.length} checks`)
} catch (error) {
  console.error('GENERAL SETTINGS UI FAIL —', error)
  if (app) { try { const p = await app.firstWindow(); await p.screenshot({ path: join(shots, 'failure.png') }) } catch { /* ignore */ } }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
