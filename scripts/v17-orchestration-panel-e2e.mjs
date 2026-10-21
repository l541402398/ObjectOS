import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join, resolve } from 'node:path'
const root=process.cwd(); const env={...process.env,PROJECTOS_DATA_DIR:mkdtempSync(join(tmpdir(),'v17panel-')),PROJECTOS_SEED_DEMO:'1',PROJECTOS_WINDOW_WIDTH:'1586',PROJECTOS_WINDOW_HEIGHT:'992'}; delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve(root,'node_modules/electron/dist/electron.exe'),args:['.','--user-data-dir='+mkdtempSync(join(tmpdir(),'u-'))],cwd:resolve(root,'apps/desktop'),env,timeout:60000})
const page=await app.firstWindow(); await page.waitForSelector('.v16-project-visual',{timeout:30000}); const id=await page.evaluate(async()=>(await window.projectos.projects.list()).projects[0].id)
await page.evaluate((pid)=>{location.hash=`#/projects/${pid}/orchestration`},id); await page.waitForSelector('.po-orchestration-page'); await page.waitForSelector('.react-flow__node', { timeout: 20000 }); await page.waitForTimeout(500)
const before=await page.evaluate(()=>({top:document.documentElement.scrollTop,body:document.body.scrollTop,h:document.body.getBoundingClientRect().height,w:document.documentElement.clientWidth}))
await page.locator('.react-flow__node').first().evaluate(el=>el.dispatchEvent(new MouseEvent('click',{bubbles:true}))); await page.waitForSelector('.po-orch-drawer-panel'); await page.waitForTimeout(600)
const after=await page.evaluate(()=>({top:document.documentElement.scrollTop,body:document.body.scrollTop,h:document.body.getBoundingClientRect().height,w:document.documentElement.clientWidth,rect:document.querySelector('.po-orch-drawer-panel').getBoundingClientRect().toJSON(),radius:getComputedStyle(document.querySelector('.po-orch-drawer-panel')).borderRadius}))
console.log('before',before); console.log('after',after)
await page.locator('.po-orch-drawer-panel .ant-tabs-tab').filter({hasText:'运行日志'}).click(); await page.waitForTimeout(500)
await page.screenshot({path:join(root,'docs/v1.7/orchestration-panel.png')}); console.log('PANEL PASS'); await app.close()
