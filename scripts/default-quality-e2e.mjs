import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-default-quality-'))
const projectRoot = join(dataDir, 'real-project')
const sourceData = join(homedir(), 'AppData', 'Roaming', 'ProjectOS', 'data')
for (const file of ['projectos.db', 'projectos.db-wal', 'projectos.db-shm', 'ai-secrets.vault.json']) {
  if (existsSync(join(sourceData, file))) cpSync(join(sourceData, file), join(dataDir, file))
}
mkdirSync(projectRoot, { recursive: true })
writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
  name: 'projectos-default-quality',
  private: true,
  scripts: { test: 'node test.js' },
}, null, 2))
writeFileSync(join(projectRoot, 'test.js'), [
  "const fs = require('node:fs')",
  "const content = fs.existsSync('hello.txt') ? fs.readFileSync('hello.txt', 'utf8') : ''",
  "if (!content.includes('PROJECTOS-DEFAULT-QUALITY')) {",
  "  console.error('hello.txt is missing the required marker')",
  "  process.exit(1)",
  "}",
  "console.log('default quality test passed')",
].join('\n'))
execFileSync('git', ['init', '-q'], { cwd: projectRoot })
execFileSync('git', ['add', '.'], { cwd: projectRoot })
execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'initial'], { cwd: projectRoot })

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
delete env.PROJECTOS_ENABLE_AUTO_QUALITY_GATE
let app
const log = (message, data) => console.log(`[default-quality] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`)

async function launch() {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 30_000,
  })
  const page = await app.firstWindow()
  await page.waitForTimeout(3000)
  return page
}

async function approvePending(page, projectId) {
  return page.evaluate(async ({ projectId }) => {
    const list = await window.projectos.approvals.list({ projectId, runId: null })
    const pending = list.approvals.filter((item) => item.status === 'pending')
    for (const approval of pending) {
      await window.projectos.approvals.decide({ approvalId: approval.id, decision: 'approved', note: 'default quality E2E' })
    }
    return pending.length
  }, { projectId })
}

async function waitTaskIdle(page, projectId, taskId, deadline) {
  while (Date.now() < deadline) {
    const runs = await page.evaluate(async ({ projectId }) => window.projectos.runs.list(projectId, 100), { projectId })
    const active = runs.runs.filter(
      (run) => run.taskId === taskId && ['running', 'waiting_approval', 'needs_reconciliation'].includes(run.status),
    )
    if (!active.length) return true
    await approvePending(page, projectId)
    await page.waitForTimeout(3000)
  }
  return false
}

async function waitRun(page, runId, deadline) {
  let last = ''
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000)
    const result = await page.evaluate(async ({ runId }) => window.projectos.runs.get(runId), { runId })
    const status = result?.run?.status ?? 'unknown'
    if (status !== last) {
      log('verification-run', { runId, status, error: result?.run?.error ?? null })
      last = status
    }
    if (['completed', 'failed', 'cancelled', 'needs_reconciliation'].includes(status)) return result
  }
  return null
}

