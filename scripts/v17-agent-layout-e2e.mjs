import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join, resolve } from 'node:path'
const root=process.cwd(); const env={...process.env,PROJECTOS_DATA_DIR:mkdtempSync(join(tmpdir(),'v17agent2-')),PROJECTOS_SEED_DEMO:'1',PROJECTOS_WINDOW_WIDTH:'1586',PROJECTOS_WINDOW_HEIGHT:'992'}; delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve(root,'node_modules/electron/dist/electron.exe'),args:['.','--user-data-dir='+mkdtempSync(join(tmpdir(),'u-'))],cwd:resolve(root,'apps/desktop'),env,timeout:60000})
const page=await app.firstWindow(); await page.waitForSelector('.v16-project-visual',{timeout:30000}); const id=await page.evaluate(async()=>(await window.projectos.projects.list()).projects[0].id)
const plan=await page.evaluate(async(pid)=>window.projectos.plans.generate(pid,'实现计划生成即创建 Agent 会话'),id); const sessions=await page.evaluate(async(pid)=>(await window.projectos.sessions.list(pid)).sessions.map(s=>s.title),id); console.log('DRAFT SESSIONS',sessions.filter(t=>t.startsWith('计划')))
await page.evaluate((pid)=>{location.hash=`#/projects/${pid}/agents`},id); await page.waitForSelector('.po-chat-pane',{timeout:15000}); await page.waitForTimeout(600)
console.log('old session pane', await page.locator('.po-session-pane').count(), 'toggle', await page.locator('.v17-session-switch').count(), 'bookmark', await page.locator('.v17-run-bookmark').count())
await page.locator('.v17-session-switch button').first().click(); await page.waitForTimeout(300); await page.screenshot({path:join(root,'docs/v1.7/agent-session-dropdown.png')})
await page.locator('.v17-run-bookmark').click(); await page.waitForTimeout(500); await page.screenshot({path:join(root,'docs/v1.7/agent-run-drawer.png')})
console.log('AGENT LAYOUT PASS'); await app.close()


