/**
 * V1.8 Phase-1 Teamwork regression E2E.
 *
 * Covers:
 *  1. Four Agents speak in a plan group chat, one turn at a time, with real counts.
 *  2. Two ready tasks for the same Agent do not fail the plan (serial queue).
 *  3. Different Agents still run in parallel; DAG dependencies still gate execution.
 *  4. An Agent bound to an unavailable Runtime cannot be approved as if it were usable.
 *
 * Uses a local fake OpenAI-compatible provider; no real model credentials.
 * The Electron app is isolated with --user-data-dir so a running ProjectOS
 * instance does not hold the single-instance lock.
 */
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-teamwork-e2e-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-teamwork-user-'))
const exec = promisify(execFile)

let requestCount = 0
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    requestCount += 1
    const index = requestCount
    let payload = {}
    try { payload = JSON.parse(body) } catch { /* ignore */ }
    setTimeout(() => {
      if (res.writableEnded || res.destroyed) return
      if (!payload.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: `reply-${index}` } }] }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: `reply-${index}` } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 5 } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }, 600)
  })
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_GROUP_TURN_TIMEOUT_MS: '20000',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

let app = null
const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${name}: ${detail ?? 'assertion failed'}`)
}

async function createProject(page, name) {
  const workspaceDir = join(dataDir, 'projects', name.replace(/[^a-zA-Z0-9_-]/g, '-'))
  mkdirSync(workspaceDir, { recursive: true })
  writeFileSync(join(workspaceDir, 'package.json'), JSON.stringify({ name, private: true, scripts: { test: 'node -e "process.exit(0)"' } }))
  const project = await page.evaluate(async ({ workspaceDir, name }) => window.projectos.projects.create({
    name,
    description: 'Phase-1 Teamwork E2E',
    rootPath: workspaceDir,
    createDirectory: false,
    initGit: true,
  }), { workspaceDir, name })
  await exec('git', ['add', '.'], { cwd: workspaceDir })
  await exec('git', ['-c', 'user.name=ProjectOS E2E', '-c', 'user.email=e2e@example.com', 'commit', '-m', 'initial'], { cwd: workspaceDir })
  return project.project
}

async function updatePlan(page, plan, tasks) {
  return page.evaluate(async ({ planId, tasks }) => window.projectos.plans.update({ planId, tasks }), { planId: plan.id, tasks })
}

async function seedArtifacts(page, projectId, items) {
  await page.evaluate(async ({ projectId, items }) => {
    for (const item of items) {
      await window.projectos.artifacts.create({ projectId, ...item })
    }
  }, { projectId, items })
}

async function waitForPlan(page, projectId, planId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  let latest = null
  while (Date.now() < deadline) {
    await page.waitForTimeout(500)
    latest = await page.evaluate(async ({ projectId, planId }) => {
      const plans = await window.projectos.plans.list(projectId)
      return plans.plans.find((item) => item.id === planId) ?? null
    }, { projectId, planId })
    if (latest?.execution?.status === 'completed' || latest?.execution?.status === 'failed' || latest?.execution?.status === 'cancelled') {
      return latest
    }
  }
  throw new Error(`plan did not settle: ${JSON.stringify(latest?.execution)}`)
}

async function waitForGroupSummary(page, groupId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await page.waitForTimeout(300)
    const detail = await page.evaluate(async (id) => window.projectos.sessions.get(id, 200), groupId)
    const summary = detail.messages.find((message) => message.metadata?.kind === 'group-summary')
    if (summary) return { detail, summary }
  }
  throw new Error('group summary did not appear')
}

try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  const pageErrors = []
  page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForTimeout(3200)
  await page.evaluate(async ({ baseUrl }) => window.projectos.settings.update({
    baseUrl,
    model: 'fake-teamwork-model',
    apiKey: 'test-key',
    temperature: 0,
  }), { baseUrl })

  // 1. Four-Agent group discussion.
  {
    const project = await createProject(page, 'group-chat')
    const plan = await page.evaluate(async (projectId) => window.projectos.plans.generate(projectId, '开发一个用户权限管理模块'), project.id)
    await page.evaluate(async (planId) => window.projectos.plans.approve(planId), plan.id)
    const sessions = await page.evaluate(async (projectId) => window.projectos.sessions.list(projectId), project.id)
    const group = sessions.sessions.find((session) => session.title.startsWith('计划群聊 ·'))
    if (!group) throw new Error('group session missing')
    const started = await page.evaluate(async ({ planId }) => window.projectos.plans.discuss(planId, '请确认权限模块的接口边界和分工。'), { planId: plan.id })
    check('group chat starts with truthful participants', started.participants === 4 && started.status === 'started' && started.queued === undefined, JSON.stringify(started))
    const { summary, detail } = await waitForGroupSummary(page, group.id)
    const assistant = detail.messages.filter((message) => message.role === 'assistant')
    check(
      'four Agents speak and summary reports 4/0',
      summary.metadata?.succeeded === 4 && summary.metadata?.failed === 0 && assistant.length === 4 && new Set(assistant.map((m) => m.agentName)).size === 4,
      `succeeded=${summary.metadata?.succeeded} failed=${summary.metadata?.failed} assistant=${assistant.length}`,
    )
    check('no Agent turn was rejected by the session mutex', !detail.messages.some((message) => message.content.includes('该会话已有运行中的 Agent')), 'clean transcript')
  }

  // 2. Same-Agent parallel ready tasks: serial queue, plan completes.
  {
    const project = await createProject(page, 'same-agent')
    const plan = await page.evaluate(async (projectId) => window.projectos.plans.generate(projectId, '同 Agent 并行修复'), project.id)
    await updatePlan(page, plan, [
      { key: 'impl-a', title: '同 Agent A', description: 'A', role: 'developer', agentId: 'agt_engineer', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['A 完成'], expectedArtifacts: [], requiresApproval: false },
      { key: 'impl-b', title: '同 Agent B', description: 'B', role: 'developer', agentId: 'agt_engineer', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['B 完成'], expectedArtifacts: [], requiresApproval: false },
    ])
    const approved = await page.evaluate(async (planId) => window.projectos.plans.approve(planId), plan.id)
    // The fake model only returns text; seed real completion Artifacts so this
    // scheduler E2E tests the strict completion evidence path explicitly.
    await seedArtifacts(page, project.id, approved.taskIds.map((taskId, index) => ({
      taskId,
      kind: 'code',
      title: `同 Agent 代码 ${index + 1}`,
      body: `export const sameAgent${index + 1} = true\n`,
    })))
    await page.evaluate(async (planId) => window.projectos.orchestration.start(planId, 2, 0), plan.id)
    const final = await waitForPlan(page, project.id, plan.id)
    const board = await page.evaluate(async (projectId) => window.projectos.tasks.board(projectId), project.id)
    const planTasks = board.tasks.filter((task) => approved.taskIds.includes(task.id))
    const runs = await page.evaluate(async (projectId) => window.projectos.runs.list(projectId, 50), project.id)
    const planRuns = runs.runs.filter((run) => approved.taskIds.includes(run.taskId))
    check(
      'same-Agent tasks serialize without failing the plan',
      final.execution?.status === 'completed' && planTasks.every((task) => task.status === 'done') && planRuns.length === 2 && planRuns.every((run) => run.status === 'completed'),
      `status=${final.execution?.status} tasks=${planTasks.map((t) => t.status).join(',')} runs=${planRuns.map((r) => r.status).join(',')}`,
    )
  }

  // 3. Different-Agent parallelism + DAG dependency gate.
  {
    const project = await createProject(page, 'parallel-dag')
    const plan = await page.evaluate(async (projectId) => window.projectos.plans.generate(projectId, '并行 DAG 验证'), project.id)
    await updatePlan(page, plan, [
      { key: 'arch', title: '架构分析', description: '分析影响面', role: 'architect', agentId: 'agt_architect', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['给出方案'], expectedArtifacts: [], requiresApproval: false },
      { key: 'impl', title: '并行实现', description: '实现模块', role: 'developer', agentId: 'agt_engineer', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['代码可构建'], expectedArtifacts: [], requiresApproval: true },
      { key: 'verify', title: '依赖后验证', description: '验证结果', role: 'tester', agentId: 'agt_qa', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: ['arch', 'impl'], acceptanceCriteria: ['记录命令'], expectedArtifacts: [], requiresApproval: true },
    ])
    const approved = await page.evaluate(async (planId) => window.projectos.plans.approve(planId), plan.id)
    await seedArtifacts(page, project.id, [
      { taskId: approved.taskIds[0], kind: 'design', title: '并行架构设计', body: '并行 DAG 架构设计' },
      { taskId: approved.taskIds[1], kind: 'code', title: '并行实现代码', body: 'export const parallel = true\n' },
    ])
    await page.evaluate(async (planId) => window.projectos.orchestration.start(planId, 2, 0), plan.id)
    const final = await waitForPlan(page, project.id, plan.id)
    const runs = await page.evaluate(async (projectId) => window.projectos.runs.list(projectId, 50), project.id)
    const planRuns = runs.runs.filter((run) => approved.taskIds.includes(run.taskId))
    const arch = planRuns.find((run) => run.taskId === approved.taskIds[0])
    const impl = planRuns.find((run) => run.taskId === approved.taskIds[1])
    const verify = planRuns.find((run) => run.taskId === approved.taskIds[2])
    const overlap = Math.min(arch?.finishedAt ?? 0, impl?.finishedAt ?? 0) - Math.max(arch?.startedAt ?? 0, impl?.startedAt ?? 0)
    const depsDone = Math.max(arch?.finishedAt ?? 0, impl?.finishedAt ?? 0)
    check(
      'different-Agent tasks overlap and the dependent task waits',
      final.execution?.status === 'completed' && overlap > 0 && Boolean(verify?.startedAt) && verify.startedAt >= depsDone,
      `overlapMs=${overlap} verifyStart=${verify?.startedAt} depsDone=${depsDone}`,
    )
  }

  // 4. Unavailable Runtime must block approval, never look successful.
  {
    const project = await createProject(page, 'runtime-unavailable')
    const profile = await page.evaluate(async () => window.projectos.runtimeProfiles.upsert({
      name: 'Missing Runtime E2E',
      protocol: 'cli',
      executable: 'C:\\__projectos_missing__\\missing-runtime.exe',
      endpoint: null,
      args: [],
      authRef: null,
      modelRef: null,
      options: {},
      capabilities: {},
    }))
    await page.evaluate(async (profileId) => window.projectos.runtimeProfiles.detect(profileId), profile.id)
    const profiles = await page.evaluate(async () => window.projectos.runtimeProfiles.list())
    const missing = profiles.profiles.find((item) => item.id === profile.id)
    check('missing Runtime is detected as unavailable', missing?.status === 'unavailable', `status=${missing?.status}`)
    const agent = await page.evaluate(async ({ profileId }) => window.projectos.agentDefinitions.upsert({
      name: 'Unavailable Runtime Agent',
      role: '开发工程师',
      description: 'E2E guard',
      category: 'code',
      avatar: '🤖',
      visibility: 'project',
      persona: { role: '开发工程师', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [],
      runtimeProfileIds: [profileId],
      primaryRuntimeProfileId: profileId,
      modelRef: null,
      permissions: { tools: [], files: true, shell: true, network: false },
    }), { profileId: profile.id })
    const plan = await page.evaluate(async (projectId) => window.projectos.plans.generate(projectId, '运行时不可用守卫'), project.id)
    const current = await page.evaluate(async (planId) => window.projectos.plans.get(planId), plan.id)
    await updatePlan(page, plan, current.tasks.map((task) => task.role === 'developer' ? {
      ...task,
      agentId: agent.id,
      assignmentReasons: ['用户手动指定'],
      assignmentBlocked: false,
    } : task))
    let approveError = ''
    try {
      await page.evaluate(async (planId) => window.projectos.plans.approve(planId), plan.id)
    } catch (error) {
      approveError = error instanceof Error ? error.message : String(error)
    }
    const board = await page.evaluate(async (projectId) => window.projectos.tasks.board(projectId), project.id)
    const done = board.tasks.filter((task) => task.status === 'done')
    check(
      'unavailable Runtime blocks approval and creates no done task',
      /Runtime|不可用/.test(approveError) && done.length === 0,
      `error=${approveError.slice(0, 200)} done=${done.length}`,
    )
  }

  if (pageErrors.length > 0) throw new Error(`renderer errors: ${pageErrors.join(' | ')}`)
  console.log(`\nV1.8 TEAMWORK E2E PASS — ${results.length} checks, ${requestCount} provider requests.`)
} catch (error) {
  console.error('V1.8 TEAMWORK E2E FAIL —', error instanceof Error ? error.stack : error)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  server.close()
  console.log('DATA DIR:', dataDir)
}
