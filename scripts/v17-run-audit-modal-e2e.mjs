import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root=process.cwd(); const env={...process.env,PROJECTOS_DATA_DIR:mkdtempSync(join(tmpdir(),'v17-runs-')),PROJECTOS_SEED_DEMO:'1',PROJECTOS_WINDOW_WIDTH:'1436',PROJECTOS_WINDOW_HEIGHT:'889'}; delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve(root,'node_modules/electron/dist/electron.exe'),args:['.','--user-data-dir='+mkdtempSync(join(tmpdir(),'v17-runs-u-'))],cwd:resolve(root,'apps/desktop'),env,timeout:60000})
const page=await app.firstWindow(); await page.waitForSelector('.v16-project-visual',{timeout:30000}); const id=await page.evaluate(async()=>(await window.projectos.projects.list()).projects[0].id)
await page.evaluate((pid)=>{location.hash=`#/projects/${pid}/runs`},id)
await page.waitForSelector('.po-runs-full'); await page.waitForTimeout(800)
console.log('aside count', await page.locator('.po-run-detail-panel').count(), 'rows', await page.locator('.po-runs-full .ant-table-row').count())
await page.locator('.po-runs-full .ant-table-row').first().click(); await page.waitForSelector('.po-run-detail-modal'); await page.waitForTimeout(500)
await page.screenshot({path:join(root,'docs/v1.7/run-audit-modal.png')}); console.log('RUN AUDIT MODAL PASS'); await app.close()
