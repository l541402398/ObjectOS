import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const key = process.env.DEEPSEEK_API_KEY
if (!key) throw new Error('DEEPSEEK_API_KEY required')
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-harness-test-')), PROJECTOS_WINDOW_WIDTH: '1280', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
delete env.DEEPSEEK_API_KEY
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-harness-test-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual, .po-empty-title', { timeout: 30000 })
await page.evaluate(async (apiKey) => window.projectos.aiConnections.create({
  name: 'DeepSeek Test', providerId: 'deepseek', protocol: 'openai-chat', backendKind: 'native-llm',
  baseUrl: 'https://api.deepseek.com/v1', apiKey, defaultModelId: 'deepseek-chat', enabled: true, isDefault: true,
}), key)
await page.waitForTimeout(800)
await page.evaluate(async () => window.projectos.runtimeProfiles.detect())
const profiles = await page.evaluate(async () => (await window.projectos.runtimeProfiles.list()).profiles)
const dsh = profiles.find((profile) => profile.name.includes('DeepSeek Harness'))
if (!dsh) throw new Error('DSH profile missing')
console.log('testing', dsh.name, dsh.status)
const result = await page.evaluate(async (id) => window.projectos.runtimeProfiles.execute(id, 'Reply with exactly: HARNESS-CONNECTION-OK'), dsh.id)
console.log('status', result.status, 'contains', result.output.includes('HARNESS-CONNECTION-OK'), 'chars', result.output.length)
if (result.status !== 'completed' || !result.output.includes('HARNESS-CONNECTION-OK')) throw new Error('harness test failed: ' + result.output.slice(-1000))
console.log('HARNESS AI CONNECTION BRIDGE PASS')
await app.close()
