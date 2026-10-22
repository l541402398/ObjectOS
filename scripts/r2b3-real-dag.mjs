/**
 * Phase 2B-3 real-provider multi-task DAG validation.
 *
 * Uses the developer's authorized encrypted provider config in an isolated data
 * dir. The Planner output is approved without reducing its task count, then the
 * existing Scheduler/AgentRunner executes the DAG under a scoped PlanGrant.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'r2b3')
mkdirSync(shots, { recursive: true })
const sourceProvider = join(process.env.APPDATA ?? '', 'ProjectOS', 'data', 'provider.json')
if (!existsSync(sourceProvider)) {
  console.log(`SKIPPED (blocked): no authorized provider config at ${sourceProvider}`)
  process.exit(0)
}
const providerConfig = JSON.parse(readFileSync(sourceProvider, 'utf8'))
if (!providerConfig.encryptedApiKey) {
  console.log('SKIPPED (blocked): provider config has no encrypted API key')
  process.exit(0)
}
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b3-real-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b3-real-user-'))
writeFileSync(join(dataDir, 'provider.json'), JSON.stringify({ ...providerConfig, connectionsMigrated: false }, null, 2))
const localState = join(process.env.APPDATA ?? '', 'ProjectOS', 'Local State')
if (existsSync(localState)) copyFileSync(localState, join(userDataDir, 'Local State'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const evidence = { capturedAt: new Date().toISOString(), goal: null, plan: null, grant: null, execution: null, usage: null }
let app = null
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.show(); win.focus(); win.moveTop() })
  await page.waitForTimeout(3600)
  let connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  for (let attempt = 0; attempt < 20 && connections.connections.length === 0; attempt += 1) {
    await page.waitForTimeout(500)
    connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  }
  if (connections.connections.length === 0) throw new Error('real provider connection was not migrated')
  const connection = connections.connections.find((item) => item.id === connections.defaultId) ?? connections.connections[0]
  evidence.connection = { name: connection.name, protocol: connection.protocol, model: connection.defaultModelId }

  const workspaceDir = join(dataDir, 'real-dag-project')
  mkdirSync(join(workspaceDir, 'src'), { recursive: true })
  writeFileSync(join(workspaceDir, 'package.json'), JSON.stringify({ name: 'r2b3-real-dag', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2))
  writeFileSync(join(workspaceDir, 'README.md'), '# R2B3 real DAG fixture\n')
  const project = await page.evaluate(async ({ workspaceDir }) => (await window.projectos.projects.create({
    name: 'R2B3 Real DAG', description: 'real provider multi-task DAG', rootPath: workspaceDir, createDirectory: false, initGit: false,
  })).project, { workspaceDir })
  await page.evaluate(async (projectId) => window.projectos.projectAnalysis.scan(projectId), project.id)

  const goal = '请创建两个相互独立的小文件：在 src/alpha.txt 写入 alpha，在 src/beta.txt 写入 beta，并分别读取确认。只使用文件读写工具，不要运行命令，不要修改其他文件；计划至少拆成两个任务。'
  evidence.goal = goal
  let draft = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, { mode: 'ai', allowRuleFallback: false, maxTasks: 6 }), { projectId: project.id, goal })
  if (draft.generatedBy !== 'provider' || draft.tasks.length < 2) {
    // One retry with an explicit two-file split; never edit the resulting DAG.
    const goal2 = '把需求拆成两个可独立执行的任务：任务一写 src/alpha.txt 为 alpha；任务二写 src/beta.txt 为 beta；两个任务都必须读取确认，不运行命令。'
    draft = await page.evaluate(async ({ projectId, goal2 }) => window.projectos.plans.generate(projectId, goal2, { mode: 'ai', allowRuleFallback: false, maxTasks: 6 }), { projectId: project.id, goal2 })
    evidence.goal = goal2
  }
  if (draft.generatedBy !== 'provider') throw new Error(`Planner source is ${draft.generatedBy}, not provider`)
  if (draft.tasks.length < 2) throw new Error(`real Planner produced ${draft.tasks.length} task(s); multi-task DAG not available`)
  evidence.plan = {
    id: draft.id,
    revision: draft.revision,
    generatedBy: draft.generatedBy,
    model: draft.generation?.model,
    attempts: draft.generation?.attempts,
    contextChars: draft.generation?.contextChars,
    tasks: draft.tasks.map((task) => ({ key: task.key, title: task.title, role: task.role, dependsOn: task.dependsOn, expectedArtifacts: task.expectedArtifacts })),
  }
  const approved = await page.evaluate(async (planId) => window.projectos.plans.approve(planId), draft.id)
  evidence.plan.approvedTaskIds = approved.taskIds
  evidence.plan.approvedExecution = approved.plan.execution?.status ?? null
  if (approved.taskIds.length < 2) throw new Error('approved task count is less than two')
  const grant = await page.evaluate(async (planId) => window.projectos.plans.grant.issue({
    planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['src'],
    maxRuns: 1,
    maxToolCalls: 40,
    ttlHours: 2,
    allowOverBudget: false,
    note: 'Phase 2B-3 real multi-task DAG validation',
    confirm: true,
  }), approved.plan.id)
  evidence.grant = { id: grant.id, planRevision: grant.planRevision, allowedPaths: grant.allowedPaths, allowedTaskIds: grant.allowedTaskIds, allowedAgentIds: grant.allowedAgentIds, maxRuns: grant.maxRuns, maxToolCalls: grant.maxToolCalls }
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(shots, 'real-dag-approved.png') })

  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()), { planId: approved.plan.id, grantId: grant.id })
  const deadline = Date.now() + 240_000
  let plan = null
  const files = {}
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000)
    plan = await page.evaluate(async (planId) => window.projectos.plans.get(planId), approved.plan.id)
    for (const name of ['alpha.txt', 'beta.txt']) {
      try {
        files[name] = (await page.evaluate(async ({ projectId, path }) => window.projectos.workspace.readFile(projectId, path), { projectId: project.id, path: `src/${name}` })).content
      } catch { /* not written yet */ }
    }
    if (plan.execution?.status === 'completed' || plan.execution?.status === 'failed') break
    if (plan.execution?.status === 'paused' && Date.now() + 90_000 > deadline) break
  }
  const tasks = await page.evaluate(async (projectId) => (await window.projectos.tasks.board(projectId)).tasks, project.id)
  const runs = await page.evaluate(async (projectId) => (await window.projectos.runs.list(projectId, 50)).runs, project.id)
  const artifacts = await page.evaluate(async (projectId) => (await window.projectos.artifacts.list(projectId)).artifacts, project.id)
  evidence.execution = {
    status: plan?.execution?.status ?? null,
    error: plan?.execution?.error ?? null,
    runIds: plan?.execution?.runIds ?? [],
    tasks: tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, assigneeAgentId: task.assigneeAgentId, artifactCount: task.artifactCount })),
    runs: runs.map((run) => ({ id: run.id, status: run.status, taskId: run.taskId, agentName: run.agentName })),
    artifacts: artifacts.map((artifact) => ({ id: artifact.id, taskId: artifact.taskId, kind: artifact.kind, title: artifact.title, verifiedAt: artifact.verifiedAt })),
    files,
  }
  evidence.usage = await page.evaluate(async (projectId) => window.projectos.aiUsage.summary(projectId), project.id)
  evidence.plan.final = plan ? { status: plan.status, revision: plan.revision, execution: plan.execution } : null
  evidence.grant.final = await page.evaluate(async (planId) => window.projectos.plans.grant.get(planId), approved.plan.id)
  await page.screenshot({ path: join(shots, 'real-dag-completed.png') })
  evidence.errors = errors.slice(0, 10)
  writeFileSync(join(shots, 'real-dag.json'), JSON.stringify(evidence, null, 2))

  const checks = []
  const check = (name, ok, detail) => { checks.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`) }
  check('real Planner produced a multi-task DAG without reduction', draft.generatedBy === 'provider' && draft.tasks.length >= 2, `tasks=${draft.tasks.length}`)
  check('approval did not execute the plan', evidence.plan.approvedExecution === null, String(evidence.plan.approvedExecution))
  check('all plan tasks reached done', plan?.execution?.status === 'completed' && tasks.filter((task) => approved.taskIds.includes(task.id)).every((task) => task.status === 'done'), `plan=${plan?.execution?.status} tasks=${tasks.map((task) => task.status).join(',')}`)
  check('both real files exist with provider-driven content', files['alpha.txt']?.includes('alpha') && files['beta.txt']?.includes('beta'), JSON.stringify(files))
  check('real Run(s) and Artifact(s) exist', runs.length >= 2 && artifacts.length >= 1, `runs=${runs.length} artifacts=${artifacts.length}`)
  check('real provider usage was recorded', evidence.usage.planner.calls >= 1 && evidence.usage.runs >= 1, `planner=${evidence.usage.planner.calls} runs=${evidence.usage.runs}`)
  check('grant consumed but not over quota', evidence.grant.final?.usedRuns <= evidence.grant.final?.maxRuns && evidence.grant.final?.usedToolCalls <= evidence.grant.final?.maxToolCalls, `${evidence.grant.final?.usedRuns}/${evidence.grant.final?.maxRuns} runs`)
  if (checks.some((item) => !item.ok)) process.exitCode = 1
  else console.log(`\nR2B3 REAL DAG PASS — ${checks.length} checks, evidence in ${shots}`)
} catch (error) {
  console.error('R2B3 REAL DAG FAIL —', error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: join(shots, 'real-dag-failure.png') })
      const projects = await page.evaluate(async () => window.projectos.projects.list())
      const project = projects.projects[0]
      if (project) writeFileSync(join(shots, 'real-dag-failure.json'), JSON.stringify({ error: String(error), projectId: project.id }, null, 2))
    } catch { /* ignore */ }
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
