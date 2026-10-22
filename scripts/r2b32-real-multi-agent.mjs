/**
 * Phase 2B-3.2 real multi-Agent failure/relay closure.
 * Real DeepSeek Planner + two real AgentDefinitions (developer/tester), a real
 * downstream failure, automatic Replan, applied revision, reuse of the completed
 * upstream Task, re-authorization and final completion.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'r2b3')
mkdirSync(shots, { recursive: true })
const configPath = join(process.env.APPDATA ?? '', 'ProjectOS', 'data', 'provider.json')
if (!existsSync(configPath)) { console.log('SKIPPED (blocked): no provider config'); process.exit(0) }
const providerConfig = JSON.parse(readFileSync(configPath, 'utf8'))
if (!providerConfig.encryptedApiKey) { console.log('SKIPPED (blocked): no encrypted key'); process.exit(0) }
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b32-multi-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b32-multi-user-'))
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
    const tool = String(approval.request?.toolName ?? '')
    const command = String(approval.request?.args?.command ?? '')
    const path = String(approval.request?.args?.path ?? '')
    if (
      (tool === 'write_file' && /^src\//.test(path)) ||
      ((tool === 'run_command' || tool === 'run_tests') && /node|npm|npx|pnpm|test|tsc|dir\s|type\s|git\s+(rev-parse|status|diff|log|show)/i.test(command))
    ) {
      await page.evaluate(async (id) => window.projectos.approvals.decide({ approvalId: id, decision: 'approved', note: '隔离多 Agent 测试：允许低风险 src 写入/测试命令' }), approval.id)
    }
  }
}

async function createAgent(page, projectId, name, role) {
  return page.evaluate(async ({ projectId, name, role }) => window.projectos.agentDefinitions.upsert({
    name, role, description: `Phase 2B-3.2 ${name}`, category: 'engineering',
    persona: { role, systemPrompt: `你是真实 ${name}，只执行任务要求的最小工作。` },
    skillIds: [], runtimeProfileIds: [], primaryRuntimeProfileId: null, modelRef: null,
    permissions: { tools: [], files: true, shell: true, network: false }, ownerProjectId: projectId,
  }), { projectId, name, role })
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
  evidence.connection = { name: connections.connections[0].name, model: connections.connections[0].defaultModelId }

  const workspace = join(dataDir, 'multi-project')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'r2b32-multi', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2))
  writeFileSync(join(workspace, 'README.md'), '# multi-agent closure\n')
  writeFileSync(join(workspace, 'src/permission.ts'), [
    'export interface User { id: string; permissions?: string[]; roles?: string[] }',
    'export interface Resource { id: string; ownerId?: string; visibility?: "public" | "private" }',
    'export function canView(_user: User | null | undefined, _resource: Resource | null | undefined): boolean { return false }',
    '',
  ].join('\n'))
  const project = await page.evaluate(async ({ workspace }) => (await window.projectos.projects.create({ name: 'R2B32 Multi Agent Closure', description: 'real multi-agent relay closure', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  const developer = await createAgent(page, project.id, 'Closure Developer', '开发工程师')
  const tester = await createAgent(page, project.id, 'Closure Tester', '测试工程师')
  evidence.agents = [
    { id: developer.id, name: developer.name, role: developer.role },
    { id: tester.id, name: tester.name, role: tester.role },
  ]

  const goal = '先在 src/permission.ts 实现 canView(user, resource)，然后由独立测试角色运行 npm test 并验证 canView 的公开资源、属主、权限、拒绝四类行为；两个任务必须有上下游依赖。'
  const draft = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, { mode: 'ai', allowRuleFallback: false, maxTasks: 2 }), { projectId: project.id, goal })
  if (draft.generatedBy !== 'provider') throw new Error(`Planner source=${draft.generatedBy}`)
  if (draft.tasks.length < 2) throw new Error(`real Planner produced ${draft.tasks.length} task(s), need two`)
  const developerTask = draft.tasks.find((task) => task.role === 'developer')
  const downstreamTask = draft.tasks.find((task) => task.role !== 'developer')
  if (!developerTask || !downstreamTask) throw new Error(`Planner roles=${draft.tasks.map((task) => task.role).join(',')}`)
  const downstreamAgent = downstreamTask.role === 'tester' ? tester : tester
  const assigned = await page.evaluate(async ({ planId, developerId, testerId, downstreamKey }) => {
    const plan = await window.projectos.plans.get(planId)
    return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({
      ...task,
      agentId: task.key === downstreamKey ? testerId : developerId,
    })) })
  }, { planId: draft.id, developerId: developer.id, testerId: downstreamAgent.id, downstreamKey: downstreamTask.key })
  evidence.plan = { tasks: assigned.tasks.map((task) => ({ key: task.key, title: task.title, role: task.role, agentId: task.agentId, dependsOn: task.dependsOn })), source: assigned.generatedBy, model: assigned.generation?.model }
  const approved = await page.evaluate(async (id) => window.projectos.plans.approve(id), assigned.id)
  const grant = await page.evaluate(async (id) => window.projectos.plans.grant.issue({ planId: id, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src'], maxRuns: 2, maxToolCalls: 40, ttlHours: 2, allowOverBudget: false, note: 'multi-agent closure initial', confirm: true }), approved.plan.id)

  // Disable the downstream tester: the developer can finish, then the downstream
  // task fails for a real, recoverable Agent-unavailable reason.
  await page.evaluate(async (id) => window.projectos.agentDefinitions.setStatus(id, 'disabled'), tester.id)
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(700)
  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: approved.plan.id, grantId: grant.id })
  let failedPlan = null
  const failDeadline = Date.now() + 240_000
  while (Date.now() < failDeadline) {
    await page.waitForTimeout(1000)
    failedPlan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
    await approveSafe(page, project.id)
    if (failedPlan.execution?.status === 'failed') break
  }
  evidence.failure = { status: failedPlan?.execution?.status ?? null, error: failedPlan?.execution?.error ?? null, runIds: failedPlan?.execution?.runIds ?? [] }
  if (failedPlan?.execution?.status !== 'failed') throw new Error(`expected failed plan, got ${failedPlan?.execution?.status}`)

  let proposals = []
  const proposalDeadline = Date.now() + 180_000
  while (Date.now() < proposalDeadline) {
    proposals = await page.evaluate(async (id) => (await window.projectos.plans.replan.list(id)).proposals, project.id)
    if (proposals.length > 0) break
    await page.waitForTimeout(1000)
  }
  const proposal = proposals[0]
  if (!proposal) throw new Error('automatic Replan proposal missing')
  evidence.proposal = { id: proposal.id, trigger: proposal.trigger, status: proposal.status, reason: proposal.reason, diff: proposal.diff, grantImpact: proposal.grantImpact, generation: proposal.generation }

  await page.evaluate(async (id) => window.projectos.agentDefinitions.setStatus(id, 'active'), tester.id)
  const applied = await page.evaluate(async (id) => window.projectos.plans.replan.apply(id), proposal.id)
  const revisedAssigned = await page.evaluate(async ({ planId, developerId, testerId }) => {
    const plan = await window.projectos.plans.get(planId)
    return window.projectos.plans.update({ planId, tasks: plan.tasks.map((task) => ({
      ...task,
      agentId: task.role === 'developer' ? developerId : testerId,
    })) })
  }, { planId: applied.plan.id, developerId: developer.id, testerId: tester.id })
  const revisedApproved = await page.evaluate(async (id) => window.projectos.plans.approve(id), revisedAssigned.id)
  const newGrant = await page.evaluate(async (id) => window.projectos.plans.grant.issue({ planId: id, actions: ['plan.start', 'workspace-write'], allowedPaths: ['src'], maxRuns: 1, maxToolCalls: 40, ttlHours: 2, allowOverBudget: false, note: 'multi-agent closure revision', confirm: true }), revisedApproved.plan.id)
  evidence.revision = { planId: revisedApproved.plan.id, taskIds: revisedApproved.taskIds, grantId: newGrant.id }

  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: revisedApproved.plan.id, grantId: newGrant.id })
  let finalPlan = null
  const finalDeadline = Date.now() + 300_000
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
  const handoffs = await page.evaluate(async (id) => (await window.projectos.collaboration.snapshot(id)).handoffs, project.id)
  const finalGrant = await page.evaluate(async (id) => window.projectos.plans.grant.get(id), revisedApproved.plan.id)
  const oldPlan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
  const oldGrant = await page.evaluate(async (id) => window.projectos.plans.grant.get(id), approved.plan.id)
  evidence.final = {
    plan: { status: finalPlan.status, execution: finalPlan.execution, taskIds: finalPlan.createdTaskIds },
    tasks: tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, agentId: task.assigneeAgentId, runCount: task.runCount, artifactCount: task.artifactCount })),
    runs: runs.map((run) => ({ id: run.id, status: run.status, taskId: run.taskId, agentId: run.agentId, agentName: run.agentName })),
    artifacts: artifacts.map((artifact) => ({ id: artifact.id, taskId: artifact.taskId, kind: artifact.kind, title: artifact.title, verifiedAt: artifact.verifiedAt })),
    handoffs: handoffs.map((handoff) => ({ id: handoff.id, taskId: handoff.taskId, status: handoff.status, sourceTaskId: handoff.sourceTaskId, targetAgentId: handoff.targetAgentId })),
    grant: { valid: finalGrant.valid, status: finalGrant.status },
    oldPlan: { status: oldPlan.status, supersededByPlanId: oldPlan.supersededByPlanId },
    oldGrant: { status: oldGrant.status, valid: oldGrant.valid },
  }
  evidence.errors = errors.slice(0, 10)
  await page.screenshot({ path: join(shots, 'multi-agent-completed.png') })
  writeFileSync(join(shots, 'multi-agent-closure.json'), JSON.stringify(evidence, null, 2))

  const finalTaskIds = new Set(revisedApproved.taskIds)
  const finalTasks = tasks.filter((task) => finalTaskIds.has(task.id))
  const distinctAgents = new Set(runs.map((run) => run.agentId))
  const developerRuns = runs.filter((run) => run.agentId === developer.id)
  const testerRuns = runs.filter((run) => run.agentId === tester.id)
  const checks = [
    ['real Planner kept two tasks', draft.tasks.length === 2],
    ['two real AgentDefinitions assigned', new Set(assigned.tasks.map((task) => task.agentId)).size === 2],
    ['real downstream dependency exists', assigned.tasks.some((task) => task.dependsOn.length > 0)],
    ['real failure recorded', failedPlan.execution?.status === 'failed'],
    ['automatic proposal from real Replanner', proposal.status === 'proposed' && proposal.generation?.mode === 'provider'],
    ['revision applied and old plan superseded', applied.plan.revision === 2 && oldPlan.status === 'superseded'],
    ['old grant revoked and new grant active', oldGrant.status === 'revoked' && finalGrant.valid === true],
    ['final plan completed', finalPlan.execution?.status === 'completed'],
    ['final tasks all done', finalTasks.every((task) => task.status === 'done')],
    ['two distinct Agents have real Runs', distinctAgents.has(developer.id) && distinctAgents.has(tester.id) && developerRuns.length >= 1 && testerRuns.length >= 1],
    ['upstream Task reused without a duplicate upstream Run', finalPlan.createdTaskIds.includes(approved.taskIds[0]) && developerRuns.length === 1],
    ['real Artifacts exist', artifacts.length >= 1],
    ['no renderer errors', errors.length === 0],
  ]
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1
  else console.log(`\nR2B32 MULTI AGENT PASS — ${checks.length} checks`)
} catch (error) {
  console.error('R2B32 MULTI AGENT FAIL —', error)
  evidence.error = error instanceof Error ? error.message : String(error)
  try { writeFileSync(join(shots, 'multi-agent-failure.json'), JSON.stringify(evidence, null, 2)) } catch { /* ignore */ }
  if (app) { try { const p = await app.firstWindow(); await p.screenshot({ path: join(shots, 'multi-agent-failure.png') }) } catch { /* ignore */ } }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
