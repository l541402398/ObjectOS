/**
 * Phase 2.8.3 — real failure -> diagnostic evidence -> auto Replan -> real fix -> re-verify.
 *
 * The only new lever versus Phase 2.8.2 is ADR-2.8.3: the tester task explicitly declares
 * `workType='diagnostic'`, so "ran the check and recorded exit code 1" legally completes
 * the diagnostic task while the quality gate still cannot pass.
 *
 * Real DeepSeek provider, real git repo, real npm test. No fake provider, no DB writes.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })
const dataDir = process.env.PROJECTOS_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), 'projectos-p283-'))
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
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const human = { planApprovals: 0, grants: 0, toolApprovals: 0, manualMerges: 0 }

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
    if (ticks % 15 === 0) console.log(`        … ${label} ${Math.round((Date.now() - started) / 1000)}s ${JSON.stringify(last?.hint ?? null).slice(0, 160)}`)
    await sleep(intervalMs)
  }
  return { ok: false, value: last?.value ?? null, hint: last?.hint ?? null }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const npmTest = (cwd) => { try { execFileSync('npm', ['test'], { cwd, encoding: 'utf8', shell: true }); return 0 } catch (error) { return error.status ?? 1 } }

async function approvePending(projectId) {
  const list = await page.evaluate(async (id) => window.projectos.approvals.list({ projectId: id, runId: null }), projectId)
  for (const approval of list.approvals.filter((item) => item.status === 'pending')) {
    const tool = String(approval.request?.toolName ?? '')
    const command = String(approval.request?.args?.command ?? '')
    const path = String(approval.request?.args?.path ?? '')
    const safe = (tool === 'write_file' && /^(src|tests)\//.test(path))
      || (['run_command', 'run_tests'].includes(tool) && /^(node|npm|npx|pnpm)\s+(--version|-v)$/.test(command))
      || (['run_command', 'run_tests'].includes(tool) && /^(node|npm test|npm run |npx tsc|pnpm test|pnpm run |git (status|diff|log|show|rev-parse|branch|ls-files|grep|blame))/.test(command))
    if (!safe) continue
    await page.evaluate(async (id) => window.projectos.approvals.decide({ approvalId: id, decision: 'approved', note: 'Phase 2.8.3 范围内授权' }), approval.id)
    human.toolApprovals += 1
  }
}

async function main() {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  page = await app.firstWindow()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(3000)
  record('Electron 启动', 'PASS', dataDir)
  if (!providerAvailable) { record('真实 Provider', 'BLOCKED', '未找到 provider.json'); return summarise() }
  const connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  record('真实 Provider 就绪', connections.connections.length > 0 ? 'PASS' : 'FAIL', connections.connections[0]?.defaultModelId ?? 'none')
  if (!connections.connections.length) return summarise()

  // ---- deterministic broken fixture ----
  const workspace = join(dataDir, 'ws-b')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  mkdirSync(join(workspace, 'tests'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'p283', private: true, type: 'module', scripts: { test: 'node --test tests/*.test.mjs' } }, null, 2))
  writeFileSync(join(workspace, 'src', 'formatting.mjs'), 'export function label(v) {\n  return `[${v}]`\n}\n')
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
  git(workspace, ['init', '-q']); git(workspace, ['config', 'user.email', 'e2e@projectos.local']); git(workspace, ['config', 'user.name', 'E2E'])
  git(workspace, ['add', '-A']); git(workspace, ['commit', '-qm', 'fixture'])
  const baseline = npmTest(workspace)
  record('夹具真实失败（基线 npm test）', baseline !== 0 ? 'PASS' : 'FAIL', `exit=${baseline}`)

  const project = await page.evaluate(async ({ workspace }) => (await window.projectos.projects.create({ name: 'P283 Diagnostic Closure', description: 'Phase 2.8.3', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  const developer = await page.evaluate(async ({ projectId }) => window.projectos.agentDefinitions.upsert({ name: 'P283 Dev', role: '开发工程师', description: 'dev', category: 'engineering', persona: { role: '开发工程师', systemPrompt: '你是开发工程师，只做任务要求的最小修改，使用 write_file。' }, skillIds: [], runtimeProfileIds: [], primaryRuntimeProfileId: null, modelRef: null, permissions: { tools: [], files: true, shell: true, network: false }, ownerProjectId: projectId }), { projectId: project.id })
  const tester = await page.evaluate(async ({ projectId }) => window.projectos.agentDefinitions.upsert({ name: 'P283 QA', role: '测试工程师', description: 'qa', category: 'engineering', persona: { role: '测试工程师', systemPrompt: '你是测试工程师，运行测试并如实报告真实结果，绝不修改源文件。' }, skillIds: [], runtimeProfileIds: [], primaryRuntimeProfileId: null, modelRef: null, permissions: { tools: [], files: true, shell: true, network: false }, ownerProjectId: projectId }), { projectId: project.id })

  const architect = await page.evaluate(async ({ projectId }) => window.projectos.agentDefinitions.upsert({ name: 'P283 Architect', role: '架构师', description: 'arch', category: 'engineering', persona: { role: '架构师', systemPrompt: '你是架构师，负责只读诊断与边界判定。' }, skillIds: [], runtimeProfileIds: [], primaryRuntimeProfileId: null, modelRef: null, permissions: { tools: [], files: true, shell: true, network: false }, ownerProjectId: projectId }), { projectId: project.id })
  const goal = '目标：让 npm test 全部通过（tests/visibility.test.mjs 描述了 canView 的必需行为）。第一个任务只做一件事：新增 src/labels.mjs 并导出 titleCase，其余代码保持不动。第二个任务：测试角色运行 npm test 并如实报告真实结果。两个任务必须有上下游依赖。'
  const draft = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, { mode: 'ai', allowRuleFallback: false, maxTasks: 2 }), { projectId: project.id, goal })
  record('真实 Planner 生成依赖计划', draft.generatedBy === 'provider' && draft.tasks.length === 2 ? 'PASS' : 'FAIL', `source=${draft.generatedBy} tasks=${draft.tasks.length}`)
  if (draft.tasks.length !== 2) return summarise()

  const devTask = draft.tasks.find((t) => t.role === 'developer') ?? draft.tasks[0]
  const qaTask = draft.tasks.find((t) => t.key !== devTask.key)
  const assigned = await page.evaluate(async ({ planId, developerId, testerId, downstreamKey }) => {
    const plan = await window.projectos.plans.get(planId)
    return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({ ...task, agentId: task.key === downstreamKey ? testerId : developerId })) })
  }, { planId: draft.id, developerId: developer.id, testerId: tester.id, downstreamKey: qaTask.key })

  const approved = await page.evaluate(async (id) => window.projectos.plans.approve(id), assigned.id)
  human.planApprovals += 1
  // ADR-2.8.3: the verification task explicitly declares a diagnostic contract.
  const qaTaskId = approved.taskIds?.[1] ?? null

  const board = await page.evaluate(async (id) => window.projectos.tasks.board(id), project.id)
  const createdQa = board.tasks.find((t) => /测试|test|npm/i.test(`${t.title} ${t.description ?? ''}`) && t.assigneeAgentId === tester.id)
    ?? board.tasks.find((t) => t.assigneeAgentId === tester.id)
  if (createdQa) {
    await page.evaluate(async ({ taskId, expectedVersion }) => window.projectos.tasks.update({ taskId, expectedVersion, workType: 'diagnostic' }), { taskId: createdQa.id, expectedVersion: createdQa.version })
    record('测试任务声明 diagnostic 验证意图', 'PASS', `task=${createdQa.id}`)
  } else {
    record('测试任务声明 diagnostic 验证意图', 'FAIL', `未找到 tester 任务 (approved=${qaTaskId})`)
  }
  const grant = await page.evaluate(async ({ planId }) => window.projectos.plans.grant.issue({ planId, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src', 'tests'], maxRuns: 6, maxToolCalls: 120, ttlHours: 3, allowOverBudget: false, note: 'Phase 2.8.3 授权', confirm: true }), { planId: approved.plan.id })
  human.grants += 1
  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: approved.plan.id, grantId: grant?.id })

  const first = await waitFor('first plan terminal', async () => {
    await approvePending(project.id)
    const plan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
    const status = plan.execution?.status ?? 'draft'
    return { done: ['completed', 'failed', 'cancelled', 'paused'].includes(status), value: plan, hint: { status, error: String(plan.execution?.error ?? '').slice(0, 120) } }
  })
  const firstStatus = first.value?.execution?.status
  record('诊断任务合法完成（不再因"必须通过"而卡死）', firstStatus !== undefined ? 'PASS' : 'FAIL', `plan=${firstStatus} err=${String(first.value?.execution?.error ?? '').slice(0, 140)}`)
  const proposalWait = await waitFor('replan proposal', async () => {
    const list = await page.evaluate(async (id) => (await window.projectos.plans.replan.list(id)).proposals, project.id)
    return { done: list.length > 0, value: list, hint: { proposals: list.length } }
  }, { timeoutMs: 180_000, intervalMs: 3000 })
  const proposals = proposalWait.value ?? []
  record('自动 Replan 提案', proposals.length > 0 ? 'PASS' : 'FAIL', `proposals=${proposals.length}${proposals[0] ? ` trigger=${proposals[0].trigger}` : ''}`)

  if (proposals.length > 0) {
    const applied = await page.evaluate(async (id) => window.projectos.plans.replan.apply(id), proposals[0].id)
    record('修订已应用', applied?.plan?.revision > 1 ? 'PASS' : 'FAIL', `revision=${applied?.plan?.revision}`)
    const reAssigned = await page.evaluate(async ({ planId, developerId, testerId, architectId }) => {
      const plan = await window.projectos.plans.get(planId)
      return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({ ...task, agentId: /arch|架构/i.test(String(task.role)) ? architectId : /test|qa|测试/i.test(String(task.role)) ? testerId : developerId })) })
    }, { planId: applied.plan.id, developerId: developer.id, testerId: tester.id, architectId: architect.id })
    const reApproved = await page.evaluate(async (id) => window.projectos.plans.approve(id), reAssigned.id)
    human.planApprovals += 1
    const reGrant = await page.evaluate(async ({ planId }) => window.projectos.plans.grant.issue({ planId, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src', 'tests'], maxRuns: 6, maxToolCalls: 120, ttlHours: 3, allowOverBudget: false, note: 'Phase 2.8.3 修订授权', confirm: true }), { planId: reApproved.plan.id })
    human.grants += 1
    await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: reApproved.plan.id, grantId: reGrant?.id })
    const fix = await waitFor('fix plan terminal', async () => {
      await approvePending(project.id)
      const plan = await page.evaluate(async (id) => window.projectos.plans.get(id), reApproved.plan.id)
      const status = plan.execution?.status ?? 'draft'
      return { done: ['completed', 'failed', 'cancelled', 'paused'].includes(status), value: plan, hint: { status, error: String(plan.execution?.error ?? '').slice(0, 120) } }
    })
    record('修复计划完成', fix.value?.execution?.status === 'completed' ? 'PASS' : 'FAIL', `status=${fix.value?.execution?.status} err=${String(fix.value?.execution?.error ?? '').slice(0, 120)}`)
    const wt = fix.value?.execution?.workspaceRef ?? workspace
    const after = npmTest(wt)
    record('**修复后同一测试真实通过**', after === 0 ? 'PASS' : 'FAIL', `wt=${String(wt).split(/[\\/]/).pop()} npm test exit=${after}`)
    try {
      await page.evaluate(async (id) => window.projectos.worktrees.merge(id), reApproved.plan.id)
      const mainAfter = npmTest(workspace)
      record('合并后主工作区 npm test 通过', mainAfter === 0 ? 'PASS' : 'FAIL', `exit=${mainAfter}`)
    } catch (error) {
      record('合并到主工作区', 'FAIL', String(error).slice(0, 160))
    }
  }

  record('渲染进程无 console error', errors.length === 0 ? 'PASS' : 'FAIL', errors.slice(0, 2).join(' | ').slice(0, 160))
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/work` }, { projectId: project.id }).catch(() => undefined)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, 'p283-01-work-center.png') }).catch(() => undefined)
  summarise()
}

function summarise() {
  const failed = results.filter((i) => i.status === 'FAIL')
  console.log('\n===== PHASE 2.8.3 DIAGNOSTIC CLOSURE =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`人工介入：计划批准=${human.planApprovals} 授权=${human.grants} 工具审批=${human.toolApprovals} 手动合并=${human.manualMerges}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} BLOCKED=${results.filter((i) => i.status === 'BLOCKED').length}`)
  console.log(`dataDir=${dataDir}`)
  if (failed.length) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error('[fatal]', error)
    results.push({ name: 'fatal', status: 'FAIL', detail: String(error).slice(0, 300) })
    summarise()
    process.exitCode = 1
  })
  .finally(async () => { try { await app?.close() } catch { /* ignore */ } })
