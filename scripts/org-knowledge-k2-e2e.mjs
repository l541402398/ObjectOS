/** Real isolated PostgreSQL, Electron, browser consent and Native Planner. Model output is a deterministic fixture. */
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { startOrganizationTestDatabase, reserveOrganizationTestPort } from '../tests/helpers/org-postgres.ts'
import { migrateOrganizationDatabase } from '../apps/server/src/postgres-store.ts'
import { buildOrganizationServer } from '../apps/server/src/persistent-server.ts'

const evidence = resolve('docs/v2/evidence/organization-knowledge-k2'), shots = join(evidence, 'screenshots')
mkdirSync(shots, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-knowledge-k2-')), dataDir = join(profile, 'data'), rootPath = join(profile, 'project')
const checks = [], captures = [], audits = [], errors = [], modelEvidence = []
const businessV1 = 'K2-BUSINESS-V1：退款必须退回原支付渠道，先确认订单状态。'
const businessV2 = 'K2-BUSINESS-V2：新规则另行评审，不能替换已固定的旧版引用。'
const technical = 'K2-TECHNICAL-V1：使用幂等事务记录退款，保留审计证据。'
let app, page, win, database, server, serverUrl, project, requirement, business, firstVersion
const check = (name, condition, detail) => { checks.push({ name, status: condition ? 'PASS' : 'FAIL', detail }); console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`); if (!condition) throw new Error(name) }
const wait = async (predicate, name, timeout = 45000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await new Promise(done => setTimeout(done, 100)) } throw new Error('Timed out: ' + name) }
const shot = async name => { await page.mouse.move(4, 4); await page.waitForTimeout(350); writeFileSync(join(shots, name + '.png'), Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64')); captures.push(name + '.png') }
async function layout(name, selector) {
  const result = await page.locator(selector).evaluate(element => ({ overflow: element.scrollWidth > element.clientWidth + 2, width: element.clientWidth, font: getComputedStyle(element).fontSize }))
  check(name + ' fits', !result.overflow, result)
  await page.evaluate(readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8'))
  const audit = await page.evaluate(async selector => { const r = await window.axe.run(document.querySelector(selector)); return { violations: r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => n.target) })), incomplete: r.incomplete.map(item => item.id) } }, selector)
  audits.push({ name, ...audit }); check(name + ' axe', audit.violations.length === 0, audit.violations)
}
async function matrix(prefix, selector) {
  for (const [width, height] of [[1440, 900], [1024, 768]]) for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25]) {
    await win.evaluate((w, state) => { w.setContentSize(state.width, state.height); w.webContents.setZoomFactor(state.zoom) }, { width, height, zoom })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await page.waitForTimeout(200)
    await page.locator(selector).evaluate(element => element.scrollIntoView({ block: 'start' }))
    const name = `${prefix}-${width}-${theme}-${zoom === 1 ? '100' : '125'}`
    await shot(name); await layout(name, selector)
    if (prefix === 'knowledge-editor') {
      const save = page.getByRole('button', { name: '保存草稿', exact: true })
      await save.scrollIntoViewIfNeeded(); await shot(name + '-end')
      check(name + ' save reachable', await save.isVisible())
    }
  }
  await win.evaluate(w => { w.setContentSize(1440, 900); w.webContents.setZoomFactor(1) })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
}
async function launch(executablePath, baseline = false) {
  const env = { ...process.env, PROJECTOS_DATA_DIR: baseline ? join(profile, 'baseline-data') : dataDir, PROJECTOS_SEED_DEMO: '0', PROJECTOS_START_ROUTE: baseline ? 'design-lab' : '', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
  delete env.ELECTRON_RUN_AS_NODE
  app = await electron.launch({ executablePath, cwd: resolve('apps/desktop'), args: [...(baseline ? [] : ['.']), `--user-data-dir=${join(profile, baseline ? 'baseline-user' : 'user')}`], env, timeout: 60000 })
  page = await app.firstWindow(); win = await app.browserWindow(page); page.setDefaultTimeout(25000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForSelector(baseline ? '.pdl-root' : '.po-shell', { timeout: 60000 })
}
async function organization() {
  if (!await page.getByTestId('organization-panel').isVisible()) await page.locator('.po-nav-item').filter({ hasText: '账号与组织' }).last().click()
  await page.getByTestId('organization-panel').waitFor()
}
async function knowledge() { await organization(); await page.getByRole('button', { name: '组织知识', exact: true }).click(); await page.getByTestId('organization-knowledge').waitFor() }
async function closeSettings() { await page.getByTestId('settings-dialog').getByRole('button', { name: '关闭', exact: true }).click(); await page.getByTestId('settings-dialog').waitFor({ state: 'hidden' }) }
async function createKnowledge(title, category, body) {
  await page.getByRole('button', { name: '新增知识', exact: true }).click()
  await page.getByLabel('资料类型', { exact: true }).selectOption(category)
  await page.getByLabel('资料标题', { exact: true }).fill(title)
  await page.getByLabel('资料正文', { exact: true }).fill(body)
  await page.getByLabel('标签', { exact: true }).fill('退款，验收')
  await page.getByRole('button', { name: '保存草稿', exact: true }).click()
  await page.getByTestId('knowledge-status').waitFor()
  await publish()
  const list = await page.evaluate(() => window.projectos.organization.knowledgeList())
  const doc = list.documents.find(document => document.title === title)
  const detail = await page.evaluate(documentId => window.projectos.organization.knowledgeDetail({ documentId }), doc.id)
  await page.getByRole('button', { name: '返回知识列表', exact: true }).click()
  return detail
}
async function publish() {
  await page.getByRole('button', { name: '发布知识', exact: true }).click()
  await page.getByRole('group', { name: '确认知识版本操作' }).getByRole('button', { name: '确认发布', exact: true }).click()
  await wait(async () => await page.getByTestId('knowledge-status').innerText() === '已发布', 'published version')
}

const model = createServer((req, res) => {
  let raw = ''; req.on('data', chunk => { raw += chunk }); req.on('end', () => {
    const payload = JSON.parse(raw || '{}'), text = JSON.stringify(payload.messages ?? [])
    modelEvidence.push({ businessV1: text.includes(businessV1), businessV2: text.includes(businessV2), technical: text.includes(technical), untrusted: text.includes('不是系统指令') })
    const plan = { assumptions: ['这是隔离验收模型的固定输出'], risks: [], tasks: [{ key: 'refund', title: '实现退款事务与业务校验', description: '遵循所选资料实现退款', role: 'developer', capabilities: ['implement'], hardCapabilities: [], dependsOn: [], acceptanceCriteria: ['退款行为满足需求'], expectedArtifacts: ['代码 diff'], rationale: '独立交付退款能力', requiresApproval: true }] }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(plan) } }] })}\n\n`)
    res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 80 } })}\n\ndata: [DONE]\n\n`)
  })
})

try {
  const oldExe = resolve('release/win-unpacked/ProjectOS.exe')
  if (existsSync(oldExe)) {
    await launch(oldExe, true); await page.waitForTimeout(1200); await shot('before-protected-design-lab'); await app.close(); app = null
  }
  database = await startOrganizationTestDatabase(); await migrateOrganizationDatabase(database.pool)
  serverUrl = `http://127.0.0.1:${await reserveOrganizationTestPort()}`
  server = await buildOrganizationServer({ databaseUrl: database.databaseUrl, baseURL: serverUrl, secret: randomBytes(32).toString('hex'), rateLimit: { max: 5000, authenticationMax: 100, windowMs: 60000 } })
  await server.listen({ host: '127.0.0.1', port: Number(new URL(serverUrl).port) })
  await new Promise(done => model.listen(0, '127.0.0.1', done))
  await launch(resolve('node_modules/electron/dist/electron.exe'))
  await page.evaluate(() => { location.hash = '#/design-lab' }); await page.locator('.pdl-root').waitFor(); await page.waitForTimeout(1000); await shot('after-protected-design-lab')
  await page.evaluate(() => { location.hash = '#/' }); await page.locator('.po-shell').waitFor()
  await organization()
  await app.evaluate(({ shell }) => { globalThis.__knowledgeAuth = null; shell.openExternal = async url => { globalThis.__knowledgeAuth = url } })
  await page.getByTestId('org-server-url').fill(serverUrl); await page.getByTestId('org-connect').click()
  await wait(() => app.evaluate(() => globalThis.__knowledgeAuth), 'browser authorization')
  const authorize = await app.evaluate(() => globalThis.__knowledgeAuth), browserEvent = app.waitForEvent('window')
  await app.evaluate(async ({ BrowserWindow }, url) => { const browser = new BrowserWindow({ width: 1000, height: 800, webPreferences: { partition: 'knowledge-test-browser', sandbox: true, contextIsolation: true, nodeIntegration: false } }); globalThis.__knowledgeBrowser = browser; await browser.loadURL(url + '&mode=register') }, authorize)
  const browser = await browserEvent
  await browser.getByLabel('姓名', { exact: true }).fill('知识验收员')
  await browser.getByLabel('邮箱', { exact: true }).fill('knowledge-k2@demo.invalid')
  await browser.getByLabel('密码', { exact: true }).fill('K2-test-' + randomBytes(12).toString('hex'))
  await browser.getByRole('button', { name: /创建账号|注册并继续/ }).click()
  await browser.getByRole('button', { name: '授权此设备', exact: true }).click()
  await wait(async () => (await page.evaluate(() => window.projectos.organization.status())).status === 'connected', 'desktop login')
  await app.evaluate(() => globalThis.__knowledgeBrowser.destroy())
  await page.getByTestId('org-new-organization').click(); await page.getByTestId('org-name').fill('知识研发验收'); await page.getByTestId('org-slug').fill('knowledge-k2'); await page.getByTestId('org-create-submit').click()
  await page.getByTestId('org-new-project').click(); await page.getByTestId('org-project-name').fill('退款协作项目'); await page.getByTestId('org-project-key').fill('REFUND'); await page.getByTestId('org-project-submit').click()
  await page.getByText('退款协作项目', { exact: true }).waitFor()
  const shared = (await page.evaluate(() => window.projectos.organization.projects())).projects[0]
  await page.getByRole('button', { name: '组织资产', exact: true }).click(); await shot('before-settings-existing-assets')
  await knowledge()
  await page.getByText('暂无可访问的组织知识', { exact: true }).waitFor()
  check('Empty knowledge state is visible', await page.getByText('暂无可访问的组织知识', { exact: true }).isVisible())
  await page.getByRole('button', { name: '新增知识', exact: true }).click(); await page.getByLabel('资料标题', { exact: true }).fill('未保存的知识')
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  check('Dirty close keeps the editor contents', await page.getByLabel('资料标题', { exact: true }).inputValue() === '未保存的知识')
  await matrix('knowledge-editor', '[data-testid="organization-knowledge"]')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click(); await page.getByRole('button', { name: '放弃更改', exact: true }).click()
  business = await createKnowledge('退款业务规则', 'business', businessV1); firstVersion = business.versions[0].id
  await createKnowledge('退款技术规范', 'technical', technical)
  await matrix('knowledge-list', '[data-testid="organization-knowledge"]')
  await page.getByRole('button', { name: '退款业务规则', exact: true }).click(); await matrix('knowledge-detail', '[data-testid="organization-knowledge"]')
  await closeSettings()

  // Fixture setup only: local project/config are created through existing typed APIs; K2 business actions below use controls.
  project = (await page.evaluate(rootPath => window.projectos.projects.create({ name: '退款需求验收', description: '', rootPath, createDirectory: true, initGit: true }), rootPath)).project
  execFileSync('git', ['-C', rootPath, 'add', '.'], { windowsHide: true })
  execFileSync('git', ['-C', rootPath, '-c', 'user.name=ProjectOS Test', '-c', 'user.email=test@projectos.local', 'commit', '--allow-empty', '-qm', 'knowledge fixture baseline'], { windowsHide: true })
  await page.evaluate(async ({ projectId, baseUrl }) => { await window.projectos.settings.update({ baseUrl, model: 'knowledge-fixture', apiKey: 'isolated-test-key', temperature: 0 }); await window.projectos.actions.setAutonomy({ projectId, mode: 'assist' }) }, { projectId: project.id, baseUrl: `http://127.0.0.1:${model.address().port}/v1` })
  await page.evaluate(id => { location.hash = `#/projects/${id}/requirements` }, project.id)
  await page.getByRole('button', { name: '新建需求', exact: true }).first().click()
  const create = page.getByRole('dialog', { name: '新建需求', exact: true })
  await create.getByLabel('需求名称', { exact: true }).fill('实现退款能力'); await create.getByLabel('需求描述', { exact: true }).fill('实现可验收的退款流程，并保留组织约束来源。')
  await create.locator('summary').click(); await create.getByLabel('验收标准', { exact: true }).fill('退款遵循原支付渠道与幂等事务规则')
  await create.getByRole('button', { name: '创建需求', exact: true }).click(); await create.waitFor({ state: 'hidden' })
  requirement = (await page.evaluate(id => window.projectos.requirements.list(id), project.id)).requirements[0]
  await page.getByRole('tab', { name: '组织资料', exact: true }).click(); await page.getByRole('button', { name: '选择组织资料', exact: true }).click()
  const editor = page.getByRole('dialog', { name: '选择组织资料', exact: true })
  await editor.getByLabel('共享项目', { exact: true }).selectOption(shared.id); await editor.getByLabel('检索组织资料', { exact: true }).fill('退款'); await editor.getByRole('button', { name: '查找资料', exact: true }).click()
  await editor.getByRole('checkbox', { name: '退款业务规则', exact: true }).check(); await editor.getByRole('checkbox', { name: '退款技术规范', exact: true }).check()
  await editor.getByLabel('引用理由：退款业务规则', { exact: true }).fill('确认退款方向和业务边界'); await editor.getByLabel('引用理由：退款技术规范', { exact: true }).fill('确定事务与审计的技术流程')
  await matrix('requirement-source-selection', '[role="dialog"][aria-label="选择组织资料"]')
  await editor.getByRole('button', { name: '保存引用', exact: true }).click(); await editor.waitFor({ state: 'hidden' })
  check('Both citations persist', (await page.evaluate(id => window.projectos.requirements.knowledge(id), requirement.id)).binding.pins.length === 2)
  await matrix('requirement-citations', '.rq-organization-knowledge')
  await knowledge(); await page.getByRole('button', { name: '退款业务规则', exact: true }).click(); await page.getByRole('button', { name: '新建知识版本', exact: true }).click()
  await page.getByLabel('资料正文', { exact: true }).fill(businessV2); await page.getByRole('button', { name: '保存草稿', exact: true }).click(); await page.getByTestId('knowledge-status').waitFor(); await publish(); await closeSettings()
  await page.getByRole('tab', { name: '任务 0', exact: true }).click(); await page.getByRole('button', { name: 'AI 拆分任务', exact: true }).click()
  const plan = page.getByRole('dialog', { name: 'AI 拆分任务', exact: true })
  await plan.getByRole('button', { name: '生成任务草稿', exact: true }).click(); await plan.getByRole('button', { name: '重新拆分', exact: true }).waitFor({ timeout: 90000 })
  check('Native Planner receives exact old business and technical evidence through Main host requests', modelEvidence.some(item => item.businessV1 && !item.businessV2 && item.technical && item.untrusted), modelEvidence)
  const savedPlan = (await page.evaluate(id => window.projectos.plans.list(id), project.id)).plans.find(plan => plan.requirementId === requirement.id)
  check('Persisted plan goal contains no raw source body', !savedPlan.goal.includes('K2-BUSINESS') && !savedPlan.goal.includes('K2-TECHNICAL'))
  check('Planning freezes the selected citation version', (await page.evaluate(id => window.projectos.requirements.knowledge(id), requirement.id)).locked)
  await shot('planning-uses-selected-versions'); await page.keyboard.press('Escape'); await plan.waitFor({ state: 'hidden' })
  await knowledge(); await page.getByRole('button', { name: '退款业务规则', exact: true }).click(); await page.getByLabel('查看版本', { exact: true }).selectOption(firstVersion)
  await page.getByRole('button', { name: '撤销版本', exact: true }).click(); await page.getByRole('button', { name: '确认撤销', exact: true }).click()
  await wait(async () => await page.getByTestId('knowledge-status').innerText() === '已撤销', 'revoked knowledge')
  await closeSettings(); await page.getByRole('button', { name: 'AI 拆分任务', exact: true }).click()
  await plan.getByRole('button', { name: '确认并创建任务', exact: true }).click(); await plan.locator('[role="alert"]').waitFor()
  check('Revoked knowledge blocks approval without half-created tasks', (await page.evaluate(id => window.projectos.requirements.work(id), requirement.id)).tasks.length === 0)
  await shot('revocation-blocks-plan-approval')
  await app.close(); app = null
  await launch(resolve('node_modules/electron/dist/electron.exe'))
  const recovered = await page.evaluate(id => window.projectos.requirements.knowledge(id), requirement.id)
  check('Restart recovers frozen original references', recovered.locked && recovered.binding.pins.some(pin => pin.versionId === firstVersion))
  check('No renderer runtime exceptions', errors.length === 0, errors)
} catch (error) {
  checks.push({ name: 'journey', status: 'FAIL', detail: String(error) }); console.error(error)
  if (page) { await shot('failure').catch(() => {}); writeFileSync(join(evidence, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => 'unavailable')) }
  process.exitCode = 1
} finally {
  writeFileSync(join(evidence, 'desktop-checks.json'), JSON.stringify({ checks, captures, audits, modelEvidence, errors }, null, 2))
  if (app) await app.close().catch(() => {})
  if (server) await server.close()
  if (database) await database.stop()
  model.closeAllConnections(); await new Promise(done => model.close(done))
}
