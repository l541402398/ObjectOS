/**
 * Phase 2B-2 real-provider plan/grant/low-risk execution validation.
 *
 * Uses the developer's already-authorized encrypted provider config in an
 * isolated data dir and Electron user-data dir. It:
 *   1. generates a real AI plan draft,
 *   2. records that draft, then applies an explicit user edit to one low-risk
 *      write task (draft editing is a first-class product capability),
 *   3. approves it (no execution),
 *   4. issues a scoped PlanExecutionGrant and starts it,
 *   5. observes the existing AgentRunner/PolicyEngine execute a real write_file
 *      under the grant, and revokes the grant,
 *   6. records Planner/Run usage and screenshots without printing any key.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'r2b2')
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

const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b2-real-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b2-real-user-'))
writeFileSync(join(dataDir, 'provider.json'), JSON.stringify({ ...providerConfig, connectionsMigrated: false }, null, 2))
const localState = join(process.env.APPDATA ?? '', 'ProjectOS', 'Local State')
if (existsSync(localState)) copyFileSync(localState, join(userDataDir, 'Local State'))

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${name}: ${detail ?? 'assertion failed'}`)
}

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
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.show()
    win.focus()
    win.moveTop()
  })
  await page.waitForTimeout(3600)

  let connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  for (let attempt = 0; attempt < 20 && connections.connections.length === 0; attempt += 1) {
    await page.waitForTimeout(500)
    connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  }
  check('real provider migrated into an AI connection with secret', connections.connections.length > 0 && Boolean(connections.connections[0]?.hasSecret), `${connections.connections[0]?.name} / ${connections.connections[0]?.defaultModelId}`)
  const connection = connections.connections.find((item) => item.id === connections.defaultId) ?? connections.connections[0]

  const workspaceDir = join(dataDir, 'real-grant-project')
  mkdirSync(join(workspaceDir, 'src'), { recursive: true })
  writeFileSync(join(workspaceDir, 'package.json'), JSON.stringify({
    name: 'r2b2-real-grant',
    private: true,
    scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
  }, null, 2))
  writeFileSync(join(workspaceDir, 'README.md'), '# R2B2 real grant fixture\n')
  const project = await page.evaluate(async ({ workspaceDir }) => (await window.projectos.projects.create({
    name: 'R2B2 Real Grant',
    description: 'Real provider plan grant and low-risk tool execution',
    rootPath: workspaceDir,
    createDirectory: false,
    initGit: false,
  })).project, { workspaceDir })
  await page.evaluate(async (projectId) => window.projectos.projectAnalysis.scan(projectId), project.id)

  const goal = '在 src/notes.txt 写入一行 hello from plan grant，并用读取工具确认文件内容；只做这个低风险小改动'
  const draft = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, {
    mode: 'ai',
    allowRuleFallback: false,
    maxTasks: 6,
  }), { projectId: project.id, goal })
  check('real provider generated a plan draft', draft.generatedBy === 'provider' && draft.tasks.length > 0, `tasks=${draft.tasks.length} model=${draft.generation?.model}`)
  const originalTasks = draft.tasks.map((task) => ({
    key: task.key,
    title: task.title,
    role: task.role,
    dependsOn: task.dependsOn,
    expectedArtifacts: task.expectedArtifacts,
  }))

  // Keep the isolated execution deliberately tiny. The user may edit a draft;
  // this does not change the real Provider provenance of the plan.
  const edited = await page.evaluate(async ({ planId }) => window.projectos.plans.update({
    planId,
    tasks: [{
      key: 'write-notes',
      title: '写入 src/notes.txt 并读取确认',
      description: '只使用 write_file 在 src/notes.txt 写入 hello from plan grant，然后使用 read_file 确认内容；不要运行命令。',
      role: 'developer',
      capabilities: ['implement'],
      hardCapabilities: [],
      dependsOn: [],
      acceptanceCriteria: ['src/notes.txt 内容为 hello from plan grant'],
      expectedArtifacts: ['代码 diff'],
      rationale: '这是验证计划授权低风险写入的最小用户编辑任务。',
      requiresApproval: true,
    }],
  }), { planId: draft.id })
  check('user-edited draft retains Provider provenance', edited.generatedBy === 'provider', `${edited.generation?.model}`)

  const approved = await page.evaluate(async (planId) => window.projectos.plans.approve(planId), edited.id)
  check('plan approval creates tasks but no execution', approved.plan.execution === null && approved.taskIds.length === 1, `tasks=${approved.taskIds.length}`)
  const taskId = approved.taskIds[0]

  const grant = await page.evaluate(async (planId) => window.projectos.plans.grant.issue({
    planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['src'],
    maxRuns: 1,
    maxToolCalls: 20,
    ttlHours: 2,
    allowOverBudget: false,
    note: 'R2B2 real provider low-risk write validation',
    confirm: true,
  }), approved.plan.id)
  check('scoped grant issued for the real plan', grant.valid && grant.allowedPaths.includes('src') && grant.allowedTaskIds.includes(taskId), `grant=${grant.id} paths=${grant.allowedPaths.join(',')}`)

  // Show the real grant panel before starting; this is a real Electron screenshot.
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(800)
  await page.locator('.po-orch-actions').getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('[data-testid="plan-grant-panel"]', { timeout: 15_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'real-grant-before.png') })

  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 1, 0, false, grantId), { planId: approved.plan.id, grantId: grant.id })

  let writeCall = null
  let runId = null
  let fileContent = null
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(700)
    try {
      const file = await page.evaluate(async ({ projectId, path }) => window.projectos.workspace.readFile(projectId, path), { projectId: project.id, path: 'src/notes.txt' })
      fileContent = file.content
    } catch {
      fileContent = null
    }
    const runs = await page.evaluate(async (projectId) => window.projectos.runs.list(projectId, 20), project.id)
    for (const summary of runs.runs) {
      const detail = await page.evaluate(async (id) => window.projectos.runs.get(id), summary.id)
      const found = detail.toolCalls.find((call) => call.toolName === 'write_file' && call.status === 'completed')
      if (found) {
        writeCall = {
          runId: summary.id,
          toolCallId: found.id,
          toolName: found.toolName,
          status: found.status,
          result: found.result,
          argsPath: typeof found.args?.path === 'string' ? found.args.path : null,
        }
        runId = summary.id
        break
      }
    }
    if (writeCall) break
  }
  check('real AgentRunner completed a scoped write_file under the grant', Boolean(writeCall) && Boolean(fileContent?.includes('hello from plan grant')), `file=${JSON.stringify(fileContent)} call=${writeCall?.toolCallId ?? 'none'}`)
  const grantAfter = await page.evaluate(async (planId) => window.projectos.plans.grant.get(planId), approved.plan.id)
  check('grant recorded the consumed tool call', grantAfter?.usedToolCalls >= 1, `usedToolCalls=${grantAfter?.usedToolCalls}`)
  const approvals = await page.evaluate(async (projectId) => window.projectos.approvals.list({ projectId, runId: null }), project.id)
  const pendingWriteApprovals = approvals.approvals.filter(
    (item) => item.status === 'pending' && item.request?.toolName === 'write_file',
  )
  check('the low-risk write did not require a per-call approval', pendingWriteApprovals.length === 0, `pendingWriteApprovals=${pendingWriteApprovals.length} allPending=${approvals.approvals.filter((item) => item.status === 'pending').length}`)

  const usage = await page.evaluate(async (projectId) => window.projectos.aiUsage.summary(projectId), project.id)
  check('Planner usage was recorded from real Provider tokens', usage.planner.calls >= 1 && usage.planner.inputTokens + usage.planner.outputTokens > 0, `plannerCalls=${usage.planner.calls} tokens=${usage.planner.inputTokens + usage.planner.outputTokens} costUnknown=${usage.costUnknown}`)

  // Revoke while the plan may still be running; this must cancel execution.
  const revoked = await page.evaluate(async (grantId) => window.projectos.plans.grant.revoke({
    grantId,
    reason: 'R2B2 真实低风险写入已完成，结束隔离验证',
  }), grant.id)
  const finalPlan = await page.evaluate(async (planId) => window.projectos.plans.get(planId), approved.plan.id)
  check('real grant revoke persisted and stopped the plan', revoked.status === 'revoked' && finalPlan.execution?.status !== 'running', `grant=${revoked.status} plan=${finalPlan.execution?.status ?? 'null'}`)
  // Reload so the screenshot reflects the persisted revoked state rather than
  // a stale renderer cache.
  await page.reload()
  await page.waitForTimeout(3200)
  await page.waitForSelector('#po-main')
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(900)
  await page.locator('.po-orch-actions').getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('[data-testid="plan-grant-panel"]', { timeout: 15_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'real-grant-revoked.png') })

  const evidence = {
    capturedAt: new Date().toISOString(),
    connection: { name: connection.name, protocol: connection.protocol, modelId: connection.defaultModelId },
    goal,
    originalDraft: {
      id: draft.id,
      revision: draft.revision,
      generatedBy: draft.generatedBy,
      model: draft.generation?.model ?? null,
      attempts: draft.generation?.attempts ?? null,
      contextChars: draft.generation?.contextChars ?? null,
      tasks: originalTasks,
    },
    userEditedExecutionTask: {
      edited: true,
      taskId,
      taskCount: approved.taskIds.length,
      note: 'Draft editing is a product capability; the plan still records Provider provenance.',
    },
    grant: {
      id: grant.id,
      planRevision: grant.planRevision,
      planFingerprint: grant.planFingerprint,
      actions: grant.actions,
      allowedPaths: grant.allowedPaths,
      allowedTaskIds: grant.allowedTaskIds,
      allowedAgentIds: grant.allowedAgentIds,
      maxRuns: grant.maxRuns,
      usedRuns: grantAfter?.usedRuns ?? null,
      maxToolCalls: grant.maxToolCalls,
      usedToolCalls: grantAfter?.usedToolCalls ?? null,
      expiresAt: grant.expiresAt,
      finalStatus: revoked.status,
    },
    execution: {
      runId,
      writeCall,
      fileContent,
      planStatus: finalPlan.execution?.status ?? null,
      pendingApprovals: approvals.approvals.filter((item) => item.status === 'pending').length,
    },
    usage: {
      planner: usage.planner,
      runs: usage.runs,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      estimatedCost: usage.estimatedCost,
      costUnknown: usage.costUnknown,
      unpricedCalls: usage.unpricedCalls,
    },
    checks: results,
  }
  const serialized = JSON.stringify(evidence)
  check('no key material in real-grant evidence', !/sk-[A-Za-z0-9_-]{12,}/.test(serialized), 'safe')
  check('no renderer page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  writeFileSync(join(shots, 'real-grant.json'), JSON.stringify(evidence, null, 2))
  console.log(`\nR2B2 REAL GRANT PASS — ${results.length} checks, evidence in ${shots}`)
} catch (error) {
  console.error('R2B2 REAL GRANT FAIL —', error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: join(shots, 'real-grant-failure.png') })
    } catch {
      // best effort
    }
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
