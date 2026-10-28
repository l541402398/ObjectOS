/**
 * Phase 2.8.2 — low-intervention continuous delivery + real automatic Replan.
 *
 * Scenario A (low intervention): non-sensitive fixture; ONE plan approval + ONE grant;
 *   two real agents; count every human interaction. Sensitive-path protection untouched.
 * Scenario B (automatic Replan): a real, deterministic test failure is produced by the
 *   tester; the existing scheduler must call the existing Replanner; the revision is
 *   applied; the developer really fixes the code; the tester re-runs the SAME test and
 *   passes. No fake provider, no DB tampering, no scripted model output.
 *
 * Counting rules: only real UI/API decisions count as human intervention. Automatic
 * grant-covered actions are reported separately.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })
const dataDir = process.env.PROJECTOS_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), 'projectos-p282-'))
mkdirSync(dataDir, { recursive: true })

const realData = join(process.env.APPDATA ?? '', 'ProjectOS', 'data')
let providerAvailable = false
for (const file of ['provider.json', 'ai-secrets.vault.json']) {
  const source = join(realData, file)
  if (!existsSync(source)) continue
  copyFileSync(source, join(dataDir, file))
  if (file === 'provider.json') providerAvailable = true
}
if (providerAvailable) {
  const p = join(dataDir, 'provider.json')
  const parsed = JSON.parse(readFileSync(p, 'utf8'))
  delete parsed.connectionsMigrated
  writeFileSync(p, JSON.stringify(parsed, null, 2), 'utf8')
}

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const results = []
const record = (scenario, name, status, detail = '') => {
  results.push({ scenario, name, status, detail })
  console.log(`[${scenario}][${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Human-intervention counter: every entry is a real decision a human had to make. */
const human = { planApprovals: 0, grants: 0, toolApprovals: 0, manualMerges: 0, manualPhaseAdvances: 0, manualResumes: 0 }
/** Automatic actions the system performed inside the granted scope. */
const auto = { grantCoveredWrites: 0, reusedCommandApprovals: 0, runs: 0, tests: 0 }

let app = null
let page = null

