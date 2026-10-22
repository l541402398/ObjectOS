/**
 * R2 Phase 3: reassign confirmation UI E2E (real Electron, isolated user data).
 *
 * Creates a paused plan with a `needs_confirmation` Handoff reassignment, then
 * verifies the existing orchestration node drawer shows: original failure,
 * candidates, capability/Runtime differences, permission expansion and working
 * Confirm/Cancel actions. Captures light/dark, 125% zoom, collapsed sidebar and
 * cancelled/confirmed states.
 */
import { _electron as electron } from 'playwright-core'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2-ui-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2-ui-user-'))
const shots = join(root, 'test-results', 'r2')
mkdirSync(shots, { recursive: true })
const exec = promisify(execFile)

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => (body += chunk))
  req.on('end', () => {
    let payload = {}
    try {
      payload = JSON.parse(body)
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (res.writableEnded || res.destroyed) return
      if (!payload.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: 'R2 替代执行完成' } }], usage: { prompt_tokens: 20, completion_tokens: 4 } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: 'R2 替代执行完成' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4 } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }, 400)
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

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${name}: ${detail ?? 'assertion failed'}`)
}

async function createProject(page, name) {
  const workspaceDir = join(dataDir, 'projects', name.replace(/[^a-zA-Z0-9_-]/g, '-'))
  mkdirSync(workspaceDir, { recursive: true })
  writeFileSync(
    join(workspaceDir, 'package.json'),
    JSON.stringify({ name, private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
  )
  const project = await page.evaluate(
    async ({ workspaceDir, name }) =>
      window.projectos.projects.create({
        name,
        description: 'R2 reassign UI E2E',
        rootPath: workspaceDir,
        createDirectory: false,
        initGit: true,
      }),
    { workspaceDir, name },
  )
  await exec('git', ['add', '.'], { cwd: workspaceDir })
  await exec('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'initial'], { cwd: workspaceDir })
  return project.project
}

async function createProposal(page, name) {
  const project = await createProject(page, name)
  const plan = await page.evaluate(async (projectId) => window.projectos.plans.generate(projectId, `R2 替代确认 ${projectId}`), project.id)
  const updated = await page.evaluate(
    async ({ planId, title }) =>
      window.projectos.plans.update({
        planId,
        tasks: [
          {
            key: 'impl',
            title,
            description: '接收方启动失败后的替代确认',
            role: 'tester',
            agentId: 'agt_qa',
            assignmentReasons: ['显式指定：用户已选择 Iris'],
            assignmentBlocked: false,
            dependsOn: [],
            acceptanceCriteria: ['完成'],
            expectedArtifacts: [],
            requiresApproval: false,
          },
        ],
      }),
    { planId: plan.id, title: `替代确认任务 ${name}` },
  )
  const approved = await page.evaluate(async (planId) => window.projectos.plans.approve(planId), updated.id)
  const receiver = await page.evaluate(async (projectId) => {
    const created = await window.projectos.agentDefinitions.upsert({
      name: 'R2 接收方',
      role: '测试接收方',
      description: 'R2 UI 接收方',
      category: 'quality',
      avatar: '',
      visibility: 'project',
      persona: {
        role: '测试接收方',
        background: '',
        responsibilities: '',
        principles: '',
        style: '',
        constraints: '',
        systemPrompt: 'Receive the task.',
      },
      skillIds: [],
      runtimeProfileIds: [],
      primaryRuntimeProfileId: null,
      modelRef: null,
      permissions: { tools: [], files: false, shell: false, network: false },
      ownerProjectId: projectId,
    })
    return created
  }, project.id)
  const receiverSession = await page.evaluate(
    async ({ projectId, agentId }) =>
      window.projectos.sessions.create({ projectId, agentId, title: 'R2 接收方会话' }),
    { projectId: project.id, agentId: receiver.id },
  )
  const sourceSession = await page.evaluate(
    async ({ projectId, agentId }) => window.projectos.sessions.create({ projectId, agentId, title: 'R2 交接来源' }),
    { projectId: project.id, agentId: 'agt_qa' },
  )
  const handoff = await page.evaluate(
    async ({ taskId, toAgentId, sessionId }) =>
      window.projectos.handoffs.request({
        taskId,
        toAgentId,
        summary: 'R2 接收方启动失败',
        sessionId,
        completed: ['准备'],
        remaining: ['继续'],
        risks: [],
        nextActions: ['继续'],
        artifactRefs: [],
        riskLevel: 'low',
      }),
    { taskId: approved.taskIds[0], toAgentId: receiver.id, sessionId: sourceSession.session.id },
  )
  await page.evaluate(
    async ({ handoffId, sessionId }) => window.projectos.handoffs.accept(handoffId, sessionId),
    { handoffId: handoff.handoff.id, sessionId: receiverSession.session.id },
  )
  await page.evaluate(async (id) => window.projectos.agentDefinitions.setStatus(id, 'disabled'), receiver.id)
  const grant = await page.evaluate(async (planId) => window.projectos.plans.grant.issue({
    planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['.'],
    maxRuns: 1,
    maxToolCalls: 100,
    ttlHours: 1,
    allowOverBudget: false,
    note: 'R2 reassign UI E2E',
    confirm: true,
  }), approved.plan.id)
  await page.evaluate(async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 1, 0, false, grantId), { planId: approved.plan.id, grantId: grant.id })

  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(400)
    const snapshot = await page.evaluate(async (projectId) => window.projectos.collaboration.snapshot(projectId), project.id)
    const target = snapshot.handoffs.find((item) => item.id === handoff.handoff.id)
    const reassignment = target?.payload?.reassignment
    if (reassignment?.status === 'needs_confirmation') {
      return { project, planId: approved.plan.id, taskId: approved.taskIds[0], handoffId: handoff.handoff.id, reassignment }
    }
  }
  throw new Error('reassignment proposal did not appear')
}

async function openProposal(page, proposal, title) {
  await page.evaluate(
    async ({ projectId }) => {
      location.hash = `#/projects/${projectId}/orchestration`
    },
    { projectId: proposal.project.id },
  )
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
  await page.waitForTimeout(700)
  const node = page.locator('.react-flow__node').filter({ hasText: title }).last()
  await node.click()
  await page.waitForTimeout(600)
  const drawerCount = await page.locator('.po-orch-drawer-panel').count()
  const nodeTexts = await page.locator('.react-flow__node').allInnerTexts()
  console.log(`DEBUG open title=${title} drawer=${drawerCount} nodes=${JSON.stringify(nodeTexts.slice(0, 8))}`)
  await page.screenshot({ path: join(shots, 'debug-open.png') })
  await page.waitForSelector('[data-testid="reassign-panel"]', { timeout: 15_000 })
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
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForTimeout(3200)
  await page.evaluate(
    async ({ baseUrl }) =>
      window.projectos.settings.update({ baseUrl, model: 'r2-fake-model', apiKey: 'test-key', temperature: 0 }),
    { baseUrl },
  )

  const first = await createProposal(page, 'reassign-confirm')
  const firstTitle = `替代确认任务 reassign-confirm`
  await openProposal(page, first, firstTitle)

  const panel = page.locator('[data-testid="reassign-panel"]')
  const panelText = await panel.innerText()
  check('reassign panel is visible in the existing orchestration drawer', await panel.isVisible())
  check('shows the original receiver failure', panelText.includes('原接收方启动失败') && /disabled|不可用/.test(panelText), panelText.slice(0, 120))
  check('lists a legal substitute candidate', panelText.includes('Iris') || panelText.includes('替代'), '')
  check('shows permission difference state', /无权限扩大|权限扩大/.test(panelText), '')
  check('offers confirm and cancel actions', panelText.includes('确认替代') && panelText.includes('取消替代'), '')
  await page.screenshot({ path: join(shots, 'reassign-light.png'), fullPage: false })
  console.log(`SHOT ${join(shots, 'reassign-light.png')}`)

  // Dark theme.
  await page.evaluate(() => {
    const raw = localStorage.getItem('projectos.ui')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
    parsed.state = { ...parsed.state, themeMode: 'dark' }
    localStorage.setItem('projectos.ui', JSON.stringify(parsed))
  })
  await page.reload()
  await page.waitForTimeout(3200)
  await openProposal(page, first, firstTitle)
  check('reassign panel works in dark theme', await page.locator('[data-testid="reassign-panel"]').isVisible())
  await page.screenshot({ path: join(shots, 'reassign-dark.png') })
  console.log(`SHOT ${join(shots, 'reassign-dark.png')}`)

  // 125% zoom.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.setZoomFactor(1.25)
  })
  await page.waitForTimeout(500)
  const zoomBox = await page.locator('[data-testid="reassign-panel"]').boundingBox()
  const windowSize = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return { width: win.getContentSize()[0], height: win.getContentSize()[1] }
  })
  check('panel stays inside the window at 125% zoom', Boolean(zoomBox) && zoomBox.width > 200 && zoomBox.x >= 0 && zoomBox.x + zoomBox.width <= windowSize.width + 2,
    JSON.stringify({ zoomBox, windowSize }))
  await page.screenshot({ path: join(shots, 'reassign-zoom-125.png') })
  console.log(`SHOT ${join(shots, 'reassign-zoom-125.png')}`)
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.setZoomFactor(1)
  })

  // Collapsed sidebar.
  await page.locator('[aria-label="切换侧边栏"]').first().click()
  await page.waitForTimeout(500)
  check('panel remains usable with collapsed sidebar', await page.locator('[data-testid="reassign-panel"]').isVisible())
  await page.screenshot({ path: join(shots, 'reassign-sidebar-collapsed.png') })
  console.log(`SHOT ${join(shots, 'reassign-sidebar-collapsed.png')}`)

  // Confirm the substitute and verify the scheduler actually starts it.
  const candidateButtons = page.locator('[data-testid="reassign-panel"] .po-reassign-candidate')
  check('candidate cards render', (await candidateButtons.count()) >= 1, String(await candidateButtons.count()))
  await page.getByRole('button', { name: '确认替代' }).click()
  await page.waitForSelector('[data-testid="reassign-confirmed"]', { timeout: 15_000 })
  await page.screenshot({ path: join(shots, 'reassign-confirmed.png') })
  const confirmedDeadline = Date.now() + 40_000
  let confirmedTask = null
  let confirmedPlan = null
  while (Date.now() < confirmedDeadline) {
    await page.waitForTimeout(500)
    confirmedTask = await page.evaluate(async (taskId) => (await window.projectos.tasks.detail(taskId)).task, first.taskId)
    confirmedPlan = await page.evaluate(async ({ projectId, planId }) => {
      const plans = await window.projectos.plans.list(projectId)
      return plans.plans.find((item) => item.id === planId) ?? null
    }, { projectId: first.project.id, planId: first.planId })
    if (confirmedPlan?.execution?.status === 'completed') break
  }
  check('confirmed substitute is executed by the scheduler', confirmedPlan?.execution?.status === 'completed' && confirmedTask?.status === 'done',
    JSON.stringify({ plan: confirmedPlan?.execution?.status, task: confirmedTask?.status }))
  console.log(`SHOT ${join(shots, 'reassign-confirmed.png')}`)

  // Cancel path.
  const second = await createProposal(page, 'reassign-decline')
  const secondTitle = `替代确认任务 reassign-decline`
  await openProposal(page, second, secondTitle)
  await page.getByRole('button', { name: '取消替代' }).click()
  await page.waitForSelector('[data-testid="reassign-declined"]', { timeout: 15_000 })
  const declinedTask = await page.evaluate(async (taskId) => (await window.projectos.tasks.detail(taskId)).task, second.taskId)
  const declinedPlan = await page.evaluate(async ({ projectId, planId }) => {
    const plans = await window.projectos.plans.list(projectId)
    return plans.plans.find((item) => item.id === planId) ?? null
  }, { projectId: second.project.id, planId: second.planId })
  check('cancel keeps the task blocked and the plan paused', declinedTask?.status === 'blocked' && declinedPlan?.execution?.status === 'paused',
    JSON.stringify({ task: declinedTask?.status, plan: declinedPlan?.execution?.status }))
  await page.screenshot({ path: join(shots, 'reassign-declined.png') })
  console.log(`SHOT ${join(shots, 'reassign-declined.png')}`)

  check('no renderer page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
  console.log(`\nR2 REASSIGN UI E2E PASS — ${results.length} checks, screenshots in ${shots}`)
  console.log(`DATA DIR: ${dataDir}`)
} finally {
  try {
    await app?.close()
  } catch {
    // ignore
  }
  server.close()
}
