import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-install-')), PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-install-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual, .po-empty-title', { timeout: 30000 })
await page.evaluate(async () => window.projectos.runtimeProfiles.detect())
const profiles = await page.evaluate(async () => (await window.projectos.runtimeProfiles.list()).profiles)
const native = profiles.find((profile) => profile.protocol === 'native')
const codex = profiles.find((profile) => profile.name.includes('Codex'))
if (!native || !codex) throw new Error('runtime profiles missing')
const nativeError = await page.evaluate(async (id) => {
  try { await window.projectos.runtimeProfiles.install(id); return null } catch (error) { return String(error?.message ?? error) }
}, native.id)
if (!nativeError || !nativeError.includes('内置 Runtime 无需安装')) throw new Error('native install guard failed: ' + nativeError)
await page.locator('.po-nav-item').filter({ hasText: '设置' }).first().click()
await page.waitForSelector('.po-settings-dialog')
await page.locator('.po-settings-nav-item').filter({ hasText: '运行时' }).first().click()
await page.waitForTimeout(800)
const unavailable = profiles.find((profile) => ['codex', 'qwen-code', 'gemini-cli'].includes(typeof profile.options.adapterId === 'string' ? profile.options.adapterId : '') && profile.status !== 'available')
if (unavailable) {
  const row = page.locator('.po-runtime-row').filter({ hasText: unavailable.name }).first()
  console.log('profile', unavailable.name, unavailable.status, unavailable.options)
  console.log('row', await row.innerText())
  const installButtons = await row.getByRole('button', { name: /安\s*装/ }).count()
  if (installButtons !== 1) throw new Error(`install button missing for ${unavailable.name}`)
  console.log('HARNESS INSTALL UI PASS', 'native-guard=ok', unavailable.name, 'install-button=1')
} else {
  console.log('HARNESS INSTALL UI PASS', 'native-guard=ok', 'all installable harnesses already available')
}
await page.screenshot({ path: join(root, 'docs/v1.6/settings-runtime-install.png') })
await app.close()