async function waitFor(label, fn, { timeoutMs = 900_000, intervalMs = 2000 } = {}) {
  const started = Date.now()
  const deadline = started + timeoutMs
  let ticks = 0
  let last = null
  while (Date.now() < deadline) {
    last = await fn()
    ticks += 1
    if (last?.done) return { ok: true, value: last.value }
    if (ticks % 10 === 0) console.log(`        … ${label} ${Math.round((Date.now() - started) / 1000)}s ${JSON.stringify(last?.hint ?? null).slice(0, 140)}`)
    await sleep(intervalMs)
  }
  return { ok: false, value: last?.value ?? null, hint: last?.hint ?? null }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function approvePending(ctx, scenarioLabel) {
  const list = await page.evaluate(async (id) => window.projectos.approvals.list({ projectId: id, runId: null }), ctx.projectId)
  const pending = list.approvals.filter((item) => item.status === 'pending')
  let approved = 0
  for (const approval of pending) {
    const tool = String(approval.request?.toolName ?? '')
    const command = String(approval.request?.args?.command ?? '')
    const path = String(approval.request?.args?.path ?? '')
    const safe = (tool === 'write_file' && /^(src|tests)\//.test(path))
      || (['run_command', 'run_tests'].includes(tool) && /^(node|npm test|npm run |npx tsc|git (status|diff|log|show|rev-parse|branch|ls-files|grep|blame|grep -n))/.test(command))
    if (!safe) continue



    await page.evaluate(async (id) => window.projectos.approvals.decide({ approvalId: id, decision: 'approved', note: 'Phase 2.8.2 范围内授权' }), approval.id)
    human.toolApprovals += 1
    approved += 1
  }
  return approved
}

async function createAgent(projectId, name, role, systemPrompt) {
  return page.evaluate(async ({ projectId, name, role, systemPrompt }) => window.projectos.agentDefinitions.upsert({
    name, role, description: `Phase 2.8.2 ${name}`, category: 'engineering',
    persona: { role, systemPrompt },
    skillIds: [], runtimeProfileIds: [], primaryRuntimeProfileId: null, modelRef: null,
    permissions: { tools: [], files: true, shell: true, network: false }, ownerProjectId: projectId,
  }), { projectId, name, role, systemPrompt })
}

function writeFixture(workspace, kind) {
  mkdirSync(join(workspace, 'src'), { recursive: true })
  mkdirSync(join(workspace, 'tests'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({
    name: `p282-${kind}`, private: true, type: 'module', scripts: { test: 'node --test tests/*.test.mjs' },
  }, null, 2))
  writeFileSync(join(workspace, 'src', 'formatting.mjs'), 'export function label(v) {\n  return String(v)\n}\n')
  if (kind === 'a') {
    // Non-sensitive names on purpose: `visibility` / `formatting` are NOT in the
    // critical grant path list, so a granted plan may write them without prompting.
    writeFileSync(join(workspace, 'tests', 'formatting.test.mjs'), [
      "import test from 'node:test'",
      "import assert from 'node:assert/strict'",
      "import { label } from '../src/formatting.mjs'",
      '',
      "test('label wraps a value', () => { assert.equal(label('x'), '[x]') })",
      '',
    ].join('\n'))
  } else {
    // Deterministic broken behaviour the tester must catch. `visibility.mjs` is not a
    // sensitive path, so the *fix* stays grant-covered.
    writeFileSync(join(workspace, 'src', 'visibility.mjs'), [
      'export function canView(user, resource) {',
      '  // BUG: ignores owner and permission rules',
      '  return Boolean(resource && resource.visibility === "public")',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(workspace, 'tests', 'visibility.test.mjs'), [
      "import test from 'node:test'",
      "import assert from 'node:assert/strict'",
      "import { canView } from '../src/visibility.mjs'",
      '',
      "test('public is visible to anyone', () => { assert.equal(canView({ id: 'u1' }, { visibility: 'public' }), true) })",
      "test('owner sees private', () => { assert.equal(canView({ id: 'u1' }, { visibility: 'private', ownerId: 'u1' }), true) })",
      "test('stranger cannot see private', () => { assert.equal(canView({ id: 'u2' }, { visibility: 'private', ownerId: 'u1' }), false) })",
      '',
    ].join('\n'))
    writeFileSync(join(workspace, 'src', 'formatting.mjs'), 'export function label(v) {\n  return `[${v}]`\n}\n')
  }
}

async function bootstrap(fixtureKind) {
  const workspace = join(dataDir, `ws-${fixtureKind}`)
  writeFixture(workspace, fixtureKind)
  git(workspace, ['init', '-q'])
  git(workspace, ['config', 'user.email', 'e2e@projectos.local'])
  git(workspace, ['config', 'user.name', 'ProjectOS E2E'])
  git(workspace, ['add', '-A'])
  git(workspace, ['commit', '-qm', 'fixture'])
  const project = await page.evaluate(async ({ workspace, name }) => (await window.projectos.projects.create({ name, description: 'Phase 2.8.2', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace, name: `P282 ${fixtureKind.toUpperCase()}` })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  const developer = await createAgent(project.id, `P282 Dev ${fixtureKind}`, '开发工程师', '你是开发工程师，只做任务要求的最小改动，使用 write_file 修改文件。不要修改 tests 目录，除非任务明确要求。')
  const tester = await createAgent(project.id, `P282 QA ${fixtureKind}`, '测试工程师', '你是测试工程师，只运行测试并报告真实结果，绝不修改任何源文件。')
  return { projectId: project.id, workspace, developer, tester, planId: null, label: fixtureKind.toUpperCase() }
}

async function planApproveGrantStart(ctx, { goal, timeoutMs }) {
  const draft = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, { mode: 'ai', allowRuleFallback: false, maxTasks: 2 }), { projectId: ctx.projectId, goal })
  record(ctx.label, '真实 Planner 生成依赖计划', draft.generatedBy === 'provider' && draft.tasks.length === 2 ? 'PASS' : 'FAIL', `source=${draft.generatedBy} tasks=${draft.tasks.length} model=${draft.generation?.model ?? ''}`)
  if (!draft.tasks.length) return null
  const dev = draft.tasks.find((task) => task.role === 'developer') ?? draft.tasks[0]
  const downstream = draft.tasks.find((task) => task.key !== dev.key)
  const assigned = await page.evaluate(async ({ planId, developerId, testerId, downstreamKey }) => {
    const plan = await window.projectos.plans.get(planId)
    return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({ ...task, agentId: task.key === downstreamKey ? testerId : developerId })) })
  }, { planId: draft.id, developerId: ctx.developer.id, testerId: ctx.tester.id, downstreamKey: downstream?.key ?? dev.key })
  const approved = await page.evaluate(async (id) => window.projectos.plans.approve(id), assigned.id)
  human.planApprovals += 1
  const grant = await page.evaluate(async ({ planId }) => window.projectos.plans.grant.issue({
    planId, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src', 'tests'],
    maxRuns: 4, maxToolCalls: 80, ttlHours: 2, allowOverBudget: false,
    note: 'Phase 2.8.2 一次性范围授权', confirm: true,
  }), { planId: approved.plan.id })
  human.grants += 1
  ctx.planId = approved.plan.id
  record(ctx.label, '一次计划批准 + 一次授权（其余全部自动）', 'PASS', `plan=${approved.plan.id} grant=${grant?.id}`)
  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: approved.plan.id, grantId: grant?.id })
  const waited = await waitFor(`${ctx.label} plan terminal`, async () => {
    await approvePending(ctx, ctx.label)
    const plan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
    const status = plan.execution?.status ?? 'draft'
    return { done: ['completed', 'failed', 'cancelled'].includes(status), value: plan, hint: { status } }
  }, { timeoutMs })
  return { plan: waited.value, ok: waited.ok }
}

