import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join, resolve } from 'node:path'
const root=process.cwd(); const env={...process.env,PROJECTOS_DATA_DIR:mkdtempSync(join(tmpdir(),'v17link-')),PROJECTOS_SEED_DEMO:'1',PROJECTOS_WINDOW_WIDTH:'1586',PROJECTOS_WINDOW_HEIGHT:'992'}; delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve(root,'node_modules/electron/dist/electron.exe'),args:['.','--user-data-dir='+mkdtempSync(join(tmpdir(),'u-'))],cwd:resolve(root,'apps/desktop'),env,timeout:60000})
const page=await app.firstWindow(); await page.waitForSelector('.v16-project-visual',{timeout:30000}); const id=await page.evaluate(async()=>(await window.projectos.projects.list()).projects[0].id)
await page.evaluate(async(pid)=>{const p=await window.projectos.plans.generate(pid,'实现跨会话群聊联动'); await window.projectos.plans.approve(p.id)},id)
await page.evaluate((pid)=>{location.hash=`#/projects/${pid}/collaboration`},id); await page.waitForSelector('.v17-collab-group',{timeout:15000}); await page.locator('.v17-collab-group').first().click()
await page.waitForSelector('.v17-group-drawer',{timeout:15000}); console.log('CROSS-SESSION GROUP LINK PASS'); await page.screenshot({path:join(root,'docs/v1.7/collaboration-group-link.png')}); await app.close()
