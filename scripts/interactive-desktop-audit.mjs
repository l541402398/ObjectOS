/** Visible desktop UI test fixture. Remote debugging is loopback-only and exists only for this run. */
import { _electron as electron } from 'playwright-core'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'

const evidence = resolve('docs/v2/evidence/2026-11-05-functional-audit')
const { profile } = JSON.parse(readFileSync(join(evidence, 'desktop-ui-checks.json'), 'utf8'))
const portServer = createServer()
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve))
const port = portServer.address().port
await new Promise(resolve => portServer.close(resolve))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`], env, timeout: 60_000 })
const page = await app.firstWindow()
await page.getByRole('button', { name: '设置', exact: true }).click()
await page.getByRole('button', { name: 'AI 连接', exact: true }).click()
writeFileSync(join(evidence, 'interactive-desktop-port.txt'), String(port))
console.log('Visible isolated desktop ready for real-model UI acceptance.')
console.log(`Loopback UI debugging port: ${port}`)
const stopFile = join(evidence, 'interactive-desktop-stop')
const stopTimer = setInterval(() => {
  if (!existsSync(stopFile)) return
  unlinkSync(stopFile)
  clearInterval(stopTimer)
  void app.close()
}, 500)
await new Promise(resolve => app.once('close', resolve))
clearInterval(stopTimer)
