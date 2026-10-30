/** Real PostgreSQL + real Electron + browser/PKCE + typed IPC. No mocked identity or renderer token. */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'
import { startOrganizationTestDatabase, reserveOrganizationTestPort } from '../tests/helpers/org-postgres.ts'
import { migrateOrganizationDatabase } from '../apps/server/src/postgres-store.ts'
import { buildOrganizationServer } from '../apps/server/src/persistent-server.ts'
import { runDesktopLogin } from '../apps/desktop/src/main/auth/desktop-login-core.ts'

const root=process.cwd(), evidence=resolve(process.env.PROJECTOS_ORG_EVIDENCE_DIR || 'docs/org-upgrade/evidence/A1'), shots=join(evidence,'screenshots')
mkdirSync(shots,{recursive:true})
const profile=mkdtempSync(join(tmpdir(),'projectos-org-ui-')),dataDir=join(profile,'data'),userData=join(profile,'user')
const results=[],errors=[]
function check(name,condition,detail=''){results.push({name,status:condition?'PASS':'FAIL',detail});console.log(`[${condition?'PASS':'FAIL'}] ${name}${detail?' — '+detail:''}`);if(!condition)throw new Error(name)}
async function waitFor(action,label,timeout=30_000){const start=Date.now();while(Date.now()-start<timeout){if(await action())return;await new Promise(r=>setTimeout(r,100))}throw new Error('Timed out: '+label)}
let database,server,app,page,win,browser
const password='A1-test-'+randomBytes(16).toString('hex'),email='owner-a1@demo.invalid'
const secret=randomBytes(32).toString('hex')
let serverUrl,serverOptions
async function launch(){
 const env={...process.env,PROJECTOS_DATA_DIR:dataDir,PROJECTOS_WINDOW_WIDTH:'1440',PROJECTOS_WINDOW_HEIGHT:'900'};delete env.ELECTRON_RUN_AS_NODE
 app=await electron.launch({executablePath:resolve('node_modules/electron/dist/electron.exe'),cwd:resolve('apps/desktop'),args:['.',`--user-data-dir=${userData}`,...(process.env.PROJECTOS_ASSET_E2E==='1'?['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0']:[])],env,timeout:60_000})
 page=await app.firstWindow();win=await app.browserWindow(page)
 page.on('pageerror',error=>errors.push(error.message))
 await page.waitForSelector('.po-shell',{timeout:60_000})
 await app.evaluate(({shell})=>{globalThis.__orgAuthorizeUrl=null;shell.openExternal=async url=>{globalThis.__orgAuthorizeUrl=url}})
 await page.getByText('账号与组织',{exact:true}).first().click()
 await page.getByTestId('organization-panel').waitFor()
}
async function theme(mode){await page.emulateMedia({colorScheme:mode});await page.waitForFunction(mode=>document.documentElement.dataset.theme===mode,mode,{timeout:5000})}
async function capture(name){
 await page.mouse.move(5,5)
 await page.waitForFunction(()=>[...document.querySelectorAll('.pui-overlay-surface:not(.is-closing)')].every(el=>Number(getComputedStyle(el).opacity)>=.999))
 await page.waitForTimeout(400)
 const bytes=await win.evaluate(async w=>(await w.webContents.capturePage()).toPNG().toString('base64'))
 writeFileSync(join(shots,name+'.png'),Buffer.from(bytes,'base64'))
}
async function matrix(prefix){
 for(const width of [1440,1024])for(const mode of ['light','dark']){
  await win.evaluate((w,size)=>{w.setContentSize(size,900);w.show();w.focus()},width)
  await theme(mode);await page.waitForTimeout(250);await capture(`${prefix}-${width}-${mode}`)
  const layout=await page.getByTestId('organization-panel').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+2,theme:document.documentElement.dataset.theme}))
  check(`${prefix} ${width} ${mode} fits`,!layout.overflow&&layout.theme===mode)
 }
 await win.evaluate(w=>{w.setContentSize(1440,900);w.webContents.setZoomFactor(1.25)})
 await theme('light');await page.waitForTimeout(250);await capture(`${prefix}-1440-light-125`)
 check(`${prefix} 125% fits`,await page.getByTestId('organization-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+2))
 await win.evaluate(w=>w.webContents.setZoomFactor(1))
}
async function bobLogin(){
 const signup=await fetch(`${serverUrl}/api/auth/sign-up/email`,{method:'POST',headers:{'content-type':'application/json',origin:serverUrl},body:JSON.stringify({name:'林舟',email:'member-a1@demo.invalid',password})})
 if(!signup.ok)throw new Error('Second account creation failed')
 const cookie=signup.headers.getSetCookie().map(value=>value.split(';',1)[0]).join('; ')
 return runDesktopLogin({authBaseUrl:serverUrl,openExternal:async url=>{
  const consent=await fetch(url,{headers:{cookie}}),html=await consent.text()
  const requestId=/name="request_id" value="([^"]+)"/.exec(html)?.[1]
  if(!requestId)throw new Error('Missing second-account consent')
  const grant=await fetch(`${serverUrl}/v1/desktop/consent`,{method:'POST',redirect:'manual',headers:{cookie,origin:serverUrl,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({request_id:requestId,decision:'allow'})})
  if(!grant.headers.get('location'))throw new Error('Second consent was rejected')
  await fetch(grant.headers.get('location'))
 }})
}
try{
 database=await startOrganizationTestDatabase();await migrateOrganizationDatabase(database.pool)
 serverUrl=`http://127.0.0.1:${await reserveOrganizationTestPort()}`
 serverOptions={databaseUrl:database.databaseUrl,secret,baseURL:serverUrl}
 let rejectNextProjectRead=false, workerUnavailable=false
 server=await buildOrganizationServer(serverOptions)
 server.addHook('onRequest',async(request,reply)=>{
  if(workerUnavailable && request.url.includes('/workers')) return reply.code(503).send({error:{code:'TEMPORARY_UNAVAILABLE',message:'Isolated worker availability fixture'}})
  if(rejectNextProjectRead && request.method==='GET' && request.url.endsWith('/projects')){
   rejectNextProjectRead=false;return reply.code(503).send({error:{code:'TEMPORARY_UNAVAILABLE',message:'Isolated one-shot recovery fixture'}})
  }
 })
 server.addHook('onError',async(request,_reply,error)=>{console.error('ORG FIXTURE ERROR',request.method,request.url.split('?')[0],error.code,error.message)})
 await server.listen({host:'127.0.0.1',port:Number(new URL(serverUrl).port)})
 await launch()
 check('Local mode remains available',(await page.evaluate(()=>window.projectos.organization.status())).status==='local')
 check('Organization form controls have labels',await page.getByTestId('organization-panel').locator('input,select,textarea').evaluateAll(elements=>elements.every(el=>el.labels?.length||el.getAttribute('aria-label'))))
 await page.getByTestId('org-server-url').focus();await page.keyboard.press('Tab')
 check('Connection action is reachable by keyboard',await page.getByTestId('org-connect').evaluate(el=>el===document.activeElement))
 await matrix('connection')
 await page.getByTestId('org-server-url').fill(serverUrl);await page.getByTestId('org-connect').click()
 await waitFor(()=>app.evaluate(()=>globalThis.__orgAuthorizeUrl),'system browser request')
 const authUrl=await app.evaluate(()=>globalThis.__orgAuthorizeUrl)
 check('Browser request has PKCE and no token',authUrl.includes('code_challenge_method=S256')&&!authUrl.includes('token='))
 const browserEvent=app.waitForEvent('window')
 // The external system browser has a separate cookie/CSP session. Preserve that boundary in this
 // unprivileged test window; the production renderer's form-action:none remains untouched.
 await app.evaluate(async({BrowserWindow},url)=>{const w=new BrowserWindow({width:1100,height:900,webPreferences:{partition:'org-a1-browser-test',contextIsolation:true,nodeIntegration:false,sandbox:true}});globalThis.__orgBrowser=w;await w.loadURL(url+'&mode=register')},authUrl)
 browser=await browserEvent;await browser.waitForLoadState('domcontentloaded')
 await browser.screenshot({path:join(shots,'browser-registration-light.png')})
 await browser.getByLabel('姓名',{exact:true}).fill('陈澄')
 await browser.getByLabel('邮箱',{exact:true}).fill(email)
 await browser.getByLabel('密码',{exact:true}).fill(password)
 await browser.getByRole('button',{name:/创建账号|注册并继续/}).click()
 await browser.getByRole('button',{name:'授权此设备',exact:true}).waitFor()
 await browser.screenshot({path:join(shots,'browser-consent-light.png')})
 await browser.getByRole('button',{name:'授权此设备',exact:true}).click()
 await waitFor(async()=> (await page.evaluate(()=>window.projectos.organization.status())).status==='connected','desktop connected')
 await app.evaluate(()=>globalThis.__orgBrowser?.destroy());browser=null
 const connected=await page.evaluate(()=>window.projectos.organization.status())
 check('IPC session is sanitized',connected.session.account.email===email&&!('token' in connected.session))
 check('Credentials are encrypted on disk',!readFileSync(join(dataDir,'organization-session.vault')).includes(Buffer.from(email)))
 await page.getByTestId('org-new-organization').click()
 await page.getByTestId('org-name').fill('澄光研发');await page.getByTestId('org-slug').fill('clarity-studio');await page.getByTestId('org-create-submit').click()
 await waitFor(async()=>Boolean((await page.evaluate(()=>window.projectos.organization.status())).activeOrganizationId),'organization created')
 const orgId=(await page.evaluate(()=>window.projectos.organization.status())).activeOrganizationId
 await page.getByTestId('org-new-project').click();await page.getByTestId('org-project-name').fill('澄光协作工作台');await page.getByTestId('org-project-key').fill('CLARITY');await page.getByTestId('org-project-submit').click()
 await page.getByText('澄光协作工作台',{exact:true}).waitFor()
 check('Shared project persisted',(await page.evaluate(()=>window.projectos.organization.projects())).projects.length===1)
 await matrix('projects')
 const memberLogin=await bobLogin()
 await page.getByRole('button',{name:'组织成员',exact:true}).click()
 await page.getByTestId('org-new-invite').click();await page.getByTestId('org-invite-email').fill('member-a1@demo.invalid');await page.getByTestId('org-invite-submit').click()
 const invitationCode=await page.getByTestId('org-generated-invitation-code').inputValue()
 const memberHeaders={authorization:`Bearer ${memberLogin.session.token}`,'content-type':'application/json'}
 const pending=await (await fetch(`${serverUrl}/v1/invitations`,{headers:memberHeaders})).json()
 check('Real invitation created',pending.invitations.length===1)
 const accept=await fetch(`${serverUrl}/v1/invitations/${pending.invitations[0].id}/decide`,{method:'POST',headers:memberHeaders,body:JSON.stringify({decision:'accepted',invitationCode})})
 check('Second account accepts invitation',accept.ok)
 await page.getByTestId('org-refresh').click()
 await page.getByText('林舟',{exact:true}).waitFor()
 await matrix('members')
 const allowed=await fetch(`${serverUrl}/v1/organizations/${orgId}/projects`,{headers:memberHeaders})
 check('Organization membership does not grant project access',(await allowed.json()).projects.length===0)
 rejectNextProjectRead=process.env.PROJECTOS_ASSET_E2E==='1'
 const assetEvidence=process.env.PROJECTOS_ASSET_E2E==='1' ? await (await import('./org-asset-ui.mjs')).exerciseAssets({page,matrix,capture,check,waitFor}) : null
 const workerEvidence=process.env.PROJECTOS_WORKER_E2E==='1' ? await (await import('./org-worker-ui.mjs')).exerciseWorkers({page,app,dataDir,matrix,capture,check,waitFor,evidence,setUnavailable:(value)=>{workerUnavailable=value}}) : null
 await server.close();server=await buildOrganizationServer(serverOptions);await server.listen({host:'127.0.0.1',port:Number(new URL(serverUrl).port)})
 check('Server restart preserves session and shared project',(await page.evaluate(()=>window.projectos.organization.status({refresh:true}))).status==='connected'&&(await page.evaluate(()=>window.projectos.organization.projects())).projects.length===1)
 await app.close();app=null;await launch()
 check('Desktop restart restores encrypted organization session',(await page.evaluate(()=>window.projectos.organization.status({refresh:true}))).session.account.email===email)
 if(assetEvidence){
  const restored=await page.evaluate(id=>window.projectos.organization.assetDetail({assetId:id}),assetEvidence.assetId)
  check('Asset version and revoked pin survive server and desktop restart',restored.bindings[0]?.status==='revoked'&&restored.bindings[0]?.versionId===assetEvidence.pinnedVersionId)
 }
 if(workerEvidence){
  const restored=await page.evaluate(()=>window.projectos.organization.workers())
  check('Device and consent survive actual server/desktop restart',restored.currentWorkerId===workerEvidence.workerId&&restored.local.grants.some(g=>g.id===workerEvidence.grantId&&g.status==='active')&&restored.grants.some(g=>g.id===workerEvidence.grantId&&g.status==='active'))
  await page.getByRole('button',{name:'执行端',exact:true}).click();await page.getByTestId('worker-link').waitFor();await capture('worker-restarted')
 }
 await page.getByTestId('org-disconnect').click();await page.getByTestId('org-disconnect-confirm').click()
 await waitFor(async()=> (await page.evaluate(()=>window.projectos.organization.status())).status==='local','local sign-out')
 check('Sign-out returned to local mode',true)
 if(assetEvidence){
  await (await import('./org-asset-ui.mjs')).exerciseReadonlyAssets({page,app,serverUrl,password,matrix,check,waitFor,audit:async()=> (await import('./org-asset-audit.mjs')).auditAssetRenderer({app,evidence,userData})})
 }
 check('Renderer has no Node API',await page.evaluate(()=>typeof window.process==='undefined'&&typeof window.require==='undefined'))
 check('No renderer exceptions',errors.length===0,errors.join(' | '))
}catch(error){
 results.push({name:'Journey completion',status:'FAIL',detail:error instanceof Error?error.message:String(error)})
 console.error('ORG A1 E2E FAIL:',error instanceof Error?error.message:String(error))
 if(page)await page.screenshot({path:join(shots,'failure.png')}).catch(()=>{})
 if(browser)await browser.screenshot({path:join(shots,'browser-failure.png')}).catch(()=>{})
 process.exitCode=1
}finally{
 if(app)await app.close().catch(()=>{})
 if(server)await server.close().catch(()=>{})
 if(database)await database.stop().catch(error=>{console.error('Isolated database cleanup failed:',error.message);process.exitCode=1})
 const summary={pass:results.filter(r=>r.status==='PASS').length,fail:results.filter(r=>r.status==='FAIL').length}
 writeFileSync(join(evidence,'electron-checks.json'),JSON.stringify({fixture:'real PostgreSQL + real Electron + browser PKCE, isolated demo identities',summary,results},null,2))
 console.log('ORG A1 E2E SUMMARY',JSON.stringify(summary))
}
