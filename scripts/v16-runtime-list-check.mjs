import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-runtime-list-')), PROJECTOS_WINDOW_WIDTH: '1280', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-runtime-list-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual, .po-empty-title', { timeout: 30000 })
await page.evaluate(async () => window.projectos.runtimeProfiles.detect())
const profiles = await page.evaluate(async () => (await window.projectos.runtimeProfiles.list()).profiles)
for (const profile of profiles) console.log(profile.name, profile.protocol, profile.status, profile.version ?? '-')
const dsh = profiles.find((p) => /DeepSeek Harness/i.test(p.name))
const opencode = profiles.find((p) => /OpenCode/i.test(p.name))
if (!dsh || dsh.status !== 'available') throw new Error('DeepSeek Harness not available')
if (!opencode || opencode.status !== 'available') throw new Error('OpenCode not available')
console.log('RUNTIME SELECTION PASS')
await app.close()
