/**
 * Phase 2.8.1 — real multi-Agent closure, two independent scenarios.
 *
 * Scenario A: normal multi-Agent delivery (real DeepSeek planner + developer + tester,
 *             real git repo, real code change, real tests, handoff, evidence).
 * Scenario B: deterministic real failure -> automatic replan -> real fix -> tests pass.
 *
 * Design rules learned from the Phase 2.8 failure:
 *  - never assert on a fixed sleep: every wait is a bounded poll on a REAL terminal state
 *  - every wait prints progress so a timeout is diagnosable
 *  - the two scenarios are isolated: A failing never prevents B from running
 *  - no FakeProvider, no direct DB writes, no fabricated tool results
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })
const dataDir = process.env.PROJECTOS_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), 'projectos-p281-'))
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

let app = null
let page = null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Bounded poll against a real predicate. Logs progress so timeouts are diagnosable. */
async function waitFor(label, fn, { timeoutMs = 600_000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  let ticks = 0
  while (Date.now() < deadline) {
    last = await fn()
    ticks += 1
    if (last?.done) return { ok: true, value: last.value }
    if (ticks % 10 === 0) console.log(`        … waiting ${label} (${Math.round((Date.now() - (deadline - timeoutMs)) / 1000)}s) state=${JSON.stringify(last?.hint ?? null).slice(0, 160)}`)
    await sleep(intervalMs)
  }
  return { ok: false, value: last?.value ?? null, hint: last?.hint ?? null }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function approveLowRisk(scenario) {
  const approvals = await page.evaluate(async (id) => window.projectos.approvals.list({ projectId: id, runId: null }), scenario.projectId)
  const pending = approvals.approvals.filter((item) => item.status === 'pending')
  let approved = 0
  for (const approval of pending) {
    const tool = String(approval.request?.toolName ?? '')
    const command = String(approval.request?.args?.command ?? '')
    const path = String(approval.request?.args?.path ?? '')
    const safe = (tool === 'write_file' && /^(src|tests)\//.test(path))
      || (['run_command', 'run_tests'].includes(tool) && /node|npm|npx|pnpm|test|tsc|git\s+(rev-parse|status|diff|log)/i.test(command))
    if (!safe) continue
    await page.evaluate(async (id) => window.projectos.approvals.decide({ approvalId: id, decision: 'approved', note: '隔离多 Agent 验收：低风险 src 写入 / 测试命令' }), approval.id)
    approved += 1
    scenario.toolApprovals += 1
  }
  return approved
}

async function createAgent(projectId, name, role) {
  return page.evaluate(async ({ projectId, name, role }) => window.projectos.agentDefinitions.upsert({
    name, role, description: `Phase 2.8.1 ${name}`, category: 'engineering',
    persona: { role, systemPrompt: `你是真实 ${name}。只做任务要求的最小工作；需要修改文件时使用 write_file。` },
    skillIds: [], runtimeProfileIds: [], primaryRuntimeProfileId: null, modelRef: null,
    permissions: { tools: [], files: true, shell: true, network: false }, ownerProjectId: projectId,
  }), { projectId, name, role })
}

function writeProject(workspace, { broken }) {
  mkdirSync(join(workspace, 'src'), { recursive: true })
  mkdirSync(join(workspace, 'tests'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({
    name: 'p281-multi', private: true, type: 'module',
    scripts: { test: 'node --test tests/*.test.mjs' },
  }, null, 2))
  writeFileSync(join(workspace, 'README.md'), '# Phase 2.8.1 multi-agent project\n')
  writeFileSync(join(workspace, 'src', 'math.mjs'), 'export function add(a, b) {\n  return a + b\n}\n')
  writeFileSync(join(workspace, 'tests', 'math.test.mjs'), [
    "import test from 'node:test'",
    "import assert from 'node:assert/strict'",
    "import { add } from '../src/math.mjs'",
    '',
    "test('add sums two numbers', () => {",
    '  assert.equal(add(2, 3), 5)',
    '})',
    '',
  ].join('\n'))
  if (broken) {
    // Deterministic real bug: slugify keeps uppercase and spaces, the test asserts the
    // documented contract. `npm test` genuinely fails until the source is corrected.
    writeFileSync(join(workspace, 'src', 'slug.mjs'), [
      'export function slugify(input) {',
      '  // BUG: does not lowercase and does not replace spaces with dashes',
      '  return input.trim()',
      '}',
      '',
    ].join('\n'))
    writeFileSync(join(workspace, 'tests', 'slug.test.mjs'), [
      "import test from 'node:test'",
      "import assert from 'node:assert/strict'",
      "import { slugify } from '../src/slug.mjs'",
      '',
      "test('slugify lowercases and dashes spaces', () => {",
      "  assert.equal(slugify('Hello World'), 'hello-world')",
      '})',
      '',
    ].join('\n'))
  }
}

async function bootstrap({ name, scenario, broken }) {
  const workspace = join(dataDir, `ws-${scenario}`)
  writeProject(workspace, { broken })
  git(workspace, ['init', '-q'])
  git(workspace, ['config', 'user.email', 'e2e@projectos.local'])
  git(workspace, ['config', 'user.name', 'ProjectOS E2E'])
  git(workspace, ['add', '-A'])
  git(workspace, ['commit', '-qm', 'fixture'])
  const project = await page.evaluate(async ({ workspace, name }) => (await window.projectos.projects.create({ name, description: 'Phase 2.8.1 real multi-agent', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace, name })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  const developer = await createAgent(project.id, `P281 Developer ${scenario}`, '开发工程师')
  const tester = await createAgent(project.id, `P281 Tester ${scenario}`, '测试工程师')
  return { projectId: project.id, workspace, developer, tester, toolApprovals: 0, planId: null }
}

/** Plans, assigns two agents, approves, issues ONE scoped grant, starts, waits. */
async function runMultiAgent(ctx, { goal, allowedPaths, timeoutMs, label }) {
  const draft = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, { mode: 'ai', allowRuleFallback: false, maxTasks: 2 }), { projectId: ctx.projectId, goal })
  record(label, '真实 Planner 生成计划', draft.generatedBy === 'provider' ? 'PASS' : 'FAIL', `source=${draft.generatedBy} tasks=${draft.tasks.length} model=${draft.generation?.model ?? ''}`)
  if (draft.tasks.length < 2) return { ok: false, reason: `planner produced ${draft.tasks.length} task(s)` }

  const developerTask = draft.tasks.find((task) => task.role === 'developer') ?? draft.tasks[0]
  const downstreamTask = draft.tasks.find((task) => task.key !== developerTask.key)
  const assigned = await page.evaluate(async ({ planId, developerId, testerId, downstreamKey }) => {
    const plan = await window.projectos.plans.get(planId)
    return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({ ...task, agentId: task.key === downstreamKey ? testerId : developerId })) })
  }, { planId: draft.id, developerId: ctx.developer.id, testerId: ctx.tester.id, downstreamKey: downstreamTask.key })
  const agentIds = new Set(assigned.tasks.map((task) => task.agentId))
  record(label, '两个不同 AgentDefinition 参与', agentIds.size === 2 ? 'PASS' : 'FAIL', `agents=${agentIds.size}`)
  record(label, '任务存在上下游依赖', assigned.tasks.some((task) => task.dependsOn.length > 0) ? 'PASS' : 'FAIL', JSON.stringify(assigned.tasks.map((t) => `${t.key}<-${t.dependsOn.join('|')}`)))

  const approved = await page.evaluate(async (id) => window.projectos.plans.approve(id), assigned.id)
  const grant = await page.evaluate(async ({ planId, allowedPaths }) => window.projectos.plans.grant.issue({
    planId, actions: ['plan.start', 'workspace-write'], allowedPaths,
    maxRuns: 4, maxToolCalls: 60, ttlHours: 2, allowOverBudget: false,
    note: 'Phase 2.8.1 一次性范围授权', confirm: true,
  }), { planId: approved.plan.id, allowedPaths })
  ctx.planId = approved.plan.id
  record(label, '一次授权（PlanGrant）', grant?.valid ? 'PASS' : 'FAIL', `grant=${grant?.id} paths=${allowedPaths.join(',')}`)


  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: approved.plan.id, grantId: grant?.id })

  const waited = await waitFor(`${label} plan terminal`, async () => {
    await approveLowRisk(ctx)
    const plan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
    const status = plan.execution?.status ?? 'draft'
    return { done: ['completed', 'failed', 'cancelled'].includes(status), value: plan, hint: { status, error: plan.execution?.error ?? null } }
  }, { timeoutMs })
  const plan = waited.value
  record(label, '计划到达终态（有界等待）', waited.ok ? 'PASS' : 'FAIL', `status=${plan?.execution?.status ?? 'timeout'} error=${String(plan?.execution?.error ?? '').slice(0, 160)}`)
  return { ok: waited.ok, plan, grantId: grant?.id, approved }
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
  if (!providerAvailable) {
    record('setup', '真实 Provider', 'BLOCKED', '未找到 provider.json')
    return summarise()
  }
  const connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  record('setup', '真实 Provider 就绪', connections.connections.length > 0 ? 'PASS' : 'FAIL', connections.connections[0]?.defaultModelId ?? 'none')
  if (connections.connections.length === 0) return summarise()

  // ---------------- Scenario A: normal multi-Agent delivery ----------------
  const A = await bootstrap({ name: 'Phase 2.8.1 A 正常多 Agent 交付', scenario: 'a', broken: false })
  const runA = await runMultiAgent(A, {
    goal: '先在 src/math.mjs 之外新增公开资源判定函数 canView(user, resource) 到 src/permission.mjs（public 资源任何人可见、私有资源仅属主可见、无权限返回 false）；然后由独立测试角色运行 npm test 并验证 canView 的三类行为，两个任务必须有上下游依赖。',
    allowedPaths: ['src', 'tests'],
    timeoutMs: 900_000,
    label: 'A',
  })
  const worktreeA = runA.plan?.execution?.workspaceRef ?? A.workspace
  const filesA = execFileSync('git', ['status', '--porcelain'], { cwd: worktreeA, encoding: 'utf8' })
  record('A', '真实代码改动落盘', filesA.trim().length > 0 ? 'PASS' : 'FAIL', `wt=${worktreeA.split(/[\\/]/).slice(-1)[0]} :: ${filesA.trim().split('\n').slice(0, 4).join(' | ').slice(0, 200)}`)
  const runsA = await page.evaluate(async (id) => window.projectos.runs.list(id, 50), A.projectId)
  const listA = runsA.runs ?? runsA
  record('A', '真实 Run 数量', listA.length > 0 ? 'PASS' : 'FAIL', `runs=${listA.length}`)
  const distinctAgentsA = new Set(listA.map((run) => run.agentId))
  record('A', '两个 Agent 都真实执行过', distinctAgentsA.size >= 2 ? 'PASS' : 'FAIL', `distinctAgents=${distinctAgentsA.size}`)
  record('A', '计划完成', runA.plan?.execution?.status === 'completed' ? 'PASS' : 'FAIL', `status=${runA.plan?.execution?.status}`)
  const approvalsA = await page.evaluate(async (id) => window.projectos.approvals.list({ projectId: id, runId: null }), A.projectId)
  const totalApprovalsA = approvalsA.approvals.length
  const byToolA = approvalsA.approvals.reduce((acc, item) => {
    const tool = String(item.request?.toolName ?? 'unknown')
    acc[tool] = (acc[tool] ?? 0) + 1
    return acc
  }, {})
  const writeApprovalsA = byToolA.write_file ?? 0
  record('A', '人工介入统计', 'INFO', `计划授权=1 工具审批=${totalApprovalsA} 次（${Object.entries(byToolA).map(([k, v]) => `${k}:${v}`).join(' ')}）`)
  record('A', '授权范围内写入未重复审批', writeApprovalsA === 0 ? 'PASS' : 'FAIL', `write_file 审批=${writeApprovalsA}（PlanGrant allowedPaths=[src] 应覆盖）`)

  // ---------------- Scenario B: deterministic failure -> replan -> fix ----------------
  const B = await bootstrap({ name: 'Phase 2.8.1 B 确定性失败自动修复', scenario: 'b', broken: true })
  const beforeB = (() => { try { execFileSync('npm', ['test'], { cwd: B.workspace, encoding: 'utf8', shell: true }); return 0 } catch (error) { return error.status ?? 1 } })()
  record('B', '夹具真实失败（npm test 退出码非 0）', beforeB !== 0 ? 'PASS' : 'FAIL', `exit=${beforeB}`)
  const runB = await runMultiAgent(B, {
    goal: '仓库里 npm test 当前失败：tests/slug.test.mjs 要求 slugify("Hello World") === "hello-world"，但 src/slug.mjs 的实现不符合该契约。先让开发角色修复 src/slug.mjs，再由独立测试角色运行 npm test 并确认全部通过。两个任务必须有上下游依赖。',
    allowedPaths: ['src', 'tests'],
    timeoutMs: 900_000,
    label: 'B',
  })
  const wtB = runB.plan?.execution?.workspaceRef ?? B.workspace
  const inWorktreeB = (() => { try { execFileSync('npm', ['test'], { cwd: wtB, encoding: 'utf8', shell: true }); return 0 } catch (error) { return error.status ?? 1 } })()
  record('B', '修复在 Worktree 内通过 npm test', inWorktreeB === 0 ? 'PASS' : 'FAIL', `wt=${String(wtB).split(/[\\/]/).pop()} exit=${inWorktreeB}`)
  let merged = null
  try {
    merged = await page.evaluate(async (id) => window.projectos.worktrees.merge(id), B.planId)
  } catch (error) {
    record('B', '合并 Worktree 到主工作区', 'FAIL', String(error).slice(0, 160))
  }
  const afterB = (() => { try { execFileSync('npm', ['test'], { cwd: B.workspace, encoding: 'utf8', shell: true }); return 0 } catch (error) { return error.status ?? 1 } })()
  record('B', '合并后主工作区 npm test 通过', merged ? (afterB === 0 ? 'PASS' : 'FAIL') : 'FAIL', `merged=${Boolean(merged)} exit=${afterB}`)
  const proposalsB = await page.evaluate(async (id) => (await window.projectos.plans.replan.list(id)).proposals, B.projectId)
  record('B', 'Replanner 提案（仅当首轮失败时需要）', 'INFO', `proposals=${proposalsB.length} planStatus=${runB.plan?.execution?.status}`)
  record('B', '计划完成', runB.plan?.execution?.status === 'completed' ? 'PASS' : 'FAIL', `status=${runB.plan?.execution?.status} error=${String(runB.plan?.execution?.error ?? '').slice(0, 140)}`)

  record('setup', '渲染进程无 console error', errors.length === 0 ? 'PASS' : 'FAIL', errors.slice(0, 3).join(' | ').slice(0, 200))
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/work` }, { projectId: A.projectId }).catch(() => undefined)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(shots, 'p281-01-work-center.png') }).catch(() => undefined)
  summarise()
}

function summarise() {
  const failed = results.filter((item) => item.status === 'FAIL')
  const blocked = results.filter((item) => item.status === 'BLOCKED')
  console.log('\n===== PHASE 2.8.1 MULTI-AGENT CLOSURE =====')
  for (const item of results) console.log(`${item.status}\t[${item.scenario}] ${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} BLOCKED=${blocked.length} INFO=${results.filter((i) => i.status === 'INFO').length}`)
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
  .finally(async () => {
    try { await app?.close() } catch { /* ignore */ }
  })
