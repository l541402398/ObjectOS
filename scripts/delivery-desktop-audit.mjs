/** Visible real Electron UI acceptance harness. No business API, mocked consent or DB writes. */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
const evidence=resolve('docs/v2/evidence/delivery-organization-closure')
mkdirSync(join(evidence,'screenshots'),{recursive:true})
const {profile}=JSON.parse(readFileSync(resolve('docs/v2/evidence/2026-11-05-functional-audit/desktop-ui-checks.json'),'utf8'))
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r))
const env={...process.env,PROJECTOS_DATA_DIR:join(profile,'data'),PROJECTOS_WINDOW_WIDTH:'1440',PROJECTOS_WINDOW_HEIGHT:'900'};delete env.ELECTRON_RUN_AS_NODE
const packaged=process.argv.includes('--packaged')
const app=await electron.launch({executablePath:resolve(packaged?'release/win-unpacked/ProjectOS.exe':'node_modules/electron/dist/electron.exe'),cwd:resolve(packaged?'.':'apps/desktop'),args:[...(packaged?[]:['.']),`--user-data-dir=${join(profile,'user')}`,'--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`],env,timeout:60000})
const page=await app.firstWindow()
const errors=[];page.on('pageerror',error=>errors.push(error.message))
writeFileSync(join(evidence,'desktop-session.json'),JSON.stringify({profile,port,packaged,interaction:'Real Electron window UI locators only; no business API or seeded business records'},null,2))
console.log(`Desktop ready on loopback port ${port}`)
const stopFile=join(evidence,'desktop-stop'),controlFile=join(evidence,'desktop-window-control.json')
let controlling=false
const timer=setInterval(()=>{
 if(existsSync(stopFile)){unlinkSync(stopFile);clearInterval(timer);void app.close();return}
 if(controlling||!existsSync(controlFile))return
 controlling=true
 const control=JSON.parse(readFileSync(controlFile,'utf8'));unlinkSync(controlFile)
 void(async()=>{
  if(![1024,1440].includes(control.width)||![768,900].includes(control.height)||![1,1.25].includes(control.zoom))throw new Error('Unsupported audit dimensions')
  const window=await app.browserWindow(page)
  await window.evaluate((win,c)=>{if(win.isMaximized())win.unmaximize();win.setSize(c.width,c.height);win.webContents.setZoomFactor(c.zoom)},control)
  writeFileSync(join(evidence,'desktop-window-applied.json'),JSON.stringify(control))
 })().finally(()=>{controlling=false})
},500)
await new Promise(r=>app.once('close',r));clearInterval(timer);writeFileSync(join(evidence,'renderer-errors.json'),JSON.stringify(errors,null,2))
