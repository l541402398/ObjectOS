/** ADR-0077 desktop acceptance: real Electron/Runtime/SQLite/Git. Model replies are the deterministic local test fixture. */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startRequirementFlowFixture } from './helpers/requirement-flow-model.mjs'

const out = resolve(process.env.PROJECTOS_EVIDENCE_DIR ?? 'docs/v2/evidence/requirement-defaults-start/desktop')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-defaults-e2e-'))
const rootPath = join(profile, 'project'), dataDir = join(profile, 'data')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '0', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], captures = [], errors = []
let app, page, win, project, requirement
const OWNERS = ['agt_product', 'agt_reviewer', 'agt_architect', 'agt_reviewer', 'agt_engineer', 'agt_qa']
const check = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) throw new Error(`${name}: ${JSON.stringify(detail)}`) }
const shot = async name => { await page.mouse.move(2, 2); await page.waitForTimeout(450); writeFileSync(join(out, `${name}.png`), Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64')); captures.push(`${name}.png`) }
const server = await startRequirementFlowFixture()
const api = (fn, arg) => page.evaluate(fn, arg)
const flowView = id => api(requirementId => window.projectos.workflows.view(requirementId), id)

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
async function openRequirement(id) {
  await page.evaluate(({ projectId, id }) => { location.hash = `#/projects/${projectId}/requirements?requirement=${id}` }, { projectId: project.id, id })
  await page.locator('.rq-flow-journey').waitFor()
}
async function checkLayout(name, scope = '.rq-page') {
  const metrics = await page.locator(scope).first().evaluate(element => ({ overflow: element.scrollWidth > element.clientWidth + 2, width: element.clientWidth }))
  check(`${name} no horizontal overflow`, !metrics.overflow, metrics)
  await page.evaluate(readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8'))
  const violations = await page.evaluate(async selector => (await window.axe.run(document.querySelector(selector))).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), scope)
  check(`${name} accessibility (axe)`, violations.length === 0, violations)
}
async function matrix(prefix, scope) {
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768]]) for (const theme of ['light', 'dark']) {
    await win.evaluate((w, size) => w.setSize(...size), [width, height]); await page.emulateMedia({ colorScheme: theme }); await page.waitForTimeout(250)
    await shot(`${prefix}-${width}-${theme}`); await checkLayout(`${prefix} ${width} ${theme}`, scope)
  }
  await win.evaluate(w => w.webContents.setZoomFactor(1.25)); await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await shot(`${prefix}-1024-dark-125-reduced`); await checkLayout(`${prefix} 1024 dark 125%`, scope)
  await win.evaluate(w => w.webContents.setZoomFactor(1)); await win.evaluate(w => w.setSize(1440, 900)); await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
}

