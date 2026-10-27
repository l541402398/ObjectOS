import { _electron as electron } from 'playwright-core'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-real-e2e-'))
const projectRoot = join(dataDir, 'real-project')
const sourceData = join(homedir(), 'AppData', 'Roaming', 'ProjectOS', 'data')
for (const file of ['projectos.db', 'projectos.db-wal', 'projectos.db-shm', 'ai-secrets.vault.json']) {
  if (existsSync(join(sourceData, file))) cpSync(join(sourceData, file), join(dataDir, file))
}
mkdirSync(projectRoot, { recursive: true })
writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
  name: 'projectos-real-e2e',
  private: true,
  scripts: { test: 'node test.js' },
}, null, 2))
writeFileSync(join(projectRoot, 'test.js'), [
  "const fs = require('node:fs')",
  "const content = fs.existsSync('hello.txt') ? fs.readFileSync('hello.txt', 'utf8') : ''",
  "if (!content.includes('PROJECTOS-REAL-E2E')) {",
  "  console.error('hello.txt is missing the required marker')",
  "  process.exit(1)",
  "}",
  "console.log('real e2e test passed')",
].join('\n'))
execFileSync('git', ['init', '-q'], { cwd: projectRoot })
execFileSync('git', ['add', '.'], { cwd: projectRoot })
execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'initial'], { cwd: projectRoot })

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_ENABLE_AUTO_QUALITY_GATE: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
let app
const log = (message, data) => console.log(`[real-e2e] ${message}${data ? ` ${JSON.stringify(data)}` : ''}`)

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

