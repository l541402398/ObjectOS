/** Real desktop/Runtime/SQLite/Git. Model responses below are explicit deterministic test fixtures. */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startRequirementFlowFixture } from './helpers/requirement-flow-model.mjs'
const out = resolve(process.env.PROJECTOS_EVIDENCE_DIR ?? 'docs/v2/evidence/requirement-guided-flow/desktop')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-flow-e2e-'))
const rootPath = join(profile, 'project'), dataDir = join(profile, 'data')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '0', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], captures = [], errors = []
let app, page, win, project, requirement, task
const check = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) throw new Error(`${name}: ${JSON.stringify(detail)}`) }
const shot = async name => { await page.mouse.move(2, 2); await page.waitForTimeout(500); writeFileSync(join(out, `${name}.png`), Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64')); captures.push(`${name}.png`) }
const server = await startRequirementFlowFixture()

async function until(predicate, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) { if (await predicate()) return; await page.waitForTimeout(250) }
  throw new Error('Timed out waiting for the actual persisted state')
}
async function launch() {
  app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], cwd: resolve('apps/desktop'), env, timeout: 60000 })
  page = await app.firstWindow(); win = await app.browserWindow(page); page.setDefaultTimeout(20000)
  page.on('pageerror', error => errors.push(error.message))
  await page.locator('.po-shell').waitFor({ timeout: 60000 })
}
async function openWork() { await page.evaluate(id => { location.hash = `#/projects/${id}/requirements` }, project.id); await page.locator('.rq-page').waitFor() }
async function selectOption(label, name, scope = page) { await scope.getByLabel(label, { exact: true }).click(); await page.locator('.ant-select-item-option').filter({ hasText: name }).last().click() }
async function checkLayout(name, scope = '.rq-page') {
  const metrics = await page.locator(scope).evaluate(element => ({ overflow: element.scrollWidth > element.clientWidth + 2, font: getComputedStyle(element).fontSize, width: element.clientWidth }))
  check(`${name} no horizontal page overflow`, !metrics.overflow, metrics)
  await page.evaluate(readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8'))
  const violations = await page.evaluate(async selector => (await window.axe.run(document.querySelector(selector))).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), scope)
  check(`${name} accessibility`, violations.length === 0, violations)
}
try {
  await launch()
  project = (await page.evaluate(rootPath => window.projectos.projects.create({ name: 'Aurora Notes · 流程验收', description: '真实运行验证，模型响应为明确的测试数据', rootPath, createDirectory: true, initGit: true }), rootPath)).project
  execFileSync('git', ['-C', rootPath, 'add', '.'], { windowsHide: true })
  execFileSync('git', ['-C', rootPath, '-c', 'user.name=ProjectOS Test', '-c', 'user.email=test@projectos.local', 'commit', '--allow-empty', '-qm', 'flow test baseline'], { windowsHide: true })
  await page.evaluate(projectId => window.projectos.actions.setAutonomy({ projectId, mode: 'assist' }), project.id)
  await page.evaluate(baseUrl => window.projectos.settings.update({ baseUrl, apiKey: 'local-test', model: 'workflow-fixture', temperature: 0 }), `http://127.0.0.1:${server.address().port}/v1`)
  await openWork(); await page.getByRole('button', { name: '创建第一个需求' }).waitFor(); await shot('empty-1440-light')
  await page.getByRole('button', { name: '创建第一个需求' }).click()
  let dialog = page.getByRole('dialog', { name: '新建需求', exact: true })
  await dialog.getByLabel('需求名称').fill('离线笔记的保存与恢复')
  await dialog.getByLabel('需求描述').fill('离线编辑正文，重启后恢复最后保存的版本。')
  await dialog.getByRole('button', { name: '新建流程', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '创建流程', exact: true })
  await dialog.getByLabel('流程名称').fill('需求梳理与审核 · 团队模板')
  // Exercise actual HTML drag/drop into React Flow, then keyboard-accessible add/connect.
  const item = dialog.getByRole('button', { name: '需求分析', exact: true })
  const canvas = dialog.getByLabel('流程编辑画布', { exact: true })
  await item.dragTo(canvas, { targetPosition: { x: 160, y: 110 } })
  await dialog.locator('.react-flow__node').first().waitFor()
  await dialog.getByRole('button', { name: '需求审核', exact: true }).click()
  await dialog.getByRole('button', { name: '适应画布', exact: true }).click()
  check('Drag/drop and keyboard addition create real flow nodes', await dialog.locator('.react-flow__node').count() === 2)
  await shot('flow-editor-1440-light')
  await checkLayout('flow editor', '[role="dialog"]')
  for (const [width,height] of [[1280,800],[1024,768]]) for (const theme of ['light','dark']) {
    await win.evaluate((w,size)=>w.setSize(...size),[width,height]);await page.emulateMedia({colorScheme:theme});await shot(`flow-editor-${width}-${theme}`);await checkLayout(`flow editor ${width} ${theme}`,'[role="dialog"]')
  }
  await win.evaluate(w=>w.setSize(1440,900));await page.emulateMedia({colorScheme:'light'})
  await dialog.getByRole('button', { name: '保存流程', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '新建需求', exact: true })
  await dialog.getByRole('radio', { name: 'AI 自动分配' }).check()
  await shot('create-requirement-1440-light')
  await dialog.getByRole('button', { name: '创建需求', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })
  await page.locator('.rq-flow-journey button').first().waitFor()
  requirement = (await page.evaluate(id => window.projectos.requirements.list(id), project.id)).requirements[0]
  check('No UC step remains in workbench', !(await page.locator('.rq-page').innerText()).includes('UC'))
  await page.getByRole('button', { name: '添加任务', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '添加任务', exact: true })
  await dialog.getByLabel('任务名称').fill('定义离线恢复行为与边界')
  await dialog.getByLabel('验收标准').fill('明确保存、重启、长文本场景')
  await dialog.getByRole('button', { name: '添加任务', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })
  task = (await page.evaluate(id => window.projectos.requirements.work(id), requirement.id)).tasks[0]
  const row = page.locator(`[data-task-id="${task.id}"]`)
  await row.getByRole('button', { name: '开始流程', exact: true }).click()
  await page.getByRole('checkbox', { name: '我已核对本次操作范围' }).waitFor({ timeout: 45000 })
  let flow = await page.evaluate(id => window.projectos.workflows.view(id), requirement.id)
  check('AI uses actual model assignment for every stage', flow.tasks[0].steps.every(step => step.agentId) && flow.tasks[0].steps[0].agentId !== flow.tasks[0].steps[1].agentId)
  check('Start requests approval before creating workspace', flow.tasks[0].pendingApprovalId && !flow.tasks[0].workspaceReady)
  await shot('workspace-approval-1440-light')
  await page.getByRole('checkbox', { name: '我已核对本次操作范围' }).check()
  await page.getByRole('button', { name: '允许本次', exact: true }).click()
  await until(() => page.evaluate(async id => (await window.projectos.workflows.view(id)).tasks[0]?.status === 'completed', requirement.id))
  flow = await page.evaluate(id => window.projectos.workflows.view(id), requirement.id)
  check('Assigned Agents complete real document and review runs', flow.tasks[0].steps.every(step => step.runId && step.status === 'completed') && flow.materials.length === 2, flow)
  await page.getByRole('button', { name: '刷新需求' }).click(); await shot('completed-flow-1440-light')
  await page.locator('.rq-flow-journey button').first().click()
  dialog = page.getByRole('dialog', { name: '流程产出资料', exact: true }); await dialog.getByText('离线笔记恢复', { exact: false }).last().waitFor()
  check('Journey opens the actual stored document body', (await dialog.innerText()).includes('长文本保持完整'))
  await shot('journey-material-1440-light'); await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.evaluate(id => { location.hash = `#/projects/${id}/agents` }, project.id)
  await page.getByTestId('collaboration-graph').waitFor()
  const agentNode = page.getByTestId('collaboration-agent-agt_product')
  if (await agentNode.count()) await agentNode.click()
  else { await page.locator('.aco-standby-toggle').click(); await page.getByTestId('standby-agent-agt_product').click() }
  const inspector = page.getByTestId('collaboration-inspector')
  await inspector.locator('.rq-agent-materials .rq-prose').waitFor()
  check('Agent graph opens the real workflow document', (await inspector.locator('.rq-agent-materials').innerText()).includes('长文本保持完整'))
  await shot('agent-material-1440-light')
  await inspector.getByRole('button', { name: '关闭', exact: true }).last().click()
  // Use a standard six-stage requirement for density and all theme/size combinations.
  const standard = (await page.evaluate(projectId => window.projectos.requirements.create({ projectId, title: '跨设备编辑的一致性与恢复体验', body: '在断网、重连和长文本场景中保持编辑内容完整。', source: 'local', acceptanceCriteria: ['重启后恢复原文'], workflow: { templateVersionId: 'wfv_standard1', assignmentMode: 'manual', assignments: {} } }), project.id)).requirement
  await page.evaluate(({projectId,id})=>{location.hash=`#/projects/${projectId}/requirements?requirement=${id}`},{projectId:project.id,id:standard.id})
  await page.getByRole('heading',{name:standard.title,exact:true}).waitFor()
  await page.getByRole('button',{name:'AI 拆分任务',exact:true}).click()
  const planDialog=page.getByRole('dialog',{name:'AI 拆分任务',exact:true})
  await planDialog.getByRole('button',{name:'生成任务草稿',exact:true}).click()
  await planDialog.getByRole('button',{name:'确认并创建任务',exact:true}).waitFor({timeout:45000})
  check('AI draft remains unexecuted before plan approval',(await page.evaluate(id=>window.projectos.requirements.work(id),standard.id)).tasks.length===0)
  await shot('requirement-plan-1440-light')
  await planDialog.getByRole('button',{name:'确认并创建任务',exact:true}).click();await planDialog.waitFor({state:'hidden'})
  const planned=(await page.evaluate(id=>window.projectos.workflows.view(id),standard.id)).tasks
  check('AI plan approval creates real tasks with every inherited workflow node',planned.length===2&&planned.every(task=>task.steps.length===6&&task.steps.every(step=>!step.runId)))
  for (let i = 2; i < 8; i++) await page.evaluate(({ projectId, requirementId, i }) => window.projectos.tasks.create({ projectId, requirementId, title: i ? `编辑边界与恢复场景 ${i}` : '同时编辑、断网重连后完整保留两份长文本内容并展示可理解的恢复路径', acceptanceCriteria: ['恢复内容完整'] }), { projectId: project.id, requirementId: standard.id, i })
  await page.evaluate(({ projectId, requirementId }) => { location.hash = `#/projects/${projectId}/requirements?requirement=${requirementId}` }, { projectId: project.id, requirementId: standard.id })
  await page.getByRole('heading', { name: standard.title, exact: true }).waitFor()
  await page.locator('.rq-task-title').first().click()
  const firstManual = {taskId:await page.locator('.rq-task-list [data-task-id]').first().getAttribute('data-task-id')}
  await selectOption('需求分析负责 Agent', 'Avery')
  await until(()=>page.evaluate(async ({reqId, taskId}) => (await window.projectos.workflows.view(reqId)).tasks.find(task=>task.taskId===taskId)?.steps[0]?.agentId === 'agt_product', {reqId:standard.id,taskId:firstManual.taskId}))
  check('Manual Agent selection is saved through the actual control', true)
  await page.getByRole('button', {name:'开始流程',exact:true}).click()
  await page.getByText('请先为每个流程节点分配 Agent', {exact:true}).waitFor()
  check('Missing assignments remain actionable, without starting a Run', (await page.evaluate(id=>window.projectos.workflows.view(id),standard.id)).tasks.every(task=>task.steps.every(step=>!step.runId)))
  await shot('assignment-error-1440-light')
  await page.getByRole('button', {name:'收起任务流程详情',exact:true}).click()
  await page.locator('.rq-task-title').first().click()
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768]]) for (const theme of ['light', 'dark']) {
    await win.evaluate((window, size) => window.setSize(...size), [width, height]); await page.emulateMedia({ colorScheme: theme }); await page.waitForTimeout(250)
    await page.locator('.rq-page').evaluate(element=>{for(let parent=element;parent;parent=parent.parentElement)parent.scrollTop=0}); await shot(`workbench-${width}-${theme}`); await checkLayout(`${width} ${theme}`)
  }
  await win.evaluate(window => window.webContents.setZoomFactor(1.25)); await page.emulateMedia({ reducedMotion: 'reduce' }); await shot('workbench-1024-dark-125-reduced')
  await page.getByRole('button',{name:'收起任务流程详情',exact:true}).focus()
  check('Keyboard detail control remains reachable at 125%', await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect();return r.width>0&&r.top>=0&&r.bottom<=innerHeight}))
  await win.evaluate(window => window.webContents.setZoomFactor(1)); await win.evaluate(window => window.setSize(1440, 900)); await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(async ({projectId,requirementId}) => { const view = await window.projectos.workflows.view(requirementId); await window.projectos.workflows.assign({stepId:view.tasks[0].steps[0].id,expectedVersion:view.tasks[0].steps[0].version,agentId:'agt_product'}); location.hash = `#/projects/${projectId}/requirements?requirement=${requirementId}` }, {projectId:project.id,requirementId:standard.id})
  await app.close(); await launch()
  await page.evaluate(({projectId,requirementId}) => { location.hash=`#/projects/${projectId}/requirements?requirement=${requirementId}` },{projectId:project.id,requirementId:standard.id})
  await page.locator('.rq-flow-journey').waitFor()
  const restored = await page.evaluate(id => window.projectos.workflows.view(id), standard.id)
  check('Template, all task steps and manual assignment survive restart', restored.tasks.length === 8 && restored.tasks[0].steps.length === 6 && restored.tasks[0].steps[0].agentId === 'agt_product')
  const saved = await page.evaluate(id => window.projectos.workflows.templates(id), project.id)
  check('Custom dragged template and layout persist', saved.templates.some(template => template.name === '需求梳理与审核 · 团队模板' && Object.keys(template.layout).length > 0))
  const secondProject=(await page.evaluate(rootPath=>window.projectos.projects.create({name:'自主分配与项目切换验证',rootPath,createDirectory:true}),join(profile,'second-project'))).project
  await page.evaluate(id=>window.projectos.actions.setAutonomy({projectId:id,mode:'autonomous'}),secondProject.id)
  await page.evaluate(id=>{location.hash=`#/projects/${id}/requirements`},secondProject.id)
  await page.getByRole('button',{name:'创建第一个需求',exact:true}).click()
  const autonomousDialog=page.getByRole('dialog',{name:'新建需求',exact:true})
  await autonomousDialog.getByRole('radio',{name:'AI 自动分配',exact:true}).waitFor()
  check('Autonomous mode defaults to AI node assignment',await autonomousDialog.getByRole('radio',{name:'AI 自动分配',exact:true}).isChecked())
  await autonomousDialog.getByLabel('需求名称').fill('为新增任务自动选择节点负责人')
  await autonomousDialog.getByRole('button',{name:'创建需求',exact:true}).click();await autonomousDialog.waitFor({state:'hidden'})
  const autoReq=(await page.evaluate(id=>window.projectos.requirements.list(id),secondProject.id)).requirements[0]
  await page.evaluate(({projectId,requirementId})=>window.projectos.tasks.create({projectId,requirementId,title:'自动分配验收任务',acceptanceCriteria:['每个节点都有真实 Agent']}),{projectId:secondProject.id,requirementId:autoReq.id})
  await until(()=>page.evaluate(async id=>{const tasks=(await window.projectos.workflows.view(id)).tasks;return tasks.length===1&&tasks[0].steps.every(step=>step.agentId&&!step.runId)},autoReq.id))
  check('Autonomous coordinator assigns every new task node without a manual assignment action',true)
  await page.evaluate(({projectId,id})=>{location.hash=`#/projects/${projectId}/requirements?requirement=${id}`},{projectId:project.id,id:standard.id})
  await page.getByRole('heading',{name:standard.title,exact:true}).waitFor()
  check('Project switch preserves the original requirement and its eight tasks',(await page.evaluate(id=>window.projectos.requirements.work(id),standard.id)).tasks.length===8)
  check('No renderer exceptions', errors.length === 0, errors)
} catch (error) {
  process.exitCode = 1; console.error(error); checks.push({ name: 'desktop execution', status: 'FAIL', detail: String(error.stack ?? error) })
  if (page) writeFileSync(join(out, 'failure-dom.txt'), await page.locator('body').ariaSnapshot().catch(() => ''))
  if (win) await shot('failure').catch(() => {})
} finally {
  await app?.close().catch(() => {}); await new Promise(done => server.close(done))
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), profile, checks, captures, errors, note: 'Real native Electron and Runtime/SQLite/Git. Model responses are deterministic test fixtures. 125% is app zoom, not OS DPI.' }, null, 2))
}
