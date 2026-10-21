import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root=process.cwd(); const workspace=join(mkdtempSync(join(tmpdir(),'v17-scan-ws-')),'sea-service-new')
mkdirSync(join(workspace,'frontend','src'),{recursive:true}); mkdirSync(join(workspace,'backend','src','main','java'),{recursive:true})
writeFileSync(join(workspace,'frontend','package.json'),JSON.stringify({name:'web',dependencies:{react:'^19',vite:'^8'}}))
writeFileSync(join(workspace,'frontend','tsconfig.json'),'{}')
writeFileSync(join(workspace,'frontend','package-lock.json'),'{}')
writeFileSync(join(workspace,'frontend','src','App.tsx'),'export const App=()=>null')
writeFileSync(join(workspace,'backend','pom.xml'),'<project><spring-boot/></project>')
writeFileSync(join(workspace,'backend','src','main','java','App.java'),'class App {}')
const env={...process.env,PROJECTOS_DATA_DIR:mkdtempSync(join(tmpdir(),'v17-scan-'))}; delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve(root,'node_modules/electron/dist/electron.exe'),args:['.','--user-data-dir='+mkdtempSync(join(tmpdir(),'v17-scan-u-'))],cwd:resolve(root,'apps/desktop'),env,timeout:60000})
const page=await app.firstWindow(); await page.waitForSelector('.po-empty-title, .v16-project-visual',{timeout:30000})
const projectId=await page.evaluate(async(ws)=>{const {project}=await window.projectos.projects.create({name:'sea-service-new',description:'',rootPath:ws,createDirectory:false,initGit:false}); return project.id},workspace)
const snap=await page.evaluate(async(id)=> window.projectos.projectAnalysis.scan(id),projectId)
console.log('snapshot', snap.languages, snap.frameworks.map(f=>f.name), snap.packageManager, snap.warnings)
const knowledge=await page.evaluate(async(id)=> (await window.projectos.knowledge.list(id)).entries,projectId)
const body=knowledge.find(e=>e.sourceUri?.startsWith('projectos://snapshot/'))?.body ?? ''
console.log('body', body.split('\n').slice(0,4).join(' | '))
if(!body.includes('React')||!body.includes('TypeScript')||!body.includes('Java / Maven')) throw new Error('knowledge index incomplete')
writeFileSync(join(workspace,'frontend','package.json'),JSON.stringify({name:'web',dependencies:{react:'^19',vite:'^8',antd:'^6'}}))
await page.evaluate(async(id)=> window.projectos.projectAnalysis.scan(id),projectId)
const knowledge2=await page.evaluate(async(id)=> (await window.projectos.knowledge.list(id)).entries,projectId)
const snapshots=knowledge2.filter(e=>e.sourceUri?.startsWith('projectos://snapshot/'))
console.log('snapshots', snapshots.length, snapshots[0]?.body.includes('Ant Design'))
if(snapshots.length!==1||!snapshots[0].body.includes('Ant Design')) throw new Error('rescan did not refresh knowledge')
console.log('PROJECT SCAN REFRESH PASS')
await app.close()
