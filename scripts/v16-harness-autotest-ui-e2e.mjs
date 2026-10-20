import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const key = process.env.DEEPSEEK_API_KEY
if (!key) throw new Error('DEEPSEEK_API_KEY required')
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-harness-ui-')), PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
delete env.DEEPSEEK_API_KEY
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-harness-ui-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual, .po-empty-title', { timeout: 30000 })
await page.evaluate(async (apiKey) => window.projectos.aiConnections.create({ name: 'DeepSeek Test', providerId: 'deepseek', protocol: 'openai-chat', backendKind: 'native-llm', baseUrl: 'https://api.deepseek.com/v1', apiKey, defaultModelId: 'deepseek-chat', enabled: true, isDefault: true }), key)
await page.evaluate(async () => window.projectos.runtimeProfiles.detect())
await page.locator('.po-nav-item').filter({ hasText: '设置' }).first().click()
await page.waitForSelector('.po-settings-dialog')
await page.locator('.po-settings-nav-item').filter({ hasText: '运行时' }).first().click()
await page.waitForTimeout(800)
const row = page.locator('.po-runtime-row').filter({ hasText: 'DeepSeek Harness' }).first()
await row.getByRole('button', { name: /测\s*试/ }).click()
await row.locator('.po-runtime-test-inline').waitFor({ timeout: 180000 })
const text = await row.locator('.po-runtime-test-inline').innerText()
console.log('inline', text.slice(0, 200))
if (!text.includes('HARNESS-CONNECTION-OK') && !text.includes('completed')) throw new Error('harness auto-test failed')
await page.screenshot({ path: join(root, 'docs/v1.6/settings-runtime-autotest.png') })
console.log('HARNESS AUTO TEST UI PASS')
await app.close()
