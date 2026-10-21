import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join, resolve } from 'node:path'
const root=process.cwd(); const env={...process.env,PROJECTOS_DATA_DIR:mkdtempSync(join(tmpdir(),'v17settings-')),PROJECTOS_SEED_DEMO:'1',PROJECTOS_WINDOW_WIDTH:'1440',PROJECTOS_WINDOW_HEIGHT:'900'}; delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve(root,'node_modules/electron/dist/electron.exe'),args:['.','--user-data-dir='+mkdtempSync(join(tmpdir(),'u-'))],cwd:resolve(root,'apps/desktop'),env,timeout:60000})
const page=await app.firstWindow(); await page.waitForSelector('.v16-project-visual',{timeout:30000}); await page.keyboard.press('Control+,'); await page.waitForSelector('.po-settings-modal',{timeout:10000})
await page.locator('.po-settings-nav-item').filter({hasText:'运行时'}).click(); await page.waitForTimeout(800); await page.screenshot({path:join(root,'docs/v1.7/runtime-settings.png')})
await page.locator('.po-settings-nav-item').filter({hasText:'偏好设置'}).click(); await page.waitForTimeout(500); await page.screenshot({path:join(root,'docs/v1.7/preferences-settings.png')})
console.log('nav items', await page.locator('.po-settings-nav-item').allInnerTexts()); console.log('SETTINGS PASS'); await app.close()
