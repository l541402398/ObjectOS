import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-tray-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve('apps/desktop'), env })
await app.firstWindow()
await new Promise((r) => setTimeout(r, 2500))
const before = await app.evaluate(({ app }) => app.isReady())
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close())
await new Promise((r) => setTimeout(r, 1200))
const hidden = await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]
  return { exists: Boolean(win), visible: win?.isVisible() ?? null }
})
if (!before || !hidden.exists || hidden.visible !== false) throw new Error(`tray close behavior failed: ${JSON.stringify(hidden)}`)
await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win?.show(); win?.focus() })
await new Promise((r) => setTimeout(r, 500))
const shown = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
if (shown !== true) throw new Error('window could not be restored from tray')
console.log('TRAY E2E PASS — close hides window, app stays alive, window can be restored.')
await app.close()
rmSync(dataDir, { recursive: true, force: true })
