/**
 * Phase 2B-3.2 real failure -> auto Replan -> applied revision -> new grant ->
 * execution -> completed closure, using a real Planner/Replanner and a real
 * AgentDefinition (disabled to create a deterministic recoverable failure).
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
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b32-real-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b32-real-user-'))
writeFileSync(join(dataDir, 'provider.json'), JSON.stringify({ ...providerConfig, connectionsMigrated: false }, null, 2))
const localState = join(process.env.APPDATA ?? '', 'ProjectOS', 'Local State')
if (existsSync(localState)) copyFileSync(localState, join(userDataDir, 'Local State'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const evidence = { capturedAt: new Date().toISOString(), dataDir }
let app = null

async function approveSafe(page, projectId) {
  const approvals = await page.evaluate(async (id) => window.projectos.approvals.list({ projectId: id, runId: null }), projectId)
  for (const approval of approvals.approvals.filter((item) => item.status === 'pending')) {
    const toolName = String(approval.request?.toolName ?? '')
    const path = String(approval.request?.args?.path ?? '')
    const command = String(approval.request?.args?.command ?? '')
    if (
      (toolName === 'write_file' && /^src\//.test(path)) ||
      ((toolName === 'run_command' || toolName === 'run_tests') && /node|npm|npx|pnpm|test|tsc|dir\s|type\s|git\s+(rev-parse|status|diff|log|show)/i.test(command))
    ) {
      await page.evaluate(async (approvalId) => window.projectos.approvals.decide({ approvalId, decision: 'approved', note: '隔离闭环测试：允许低风险 src 写入/只读测试命令' }), approval.id)
    }
  }
}

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

  const workspace = join(dataDir, 'closure-project')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'r2b32-closure', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2))
  writeFileSync(join(workspace, 'README.md'), '# closure\n')
  // Seed the target module so the Agent extends an existing contract instead of
  // stopping because the file is missing. The implementation remains the Agent's.
  writeFileSync(join(workspace, 'src/permission.ts'), [
    'export interface User { id: string; permissions?: string[]; roles?: string[] }',
    'export interface Resource { id: string; ownerId?: string; visibility?: "public" | "private" }',
    '',
    '// Minimal placeholder; the assigned Agent must implement the approved contract.',
    'export function canView(_user: User | null | undefined, _resource: Resource | null | undefined): boolean {',
    '  return false',
    '}',
    '',
  ].join('\n'))
  const project = await page.evaluate(async ({ workspace }) => (await window.projectos.projects.create({ name: 'R2B32 Real Closure', description: 'real failure replan closure', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  const agent = await page.evaluate(async (projectId) => window.projectos.agentDefinitions.upsert({
    name: 'Closure Developer',
    role: '开发工程师',
    description: 'Phase 2B-3.2 closure developer',
    category: 'engineering',
    persona: { role: '开发工程师', systemPrompt: '你是真实开发 Agent，只做任务要求的低风险文件实现。' },
    skillIds: [],
    runtimeProfileIds: [],
    primaryRuntimeProfileId: null,
    modelRef: null,
    permissions: { tools: [], files: true, shell: true, network: false },
    ownerProjectId: projectId,
  }), project.id)
  evidence.agent = { id: agent.id, name: agent.name, role: agent.role, status: agent.status }

  const goal = '在 src/permission.ts 实现一个简单的 canView(user, resource) 函数，并读取文件确认内容；只做这个最小变更。'
  const draft = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, { mode: 'ai', allowRuleFallback: false, maxTasks: 1 }), { projectId: project.id, goal })
  if (draft.generatedBy !== 'provider') throw new Error(`Planner source=${draft.generatedBy}`)
  const assigned = await page.evaluate(async ({ planId, agentId }) => {
    const plan = await window.projectos.plans.get(planId)
    return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({ ...task, agentId })) })
  }, { planId: draft.id, agentId: agent.id })
  const approved = await page.evaluate(async (id) => window.projectos.plans.approve(id), assigned.id)
  const grant = await page.evaluate(async (id) => window.projectos.plans.grant.issue({ planId: id, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src'], maxRuns: 2, maxToolCalls: 30, ttlHours: 2, allowOverBudget: false, note: 'real closure initial grant', confirm: true }), approved.plan.id)
  evidence.initial = { planId: approved.plan.id, taskIds: approved.taskIds, grantId: grant.id, agentId: agent.id, tasks: draft.tasks.length }

  // Deterministic recoverable failure: the assigned AgentDefinition becomes unavailable.
  await page.evaluate(async (agentId) => window.projectos.agentDefinitions.setStatus(agentId, 'disabled'), agent.id)
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(700)
  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: approved.plan.id, grantId: grant.id })
  let failedPlan = null
  const failDeadline = Date.now() + 180_000
  while (Date.now() < failDeadline) {
    await page.waitForTimeout(1000)
    failedPlan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
    await approveSafe(page, project.id)
    if (failedPlan.execution?.status === 'failed') break
  }
  evidence.failure = { status: failedPlan?.execution?.status ?? null, error: failedPlan?.execution?.error ?? null, runIds: failedPlan?.execution?.runIds ?? [] }
  if (failedPlan?.execution?.status !== 'failed') throw new Error(`expected failed plan, got ${failedPlan?.execution?.status}`)

  let proposals = []
  const replanDeadline = Date.now() + 180_000
  while (Date.now() < replanDeadline) {
    proposals = await page.evaluate(async (projectId) => (await window.projectos.plans.replan.list(projectId)).proposals, project.id)
    if (proposals.length > 0) break
    await page.waitForTimeout(1000)
  }
  const proposal = proposals[0]
  if (!proposal) throw new Error('automatic Replan proposal missing')
  evidence.proposal = { id: proposal.id, trigger: proposal.trigger, status: proposal.status, reason: proposal.reason, diff: proposal.diff, grantImpact: proposal.grantImpact, generation: proposal.generation }
  await page.screenshot({ path: join(shots, 'closure-proposal.png') })

  await page.evaluate(async (agentId) => window.projectos.agentDefinitions.setStatus(agentId, 'active'), agent.id)
  const applied = await page.evaluate(async (proposalId) => window.projectos.plans.replan.apply(proposalId), proposal.id)
  evidence.applied = { planId: applied.plan.id, revision: applied.plan.revision, status: applied.plan.status }
  const revisedAssigned = await page.evaluate(async ({ planId, agentId }) => {
    const plan = await window.projectos.plans.get(planId)
    return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({ ...task, agentId })) })
  }, { planId: applied.plan.id, agentId: agent.id })
  const revisedApproved = await page.evaluate(async (id) => window.projectos.plans.approve(id), revisedAssigned.id)
  const newGrant = await page.evaluate(async (id) => window.projectos.plans.grant.issue({ planId: id, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src'], maxRuns: 1, maxToolCalls: 30, ttlHours: 2, allowOverBudget: false, note: 'real closure revision grant', confirm: true }), revisedApproved.plan.id)
  evidence.revision = { planId: revisedApproved.plan.id, taskIds: revisedApproved.taskIds, grantId: newGrant.id }

  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: revisedApproved.plan.id, grantId: newGrant.id })
  let finalPlan = null
  const finalDeadline = Date.now() + 240_000
  while (Date.now() < finalDeadline) {
    await page.waitForTimeout(1000)
    finalPlan = await page.evaluate(async (id) => window.projectos.plans.get(id), revisedApproved.plan.id)
    await approveSafe(page, project.id)
    if (finalPlan.execution?.status === 'completed' || finalPlan.execution?.status === 'failed') break
  }
  await page.waitForTimeout(1500)
  finalPlan = await page.evaluate(async (id) => window.projectos.plans.get(id), revisedApproved.plan.id)
  const tasks = await page.evaluate(async (id) => (await window.projectos.tasks.board(id)).tasks, project.id)
  const runs = await page.evaluate(async (id) => (await window.projectos.runs.list(id, 50)).runs, project.id)
  const artifacts = await page.evaluate(async (id) => (await window.projectos.artifacts.list(id)).artifacts, project.id)
  const finalGrant = await page.evaluate(async (id) => window.projectos.plans.grant.get(id), revisedApproved.plan.id)
  const oldPlan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
  const oldGrant = await page.evaluate(async (id) => window.projectos.plans.grant.get(id), approved.plan.id)
  evidence.final = {
    plan: finalPlan,
    tasks,
    runs,
    artifacts: artifacts.map((a) => ({ id: a.id, taskId: a.taskId, kind: a.kind, title: a.title, verifiedAt: a.verifiedAt })),
    grant: finalGrant,
    oldPlan: { status: oldPlan.status, supersededByPlanId: oldPlan.supersededByPlanId },
    oldGrant: { status: oldGrant.status, valid: oldGrant.valid },
  }
  evidence.errors = errors.slice(0, 10)
  await page.screenshot({ path: join(shots, 'closure-completed.png') })
  writeFileSync(join(shots, 'closure.json'), JSON.stringify(evidence, null, 2))

  const checks = [
    ['initial plan approved without execution', approved.plan.execution === null],
    ['real agent failure recorded', failedPlan.execution?.status === 'failed'],
    ['automatic proposal generated', proposal.status === 'proposed'],
    ['proposal from real Provider Replanner', proposal.generation?.mode === 'provider'],
    ['revision applied as draft', applied.plan.status === 'draft' && applied.plan.revision === 2],
    ['old plan superseded', oldPlan.status === 'superseded'],
    ['old grant revoked/invalid', oldGrant.status === 'revoked' && oldGrant.valid === false],
    ['new grant active', finalGrant.valid === true],
    ['final plan completed', finalPlan?.execution?.status === 'completed'],
    ['final tasks all done', tasks.filter((task) => revisedApproved.taskIds.includes(task.id)).every((task) => task.status === 'done')],
    ['real AgentDefinition run and artifacts present', runs.length >= 1 && runs.every((run) => run.agentId === agent.id) && artifacts.length >= 1],
    ['no renderer errors', errors.length === 0],
  ]
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1
  else console.log(`\nR2B32 REAL CLOSURE PASS — ${checks.length} checks`)
} catch (error) {
  console.error('R2B32 REAL CLOSURE FAIL —', error)
  evidence.error = error instanceof Error ? error.message : String(error)
  try { writeFileSync(join(shots, 'closure-failure.json'), JSON.stringify(evidence, null, 2)) } catch { /* ignore */ }
  if (app) { try { const p = await app.firstWindow(); await p.screenshot({ path: join(shots, 'closure-failure.png') }) } catch { /* ignore */ } }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
