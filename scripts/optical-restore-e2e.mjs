/** Restore verification. Real native Electron, isolated persisted data; no product fixtures. */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const out = resolve('docs/design/optical-restore/after')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-optical-restore-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60000 })
const page = await app.firstWindow(), win = await app.browserWindow(page)
const checks = [], captures = [], errors = []
page.setDefaultTimeout(20000)
page.on('pageerror', e => errors.push(e.message))
page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text()) })
const check = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok?'PASS':'FAIL'} ${name}${detail?' '+JSON.stringify(detail):''}`) }
const shot = async name => { await page.mouse.move(3,3); await page.waitForTimeout(350); writeFileSync(join(out,name+'.png'),Buffer.from(await win.evaluate(async w=>(await w.webContents.capturePage()).toPNG().toString('base64')),'base64')); captures.push(name+'.png') }
try {
  await page.locator('.po-shell').waitFor({timeout:60000})
  const project=(await page.evaluate(()=>window.projectos.projects.list())).projects[0]
  const route=async(suffix,selector)=>{await page.evaluate(({id,suffix})=>{location.hash=`#/projects/${id}${suffix}`},{id:project.id,suffix});await page.locator(selector).first().waitFor();await page.waitForTimeout(450)}
  // A saved preference from the rejected build must not reactivate that theme.
  await page.evaluate(()=>{const value=JSON.parse(localStorage.getItem('projectos.ui')??'{"state":{},"version":1}');value.state.skin='soft-studio';value.state.themeMode='system';localStorage.setItem('projectos.ui',JSON.stringify(value))})
  await page.reload(); await page.locator('.po-shell').waitFor({timeout:60000})
  check('Rejected skin preference is inactive',await page.locator('html').getAttribute('data-ui-skin')!=='soft-studio')
  for(const [width,height] of [[1440,900],[1280,800],[1024,768]]) for(const mode of ['light','dark']) {
    await win.evaluate((w,v)=>{w.setSize(v.width,v.height);w.webContents.setZoomFactor(1)},{width,height})
    await page.emulateMedia({colorScheme:mode});await page.waitForFunction(m=>document.documentElement.dataset.theme===m,mode)
    const label=`${width}-${mode}`
    for(const [suffix,selector,name] of [['','.studio-workbench','home'],['/agents','.aco-workbench','agents'],['/orchestration','.po-orchestration-page','flow'],['/approvals','.studio-review','approvals']]) {
      await route(suffix,selector)
      await shot(`${name}-${label}`)
      const palette=await page.evaluate(()=>{const s=getComputedStyle(document.documentElement);return {accent:s.getPropertyValue('--ui-accent').trim(),ambient:s.getPropertyValue('--ui-ambient').trim(),frame:s.getPropertyValue('--ui-optical-frame').trim(),fontStatus:document.fonts.status}})
      check(`${name}-${label} optical material`,palette.ambient.includes('gradient')&&palette.frame.includes('gradient')&&(mode!=='light'||palette.accent.toLowerCase()==='#4f64d9'),palette)
      check(`${name}-${label} complete journey and font readiness`,await page.locator('.po-journey-step-label').count()===9&&palette.fontStatus==='loaded')
    }
  }
  await win.evaluate(w=>{w.setSize(1440,900);w.webContents.setZoomFactor(1)})
  await page.emulateMedia({colorScheme:'light'});await route('/agents','.aco-workbench')
  await page.getByRole('button',{name:'适应画布',exact:true}).click();await page.waitForTimeout(350)
  await page.locator('.aco-gnode-task').first().click()
  await page.getByTestId('collaboration-inspector').waitFor()
  check('Graph task detail retained',await page.getByTestId('collaboration-inspector').isVisible())
  await shot('agent-detail-1440-light')
  await page.keyboard.press('Escape')
  await route('','.studio-workbench')
  check('Autonomous and assisted mode control retained',await page.locator('.po-project-mode').count()>0||await page.getByText('自主模式',{exact:true}).count()>0)
  await page.getByRole('button',{name:'设置',exact:true}).click()
  await page.getByTestId('settings-dialog').waitFor()
  check('Settings remain reachable',await page.getByTestId('settings-dialog').isVisible())
  await shot('settings-1440-light')
  await page.keyboard.press('Escape')
  await win.evaluate(w=>{w.setSize(1024,768);w.webContents.setZoomFactor(1.25)})
  await route('/agents','.aco-workbench');await shot('agents-1024-light-125')
  check('125% app zoom retains named journey',await page.locator('.po-journey-step-label').count()===9)
  const cdp=await page.context().newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable')
  const {root}=await cdp.send('DOM.getDocument');const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.po-journey-current'})
  const {fonts}=await cdp.send('CSS.getPlatformFontsForNode',{nodeId})
  check('Actual Chinese glyphs use bundled font',fonts.some(f=>f.isCustomFont&&/Noto Sans SC/.test(f.familyName)&&f.glyphCount>0),fonts)
  await page.emulateMedia({reducedMotion:'reduce'})
  check('Reduced-motion preference reaches browser',await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches))
  check('No renderer or CSP errors',errors.length===0,errors)
} finally {
  await app.close().catch(()=>{})
  writeFileSync(join(out,'results.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'Restoration verification, not acceptance of the withdrawn Soft Studio redesign. 125% is app zoom, not Windows system DPI.',checks,captures,errors},null,2))
}
if(checks.some(c=>c.status==='FAIL')||errors.length)process.exitCode=1
