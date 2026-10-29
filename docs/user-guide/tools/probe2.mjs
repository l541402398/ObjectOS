import { _electron as electron } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const dataDir = process.argv[2]
const vault = JSON.parse(readFileSync(join(dataDir, 'ai-secrets.vault.json'), 'utf8'))
console.log('vault ids:', Object.keys(vault.secrets))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${join(dataDir, 'userdata')}`],
  cwd: resolve('apps/desktop'),
  env,
  timeout: 60_000,
})
const page = await app.firstWindow()
await page.waitForSelector('.po-empty-title, .v16-project-visual', { timeout: 60_000 })
await page.waitForTimeout(2500)
const list = await page.evaluate(() => window.projectos.aiConnections.list())
console.log(JSON.stringify(list, null, 2))
await app.close()
