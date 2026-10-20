import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-install-real-')), PROJECTOS_WINDOW_WIDTH: '1280', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-install-real-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual, .po-empty-title', { timeout: 30000 })
await page.evaluate(async () => window.projectos.runtimeProfiles.detect())
const profiles = await page.evaluate(async () => (await window.projectos.runtimeProfiles.list()).profiles)
const qwen = profiles.find((profile) => profile.name.includes('Qwen'))
if (!qwen) throw new Error('Qwen profile missing')
console.log('installing', qwen.name, qwen.status)
const started = Date.now()
const result = await page.evaluate(async (id) => window.projectos.runtimeProfiles.install(id), qwen.id)
console.log('install result', result.detection.status, result.detection.version, Math.round((Date.now() - started) / 1000) + 's')
const after = await page.evaluate(async () => (await window.projectos.runtimeProfiles.list()).profiles)
const updated = after.find((profile) => profile.id === qwen.id)
if (!updated || updated.status !== 'available') throw new Error('Qwen not available after install')
console.log('REAL HARNESS INSTALL PASS', updated.name, updated.status, updated.version)
await app.close()