try {
  let page = await launch()
  const result = await page.evaluate(async ({ projectRoot }) => {
    const project = await window.projectos.projects.create({
      name: 'Real AI Multi-Agent E2E',
      description: 'Real provider, two Agents, real files and tests',
      rootPath: projectRoot,
      createDirectory: false,
      initGit: false,
    })
    const requirement = await window.projectos.requirements.create({
      projectId: project.project.id,
      title: '创建 hello.txt 并通过真实测试',
      body: '在项目根目录创建 hello.txt，内容必须包含 PROJECTOS-REAL-E2E。不要修改 test.js。完成后运行 npm test 并留下测试报告 Artifact。',
      acceptanceCriteria: [
        'hello.txt 存在且包含 PROJECTOS-REAL-E2E',
        'npm test 实际执行并返回 0',
        '留下可追溯的测试报告 Artifact',
      ],
      source: 'real-e2e',
    })
    const plan = await window.projectos.plans.generate(project.project.id, '只创建两个任务：1) 开发工程师创建 hello.txt，内容包含 PROJECTOS-REAL-E2E，不修改 test.js；2) 测试工程师运行 npm test 并生成测试报告 Artifact。不要创建审查任务。使用两个不同角色的 Agent，测试任务依赖开发任务。', {
      mode: 'ai',
      maxTasks: 2,
      allowRuleFallback: false,
    })
    return { projectId: project.project.id, requirementId: requirement.requirement.id, plan }
  }, { projectRoot })
  log('project-created', { projectId: result.projectId, planId: result.plan.id, generatedBy: result.plan.generatedBy, tasks: result.plan.tasks.length })
  if (result.plan.generatedBy !== 'provider') throw new Error(`expected provider plan, got ${result.plan.generatedBy}`)

  const updated = await page.evaluate(async ({ planId }) => {
    const plan = await window.projectos.plans.get(planId)
    const tasks = plan.tasks.map((task, index) => index === 0
      ? { ...task, description: `${task.description}\n\n验收：hello.txt 必须包含 PROJECTOS-REAL-E2E。` }
      : task)
    return window.projectos.plans.update({ planId, tasks })
  }, { planId: result.plan.id })
  log('plan-modified', { tasks: updated.tasks.length })

  const approved = await page.evaluate(async ({ planId }) => window.projectos.plans.approve(planId), { planId: result.plan.id })
  log('plan-approved', { taskIds: approved.taskIds.length })

  const grant = await page.evaluate(async ({ planId }) => window.projectos.plans.grant.issue({
    planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['.'],
    maxRuns: 8,
    maxToolCalls: 120,
    ttlHours: 2,
    confirm: true,
    note: 'real AI multi-agent E2E',
  }), { planId: result.plan.id })
  log('grant-issued', { grantId: grant.id, canStart: grant.canStart })

  const started = await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId), {
    planId: result.plan.id,
    grantId: grant.id,
  })
  log('orchestration-started', { status: started.execution?.status })

  const deadline = Date.now() + 15 * 60_000
  let finalPlan = null
  let lastStatus = ''
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000)
    const approvals = await page.evaluate(async ({ projectId }) => {
      const list = await window.projectos.approvals.list({ projectId, runId: null })
      const pending = list.approvals.filter((item) => item.status === 'pending')
      for (const approval of pending) {
        await window.projectos.approvals.decide({ approvalId: approval.id, decision: 'approved', note: 'real E2E approval' })
      }
      return { pending: pending.length }
    }, { projectId: result.projectId })
    if (approvals.pending) log('approvals-approved', approvals)
    finalPlan = await page.evaluate(async ({ planId }) => window.projectos.plans.get(planId), { planId: result.plan.id })
    const status = finalPlan?.execution?.status ?? 'none'
    if (status !== lastStatus) {
      lastStatus = status
      log('plan-status', { status, error: finalPlan?.execution?.error ?? null })
    }
    if (['completed', 'failed', 'cancelled'].includes(status)) break
    if (status === 'paused') {
      log('plan-paused', { error: finalPlan?.execution?.error ?? null })
      break
    }
  }

  const evidence = await page.evaluate(async ({ projectId, planId }) => {
    const plans = await window.projectos.plans.list(projectId)
    const plan = plans.plans.find((item) => item.id === planId)
    const board = await window.projectos.tasks.board(projectId)
    const artifacts = await window.projectos.artifacts.list(projectId, null)
    const runs = await window.projectos.runs.list(projectId, 100)
    return {
      plan: plan ? { status: plan.status, execution: plan.execution } : null,
      tasks: board.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, versionId: task.versionId })),
      artifacts: artifacts.artifacts.map((artifact) => ({ id: artifact.id, kind: artifact.kind, title: artifact.title, verifiedAt: artifact.verifiedAt })),
      runs: runs.runs.map((run) => ({ id: run.id, status: run.status, agent: run.agentName, task: run.taskTitle })),
    }
  }, { projectId: result.projectId, planId: result.plan.id })
  log('evidence', evidence)
  const workspaceRef = finalPlan?.execution?.workspaceRef ?? projectRoot
  log('files', {
    workspaceRef,
    hello: existsSync(join(workspaceRef, 'hello.txt')) ? readFileSync(join(workspaceRef, 'hello.txt'), 'utf8') : null,
    git: existsSync(workspaceRef) ? execFileSync('git', ['status', '--short'], { cwd: workspaceRef, encoding: 'utf8' }) : '',
  })

  await app.close()
  app = undefined
  page = await launch()
  const recovered = await page.evaluate(async ({ projectId, planId }) => {
    const plans = await window.projectos.plans.list(projectId)
    const plan = plans.plans.find((item) => item.id === planId)
    const board = await window.projectos.tasks.board(projectId)
    return {
      planStatus: plan?.execution?.status ?? null,
      tasks: board.tasks.length,
      done: board.tasks.filter((task) => task.status === 'done').length,
    }
  }, { projectId: result.projectId, planId: result.plan.id })
  log('restart-recovered', recovered)
  for (let i = 0; i < 24 && finalPlan?.execution?.status === 'running'; i += 1) {
    await page.waitForTimeout(5000)
    const approvals = await page.evaluate(async ({ projectId }) => {
      const list = await window.projectos.approvals.list({ projectId, runId: null })
      const pending = list.approvals.filter((item) => item.status === 'pending')
      for (const approval of pending) {
        await window.projectos.approvals.decide({ approvalId: approval.id, decision: 'approved', note: 'real E2E approval after restart' })
      }
      return { pending: pending.length }
    }, { projectId: result.projectId })
    if (approvals.pending) log('approvals-approved-after-restart', approvals)
    finalPlan = await page.evaluate(async ({ planId }) => window.projectos.plans.get(planId), { planId: result.plan.id })
    if (finalPlan?.execution?.status !== 'running') break
  }
  if (!['completed', 'failed', 'paused'].includes(finalPlan?.execution?.status ?? '')) {
    throw new Error(`plan did not settle: ${finalPlan?.execution?.status}`)
  }
  if (finalPlan.execution?.status !== 'completed') {
    throw new Error(`plan not completed: ${finalPlan.execution?.status} ${finalPlan.execution?.error ?? ''}`)
  }
  if (!existsSync(join(workspaceRef, 'hello.txt'))) throw new Error('hello.txt was not created in the plan worktree')
  if (!readFileSync(join(workspaceRef, 'hello.txt'), 'utf8').includes('PROJECTOS-REAL-E2E')) throw new Error('marker missing')
  log('worktree-diff', { diff: execFileSync('git', ['diff', '--stat', 'HEAD'], { cwd: workspaceRef, encoding: 'utf8' }) })
  execFileSync('npm', ['test'], { cwd: workspaceRef, stdio: 'inherit', shell: true })
  const merged = await page.evaluate(async ({ planId }) => window.projectos.worktrees.merge(planId), { planId: result.plan.id })
  log('worktree-merged', merged)
  if (!existsSync(join(projectRoot, 'hello.txt'))) throw new Error('merged project is missing hello.txt')
  log('PASS')
} finally {
  try { await app?.close() } catch { /* ignore */ }
  rmSync(dataDir, { recursive: true, force: true })
}
