/** Real Electron/Runtime/Git acceptance of A3.2a with explicit local test content. */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startRequirementFlowFixture } from './helpers/requirement-flow-model.mjs'
const server = await startRequirementFlowFixture()
const out = resolve(process.env.PROJECTOS_EVIDENCE_DIR ?? 'docs/v2/evidence/requirement-guided-flow/integration')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-integration-e2e-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '0', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], captures = [], errors = []
let app, page, win, project, requirement, task, nextTask
const check = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) throw new Error(name) }
const shot = async name => { await page.mouse.move(2,2); await page.waitForTimeout(250); writeFileSync(join(out, `${name}.png`), Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64')); captures.push(`${name}.png`) }
const git = (root, ...args) => execFileSync('git', ['-C',root,...args], { encoding:'utf8', windowsHide:true }).trim()
async function until(predicate, timeout=60000) { const end=Date.now()+timeout; while(Date.now()<end){if(await predicate())return;await page.waitForTimeout(250)} throw new Error('Timed out waiting for actual persisted operation') }
async function launch() {
  app = await electron.launch({ executablePath:resolve('node_modules/electron/dist/electron.exe'), args:['.',`--user-data-dir=${join(profile,'user')}`], cwd:resolve('apps/desktop'),env,timeout:60000 })
  page = await app.firstWindow(); win = await app.browserWindow(page); page.setDefaultTimeout(30000)
  page.on('pageerror', error => errors.push(error.message)); await page.locator('.po-shell').waitFor({ timeout:60000 })
  await win.evaluate(w=>w.webContents.setZoomFactor(1)); await page.emulateMedia({colorScheme:'light'})
}
async function openWork() {
  await page.evaluate(({ projectId, id }) => { location.hash=`#/projects/${projectId}/requirements?requirement=${id}` },{projectId:project.id,id:requirement.id})
  await page.locator('.rq-workspace').waitFor()
}
async function openReview(captureLoading=false) {
  await openWork(); const taskRow=page.locator(`[data-task-id="${task.id}"]`); if(!(await taskRow.getAttribute('class')).includes('is-selected')) await taskRow.locator('.rq-task-title').click(); await page.getByRole('button',{name:'成果审查与合入',exact:true}).click()
  await page.getByRole('dialog',{name:'成果审查',exact:true}).waitFor()
  if(captureLoading) {
    await page.getByRole('status',{name:'正在读取实际改动与验证记录',exact:true}).waitFor()
    check('Actual loading state shows a labelled placeholder',await page.getByRole('button',{name:'申请合入需求',exact:true}).isDisabled())
    await shot('review-loading-1440-light')
  }
  await page.locator('.rq-code-diff').waitFor()
}
async function approve() { await page.getByRole('checkbox',{name:'我已核对本次操作范围',exact:true}).check(); await page.getByRole('button',{name:'允许本次',exact:true}).click(); await page.getByRole('checkbox',{name:'我已核对本次操作范围',exact:true}).waitFor({state:'hidden'}) }
try {
  await launch()
  const rootPath=join(profile,'project')
  project=(await page.evaluate(rootPath=>window.projectos.projects.create({name:'离线笔记 · 成果集成验收',rootPath,createDirectory:true,initGit:true}),rootPath)).project
  git(rootPath,'add','.');git(rootPath,'-c','user.name=ProjectOS Test','-c','user.email=test@projectos.local','commit','--allow-empty','-qm','test baseline')
  await page.evaluate(projectId=>window.projectos.actions.setAutonomy({projectId,mode:'assist'}),project.id)
  await page.evaluate(baseUrl=>window.projectos.settings.update({baseUrl,apiKey:'test',model:'workflow-fixture',temperature:0}),`http://127.0.0.1:${server.address().port}/v1`)
  requirement=(await page.evaluate(projectId=>window.projectos.requirements.create({projectId,title:'离线修改后可靠恢复笔记',body:'正文保存后可离线恢复，重启后内容一致。',source:'local',acceptanceCriteria:['保存后可以恢复原文'],workflow:{templateVersionId:'wfv_document1',assignmentMode:'manual',assignments:{'stage-1':'agt_product','stage-2':'agt_reviewer'}}}),project.id)).requirement
  task=(await page.evaluate(({projectId,requirementId})=>window.projectos.tasks.create({projectId,requirementId,title:'实现可靠的笔记存储与恢复，并补充回归测试',acceptanceCriteria:['保存内容与恢复内容一致'],assigneeAgentId:'agt_engineer'}),{projectId:project.id,requirementId:requirement.id})).task
  nextTask=(await page.evaluate(({projectId,requirementId,taskId})=>window.projectos.tasks.create({projectId,requirementId,title:'接入笔记编辑器，使用已验证的存储实现',acceptanceCriteria:['编辑器可读取存储内容'],assigneeAgentId:'agt_engineer',dependsOn:[taskId]}),{projectId:project.id,requirementId:requirement.id,taskId:task.id})).task
  const prep=await page.evaluate(task=>window.projectos.requirements.requestWorkspace({taskId:task.id,expectedVersion:task.version}),task)
  await page.evaluate(id=>window.projectos.approvals.decide({approvalId:id,decision:'approved',note:'测试：准备工作区'}),prep.approvalId)
  let view=await page.evaluate(id=>window.projectos.requirements.work(id),requirement.id)
  const source=view.workspaces.find(w=>w.taskId===task.id).rootPath,target=view.workspaces.find(w=>w.kind==='integration').rootPath
  await openReview(true)
  check('Empty task shows no fabricated diff or enabled merge',await page.getByText('当前没有代码改动',{exact:true}).isVisible() && await page.getByRole('button',{name:'申请合入需求'}).isDisabled())
  await shot('review-empty-1440-light')
  await page.getByRole('dialog',{name:'成果审查',exact:true}).getByRole('button',{name:'关闭',exact:true}).click()
  writeFileSync(join(source,'notes.cjs'),"exports.restore = value => String(value)\n")
  writeFileSync(join(source,'notes.test.cjs'),"const assert = require('node:assert/strict'); require('node:test')('离线正文可恢复', () => assert.equal(require('./notes.cjs').restore('一段离线保存的正文'), '一段离线保存的正文'))\n")
  await page.evaluate(id=>window.projectos.workflows.start(id),task.id)
  await until(()=>page.evaluate(async ({id,taskId})=>(await window.projectos.workflows.view(id)).tasks.find(t=>t.taskId===taskId)?.status==='completed',{id:requirement.id,taskId:task.id}))
  await page.evaluate(async id=>{const latest=(await window.projectos.tasks.detail(id)).task;return window.projectos.tasks.move({taskId:id,expectedVersion:latest.version,to:'done',note:'本机所有者已完成任务验收，接下来独立审查和验证合入内容'})},task.id)
  await openReview()
  let dialog=page.getByRole('dialog',{name:'成果审查',exact:true})
  check('Integration requires both review and verification',await dialog.getByRole('button',{name:'申请合入需求'}).isDisabled())
  await shot('review-initial-1440-light')
  await dialog.getByLabel('审查结论').fill('已检查正文恢复逻辑与测试覆盖，审查通过')
  writeFileSync(join(source,'notes.cjs'),"exports.restore = value => 'changed'\n")
  await dialog.getByRole('button',{name:'记录审查通过'}).click()
  await dialog.getByText('任务、文档或代码已变化，请刷新改动后重新审查',{exact:true}).waitFor(); await shot('stale-review-error-1440-light')
  check('Stale visible review rejected',await dialog.getByRole('button',{name:'申请合入需求'}).isDisabled())
  writeFileSync(join(source,'notes.cjs'),"exports.restore = value => String(value)\n")
  await dialog.getByRole('button',{name:'刷新成果'}).click(); await dialog.getByRole('button',{name:'记录审查通过'}).click()
  await dialog.getByText('当前改动已记录审查结论。',{exact:true}).waitFor()
  await dialog.getByLabel('验证命令').fill('node --test notes.test.cjs')
  await dialog.getByRole('button',{name:'申请运行验证'}).click(); await page.getByRole('checkbox',{name:'我已核对本次操作范围',exact:true}).waitFor()
  await shot('verify-approval-1440-light'); await approve(); await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'})
  await openReview(); dialog=page.getByRole('dialog',{name:'成果审查',exact:true})
  await dialog.getByText('当前代码已通过实际验证',{exact:true}).waitFor()
  check('Reopened review displays the command that actually ran',await dialog.getByLabel('验证命令').inputValue()==='node --test notes.test.cjs')
  check('Real command exit unlocks current verification',await dialog.getByRole('button',{name:'申请合入需求'}).isEnabled())
  for(const [width,height] of [[1440,900],[1280,800],[1024,768]]) for(const theme of ['light','dark']) {
    await win.evaluate((w,[width,height])=>w.setSize(width,height),[width,height]);await page.emulateMedia({colorScheme:theme});await page.waitForTimeout(200)
    await shot(`review-${width}-${theme}`)
    const metrics=await page.evaluate(()=>{const e=document.querySelector('.rq-integration-scroll');return {overflow:document.documentElement.scrollWidth>innerWidth,scroll:e.scrollHeight>e.clientHeight,body:getComputedStyle(e).fontSize,code:getComputedStyle(document.querySelector('.rq-code-diff')).fontSize}})
    check(`${width} ${theme} readable without page overflow`,!metrics.overflow && parseFloat(metrics.body)>=14 && parseFloat(metrics.code)>=13,metrics)
    await page.evaluate(readFileSync(resolve('node_modules/axe-core/axe.min.js'),'utf8'))
    const violations=await page.evaluate(async()=> (await window.axe.run(document.querySelector('[role="dialog"]'))).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))
    check(`${width} ${theme} accessibility`,violations.length===0,violations)
  }
  await win.evaluate(w=>w.webContents.setZoomFactor(1.25));await page.emulateMedia({reducedMotion:'reduce'});await shot('review-1024-dark-125-reduced')
  await dialog.getByRole('button',{name:'申请合入需求'}).focus()
  check('Keyboard primary action remains visible at 125%',await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return r.width>0 && r.top>=0 && r.bottom<=innerHeight}))
  await dialog.getByRole('button',{name:'申请合入需求'}).click()
  await page.getByRole('checkbox',{name:'我已核对本次操作范围',exact:true}).waitFor()
  check('Git unchanged while integration awaits approval',!existsSync(join(target,'notes.cjs')))
  await app.close();await launch();await openReview()
  dialog=page.getByRole('dialog',{name:'成果审查',exact:true});await page.getByRole('checkbox',{name:'我已核对本次操作范围',exact:true}).waitFor()
  check('Pending integration survives desktop restart',true)
  await shot('integrate-approval-1440-light');await approve();await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'})
  await openWork();view=await page.evaluate(id=>window.projectos.requirements.work(id),requirement.id)
  check('Approved integration persists actual commit',view.integrations.some(op=>op.kind==='integrate'&&op.status==='completed'&&op.resultCommit)&&existsSync(join(target,'notes.cjs')))
  check('Project root and requirement delivery state unchanged',!existsSync(join(rootPath,'notes.cjs'))&&view.requirement.status!=='implemented')
  const nextRow=page.locator(`[data-task-id="${nextTask.id}"]`)
  await page.evaluate(id=>window.projectos.workflows.start(id),nextTask.id)
  await nextRow.locator('.rq-task-title').click();await page.getByRole('checkbox',{name:'我已核对本次操作范围',exact:true}).waitFor();await approve()
  await page.evaluate(id=>window.projectos.workflows.pause(id),nextTask.id)
  view=await page.evaluate(id=>window.projectos.requirements.work(id),requirement.id)
  const nextRoot=view.workspaces.find(w=>w.taskId===nextTask.id)?.rootPath
  check('Dependent task receives predecessor code in its own directory',Boolean(nextRoot)&&nextRoot!==source&&readFileSync(join(nextRoot,'notes.cjs'),'utf8').includes('String(value)'))
  await openWork();await shot('integrated-workbench-1440-light')
  await openReview();dialog=page.getByRole('dialog',{name:'成果审查',exact:true})
  check('Integrated current content cannot request a duplicate merge',await dialog.getByRole('button',{name:'已合入需求',exact:true}).isDisabled())
  await shot('review-integrated-1440-light');await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'})
  for(let index=0;index<20;index++)writeFileSync(join(source,`离线恢复边界与多端同步一致性-${String(index).padStart(2,'0')}.txt`),'用于密集内容与长文本的真实文件验收。'.repeat(400))
  await openReview();dialog=page.getByRole('dialog',{name:'成果审查',exact:true})
  await dialog.getByRole('button',{name:'刷新成果',exact:true}).click()
  await dialog.getByText('改动较大，预览已截断；请在任务工作区检查完整内容后再记录审查。',{exact:true}).waitFor()
  await dialog.locator('summary').filter({hasText:'文件列表'}).click();await shot('review-dense-long-1440-light')
  check('Long real diff explicitly reports truncation',await dialog.getByText('改动较大，预览已截断；请在任务工作区检查完整内容后再记录审查。',{exact:true}).isVisible())
  check('Additional uncommitted files invalidate existing verification and review',await dialog.getByRole('button',{name:'申请合入需求'}).isDisabled() && await dialog.getByText('待审查',{exact:true}).isVisible())
  await dialog.locator('.rq-code-diff').focus();await page.keyboard.press('End');await shot('review-dense-scroll-1440-light')
  check('No renderer errors',errors.length===0,errors)
} catch(error) {
  console.error(error);checks.push({name:'E2E execution',status:'FAIL',detail:String(error.stack??error)});process.exitCode=1
  if(page)writeFileSync(join(out,'failure-dom.txt'),await page.locator('body').ariaSnapshot().catch(()=>''))
  if(page&&win)await shot('failure').catch(()=>{})
} finally {
  await app?.close().catch(()=>{});await new Promise(done=>server.close(done))
  writeFileSync(join(out,'checks.json'),JSON.stringify({head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),profile,checks,captures,errors,note:'Real Electron/Runtime/SQLite/Git with explicit fixture content. 125% is app zoom, not OS DPI.'},null,2))
}
