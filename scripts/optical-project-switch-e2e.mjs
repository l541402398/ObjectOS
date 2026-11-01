import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const profile = mkdtempSync(join(tmpdir(), 'projectos-optical-navigation-'))
const out = resolve('docs/design/optical-restore/navigation')
mkdirSync(out, { recursive: true })
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile,'data'), PROJECTOS_SEED_DEMO: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.',`--user-data-dir=${join(profile,'user')}`], env, timeout:60000 })
const page = await app.firstWindow(), checks=[]
const check=(name,ok)=>{checks.push({name,status:ok?'PASS':'FAIL'});console.log(`${ok?'PASS':'FAIL'} ${name}`)}
try {
  await page.locator('.po-shell').waitFor({timeout:60000})
  const original=(await page.evaluate(()=>window.projectos.projects.list())).projects[0]
  const created=await page.evaluate(rootPath=>window.projectos.projects.create({name:'切换回归项目',description:'Isolated navigation verification',rootPath,createDirectory:true,initGit:true}),join(profile,'workspace'))
  await page.reload();await page.locator('.po-shell').waitFor({timeout:60000})
  await page.evaluate(id=>{location.hash=`#/projects/${id}/agents`},original.id)
  await page.locator('.aco-workbench').waitFor()
  await page.locator('.po-project-button').click()
  await page.getByRole('menuitem').filter({hasText:'切换回归项目'}).click()
  await page.waitForURL(new RegExp(created.project.id))
  await page.locator('.studio-workbench').waitFor()
  check('Project menu opens the newly created real project',await page.locator('.po-project-button').getAttribute('aria-label')==='切换项目：切换回归项目')
  await page.getByRole('button',{name:'任务看板',exact:true}).click()
  await page.locator('.po-tasks-page').waitFor()
  check('Restored task navigation works in the other project',page.url().includes(created.project.id+'/tasks'))
  await page.locator('.po-project-button').click()
  await page.getByRole('menuitem').filter({hasText:original.name}).click()
  await page.waitForURL(new RegExp(original.id));await page.locator('.studio-workbench').waitFor()
  check('Project menu returns to the original data scope',await page.locator('.po-project-button').getAttribute('aria-label')===`切换项目：${original.name}`)
  await page.getByRole('combobox',{name:'项目工作模式'}).click()
  check('Autonomous and assisted choices remain available',await page.getByText('自主模式',{exact:true}).count()>0&&await page.getByText('辅助模式',{exact:true}).count()>0)
  await page.keyboard.press('Escape')
  const win=await app.browserWindow(page)
  writeFileSync(join(out,'project-return.png'),Buffer.from(await win.evaluate(async w=>(await w.webContents.capturePage()).toPNG().toString('base64')),'base64'))
} finally {await app.close().catch(()=>{});writeFileSync(join(out,'results.json'),JSON.stringify({checks},null,2))}
if(checks.some(c=>c.status==='FAIL'))process.exitCode=1