try {
  await launch()
  project = (await api(rootPath => window.projectos.projects.create({ name: 'Aurora Notes · 批量安排验收', description: '真实运行验证，模型响应为明确的测试数据', rootPath, createDirectory: true, initGit: true }), rootPath)).project
  execFileSync('git', ['-C', rootPath, 'add', '.'], { windowsHide: true })
  execFileSync('git', ['-C', rootPath, '-c', 'user.name=ProjectOS Test', '-c', 'user.email=test@projectos.local', 'commit', '--allow-empty', '-qm', 'defaults test baseline'], { windowsHide: true })
  await api(projectId => window.projectos.actions.setAutonomy({ projectId, mode: 'assist' }), project.id)
  await api(baseUrl => window.projectos.settings.update({ baseUrl, apiKey: 'local-test', model: 'workflow-fixture', temperature: 0 }), `http://127.0.0.1:${server.address().port}/v1`)
  const agents = new Map((await api(id => window.projectos.agents.list(id), project.id)).agents.map(({ agent }) => [agent.id, agent.name]))
  requirement = (await api(projectId => window.projectos.requirements.create({ projectId, title: '跨设备编辑的一致性与恢复体验', body: '断网、重连和长文本场景中保持编辑内容完整。', source: 'local', acceptanceCriteria: ['重启后恢复原文'], workflow: { templateVersionId: 'wfv_standard1', assignmentMode: 'manual', assignments: {} } }), project.id)).requirement
  const create = (title, dependsOn = []) => api(input => window.projectos.tasks.create(input), { projectId: project.id, requirementId: requirement.id, title, acceptanceCriteria: ['恢复内容完整'], dependsOn })
  const taskId = async title => (await api(id => window.projectos.requirements.work(id), requirement.id)).tasks.find(task => task.title === title).id
  await create('保存草稿并在重启后恢复'); const taskA = await taskId('保存草稿并在重启后恢复')
  await create('断网期间的编辑冲突提示'); const taskB = await taskId('断网期间的编辑冲突提示')
  await create('长文本恢复的性能边界', [taskA]); const taskC = await taskId('长文本恢复的性能边界')
  // One explicit single-task override that must survive the batch application.
  const override = (await flowView(requirement.id)).tasks.find(task => task.taskId === taskB).steps.find(step => step.nodeId === 'stage-3')
  await api(input => window.projectos.workflows.assign(input), { stepId: override.id, expectedVersion: override.version, agentId: 'agt_engineer' })

  await openRequirement(requirement.id)
  const bar = page.getByRole('region', { name: '需求下一步' })
  await bar.getByRole('button', { name: '确认安排', exact: true }).waitFor()
  check('Unassigned requirement shows one primary action: 确认安排', await bar.locator('.ant-btn-primary').count() === 1)
  await shot('arrange-needed-1440-light')

  await bar.getByRole('button', { name: '确认安排', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '任务安排', exact: true })
  await dialog.waitFor()
  const binding = (await flowView(requirement.id)).binding
  for (const [index, node] of binding.graph.nodes.entries()) {
    // Keyboard selection through the searchable control (also the non-pointer path).
    const control = dialog.getByLabel(`${node.title}默认负责人`, { exact: true })
    await control.click(); await control.fill(agents.get(OWNERS[index])); await page.keyboard.press('Enter'); await page.waitForTimeout(150)
  }
  await shot('arrangement-defaults-1440-light')
  await dialog.getByRole('button', { name: '保存默认负责人', exact: true }).click()
  await dialog.getByRole('button', { name: /应用到 17 个节点/ }).waitFor()
  const saved = await flowView(requirement.id)
  check('Defaults saved at requirement level without rebuilding task instances', JSON.stringify(Object.values(saved.binding.assignments)) === JSON.stringify(OWNERS) && saved.tasks.every(task => task.steps.length === 6) && saved.tasks.find(t => t.taskId === taskB).steps.find(s => s.id === override.id))
  check('Preview keeps the single-task override as an explicit, unchecked replacement', await dialog.getByRole('checkbox').count() === 1 && !(await dialog.getByRole('checkbox').isChecked()))
  await matrix('arrangement-preview', '[role="dialog"]')
  await dialog.getByRole('button', { name: /应用到 17 个节点/ }).click(); await dialog.waitFor({ state: 'hidden' })
  const applied = await flowView(requirement.id)
  check('Three tasks share the six-stage defaults', [taskA, taskC].every(id => JSON.stringify(applied.tasks.find(t => t.taskId === id).steps.map(s => s.agentId)) === JSON.stringify(OWNERS)))
  check('Single-task manual override is preserved', applied.tasks.find(t => t.taskId === taskB).steps.find(s => s.nodeId === 'stage-3').agentId === 'agt_engineer')
  check('Applying defaults starts nothing', applied.tasks.every(task => task.status === 'idle' && task.steps.every(step => !step.runId)))

  await bar.getByRole('button', { name: '开始执行 3 个任务', exact: true }).waitFor()
  await shot('ready-to-start-1440-light')
  await bar.getByRole('button', { name: '开始执行 3 个任务', exact: true }).click()
  await page.getByRole('heading', { name: '本次开始结果', exact: true }).waitFor({ timeout: 45000 })
  const started = await flowView(requirement.id)
  const outcome = id => started.startIntent.items.find(item => item.taskId === id)
  check('First task waits for its workspace approval; the second queues instead of creating a conflicting request', outcome(taskA).outcome === 'waiting_approval' && outcome(taskB).outcome === 'waiting_workspace' && outcome(taskB).status === 'waiting', started.startIntent)
  check('Dependent task waits for its prerequisite instead of being started', outcome(taskC).outcome === 'waiting_dependency' && outcome(taskC).status === 'waiting')
  check('No node Run starts before workspace approval', started.tasks.every(task => task.steps.every(step => !step.runId)))
  const replay = await api(input => window.projectos.workflows.startAll(input), { requirementId: requirement.id, expectedBindingVersion: started.binding.version, requestKey: 'desktop-repeat-1' })
  const repeated = await flowView(requirement.id)
  check('A repeated start creates no extra workspace request or Run', repeated.tasks.filter(t => t.pendingApprovalId).length === 1 && replay.intent.items.every(item => ['running', 'waiting_approval', 'waiting_dependency', 'waiting_workspace'].includes(item.outcome)), replay.intent)
  const stale = await api(input => window.projectos.workflows.startAll(input).then(() => 'started', error => String(error?.message ?? error)), { requirementId: requirement.id, expectedBindingVersion: started.binding.version - 1, requestKey: 'desktop-stale-1' })
  check('Stale binding version fails explicitly', /刷新/.test(stale), stale)
  await matrix('start-results', '.rq-page')

  // Approve one workspace in context; the flow then runs real nodes with the deterministic fixture.
  await bar.getByRole('button', { name: /处理授权/ }).click()
  await page.getByRole('checkbox', { name: '我已核对本次操作范围' }).waitFor()
  await shot('approval-in-context-1440-light')
  const approving = await page.locator('.rq-task.is-selected').getAttribute('data-task-id')
  await page.getByRole('checkbox', { name: '我已核对本次操作范围' }).check()
  await page.getByRole('button', { name: '允许本次', exact: true }).click()
  await until(async () => (await flowView(requirement.id)).tasks.find(t => t.taskId === approving).steps[0].runId)
  check('Workspace approval lets the started flow run its first node', true)
  const queued = approving === taskA ? taskB : taskA
  await until(async () => (await flowView(requirement.id)).tasks.find(t => t.taskId === queued).pendingApprovalId)
  check('The queued task requests its own workspace approval after the first workspace exists', (await flowView(requirement.id)).startIntent.items.find(i => i.taskId === queued).outcome === 'waiting_approval')
  await page.getByRole('button', { name: '停止自动推进', exact: true }).click()
  await until(async () => (await flowView(requirement.id)).startIntent.status === 'revoked')
  const atStop = await flowView(requirement.id)
  const withRun = t => t.steps.filter(s => s.runId).length
  const runsAtStop = new Map(atStop.tasks.map(t => [t.taskId, withRun(t)]))
  check('Stop revokes the intent, pauses running flows and cancels waiting continuation', atStop.tasks.find(t => t.taskId === queued).status === 'paused' && ['paused', 'blocked'].includes(atStop.tasks.find(t => t.taskId === approving).status) && atStop.startIntent.items.find(i => i.taskId === taskC).outcome === 'revoked', atStop.tasks.map(t => [t.taskId, t.status]))
  // Approving the other workspace after the stop must not start any node.
  const other = queued
  await page.locator(`[data-task-id="${other}"] .rq-task-title`).click()
  await page.getByRole('checkbox', { name: '我已核对本次操作范围' }).check()
  await page.getByRole('button', { name: '允许本次', exact: true }).click()
  await until(async () => (await flowView(requirement.id)).tasks.find(t => t.taskId === other).workspaceReady)
  await page.waitForTimeout(6000)
  const later = await flowView(requirement.id)
  check('No new node starts after the stop, even after a later workspace approval', later.tasks.every(t => withRun(t) === runsAtStop.get(t.taskId)), later.tasks.map(t => [t.taskId, t.status, withRun(t)]))
  check('Waiting, paused and stopped work is not marked complete', later.tasks.every(t => t.status !== 'completed'))
  await page.getByRole('button', { name: '收起任务流程详情', exact: true }).click().catch(() => {})
  await shot('stopped-1440-light')

  await app.close(); await launch(); await openRequirement(requirement.id)
  const restored = await flowView(requirement.id)
  check('Restart keeps the revoked intent, paused flows and per-node owners', restored.startIntent.status === 'revoked' && restored.tasks.find(t => t.taskId === queued).status === 'paused' && ['paused', 'blocked'].includes(restored.tasks.find(t => t.taskId === approving).status) && restored.tasks.find(t => t.taskId === taskB).steps.find(s => s.nodeId === 'stage-3').assignmentSource === 'manual')
  await page.waitForTimeout(4000)
  check('Restart does not resume a paused or revoked flow', (await flowView(requirement.id)).tasks.every(t => withRun(t) === runsAtStop.get(t.taskId)))
  await shot('after-restart-1440-light')

  // AI split with "确认并开始": approval creates tasks and requests a policy-bound start; nothing is pre-approved.
  const second = (await api(projectId => window.projectos.requirements.create({ projectId, title: '离线笔记的保存与恢复', body: '离线编辑正文，重启后恢复最后保存的版本。', source: 'local', acceptanceCriteria: ['恢复正文'], workflow: { templateVersionId: 'wfv_document1', assignmentMode: 'manual', assignments: { 'stage-1': 'agt_product', 'stage-2': 'agt_reviewer' } } }), project.id)).requirement
  await page.evaluate(({ projectId, id }) => { location.hash = `#/projects/${projectId}/requirements?requirement=${id}` }, { projectId: project.id, id: second.id })
  // Created through the API: refresh the renderer list explicitly instead of relying on cache.
  await page.getByRole('button', { name: '刷新需求' }).click()
  await page.getByRole('heading', { name: second.title, exact: true }).waitFor()
  await page.getByRole('button', { name: 'AI 拆分任务', exact: true }).click()
  const plan = page.getByRole('dialog', { name: 'AI 拆分任务', exact: true })
  await plan.getByRole('button', { name: '生成任务草稿', exact: true }).click()
  await plan.getByRole('button', { name: '确认并开始', exact: true }).waitFor({ timeout: 45000 })
  check('Plan draft remains unexecuted before confirmation', (await api(id => window.projectos.requirements.work(id), second.id)).tasks.length === 0)
  await shot('plan-confirm-start-1440-light'); await checkLayout('plan confirm', '[role="dialog"]')
  await plan.getByRole('button', { name: '确认并开始', exact: true }).click(); await plan.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '本次开始结果', exact: true }).waitFor({ timeout: 45000 })
  const planned = await flowView(second.id)
  check('Confirm-and-start inherits defaults and stops at the separate workspace approval', planned.tasks.length === 2 && planned.tasks.every(t => t.steps.every(s => s.agentId && s.assignmentSource === 'default' && !s.runId))
    && planned.tasks.filter(t => t.pendingApprovalId).length === 1 && planned.startIntent.items.map(i => i.outcome).sort().join() === 'waiting_approval,waiting_workspace', { tasks: planned.tasks.map(t => [t.status, t.pendingApprovalId, t.steps.map(s => [s.agentId, s.assignmentSource, s.runId])]), intent: planned.startIntent })
  await shot('plan-start-results-1440-light'); await checkLayout('plan start results')
  check('No renderer exceptions', errors.length === 0, errors)
} catch (error) {
  process.exitCode = 1; console.error(error); checks.push({ name: 'desktop execution', status: 'FAIL', detail: String(error.stack ?? error) })
  if (page) writeFileSync(join(out, 'failure-dom.txt'), await page.locator('body').ariaSnapshot().catch(() => ''))
  if (win) await shot('failure').catch(() => {})
} finally {
  await app?.close().catch(() => {}); await new Promise(done => server.close(done))
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), profile, checks, captures, errors, note: 'Real native Electron and Runtime/SQLite/Git. Model responses are deterministic test fixtures. 125% is app zoom, not OS DPI.' }, null, 2))
}
