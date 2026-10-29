/** 探针：验证隔离环境里 AI 连接是否可用（真实推理）。不进手册，只用于环境自检。 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { prepareUserData, seedProvider } from './env.mjs'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-guide-probe-'))
seedProvider(dataDir)
const userData = prepareUserData(dataDir)

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${userData}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.po-empty-title, .v16-project-visual', { timeout: 60_000 })
  await page.waitForTimeout(2500)
  const connections = await page.evaluate(() => window.projectos.aiConnections.list())
  console.log(JSON.stringify(connections, null, 2))
  const test = await page.evaluate(async (id) =>
    window.projectos.aiConnections.test({ id }),
  connections.connections[0]?.id)
  console.log('test:', JSON.stringify(test).slice(0, 600))
} finally {
  await app.close()
}