try {
  let page = await launch()
  const created = await page.evaluate(async ({ projectRoot }) => {
    const project = await window.projectos.projects.create({
      name: 'Default Quality Closure',
      description: 'default quality gate off; controlled verification',
      rootPath: projectRoot,
      createDirectory: false,
      initGit: false,
    })
    const requirement = await window.projectos.requirements.create({
      projectId: project.project.id,
      title: '默认安全质量闭环',
      body: '创建 hello.txt，内容包含 PROJECTOS-DEFAULT-QUALITY；不修改 test.js；运行 npm test 并留下真实测试报告。',
      acceptanceCriteria: ['hello.txt 含 PROJECTOS-DEFAULT-QUALITY', 'npm test 实际退出 0', '留下可追溯测试报告'],
      source: 'default-quality-e2e',
    })
    const plan = await window.projectos.plans.generate(
      project.project.id,
      '只创建三个任务：1) 开发工程师创建 hello.txt，内容包含 PROJECTOS-DEFAULT-QUALITY，不修改 test.js；2) 测试工程师运行 npm test 并生成测试报告 Artifact；3) 审查工程师独立审查 hello.txt、test.js 未修改和测试证据并生成审查报告 Artifact。使用三个不同角色的 Agent，后两个任务依次依赖前一个任务。',
      { mode: 'ai', maxTasks: 3, allowRuleFallback: false },
    )
    return { projectId: project.project.id, requirementId: requirement.requirement.id, plan }
  }, { projectRoot })
  log('created', { projectId: created.projectId, planId: created.plan.id, generatedBy: created.plan.generatedBy, tasks: created.plan.tasks.length })
  if (created.plan.generatedBy !== 'provider') throw new Error(`expected provider plan, got ${created.plan.generatedBy}`)

  // The initial review run deliberately omits the required review artifact so
  // this E2E exercises the real pause -> controlled verification -> resume path
  // instead of the ordinary "agent already produced evidence" path.
  const modified = await page.evaluate(async ({ planId }) => {
    const plan = await window.projectos.plans.get(planId)
    const tasks = plan.tasks.map((task) =>
      task.role === 'reviewer'
        ? {
            ...task,
            description: `${task.description}\n\n[受控验证场景] 首次执行不要创建 Artifact，不要运行测试，只回复“审查完成”。这是为了验证缺少证据时编排器会暂停，并由受控验证补证。`,
          }
        : task,
    )
    return window.projectos.plans.update({ planId, tasks })
  }, { planId: created.plan.id })
  log('review-task-marked-missing-evidence', { tasks: modified.tasks.length })

  const approved = await page.evaluate(async ({ planId }) => window.projectos.plans.approve(planId), { planId: created.plan.id })
  const grant = await page.evaluate(async ({ planId }) => window.projectos.plans.grant.issue({
    planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['.'],
    maxRuns: 10,
    maxToolCalls: 160,
    ttlHours: 2,
    confirm: true,
    note: 'default quality closure',
  }), { planId: created.plan.id })
  log('grant', { approvedTasks: approved.taskIds.length, canStart: grant.canStart })
  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, null, 0), {
    planId: created.plan.id,
    grantId: grant.id,
  })

  let finalPlan = null
  let verificationCount = 0
  const deadline = Date.now() + 20 * 60_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(4000)
    const pending = await approvePending(page, created.projectId)
    if (pending) log('approvals-approved', { pending })
    finalPlan = await page.evaluate(async ({ planId }) => window.projectos.plans.get(planId), { planId: created.plan.id })
    const status = finalPlan?.execution?.status ?? 'none'
    if (status === 'completed' || status === 'failed' || status === 'cancelled') break
    if (status !== 'paused') continue

    const board = await page.evaluate(async ({ projectId }) => window.projectos.tasks.board(projectId), { projectId: created.projectId })
    const target = board.tasks.find((task) => task.status === 'review')
    if (!target) {
      log('paused-without-review-task', { error: finalPlan?.execution?.error ?? null })
      break
    }
    if (verificationCount >= 3) {
      log('verification-limit-reached', { error: finalPlan?.execution?.error ?? null })
      break
    }
    verificationCount += 1
    log('paused-request-verification', { taskId: target.id, title: target.title, error: finalPlan?.execution?.error ?? null })
    const idle = await waitTaskIdle(page, created.projectId, target.id, Date.now() + 120_000)
    if (!idle) {
      log('task-still-active', { taskId: target.id })
      break
    }
    const verification = await page.evaluate(async ({ projectId, taskId }) => window.projectos.verification.request(projectId, taskId), {
      projectId: created.projectId,
      taskId: target.id,
    })
    log('verification-started', verification)
    const run = await waitRun(page, verification.runId, Date.now() + 8 * 60_000)
    log('verification-result', {
      status: run?.run?.status ?? null,
      artifacts: run?.artifacts?.length ?? null,
      toolCalls: run?.toolCalls?.map((call) => ({ tool: call.toolName, status: call.status })) ?? null,
    })
    if (run?.run?.status !== 'completed') {
      throw new Error(`verification run did not complete: ${run?.run?.status ?? 'missing'} ${run?.run?.error ?? ''}`)
    }
    await page.waitForTimeout(1500)
    const afterRun = await page.evaluate(async ({ runId }) => window.projectos.runs.get(runId), { runId: verification.runId })
    if (afterRun?.run?.status !== 'completed') {
      throw new Error(`verification run was not durable completed: ${afterRun?.run?.status ?? 'missing'}`)
    }
    await approvePending(page, created.projectId)
    await page.evaluate(async ({ planId }) => window.projectos.orchestration.resume(planId), { planId: created.plan.id })
    log('plan-resumed')
  }

  log('final-plan', { status: finalPlan?.execution?.status ?? null, error: finalPlan?.execution?.error ?? null })
  const evidence = await page.evaluate(async ({ projectId, planId }) => {
    const board = await window.projectos.tasks.board(projectId)
    const runs = await window.projectos.runs.list(projectId, 100)
    const artifacts = await window.projectos.artifacts.list(projectId, null)
    return {
      plan: (await window.projectos.plans.list(projectId)).plans.find((item) => item.id === planId) ?? null,
      tasks: board.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status })),
      runs: runs.runs.map((run) => ({ id: run.id, status: run.status, agent: run.agentName, task: run.taskTitle })),
      artifacts: artifacts.artifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, title: artifact.title, verifiedAt: artifact.verifiedAt, taskId: artifact.taskId })),
    }
  }, { projectId: created.projectId, planId: created.plan.id })
  log('evidence', evidence)

  if (finalPlan?.execution?.status !== 'completed') throw new Error(`plan did not complete: ${finalPlan?.execution?.status} ${finalPlan?.execution?.error ?? ''}`)
  const workspaceRef = finalPlan.execution.workspaceRef
  if (!workspaceRef || !existsSync(join(workspaceRef, 'hello.txt'))) throw new Error('hello.txt missing in worktree')
  execFileSync('npm', ['test'], { cwd: workspaceRef, stdio: 'inherit', shell: true })
  log('hello', readFileSync(join(workspaceRef, 'hello.txt'), 'utf8'))

  for (let i = 0; i < 30; i += 1) {
    const active = await page.evaluate(async ({ projectId }) => {
      const runs = await window.projectos.runs.list(projectId, 100)
      return runs.runs.filter((run) => ['running', 'waiting_approval', 'needs_reconciliation'].includes(run.status))
    }, { projectId: created.projectId })
    if (!active.length) break
    if (i === 29) throw new Error(`project still has active runs: ${active.map((run) => `${run.id}:${run.status}`).join(',')}`)
    await approvePending(page, created.projectId)
    await page.waitForTimeout(2000)
  }

  await app.close()
  app = undefined
  page = await launch()
  const recovered = await page.evaluate(async ({ projectId, planId }) => {
    const plan = (await window.projectos.plans.list(projectId)).plans.find((item) => item.id === planId)
    const board = await window.projectos.tasks.board(projectId)
    return { planStatus: plan?.execution?.status ?? null, tasks: board.tasks.length, done: board.tasks.filter((task) => task.status === 'done').length }
  }, { projectId: created.projectId, planId: created.plan.id })
  log('restart-recovered', recovered)
  const merged = await page.evaluate(async ({ planId }) => window.projectos.worktrees.merge(planId), { planId: created.plan.id })
  log('merged', merged)
  if (!existsSync(join(projectRoot, 'hello.txt'))) throw new Error('merged project missing hello.txt')
  log('PASS')
} finally {
  try { await app?.close() } catch { /* ignore */ }
  if (process.env.KEEP_DATA === '1') {
    console.log(`[default-quality] DATA DIR: ${dataDir}`)
  } else {
    rmSync(dataDir, { recursive: true, force: true })
  }
}
