import { _electron as electron } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
const evidence=resolve('docs/v2/evidence/requirement-guided-flow')
const profile=JSON.parse(readFileSync(join(evidence,'desktop/checks.json'),'utf8')).profile
const out=join(evidence,'editor');mkdirSync(out,{recursive:true})
const env={...process.env,PROJECTOS_DATA_DIR:join(profile,'data'),PROJECTOS_SEED_DEMO:'0',PROJECTOS_WINDOW_WIDTH:'1440',PROJECTOS_WINDOW_HEIGHT:'900'};delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),cwd:resolve('apps/desktop'),args:['.',`--user-data-dir=${join(profile,'user')}`],env,timeout:60000})
const page=await app.firstWindow(),win=await app.browserWindow(page),checks=[],captures=[]
const check=(name,ok,detail)=>{checks.push({name,status:ok?'PASS':'FAIL',detail});console.log(`${ok?'PASS':'FAIL'} ${name}`);if(!ok)throw new Error(name)}
const shot=async name=>{await page.mouse.move(2,2);await page.waitForTimeout(350);writeFileSync(join(out,`${name}.png`),Buffer.from(await win.evaluate(async w=>(await w.webContents.capturePage()).toPNG().toString('base64')),'base64'));captures.push(`${name}.png`)}
try{
  await page.locator('.po-shell').waitFor({timeout:60000})
  const project=(await page.evaluate(()=>window.projectos.projects.list())).projects.find(p=>p.name==='Aurora Notes · 流程验收')
  const requirement=(await page.evaluate(id=>window.projectos.requirements.list(id),project.id)).requirements.find(r=>r.title==='跨设备编辑的一致性与恢复体验')
  await page.evaluate(({p,r})=>{location.hash=`#/projects/${p}/requirements?requirement=${r}`},{p:project.id,r:requirement.id})
  await page.getByRole('button',{name:'调整流程',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:'调整需求流程',exact:true});await dialog.locator('.react-flow__node').last().waitFor()
  check('Standard workflow exposes all six real nodes',await dialog.locator('.react-flow__node').count()===6)
  for(const theme of ['light','dark']){
    await page.emulateMedia({colorScheme:theme});await shot(`six-stages-1440-${theme}`)
  }
  await win.evaluate(w=>w.setSize(1024,768));await win.evaluate(w=>w.webContents.setZoomFactor(1.25));await page.emulateMedia({reducedMotion:'reduce'})
  await dialog.getByRole('button',{name:'适应画布',exact:true}).click()
  await dialog.getByRole('button',{name:'保存流程',exact:true}).focus()
  check('Editor primary action stays reachable at 125%',await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth}))
  check('Reduced motion preference is active',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches))
  await page.evaluate(readFileSync(resolve('node_modules/axe-core/axe.min.js'),'utf8'))
  const issues=await page.evaluate(async()=>(await window.axe.run(document.querySelector('[role="dialog"]'))).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})))
  check('Editor at 125% has no axe violations',issues.length===0,issues)
  await shot('six-stages-1024-dark-125-reduced')
  await dialog.getByLabel('流程名称').fill('未保存的调整')
  await dialog.getByRole('button',{name:'返回',exact:true}).click()
  await dialog.getByText('流程还有未保存的修改',{exact:true}).waitFor()
  check('Back preserves the unsaved editor until a deliberate decision',await dialog.getByRole('button',{name:'继续编辑',exact:true}).isVisible())
  await shot('unsaved-flow-1024-dark-125')
  await dialog.getByRole('button',{name:'放弃修改并返回',exact:true}).click();await dialog.waitFor({state:'hidden'})
  const original=await page.evaluate(id=>window.projectos.workflows.view(id),requirement.id)
  check('Discard leaves the saved requirement workflow intact',original.binding.templateName==='标准研发流程'&&original.binding.graph.nodes.length===6)
}catch(e){process.exitCode=1;console.error(e);checks.push({name:'execution',status:'FAIL',detail:String(e)});await shot('failure').catch(()=>{})}
finally{await app.close().catch(()=>{});writeFileSync(join(out,'checks.json'),JSON.stringify({profile,checks,captures,note:'Native Electron; existing real template from previous integration test; 125% app zoom, not OS DPI.'},null,2))}
