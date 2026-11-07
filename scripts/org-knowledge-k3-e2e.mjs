/** K3: real PostgreSQL, native Electron, current workflow/Git evidence and browser consent.
 * Project/code/workflow fixtures use typed APIs; K3 acceptance, sharing and review use visible UI.
 * The local model is deterministic, not an external inference-quality test.
 */
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
import { compositeContrast } from './lib/premium-contrast.mjs'

const out = resolve('docs/v2/evidence/organization-knowledge-k3'), shots = join(out, 'screenshots')
mkdirSync(shots, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-knowledge-k3-')), dataDir = join(profile, 'data'), rootPath = join(profile, 'project')
const checks = [], audits = [], captures = [], errors = [], modelEvidence = []
const sourceBody = 'K3-ACCEPTED：退款必须退回原支付渠道；重试采用幂等事务，保留审计证据。'
const correctedBody = sourceBody + '\n补充说明：仅对本次已验收版本生效。'
const candidateTitle = '退款知识复用规则'
let app, page, win, database, server, origin, project, requirement, task, shared, publication
let orgRequests = 0, submissions = 0, decisions = 0, dropSubmission = false, dropDecision = false
let detectorPort
const check = (name, condition, detail) => { checks.push({ name, status: condition ? 'PASS' : 'FAIL', detail }); console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`); if (!condition) throw new Error(name) }
const wait = async (predicate, name, timeout = 90000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await new Promise(done => setTimeout(done, 200)) } throw new Error('Timed out: ' + name) }
const shot = async name => { await page.mouse.move(4, 4); await page.waitForTimeout(250); writeFileSync(join(shots, name + '.png'), Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64')); captures.push(name + '.png') }
async function audit(name, selector) {
  check(name + ' fits', await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 2))
  await page.evaluate(readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8'))
  const result = await page.evaluate(async selector => { const r = await window.axe.run(document.querySelector(selector)); return { violations: r.violations.map(v => ({ id: v.id, impact: v.impact, targets: v.nodes.map(n => n.target) })), incomplete: r.incomplete.map(v => v.id) } }, selector)
  const contrast = await compositeContrast(page, win, selector)
  audits.push({ name, ...result, contrast })
  check(name + ' axe', result.violations.length === 0, result.violations)
  check(name + ' native contrast', contrast.count > 0 && contrast.failures.length === 0, { count: contrast.count, minimum: contrast.minimum, failures: contrast.failures })
}
async function matrix(prefix, selector) {
  for (const [width, height] of [[1440, 900], [1024, 768]]) for (const theme of ['light', 'dark']) for (const zoom of [1, 1.25]) {
    await win.evaluate((w, s) => { w.setContentSize(s.width, s.height); w.webContents.setZoomFactor(s.zoom) }, { width, height, zoom })
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await page.waitForTimeout(150)
    await page.locator(selector).evaluate(el => el.scrollIntoView({ block: 'start' }))
    const name = `${prefix}-${width}-${theme}-${zoom === 1 ? '100' : '125'}`
    await shot(name); await audit(name, selector)
  }
  await win.evaluate(w => { w.setContentSize(1440, 900); w.webContents.setZoomFactor(1) }); await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
}
async function launch(baseline = false) {
  const env = { ...process.env, PROJECTOS_DATA_DIR: baseline ? join(profile, 'baseline-data') : dataDir, PROJECTOS_SEED_DEMO: '0', PROJECTOS_START_ROUTE: baseline ? 'design-lab' : '', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
  delete env.ELECTRON_RUN_AS_NODE
  detectorPort = process.env.PROJECTOS_IMPECCABLE_ENGINE ? await reserveOrganizationTestPort() : undefined
  app = await electron.launch({ executablePath: resolve(baseline ? 'release/win-unpacked/ProjectOS.exe' : 'node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: [...(baseline ? [] : ['.']), ...(detectorPort ? [`--remote-debugging-port=${detectorPort}`, '--remote-debugging-address=127.0.0.1'] : []), `--user-data-dir=${join(profile, baseline ? 'baseline-user' : 'user')}`], env, timeout: 60000 })
  page = await app.firstWindow(); win = await app.browserWindow(page); page.setDefaultTimeout(45000)
  page.on('pageerror', error => errors.push(error.message))
  await page.waitForSelector(baseline ? '.pdl-root' : '.po-shell', { timeout: 60000 })
}
async function settings() { if (!await page.getByTestId('organization-panel').isVisible()) await page.locator('.po-nav-item').filter({ hasText: '账号与组织' }).last().click(); await page.getByTestId('organization-panel').waitFor() }
async function knowledge() { await settings(); await page.getByRole('button', { name: '组织知识', exact: true }).click(); await page.getByTestId('organization-knowledge').waitFor() }
async function reviewQueue() { await knowledge(); await page.getByRole('button', { name: '知识审核', exact: true }).click(); await page.getByTestId('knowledge-candidates').waitFor() }
async function closeSettings() { await page.getByTestId('settings-dialog').getByRole('button', { name: '关闭', exact: true }).click(); await page.getByTestId('settings-dialog').waitFor({ state: 'hidden' }) }
async function writeback() { await page.getByRole('tab', { name: '组织资料', exact: true }).click(); await page.getByRole('button', { name: '成果验收与知识回写', exact: true }).click(); return page.getByTestId('knowledge-writeback-dialog') }
async function fillCandidate(dialog, corrected = false) {
  await dialog.getByRole('checkbox', { name: '退款规则与技术决策', exact: true }).check()
  await dialog.getByRole('button', { name: '从所选产物整理', exact: true }).click()
  await wait(async () => (await dialog.getByLabel('候选正文', { exact: true }).inputValue()).includes(sourceBody), 'draft from actual artifact')
  await dialog.getByLabel('提交到共享项目', { exact: true }).selectOption(shared.id)
  await dialog.getByLabel('候选标题', { exact: true }).fill(candidateTitle)
  await dialog.getByLabel('候选类型', { exact: true }).selectOption('business')
  if (corrected) await dialog.getByLabel('候选正文', { exact: true }).fill(correctedBody)
  await dialog.getByLabel('候选标签', { exact: true }).fill('退款，复用')
}

const model = createServer((req, res) => {
  let raw = ''; req.on('data', chunk => { raw += chunk }); req.on('end', () => {
    const payload = JSON.parse(raw || '{}')
    if (!payload.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'k3-fixture' }], choices: [{ message: { content: 'fixture' } }] })); return }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); const write = value => res.write(`data: ${JSON.stringify(value)}\n\n`)
    if (payload.tools?.length) {
      if ((payload.messages ?? []).some(item => item.role === 'tool')) write({ choices: [{ delta: { content: '节点产物已保存' }, finish_reason: 'stop' }] })
      else {
        const user = payload.messages.filter(item => item.role === 'user').at(-1)?.content ?? ''
        const review = user.includes('需求审核')
        write({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_k3_' + randomBytes(4).toString('hex'), type: 'function', function: { name: 'create_artifact', arguments: JSON.stringify({ kind: 'document', title: review ? '产物审核结论' : '退款规则与技术决策', body: review ? '审核通过：已检查当前输入的业务与技术规则。' : sourceBody, metadata: { verdict: 'approved' } }) } }] } }] })
        write({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
      }
    } else {
      const text = (payload.messages ?? []).map(item => typeof item.content === 'string' ? item.content : JSON.stringify(item.content)).join('\n')
      modelEvidence.push({ hasAcceptedContent: text.includes(sourceBody), hasReviewedBody: text.includes('"body":' + JSON.stringify(correctedBody)), versionId: publication?.versionId, hasExactVersion: publication ? text.includes(publication.versionId) : false })
      const plan = { assumptions: ['隔离验收模型固定输出'], risks: [], tasks: [{ key: 'refund', title: '复用退款规则', description: '根据已审核知识实现后续需求', role: 'developer', capabilities: ['implement'], hardCapabilities: [], dependsOn: [], acceptanceCriteria: ['遵循已审核退款规则'], expectedArtifacts: ['代码 diff'], rationale: '独立交付后续功能', requiresApproval: true }] }
      write({ choices: [{ delta: { content: JSON.stringify(plan) }, finish_reason: 'stop' }] })
    }
    write({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 80 } }); res.end('data: [DONE]\n\n')
  })
})

try {
  if (existsSync(resolve('release/win-unpacked/ProjectOS.exe'))) { await launch(true); await page.waitForTimeout(1000); await shot('before-protected-dag'); await app.close(); app = null }
  database = await startOrganizationTestDatabase(); await migrateOrganizationDatabase(database.pool)
  origin = `http://127.0.0.1:${await reserveOrganizationTestPort()}`
  server = await buildOrganizationServer({ databaseUrl: database.databaseUrl, baseURL: origin, secret: randomBytes(32).toString('hex'), rateLimit: { max: 10000, authenticationMax: 100, windowMs: 60000 } })
  server.addHook('onRequest', async () => { orgRequests++ })
  server.addHook('onSend', async (request, reply, payload) => {
    if (request.method === 'POST' && /\/knowledge-candidates$/.test(request.url)) { submissions++; if (dropSubmission && reply.statusCode === 200) { dropSubmission = false; reply.raw.destroy() } }
    if (request.method === 'POST' && /\/knowledge-candidates\/[^/]+\/decision$/.test(request.url)) { decisions++; if (dropDecision && reply.statusCode === 200) { dropDecision = false; reply.raw.destroy() } }
    return payload
  })
  await server.listen({ host: '127.0.0.1', port: Number(new URL(origin).port) }); await new Promise(done => model.listen(0, '127.0.0.1', done))
  await launch(); await page.evaluate(() => { location.hash = '#/design-lab' }); await page.locator('.pdl-root').waitFor(); await page.waitForTimeout(1000); await shot('after-protected-dag')
  check('Protected DAG screenshot remains byte-identical', readFileSync(join(shots, 'before-protected-dag.png')).equals(readFileSync(join(shots, 'after-protected-dag.png'))))
  await page.evaluate(() => { location.hash = '#/' }); await page.locator('.po-shell').waitFor()

  // Fixtures: actual workspace approval, two native workflow Agents, real tests and separately approved integration.
  project = (await page.evaluate(rootPath => window.projectos.projects.create({ name: '知识回写验收', description: '', rootPath, createDirectory: true, initGit: true }), rootPath)).project
  execFileSync('git', ['-C', rootPath, 'add', '.'], { windowsHide: true }); execFileSync('git', ['-C', rootPath, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '--allow-empty', '-qm', 'k3 fixture baseline'], { windowsHide: true })
  await page.evaluate(baseUrl => window.projectos.settings.update({ baseUrl, model: 'k3-fixture', apiKey: 'isolated-k3-test-key', temperature: 0 }), `http://127.0.0.1:${model.address().port}/v1`)
  await page.evaluate(projectId => window.projectos.actions.setAutonomy({ projectId, mode: 'assist' }), project.id)
  requirement = (await page.evaluate(projectId => window.projectos.requirements.create({ projectId, title: '退款能力', body: '定义并验收退款规则', source: 'local', acceptanceCriteria: ['退款采用原渠道与幂等事务'], workflow: { templateVersionId: 'wfv_document1', assignmentMode: 'manual', assignments: { 'stage-1': 'agt_product', 'stage-2': 'agt_reviewer' } } }), project.id)).requirement
  task = (await page.evaluate(({ projectId, requirementId }) => window.projectos.tasks.create({ projectId, requirementId, title: '退款规则成果', acceptanceCriteria: ['实际测试通过'], dependsOn: [] }), { projectId: project.id, requirementId: requirement.id })).task
  const prep = await page.evaluate(({ taskId, expectedVersion }) => window.projectos.requirements.requestWorkspace({ taskId, expectedVersion }), { taskId: task.id, expectedVersion: task.version })
  await page.evaluate(approvalId => window.projectos.approvals.decide({ approvalId, decision: 'approved', note: '夹具授权独立工作区' }), prep.approvalId)
  const taskRoot = (await page.evaluate(id => window.projectos.requirements.work(id), requirement.id)).workspaces.find(item => item.taskId === task.id).rootPath
  writeFileSync(join(taskRoot, 'refund.cjs'), 'module.exports = 1\n'); writeFileSync(join(taskRoot, 'check.test.cjs'), "require('node:test')('refund',()=>require('node:assert/strict').equal(require('./refund.cjs'),1))\n")
  await page.evaluate(id => window.projectos.workflows.start(id), task.id)
  await wait(async () => (await page.evaluate(id => window.projectos.workflows.view(id), requirement.id)).tasks[0]?.status === 'completed', 'two native workflow stages')
  const state = await page.evaluate(id => window.projectos.tasks.detail(id), task.id)
  if (state.task.status !== 'done') await page.evaluate(({ taskId, expectedVersion }) => window.projectos.tasks.move({ taskId, expectedVersion, to: 'done', note: '已核对当前任务成果与验收范围' }), { taskId: task.id, expectedVersion: state.task.version })
  let integration = await page.evaluate(id => window.projectos.requirements.integrationPreview(id), task.id)
  await page.evaluate(({ taskId, fingerprint }) => window.projectos.requirements.reviewIntegration({ taskId, fingerprint, note: '已审查当前代码、实际测试与验收范围' }), { taskId: task.id, fingerprint: integration.fingerprint })
  integration = await page.evaluate(id => window.projectos.requirements.integrationPreview(id), task.id)
  const verification = await page.evaluate(({ taskId, fingerprint }) => window.projectos.requirements.requestIntegration({ taskId, fingerprint, kind: 'verify', command: 'node --test check.test.cjs' }), { taskId: task.id, fingerprint: integration.fingerprint })
  await page.evaluate(approvalId => window.projectos.approvals.decide({ approvalId, decision: 'approved', note: '夹具批准实际验证' }), verification.approvalId)
  await wait(async () => (await page.evaluate(id => window.projectos.runs.get(id), verification.runId)).run.status === 'completed', 'actual verification')
  integration = await page.evaluate(id => window.projectos.requirements.integrationPreview(id), task.id)
  const merge = await page.evaluate(({ taskId, fingerprint }) => window.projectos.requirements.requestIntegration({ taskId, fingerprint, kind: 'integrate' }), { taskId: task.id, fingerprint: integration.fingerprint })
  await page.evaluate(approvalId => window.projectos.approvals.decide({ approvalId, decision: 'approved', note: '夹具仅批准合入需求分支' }), merge.approvalId)
  await page.evaluate(id => { location.hash = `#/projects/${id}/requirements` }, project.id)
  let dialog = await writeback(); await dialog.getByLabel('整体验收结论', { exact: true }).fill('已核对需求范围、当前产物和实际测试，整体验收通过')
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  check('Unsaved acceptance survives immediate Escape', (await dialog.getByLabel('整体验收结论', { exact: true }).inputValue()).includes('整体验收通过'))
  await matrix('personal-acceptance', '.kw-dialog')
  await dialog.getByRole('checkbox', { name: '我已核对需求范围、当前成果及验收证据', exact: true }).check(); await dialog.getByRole('button', { name: '记录整体验收通过', exact: true }).click()
  await dialog.getByText('当前成果已记录人工整体验收。', { exact: true }).waitFor()
  check('Personal acceptance sends no organization request', orgRequests === 0, orgRequests)
  check('Sharing is disabled while signed out', await dialog.getByRole('button', { name: '提交知识候选', exact: true }).isDisabled())
  await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })

  await settings(); await app.evaluate(({ shell }) => { globalThis.__k3Auth = null; shell.openExternal = async url => { globalThis.__k3Auth = url } })
  await page.getByTestId('org-server-url').fill(origin); await page.getByTestId('org-connect').click(); await wait(() => app.evaluate(() => globalThis.__k3Auth), 'authorization URL')
  const authUrl = await app.evaluate(() => globalThis.__k3Auth), browserEvent = app.waitForEvent('window')
  await app.evaluate(async ({ BrowserWindow }, url) => { const browser = new BrowserWindow({ width: 1000, height: 800, webPreferences: { partition: 'knowledge-k3-auth', sandbox: true, contextIsolation: true, nodeIntegration: false } }); globalThis.__k3Browser = browser; await browser.loadURL(url + '&mode=register') }, authUrl)
  const browser = await browserEvent
  await browser.getByLabel('姓名', { exact: true }).fill('知识审核员'); await browser.getByLabel('邮箱', { exact: true }).fill('knowledge-k3@demo.invalid'); await browser.getByLabel('密码', { exact: true }).fill('K3-test-' + randomBytes(12).toString('hex'))
  await browser.getByRole('button', { name: /创建账号|注册并继续/ }).click(); await browser.getByRole('button', { name: '授权此设备', exact: true }).click()
  await wait(async () => (await page.evaluate(() => window.projectos.organization.status())).status === 'connected', 'desktop account'); await app.evaluate(() => globalThis.__k3Browser.destroy())
  await page.getByTestId('org-new-organization').click(); await page.getByTestId('org-name').fill('知识回写协作'); await page.getByTestId('org-slug').fill('knowledge-k3'); await page.getByTestId('org-create-submit').click()
  await page.getByTestId('org-new-project').click(); await page.getByTestId('org-project-name').fill('退款知识项目'); await page.getByTestId('org-project-key').fill('REFUND'); await page.getByTestId('org-project-submit').click(); await page.getByText('退款知识项目', { exact: true }).waitFor()
  shared = (await page.evaluate(() => window.projectos.organization.projects())).projects[0]
  await closeSettings(); dialog = await writeback(); await fillCandidate(dialog)
  check('Sharing requires an explicit confirmation', await dialog.getByRole('button', { name: '提交知识候选', exact: true }).isDisabled())
  await matrix('candidate-editor', '.kw-dialog')
  if (detectorPort) {
    let output, detectorExitCode = 0
    try { output = execFileSync(process.env.PROJECTOS_IMPECCABLE_ENGINE, ['detect', '--cdp', String(detectorPort), '--target', 'index.html', '--json'], { encoding: 'utf8', windowsHide: true }) }
    catch (error) { if (error.status !== 2) throw error; output = String(error.stdout); detectorExitCode = 2 }
    writeFileSync(join(out, 'impeccable-rendered.json'), output)
    const findings = JSON.parse(output)
    const context = await page.evaluate(findings => findings.map(item => {
      const element = item.selector ? document.querySelector(item.selector) : null
      return { rule: item.antipattern, selector: item.selector, insideWriteback: Boolean(element?.closest('.kw-dialog')), excludedFromAccessibilityTree: Boolean(element?.closest('[aria-hidden="true"],[inert]')) }
    }), findings)
    writeFileSync(join(out, 'impeccable-rendered-context.json'), JSON.stringify({ detectorExitCode, context, note: 'Diagnostic findings are retained for manual review; completion is not a quality pass.' }, null, 2))
    check('Rendered design detector captured diagnostics', Array.isArray(findings), { detectorExitCode, findings: findings.length })
  }
  await dialog.getByLabel('候选正文', { exact: true }).scrollIntoViewIfNeeded(); await shot('candidate-editor-body')
  await dialog.getByRole('checkbox', { name: '我已核对正文和证据，确认分享给所选项目成员', exact: true }).scrollIntoViewIfNeeded(); await shot('candidate-editor-sharing')
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  check('Candidate draft survives dirty close', (await dialog.getByLabel('候选正文', { exact: true }).inputValue()).includes(sourceBody))
  await dialog.getByRole('checkbox', { name: '我已核对正文和证据，确认分享给所选项目成员', exact: true }).check(); await dialog.getByRole('button', { name: '提交知识候选', exact: true }).click()
  await dialog.getByText('已提交候选', { exact: true }).first().waitFor(); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })
  check('Pending candidate is absent from knowledge retrieval', (await page.evaluate(projectId => window.projectos.organization.searchKnowledge({ projectId, query: '退款知识复用规则' }), shared.id)).results.length === 0)
  await reviewQueue(); await page.getByRole('button', { name: candidateTitle, exact: true }).click(); await page.getByTestId('candidate-status').waitFor()
  await matrix('candidate-review', '[data-testid="knowledge-candidates"]')
  await page.getByLabel('知识审核意见', { exact: true }).fill('请补充此规则仅适用于本次验收版本的说明')
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '继续编辑', exact: true }).click()
  check('Settings protects unsaved review notes', (await page.getByLabel('知识审核意见', { exact: true }).inputValue()).includes('补充'))
  await page.getByRole('button', { name: '退回候选', exact: true }).click(); await wait(async () => (await page.getByTestId('candidate-status').innerText()) === '已退回', 'returned candidate')
  await matrix('candidate-returned', '[data-testid="knowledge-candidates"]'); await closeSettings()
  check('Return preserves local acceptance', (await page.evaluate(id => window.projectos.requirements.knowledgeDelivery(id), requirement.id)).acceptance.current)

  dialog = await writeback(); await fillCandidate(dialog, true); dropSubmission = true
  await dialog.getByRole('checkbox', { name: '我已核对正文和证据，确认分享给所选项目成员', exact: true }).check(); await dialog.getByRole('button', { name: '提交知识候选', exact: true }).click()
  await dialog.getByText('结果待核对', { exact: true }).first().waitFor()
  const postCount = submissions
  await matrix('submission-unknown', '.kw-dialog')
  check('Unknown submission is not automatically replayed', submissions === postCount)
  await dialog.getByRole('button', { name: '查看提交内容', exact: true }).first().click(); await dialog.getByRole('button', { name: '核对服务器回执', exact: true }).waitFor()
  check('Retry of unknown content needs renewed confirmation', await dialog.getByRole('button', { name: '确认重新提交原内容', exact: true }).isDisabled())
  await dialog.getByRole('button', { name: '核对服务器回执', exact: true }).click(); await wait(async () => (await dialog.getByText('已提交候选', { exact: true }).count()) > 0, 'read-only receipt reconciliation')
  check('Reconciliation uses a read without resending', submissions === postCount)
  await shot('submission-reconciled'); await dialog.getByRole('button', { name: '关闭', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })
  await reviewQueue(); await matrix('candidate-queue', '[data-testid="knowledge-candidates"]')
  await page.locator('tr').filter({ hasText: '待审核' }).getByRole('button', { name: candidateTitle, exact: true }).click()
  await page.getByLabel('知识审核意见', { exact: true }).fill('已核对修订正文、来源验收与发布位置，同意作为项目知识发布')
  await page.getByRole('checkbox', { name: '我已核对候选正文、来源证据和发布位置', exact: true }).check(); dropDecision = true
  await page.getByRole('button', { name: '审核并发布知识', exact: true }).click(); await page.getByRole('button', { name: '核对审核结果', exact: true }).waitFor()
  const decisionCount = decisions; await shot('publication-unknown'); await page.getByRole('button', { name: '核对审核结果', exact: true }).click()
  await wait(async () => (await page.getByTestId('candidate-status').innerText()) === '已发布', 'published knowledge')
  check('Unknown publication is reconciled without repeating the decision', decisions === decisionCount)
  await matrix('candidate-published', '[data-testid="knowledge-candidates"]')
  const candidates = await page.evaluate(() => window.projectos.organization.knowledgeCandidates())
  const publishedId = candidates.candidates.find(item => item.status === 'published').id
  publication = (await page.evaluate(id => window.projectos.organization.knowledgeCandidate({ id }), publishedId)).candidate.publication
  check('Publication created exactly one immutable version', Number((await database.pool.query('SELECT count(*) AS count FROM organization_knowledge_versions WHERE document_id=$1', [publication.documentId])).rows[0].count) === 1)
  await closeSettings()

  await page.getByRole('button', { name: '新建需求', exact: true }).first().click()
  const create = page.getByRole('dialog', { name: '新建需求', exact: true }); await create.getByLabel('需求名称', { exact: true }).fill('复用退款知识的新需求'); await create.getByLabel('需求描述', { exact: true }).fill('在已验收知识基础上规划后续退款需求'); await create.getByRole('button', { name: '创建需求', exact: true }).click(); await create.waitFor({ state: 'hidden' })
  const next = (await page.evaluate(id => window.projectos.requirements.list(id), project.id)).requirements.find(item => item.title === '复用退款知识的新需求')
  await page.getByRole('tab', { name: '组织资料', exact: true }).click(); await page.getByRole('button', { name: '选择组织资料', exact: true }).click()
  const references = page.getByRole('dialog', { name: '选择组织资料', exact: true }); await references.getByLabel('共享项目', { exact: true }).selectOption(shared.id); await references.getByLabel('检索组织资料', { exact: true }).fill('退款知识复用规则'); await references.getByRole('button', { name: '查找资料', exact: true }).click()
  await references.getByRole('checkbox', { name: candidateTitle, exact: true }).check(); await references.getByLabel('引用理由：' + candidateTitle, { exact: true }).fill('复用前次已验收并审核发布的规则'); await shot('new-requirement-reuses-publication'); await references.getByRole('button', { name: '保存引用', exact: true }).click(); await references.waitFor({ state: 'hidden' })
  await page.getByRole('tab', { name: '任务 0', exact: true }).click(); await page.getByRole('button', { name: 'AI 拆分任务', exact: true }).click()
  const plan = page.getByRole('dialog', { name: 'AI 拆分任务', exact: true }); await plan.getByRole('button', { name: '生成任务草稿', exact: true }).click(); await plan.getByRole('button', { name: '重新拆分', exact: true }).waitFor({ timeout: 90000 })
  check('Knowledge flywheel reaches the next requirement model with the exact reviewed version', modelEvidence.some(item => item.hasAcceptedContent && item.hasReviewedBody && item.hasExactVersion), modelEvidence)
  await shot('knowledge-flywheel-plan'); const beforeRestartPosts = submissions
  await app.close(); app = null; await launch()
  const recovered = await page.evaluate(({ original, next }) => Promise.all([window.projectos.requirements.knowledgeDelivery(original), window.projectos.requirements.knowledge(next)]), { original: requirement.id, next: next.id })
  check('Restart retains accepted receipts and frozen next-requirement references', recovered[0].receipts.filter(item => item.status === 'submitted').length === 2 && recovered[1].binding.pins[0].versionId === publication.versionId)
  check('Restart never resends knowledge submissions', submissions === beforeRestartPosts)
  check('No Renderer exceptions', errors.length === 0, errors)
} catch (error) {
  checks.push({ name: 'journey', status: 'FAIL', detail: String(error) }); console.error(error); process.exitCode = 1
  if (page) { await shot('failure').catch(() => {}); writeFileSync(join(out, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => 'unavailable')) }
} finally {
  writeFileSync(join(out, 'desktop-checks.json'), JSON.stringify({ checks, audits, captures, errors, modelEvidence, submissions, decisions, fixture: 'typed workspace/Git preparation, two actual native workflow Agents and a deterministic local model; K3 business actions use UI' }, null, 2))
  if (app) await app.close().catch(() => {}); if (server) await server.close(); if (database) await database.stop(); model.closeAllConnections(); await new Promise(done => model.close(done))
}