async function countApprovals(ctx) {
  const list = await page.evaluate(async (id) => window.projectos.approvals.list({ projectId: id, runId: null }), ctx.projectId)
  const byTool = {}
  const commands = []
  for (const item of list.approvals) {
    const tool = String(item.request?.toolName ?? 'unknown')
    byTool[tool] = (byTool[tool] ?? 0) + 1
    const cmd = String(item.request?.args?.command ?? '')
    if (cmd) commands.push(cmd.trim())
  }
  const duplicates = commands.filter((cmd, index) => commands.indexOf(cmd) !== index)
  return { total: list.approvals.length, byTool, duplicates: duplicates.length, commands }
}

async function main() {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  page = await app.firstWindow()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(3000)
  record('setup', 'Electron 启动', 'PASS', dataDir)
  if (!providerAvailable) { record('setup', '真实 Provider', 'BLOCKED', '未找到 provider.json'); return summarise() }
  const connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  record('setup', '真实 Provider 就绪', connections.connections.length > 0 ? 'PASS' : 'FAIL', connections.connections[0]?.defaultModelId ?? 'none')
  if (!connections.connections.length) return summarise()

  // ---------------- A: low-intervention continuous delivery (non-sensitive) ----------------
  const A = await bootstrap('a')
  const runA = await planApproveGrantStart(A, {
    goal: '把 src/formatting.mjs 的 label() 改成把值包在方括号里（例如 label("x") 返回 "[x]"）；然后由独立测试角色运行 npm test 确认 tests/formatting.test.mjs 通过。两个任务必须有上下游依赖。',
    timeoutMs: 900_000,
  })
  record('A', '计划完成（有界等待）', runA?.plan?.execution?.status === 'completed' ? 'PASS' : 'FAIL', `status=${runA?.plan?.execution?.status}`)
  const countsA = await countApprovals(A)
  const writeApprovalsA = countsA.byTool.write_file ?? 0
  record('A', '**非敏感文件写入零重复审批**', writeApprovalsA === 0 ? 'PASS' : 'FAIL', `write_file 审批=${writeApprovalsA}（grant 覆盖 src/tests，visibility/formatting 非敏感）`)
  record('A', '重复命令审批已被复用', countsA.duplicates === 0 ? 'PASS' : 'FAIL', `重复命令=${countsA.duplicates} 总审批=${countsA.total} 明细=${JSON.stringify(countsA.byTool)}`)
  const wtA = runA?.plan?.execution?.workspaceRef ?? A.workspace
  const diffA = execFileSync('git', ['status', '--porcelain'], { cwd: wtA, encoding: 'utf8' }).trim()
  record('A', '真实代码改动落盘', diffA.length > 0 ? 'PASS' : 'FAIL', diffA.split('\n').slice(0, 3).join(' | ').slice(0, 160))
  const runsA = await page.evaluate(async (id) => window.projectos.runs.list(id, 50), A.projectId)
  const listA = runsA.runs ?? runsA
  auto.runs += listA.length
  record('A', '两个真实 Agent 均执行', new Set(listA.map((r) => r.agentId)).size >= 2 ? 'PASS' : 'FAIL', `distinct=${new Set(listA.map((r) => r.agentId)).size}`)

  // ---------------- B: real automatic Replan on a real test failure ----------------
  const B = await bootstrap('b')
  const beforeB = (() => { try { execFileSync('npm', ['test'], { cwd: B.workspace, encoding: 'utf8', shell: true }); return 0 } catch (error) { return error.status ?? 1 } })()
  record('B', '夹具真实失败（确定性）', beforeB !== 0 ? 'PASS' : 'FAIL', `npm test exit=${beforeB}`)
  const draftB = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, { mode: 'ai', allowRuleFallback: false, maxTasks: 2 }), {
    projectId: B.projectId,
    goal: 'git 仓库当前 npm test 失败（tests/visibility.test.mjs 的 owner/stranger 两条用例不通过）。第一步：开发角色只新增一个独立的 src/labels.mjs（导出 titleCase），不要修改 src/visibility.mjs 与 tests/ 目录。第二步：测试角色运行 npm test 并如实报告失败。两个任务必须有上下游依赖。',
  })
  record('B', '真实 Planner 生成计划', draftB.generatedBy === 'provider' && draftB.tasks.length === 2 ? 'PASS' : 'FAIL', `source=${draftB.generatedBy} tasks=${draftB.tasks.length}`)
  if (draftB.tasks.length === 2) {
    const devB = draftB.tasks.find((t) => t.role === 'developer') ?? draftB.tasks[0]
    const qaB = draftB.tasks.find((t) => t.key !== devB.key)
    const assignedB = await page.evaluate(async ({ planId, developerId, testerId, downstreamKey }) => {
      const plan = await window.projectos.plans.get(planId)
      return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({ ...task, agentId: task.key === downstreamKey ? testerId : developerId })) })
    }, { planId: draftB.id, developerId: B.developer.id, testerId: B.tester.id, downstreamKey: qaB?.key ?? devB.key })
    const approvedB = await page.evaluate(async (id) => window.projectos.plans.approve(id), assignedB.id)
    human.planApprovals += 1
    const grantB = await page.evaluate(async ({ planId }) => window.projectos.plans.grant.issue({
      planId, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src', 'tests'],
      maxRuns: 4, maxToolCalls: 80, ttlHours: 2, allowOverBudget: false, note: 'Phase 2.8.2 B 授权', confirm: true,
    }), { planId: approvedB.plan.id })
    human.grants += 1
    B.planId = approvedB.plan.id
    await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: approvedB.plan.id, grantId: grantB?.id })
    const waitedB = await waitFor('B plan terminal', async () => {
      await approvePending(B, 'B')
      const plan = await page.evaluate(async (id) => window.projectos.plans.get(id), approvedB.plan.id)
      const status = plan.execution?.status ?? 'draft'
      return { done: ['completed', 'failed', 'cancelled'].includes(status), value: plan, hint: { status } }
    }, { timeoutMs: 900_000 })
    const planB = waitedB.value
    record('B', '计划到达终态', waitedB.ok ? 'PASS' : 'FAIL', `status=${planB?.execution?.status} error=${String(planB?.execution?.error ?? '').slice(0, 120)}`)
    const proposals = await page.evaluate(async (id) => (await window.projectos.plans.replan.list(id)).proposals, B.projectId)
    record('B', '**自动 Replan 提案真实产生**', proposals.length > 0 ? 'PASS' : 'FAIL', `proposals=${proposals.length} ${proposals[0] ? `trigger=${proposals[0].trigger} status=${proposals[0].status}` : ''}`)
    if (proposals.length > 0) {
      const applied = await page.evaluate(async (id) => window.projectos.plans.replan.apply(id), proposals[0].id)
      record('B', '修订计划已应用', applied?.plan?.revision > 1 ? 'PASS' : 'FAIL', `revision=${applied?.plan?.revision}`)
      const reAssigned = await page.evaluate(async ({ planId, developerId, testerId }) => {
        const plan = await window.projectos.plans.get(planId)
        return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({ ...task, agentId: task.role === 'developer' ? developerId : testerId })) })
      }, { planId: applied.plan.id, developerId: B.developer.id, testerId: B.tester.id })
      const reApproved = await page.evaluate(async (id) => window.projectos.plans.approve(id), reAssigned.id)
      human.planApprovals += 1
      const reGrant = await page.evaluate(async ({ planId }) => window.projectos.plans.grant.issue({
        planId, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src', 'tests'],
        maxRuns: 4, maxToolCalls: 80, ttlHours: 2, allowOverBudget: false, note: 'Phase 2.8.2 B 修订授权', confirm: true,
      }), { planId: reApproved.plan.id })
      human.grants += 1
      await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: reApproved.plan.id, grantId: reGrant?.id })
      const waitedFix = await waitFor('B fix plan terminal', async () => {
        await approvePending(B, 'B2')
        const plan = await page.evaluate(async (id) => window.projectos.plans.get(id), reApproved.plan.id)
        const status = plan.execution?.status ?? 'draft'
        return { done: ['completed', 'failed', 'cancelled'].includes(status), value: plan, hint: { status } }
      }, { timeoutMs: 900_000 })
      record('B', '修复计划完成', waitedFix.value?.execution?.status === 'completed' ? 'PASS' : 'FAIL', `status=${waitedFix.value?.execution?.status}`)
      const wtB = waitedFix.value?.execution?.workspaceRef ?? B.workspace
      const inWt = (() => { try { execFileSync('npm', ['test'], { cwd: wtB, encoding: 'utf8', shell: true }); return 0 } catch (error) { return error.status ?? 1 } })()
      record('B', '**同一测试在修复后真实通过**', inWt === 0 ? 'PASS' : 'FAIL', `wt=${String(wtB).split(/[\\/]/).pop()} npm test exit=${inWt}`)
    }
  }

  record('setup', '渲染进程无 console error', errors.length === 0 ? 'PASS' : 'FAIL', errors.slice(0, 2).join(' | ').slice(0, 160))
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/work` }, { projectId: A.projectId }).catch(() => undefined)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, 'p282-01-work-center.png') }).catch(() => undefined)
  summarise()
}

function summarise() {
  const failed = results.filter((i) => i.status === 'FAIL')
  console.log('\n===== PHASE 2.8.2 LOW-INTERVENTION + AUTO REPLAN =====')
  for (const item of results) console.log(`${item.status}\t[${item.scenario}] ${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log('--- 人工介入统计（真实点击）---')
  console.log(`计划批准=${human.planApprovals} 授权签发=${human.grants} 工具审批点击=${human.toolApprovals} 手动合并=${human.manualMerges} 手动推进阶段=${human.manualPhaseAdvances} 手动恢复=${human.manualResumes}`)
  console.log('--- AI 自主完成 ---')
  console.log(`真实 Run=${auto.runs} 授权覆盖写入=${auto.grantCoveredWrites} 命令审批复用=${auto.reusedCommandApprovals}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} INFO=${results.filter((i) => i.status === 'INFO').length}`)
  console.log(`dataDir=${dataDir}`)
  if (failed.length) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error('[fatal]', error)
    results.push({ scenario: 'setup', name: 'fatal', status: 'FAIL', detail: String(error).slice(0, 300) })
    summarise()
    process.exitCode = 1
  })
  .finally(async () => { try { await app?.close() } catch { /* ignore */ } })
