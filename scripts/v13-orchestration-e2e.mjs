import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
mkdirSync('test-results', { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-orch-e2e-'))
const workspaceDir = join(dataDir, 'project')
mkdirSync(workspaceDir, { recursive: true })
writeFileSync(
  join(workspaceDir, 'package.json'),
  JSON.stringify({ name: 'orchestration-e2e', private: true, scripts: { test: 'node -e "process.exit(0)"' } }),
)
let requests = 0

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    requests += 1
    if (requests === 1) {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'transient provider failure' } }))
      return
    }
    let payload = {}
    try {
      payload = JSON.parse(body)
    } catch {
      // ignore
    }
    if (!payload.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const write = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
    write({ choices: [{ delta: { role: 'assistant', content: '已完成该计划任务。' } }] })
    write({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 60, completion_tokens: 12 } })
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

let app = null
let passed = false
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForTimeout(3200)

  const project = await page.evaluate(
    async ({ workspaceDir }) =>
      window.projectos.projects.create({
        name: 'Orchestration E2E',
        description: 'Auto orchestration',
        rootPath: workspaceDir,
        createDirectory: false,
        initGit: true,
      }),
    { workspaceDir },
  )
  const exec = promisify(execFile)
  await exec('git', ['add', '.'], { cwd: workspaceDir })
  await exec(
    'git',
    ['-c', 'user.name=ProjectOS E2E', '-c', 'user.email=e2e@example.com', 'commit', '-m', 'initial'],
    { cwd: workspaceDir },
  )
  await page.evaluate(
    async ({ baseUrl }) =>
      window.projectos.settings.update({
        baseUrl,
        model: 'fake-orchestrator-model',
        apiKey: 'test-key',
        temperature: 0,
      }),
    { baseUrl },
  )
  const plan = await page.evaluate(
    async ({ projectId }) => window.projectos.plans.generate(projectId, '增加 RBAC'),
    { projectId: project.project.id },
  )
  const approved = await page.evaluate(async (planId) => window.projectos.plans.approve(planId), plan.id)
  if (approved.taskIds.length !== 4) throw new Error('plan did not create 4 tasks')
  await page.evaluate(async (planId) => window.projectos.orchestration.start(planId, 2), plan.id)

  let finalPlan = null
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000)
    const listed = await page.evaluate(
      async ({ projectId }) => window.projectos.plans.list(projectId),
      { projectId: project.project.id },
    )
    finalPlan = listed.plans.find((item) => item.id === plan.id)
    if (finalPlan?.execution?.status === 'completed') break
    if (finalPlan?.execution?.status === 'failed') throw new Error(`orchestration failed: ${finalPlan.execution.error}`)
  }
  if (finalPlan?.execution?.status !== 'completed') {
    console.error(JSON.stringify(finalPlan?.execution, null, 2))
    throw new Error(`orchestration did not complete: ${finalPlan?.execution?.status ?? 'missing'}`)
  }

  const board = await page.evaluate(
    async (projectId) => window.projectos.tasks.board(projectId),
    project.project.id,
  )
  const tasks = board.tasks.filter((task) => approved.taskIds.includes(task.id))
  if (tasks.some((task) => task.status !== 'done')) throw new Error('not all orchestrated tasks are done')
  const usage = await page.evaluate(async () => window.projectos.aiUsage.summary())
  if (usage.runs < 4 || usage.inputTokens <= 0) throw new Error('usage was not recorded')
  const artifacts = await page.evaluate(
    async (projectId) => window.projectos.artifacts.list(projectId),
    project.project.id,
  )
  const reports = artifacts.artifacts.filter((artifact) => artifact.kind === 'test-report')
  if (reports.length < 2) throw new Error('quality gate reports were not created')
  const diffArtifacts = artifacts.artifacts.filter((artifact) => artifact.kind === 'diff')
  if (diffArtifacts.length < 1) throw new Error('worktree diff artifact was not created')
  if (!finalPlan.execution.workspaceRef || !finalPlan.execution.branch) throw new Error('worktree was not created')
  const info = await page.evaluate(async (planId) => window.projectos.worktrees.info(planId), plan.id)
  if (!info.available || info.branch !== finalPlan.execution.branch) throw new Error('worktree info invalid')
  const merged = await page.evaluate(async (planId) => window.projectos.worktrees.merge(planId), plan.id)
  if (!merged.mergedAt) throw new Error('worktree merge failed')

  await page.reload()
  await page.waitForTimeout(1800)
  const persisted = await page.evaluate(
    async ({ projectId, planId }) => {
      const plans = await window.projectos.plans.list(projectId)
      return plans.plans.find((item) => item.id === planId)
    },
    { projectId: project.project.id, planId: plan.id },
  )
  if (persisted?.execution?.status !== 'completed') throw new Error('execution status did not persist')
  const retryTotal = Object.values(persisted.execution.retries ?? {}).reduce((sum, value) => sum + value, 0)
  if (retryTotal < 1) throw new Error('transient failure was not retried')
  if (errors.length) throw new Error(`renderer errors: ${errors.join(' | ')}`)

  console.log('V1.3 ORCHESTRATION E2E PASS — 4-task plan auto-executed to done, usage recorded, state persisted.')
  console.log(`  provider requests: ${requests}`)
  console.log(`  usage: ${usage.runs} runs / ${usage.inputTokens} input / ${usage.outputTokens} output tokens`)
  console.log(`  execution: ${persisted.execution.status} · ${persisted.execution.runIds.length} runs`)
  console.log(`  quality reports: ${reports.length}`)
  console.log(`  retries: ${retryTotal}`)
  console.log(`  worktree: ${finalPlan.execution.branch} · merged ${merged.mergedAt ? 'yes' : 'no'}`)
  passed = true
} catch (error) {
  console.error('V1.3 ORCHESTRATION E2E FAIL —', error instanceof Error ? error.message : error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: 'test-results/v13-orchestration-e2e-failure.png' })
    } catch {
      // ignore
    }
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  server.close()
  if (passed) rmSync(dataDir, { recursive: true, force: true })
}



