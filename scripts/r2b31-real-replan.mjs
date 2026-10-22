/**
 * Phase 2B-3.1 real-provider automatic Replan proposal probe.
 * A real project intentionally has no test script, so the developer quality gate
 * fails through the real Scheduler; the resulting failure must auto-trigger a
 * real Provider Replanner proposal (not a direct ReplanService call).
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'r2b3')
mkdirSync(shots, { recursive: true })
const sourceProvider = join(process.env.APPDATA ?? '', 'ProjectOS', 'data', 'provider.json')
if (!existsSync(sourceProvider)) { console.log('SKIPPED (blocked): no authorized provider config'); process.exit(0) }
const providerConfig = JSON.parse(readFileSync(sourceProvider, 'utf8'))
if (!providerConfig.encryptedApiKey) { console.log('SKIPPED (blocked): no encrypted API key'); process.exit(0) }
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b31-real-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b31-real-user-'))
writeFileSync(join(dataDir, 'provider.json'), JSON.stringify({ ...providerConfig, connectionsMigrated: false }, null, 2))
const localState = join(process.env.APPDATA ?? '', 'ProjectOS', 'Local State')
if (existsSync(localState)) copyFileSync(localState, join(userDataDir, 'Local State'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const evidence = { capturedAt: new Date().toISOString() }
let app = null
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.focus(); w.moveTop() })
  await page.waitForTimeout(3600)
  let connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  for (let i = 0; i < 20 && connections.connections.length === 0; i += 1) { await page.waitForTimeout(500); connections = await page.evaluate(async () => window.projectos.aiConnections.list()) }
  if (!connections.connections.length) throw new Error('real provider connection missing')
  const connection = connections.connections.find((c) => c.id === connections.defaultId) ?? connections.connections[0]
  evidence.connection = { name: connection.name, model: connection.defaultModelId }

  const workspace = join(dataDir, 'real-replan-project')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  // Intentionally no test script: real quality gate must fail deterministically.
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'r2b31-real-replan', private: true, scripts: { build: 'node -e "process.exit(0)"' } }, null, 2))
  writeFileSync(join(workspace, 'README.md'), '# real replan probe\n')
  const project = await page.evaluate(async ({ workspace }) => (await window.projectos.projects.create({ name: 'R2B31 Real Replan', description: 'real replanner probe', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  const goal = '在 src/permission.ts 实现一个简单的 canView(user, resource) 权限检查函数，并读取文件确认内容；只做这个最小变更。'
  const draft = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, { mode: 'ai', allowRuleFallback: false, maxTasks: 1 }), { projectId: project.id, goal })
  if (draft.generatedBy !== 'provider') throw new Error(`Planner source=${draft.generatedBy}`)
  const approved = await page.evaluate(async (id) => window.projectos.plans.approve(id), draft.id)
  const grant = await page.evaluate(async (id) => window.projectos.plans.grant.issue({ planId: id, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src'], maxRuns: 1, maxToolCalls: 30, ttlHours: 2, allowOverBudget: false, note: 'real replanner probe', confirm: true }), approved.plan.id)
  evidence.plan = { id: draft.id, tasks: draft.tasks.map((t) => ({ key: t.key, title: t.title, role: t.role })), generatedBy: draft.generatedBy, model: draft.generation?.model }
  evidence.grant = { id: grant.id, maxRuns: grant.maxRuns, paths: grant.allowedPaths }
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(800)
  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: approved.plan.id, grantId: grant.id })
  let plan = null
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000)
    plan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
    const approvals = await page.evaluate(async (projectId) => window.projectos.approvals.list({ projectId, runId: null }), project.id)
    for (const approval of approvals.approvals.filter((item) => item.status === 'pending')) {
      const toolName = String(approval.request?.toolName ?? '')
      const command = String(approval.request?.command ?? approval.request?.args?.command ?? '')
      const path = String(approval.request?.args?.path ?? '')
      if (
        (toolName === 'run_command' && /node|npm|npx|pnpm|test|tsc|dir\s|type\s|where\s|Get-ChildItem|Test-Path/i.test(command)) ||
        (toolName === 'write_file' && /^src\//.test(path) && !/(^|\/)(package\.json|\.env|auth|migrations)/i.test(path))
      ) {
        await page.evaluate(async (approvalId) => window.projectos.approvals.decide({ approvalId, decision: 'approved', note: '隔离测试中允许低风险 src 文件写入/只读命令' }), approval.id)
      }
    }
    if (plan.execution?.status === 'failed' || plan.execution?.status === 'paused') break
  }
  evidence.execution = { status: plan?.execution?.status ?? null, error: plan?.execution?.error ?? null, runIds: plan?.execution?.runIds ?? [] }
  let proposals = []
  const proposalDeadline = Date.now() + 180_000
  let lastLog = 0
  while (Date.now() < proposalDeadline) {
    proposals = await page.evaluate(async (projectId) => (await window.projectos.plans.replan.list(projectId)).proposals, project.id)
    if (Date.now() - lastLog > 15_000) {
      console.log(`[r2b31] waiting for proposal; plan=${plan?.execution?.status} proposals=${proposals.length}`)
      lastLog = Date.now()
    }
    if (proposals.length > 0) break
    await page.waitForTimeout(1000)
  }
  evidence.proposals = proposals
  evidence.errors = errors.slice(0, 10)
  await page.screenshot({ path: join(shots, 'real-replan-proposal.png') })
  writeFileSync(join(shots, 'real-replan.json'), JSON.stringify(evidence, null, 2))
  const proposal = proposals[0]
  const checks = [
    ['real Planner generated plan', draft.generatedBy === 'provider'],
    ['real Scheduler failure recorded', plan?.execution?.status === 'failed'],
    ['automatic trigger produced a proposal', Boolean(proposal) && proposal.status === 'proposed'],
    ['proposal came from real Provider Replanner', proposal?.generation?.mode === 'provider'],
    ['real Replanner used execution context', (proposal?.contextChars ?? 0) > 0],
    ['proposal has valid DAG and tasks', Boolean(proposal?.proposedTasks?.length)],
    ['no plan mutation before apply', (await page.evaluate(async (projectId) => (await window.projectos.plans.list(projectId)).plans.length, project.id)) === 1],
    ['no renderer errors', errors.length === 0],
  ]
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1
  else console.log(`\nR2B31 REAL REPLAN PASS — ${checks.length} checks, evidence in ${shots}`)
} catch (error) {
  console.error('R2B31 REAL REPLAN FAIL —', error)
  if (app) { try { const p = await app.firstWindow(); await p.screenshot({ path: join(shots, 'real-replan-failure.png') }) } catch { /* ignore */ } }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
