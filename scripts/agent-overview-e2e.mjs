/**
 * Agent collaboration overview — real Electron E2E and screenshot evidence.
 *
 * Fixture: a real project + real plan/tasks + a local fake OpenAI-compatible provider (no credentials).
 * One task reaches a real waiting_approval Run (write_file approval), another stays in a real running
 * Run while the screenshot is taken, and the rest stay queued/blocked. Artifacts and a handoff are
 * persisted through the product APIs (seeded evidence, labelled as such in the report).
 *
 * Verifies: real agent/run/task/handoff/artifact data, status truthfulness, drill-down, 1024 focus mode,
 * dark theme, 125% zoom, reduced-motion behaviour and Runtime restart recovery.
 *
 * usage: node scripts/agent-overview-e2e.mjs
 */
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const exec = promisify(execFile)
const evidenceDir = resolve(process.env.PROJECTOS_OVERVIEW_EVIDENCE_DIR || join(root, 'docs/agent-overview/evidence'))
const shotDir = join(evidenceDir, 'screenshots')
mkdirSync(shotDir, { recursive: true })

const dataDir = mkdtempSync(join(tmpdir(), 'projectos-agent-overview-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-agent-overview-user-'))
const projectDir = join(dataDir, 'workspace')
mkdirSync(projectDir, { recursive: true })

const results = []
function record(name, status, detail = '') {
  const normalized = typeof status === 'boolean' ? (status ? 'PASS' : 'FAIL') : status
  results.push({ name, status: normalized, detail })
  console.log(`[${normalized}] ${name}${detail ? ` — ${detail}` : ''}`)
}

let requestCount = 0
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    requestCount += 1
    const index = requestCount
    let payload = {}
    try { payload = JSON.parse(body) } catch { /* ignore */ }
    const respondText = () => {
      if (res.writableEnded || res.destroyed) return
      if (!payload.stream) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { content: `reply-${index}` } }], usage: { prompt_tokens: 20, completion_tokens: 4 } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: `reply-${index}` } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 4 } })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    }
    if (index === 1) {
      // First Run hits a real approval: run_command always needs a human decision.
      setTimeout(() => {
        if (res.writableEnded || res.destroyed) return
        if (!payload.stream) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ choices: [{ message: { content: '需要执行一条命令，请授权。' } }] }))
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: '需要执行一条命令，请授权。' } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_overview_write', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'node -e "console.log(1)"', timeoutMs: 30000 }) } }] } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      }, 200)
      return
    }
    if (index === 2) {
      // Keep one Run genuinely running while evidence is captured, then answer if still connected.
      const timer = setTimeout(respondText, 120_000)
      res.on('close', () => clearTimeout(timer))
      return
    }
    setTimeout(respondText, 300)
  })
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
  PROJECTOS_GROUP_TURN_TIMEOUT_MS: '20000',
}
delete env.ELECTRON_RUN_AS_NODE

let app = null
let page = null
let win = null

async function launch() {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  page = await app.firstWindow()
  win = await app.browserWindow(page)
  page.on('pageerror', (error) => console.log('PAGE_EXCEPTION', error.message.slice(0, 240)))
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(2600)
  return page
}

async function openOverview(projectId) {
  await page.evaluate((id) => { window.location.hash = `#/projects/${id}/agents` }, projectId)
  await page.waitForSelector('.aco-root', { timeout: 30_000 })
  await page.waitForTimeout(1200)
}

async function shot(name) {
  await page.mouse.move(5, 5)
  // Native capture does not wait for Motion as Playwright screenshot does. Capture
  // the settled surface, then allow the Electron compositor to finish painting.
  await page.waitForFunction(() => [...document.querySelectorAll('.pui-overlay-surface:not(.is-closing)')]
    .filter(element => element.getBoundingClientRect().width > 0)
    .every(element => Number(getComputedStyle(element).opacity) >= .999))
  await page.waitForTimeout(1200)
  const bytes = await win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(shotDir, name), Buffer.from(bytes, 'base64'))
}

async function setWindow(width, height) {
  await win.evaluate((w, size) => w.setContentSize(size.width, size.height), { width, height })
  await page.waitForTimeout(450)
}

async function setTheme(theme) {
  const current = await page.evaluate(() => document.documentElement.dataset.theme)
  if (current === theme) return
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(350)
  await page.keyboard.type(theme === 'dark' ? '深色' : '浅色')
  await page.waitForTimeout(300)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(700)
}

try {
  await launch()
  await page.evaluate(async ({ baseUrl }) => window.projectos.settings.update({
    baseUrl,
    model: 'fake-overview-model',
    apiKey: 'test-key',
    temperature: 0,
  }), { baseUrl })
  await page.waitForTimeout(1200)

  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'agent-overview-e2e', private: true, scripts: { test: 'node -e "process.exit(0)"' } }))
  const project = await page.evaluate(async ({ projectDir }) => window.projectos.projects.create({
    name: 'Agent Overview E2E',
    description: 'Real collaboration overview fixture',
    rootPath: projectDir,
    createDirectory: false,
    initGit: true,
  }), { projectDir })
  const projectId = project.project.id
  await exec('git', ['add', '.'], { cwd: projectDir })
  await exec('git', ['-c', 'user.name=ProjectOS E2E', '-c', 'user.email=e2e@example.com', 'commit', '-m', 'initial'], { cwd: projectDir })

  const plan = await page.evaluate(async (id) => window.projectos.plans.generate(id, '实现 Agent 协作总览与真实运行追踪'), projectId)
  await page.evaluate(async ({ planId }) => window.projectos.plans.update({
    planId,
    tasks: [
      { key: 'arch', title: '梳理协作总览数据边界', description: '确认 Task/Run/Handoff/Artifact 关联', role: 'architect', agentId: 'agt_architect', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['给出真实对象关系'], expectedArtifacts: [], requiresApproval: false },
      { key: 'impl', title: '实现协作关系图与活动带', description: '按真实投影渲染', role: 'developer', agentId: 'agt_engineer', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: [], acceptanceCriteria: ['关系图可读'], expectedArtifacts: [], requiresApproval: false },
      { key: 'test', title: '真实 Electron 验证', description: '验证状态与下钻', role: 'tester', agentId: 'agt_qa', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: ['arch', 'impl'], acceptanceCriteria: ['截图与断言通过'], expectedArtifacts: [], requiresApproval: false },
      { key: 'review', title: '独立代码审查', description: '审查总览实现', role: 'reviewer', agentId: 'agt_reviewer', assignmentReasons: ['用户手动指定'], assignmentBlocked: false, dependsOn: ['test'], acceptanceCriteria: ['给出审查结论'], expectedArtifacts: [], requiresApproval: false },
    ],
  }), { planId: plan.id })
  const approved = await page.evaluate(async (planId) => window.projectos.plans.approve(planId), plan.id)
  const tasks = await page.evaluate(async (id) => window.projectos.tasks.board(id), projectId)
  const archTask = tasks.tasks.find((task) => task.id === approved.taskIds[0])
  const implTask = tasks.tasks.find((task) => task.id === approved.taskIds[1])
  const testTask = tasks.tasks.find((task) => task.id === approved.taskIds[2])

  // Persisted evidence fixtures (real Artifact rows, explicitly seeded for this E2E).
  await page.evaluate(async ({ projectId, taskId }) => {
    await window.projectos.artifacts.create({
      projectId,
      taskId,
      kind: 'design',
      title: '协作总览对象关系与状态映射',
      body: '# 对象关系\n\nTask → Run → Approval/Artifact；Handoff 只来自真实 handoffs 表。\n',
      uri: 'docs/agent-overview-design.md',
      metadata: { artifactType: 'design', source: 'agent-overview-e2e' },
    })
    await window.projectos.artifacts.create({
      projectId,
      taskId,
      kind: 'document',
      title: 'Agent 协作验收清单',
      body: '- 状态来自 Run 行\n- 产物来自 Artifact 行\n',
      metadata: { artifactType: 'document', source: 'agent-overview-e2e' },
    })
  }, { projectId, taskId: archTask.id })

  const archSession = await page.evaluate(async ({ projectId }) => window.projectos.sessions.create({
    projectId,
    agentId: 'agt_architect',
    title: '架构协作 · 总览边界',
  }), { projectId })
  await page.evaluate(async ({ taskId, sessionId }) => window.projectos.handoffs.request({
    taskId,
    toAgentId: 'agt_qa',
    sessionId,
    summary: '设计边界已确认，请接手 Electron 验证',
    completed: ['对象关系梳理'],
    remaining: ['真实 Electron 验证'],
    risks: ['并发运行状态需要截图时仍在运行'],
    nextActions: ['启动验证'],
    riskLevel: 'low',
  }), { taskId: archTask.id, sessionId: archSession.session.id })

  const grant = await page.evaluate(async (planId) => window.projectos.plans.grant.issue({
    planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['.'],
    maxRuns: 4,
    maxToolCalls: 100,
    ttlHours: 1,
    allowOverBudget: false,
    note: 'Agent overview E2E',
    confirm: true,
  }), plan.id)
  await page.evaluate(async ({ planId, grantId }) => {
    try {
      await window.projectos.orchestration.start(planId, 2, 0, false, grantId)
    } catch (error) {
      // The autonomy coordinator may start a granted plan between grant and this call. That is the
      // same outcome, so only re-throw a genuinely different failure.
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('已经在执行中')) throw error
    }
  }, { planId: plan.id, grantId: grant.id })

  const debug = await page.evaluate(async (id) => {
    const plans = await window.projectos.plans.list(id)
    const board = await window.projectos.tasks.board(id)
    const runs = await window.projectos.runs.list(id, 20)
    return {
      execution: plans.plans[0]?.execution ?? null,
      tasks: board.tasks.map((task) => `${task.title}:${task.status}`),
      runs: runs.runs.map((run) => `${run.status}:${run.taskId}`),
    }
  }, projectId)
  console.log('DEBUG', JSON.stringify(debug).slice(0, 900))

  await page.waitForFunction(async (id) => {
    const overview = await window.projectos.collaboration.overview(id)
    return overview.metrics.pendingApprovals >= 1
      && overview.agents.filter((agent) => agent.status === 'working').length >= 2
      && overview.metrics.artifacts >= 2
  }, projectId, { timeout: 120_000 })
  await page.waitForTimeout(600)

  let projection = await page.evaluate(async (id) => window.projectos.collaboration.overview(id), projectId)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (projection.metrics.pendingApprovals >= 1 && projection.metrics.workingAgents >= 2) break
    await page.waitForTimeout(1_000)
    projection = await page.evaluate(async (id) => window.projectos.collaboration.overview(id), projectId)
  }
  record('真实投影：审批、运行中 Agent、产物同时存在', projection.metrics.pendingApprovals >= 1 && projection.metrics.workingAgents >= 2 && projection.artifacts.length >= 2,
    `approvals=${projection.metrics.pendingApprovals} working=${projection.metrics.workingAgents} artifacts=${projection.artifacts.length} handoffs=${projection.handoffs.length}`)
  record('投影包含真实计划与依赖任务', Boolean(projection.plan) && projection.tasks.length >= 4 && projection.plan.taskIds.length >= 4,
    `plan=${projection.plan?.id ?? 'none'} tasks=${projection.tasks.length} planTaskIds=${projection.plan?.taskIds.length ?? 0}`)
  record('存在真实 Handoff 行', projection.handoffs.some((handoff) => handoff.status === 'requested' || handoff.status === 'accepted'),
    `handoffs=${projection.handoffs.map((handoff) => handoff.status).join(',')}`)

  await openOverview(projectId)
  await setWindow(1440, 900)
  await setTheme('light')
  await page.waitForTimeout(5000)
  const ui = await page.evaluate(() => ({
    agents: document.querySelectorAll('.aco-gnode-agent').length,
    waiting: [...document.querySelectorAll('.aco-pill')].filter((node) => node.textContent?.includes('等待审批')).length,
    tasks: document.querySelectorAll('.aco-gnode-task').length,
    artifacts: document.querySelectorAll('.aco-gnode-artifact').length,
    approvals: document.querySelectorAll('.aco-gnode-approval').length,
    handoffHint: document.querySelectorAll('.aco-canvas-hint.is-handoff').length,
    activity: document.querySelector('.aco-activity')?.textContent ?? '',
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  record('全图渲染真实 Agent/任务/审批/产物/交接', ui.agents >= 4 && ui.waiting >= 1 && ui.tasks >= 3 && ui.artifacts >= 2 && ui.approvals >= 1 && ui.handoffHint >= 1,
    JSON.stringify(ui).slice(0, 280))
  const edgeDebug = await page.evaluate(() => ({
    edges: document.querySelectorAll('.aco-edge').length,
    handoffEdges: document.querySelectorAll('.aco-edge-handoff').length,
    paths: [...document.querySelectorAll('.aco-edge path')].slice(0, 3).map((path) => ({
      stroke: getComputedStyle(path).stroke,
      width: getComputedStyle(path).strokeWidth,
    })),
  }))
  record('图中存在真实关系连线', edgeDebug.edges >= 8 && edgeDebug.handoffEdges >= 1, JSON.stringify(edgeDebug))
  record('1440 无横向溢出', ui.overflowX === 0, `overflow=${ui.overflowX}`)
  const styleProbe = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    shellBefore: getComputedStyle(document.querySelector('.po-shell'), '::before').backgroundImage.slice(0, 160),
    sidebar: getComputedStyle(document.querySelector('.po-sidebar')).backgroundImage.slice(0, 160),
    uiGlass: getComputedStyle(document.documentElement).getPropertyValue('--ui-glass'),
    pdlCanvas: getComputedStyle(document.documentElement).getPropertyValue('--pdl-canvas').slice(0, 80),
    nxAccent: getComputedStyle(document.documentElement).getPropertyValue('--nx-accent'),
    journey: document.querySelector('.po-journey-action') ? getComputedStyle(document.querySelector('.po-journey-action')).backgroundImage.slice(0, 160) : 'none',
    navActive: document.querySelector('.po-nav-item.is-active') ? { bg: getComputedStyle(document.querySelector('.po-nav-item.is-active')).backgroundColor, color: getComputedStyle(document.querySelector('.po-nav-item.is-active')).color } : null,
  }))
  console.log('STYLE_PROBE', JSON.stringify(styleProbe))
  await shot('overview-1440-light.png')

  // P1-C production visual masters: project home and review room, using the same real project,
  // plan, tasks, runs and pending approval. No demo data is injected for these screenshots.
  await page.evaluate((id) => { window.location.hash = `#/projects/${id}` }, projectId)
  await page.waitForSelector('.studio-home', { timeout: 20_000 })
  await page.waitForTimeout(900)
  const homeFacts = await page.evaluate(() => ({
    heading: document.querySelector('.studio-home h1')?.textContent ?? '',
    mission: document.querySelector('.studio-hero h2')?.textContent ?? '',
    pending: document.querySelectorAll('.studio-approval-row').length,
  }))
  record('项目首页使用真实项目/计划/审批数据', homeFacts.heading.includes('Agent Overview E2E') && homeFacts.pending >= 1, JSON.stringify(homeFacts))
  await shot('studio-project-home-1440-light.png')
  await setWindow(1024, 768)
  await page.waitForTimeout(500)
  await shot('studio-project-home-1024-light.png')
  await setTheme('dark')
  await page.waitForTimeout(400)
  await shot('studio-project-home-1024-dark.png')
  await setWindow(1440, 900)
  await page.waitForTimeout(400)
  await shot('studio-project-home-1440-dark.png')
  await setTheme('light')
  await win.evaluate((w) => w.webContents.setZoomFactor(1.25))
  await page.waitForTimeout(500)
  await shot('studio-project-home-1440-125.png')
  await win.evaluate((w) => w.webContents.setZoomFactor(1))
  await page.waitForTimeout(400)

  await page.evaluate((id) => { window.location.hash = `#/projects/${id}/approvals` }, projectId)
  await page.waitForSelector('.studio-review', { timeout: 20_000 })
  await page.waitForTimeout(800)
  const reviewFacts = await page.evaluate(() => ({
    queue: document.querySelectorAll('.studio-review-queue button').length,
    title: document.querySelector('.studio-review-document h2')?.textContent ?? '',
    hasRequest: Boolean(document.querySelector('.studio-evidence pre')),
  }))
  record('审批评审室显示真实队列与请求证据', reviewFacts.queue >= 1 && reviewFacts.hasRequest, JSON.stringify(reviewFacts))
  await shot('studio-review-1440-light.png')
  await setWindow(1024, 768)
  await page.waitForTimeout(500)
  await shot('studio-review-1024-light.png')
  await setTheme('dark')
  await page.waitForTimeout(400)
  await shot('studio-review-1024-dark.png')
  await setWindow(1440, 900)
  await page.waitForTimeout(400)
  await shot('studio-review-1440-dark.png')
  await setTheme('light')
  await win.evaluate((w) => w.webContents.setZoomFactor(1.25))
  await page.waitForTimeout(500)
  await shot('studio-review-1440-125.png')
  await win.evaluate((w) => w.webContents.setZoomFactor(1))
  await page.waitForTimeout(400)

  // Cross-page shell continuity: business pages keep their old compositions in this phase but must
  // share the approved optical frame. These are baseline captures, not claimed composition redesigns.
  for (const [route, file] of [
    ['tasks', 'unification-tasks-1440-light.png'],
    ['runs', 'unification-runs-1440-light.png'],
    ['approvals/center', 'unification-approval-center-1440-light.png'],
  ]) {
    await page.evaluate((hash) => { window.location.hash = hash }, `#/projects/${projectId}/${route}`)
    const heading = route === 'tasks' ? '任务看板' : route === 'runs' ? '运行审计' : '审批工作台'
    await page.getByRole('heading', { name: heading, exact: true }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(900)
    await shot(file)
  }
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(350)
  await page.keyboard.type('设置')
  await page.waitForTimeout(350)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.ant-modal-content, [role="dialog"]', { timeout: 10_000 })
  await page.waitForTimeout(500)
  await shot('unification-settings-1440-light.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  await openOverview(projectId)
  await page.waitForTimeout(800)

  // Idle agents must not enter the ELK canvas or fitView; they live in the standby dock.
  const standby = await page.evaluate(() => ({
    graphAgents: document.querySelectorAll('.aco-gnode-agent').length,
    standbyDock: Boolean(document.querySelector('[data-testid="standby-agents"]')),
    standbyLabel: document.querySelector('.aco-standby-toggle')?.textContent ?? '',
    idleInGraph: Boolean(document.querySelector('[data-testid="collaboration-agent-agt_product"]')),
  }))
  record('空闲 Agent 退出主图并收进待命区', standby.graphAgents === 4 && standby.standbyDock && standby.idleInGraph === false,
    JSON.stringify(standby))
  await page.locator('.aco-standby-toggle').click()
  await page.waitForSelector('.aco-standby-list', { timeout: 5_000 })
  const standbyRows = await page.locator('.aco-standby-row').count()
  record('待命 Agent 区域可展开且仍可查看', standbyRows >= 1, `rows=${standbyRows}`)
  await shot('overview-1440-standby.png')
  await page.locator('.aco-standby-toggle').click()

  // Pixel proof: screenshot once with the relationship layer and once without it. DOM path count
  // alone is not accepted; the diff must contain visible edge pixels inside the canvas.
  const canvasBox = await page.locator('.aco-canvas').boundingBox()
  if (!canvasBox) throw new Error('collaboration canvas not visible')
  const withEdges = await page.screenshot({ clip: canvasBox, animations: 'disabled' })
  const hideEdges = await page.addStyleTag({ content: '.aco-edge-layer{display:none!important}' })
  const withoutEdges = await page.screenshot({ clip: canvasBox, animations: 'disabled' })
  await hideEdges.evaluate((node) => node.remove())
  const pixelDiff = await page.evaluate(async ({ a, b }) => {
    const decode = async (base64) => {
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
      return createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    }
    const [first, second] = await Promise.all([decode(a), decode(b)])
    const canvas = document.createElement('canvas')
    canvas.width = first.width
    canvas.height = first.height
    const context = canvas.getContext('2d')
    if (!context) return { visiblePixels: 0, total: 0 }
    context.drawImage(first, 0, 0)
    const firstData = context.getImageData(0, 0, canvas.width, canvas.height).data
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(second, 0, 0)
    const secondData = context.getImageData(0, 0, canvas.width, canvas.height).data
    let visiblePixels = 0
    for (let index = 0; index < firstData.length; index += 4) {
      const delta = Math.abs(firstData[index] - secondData[index])
        + Math.abs(firstData[index + 1] - secondData[index + 1])
        + Math.abs(firstData[index + 2] - secondData[index + 2])
      if (delta > 40) visiblePixels += 1
    }
    return { visiblePixels, total: canvas.width * canvas.height }
  }, { a: withEdges.toString('base64'), b: withoutEdges.toString('base64') })
  record('连线在真实截图像素中可见', pixelDiff.visiblePixels > 500, JSON.stringify(pixelDiff))

  const edgeAlignment = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((node) => {
      const rect = node.getBoundingClientRect()
      return { id: node.getAttribute('data-id') ?? '', left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    })
    const distance = (x, y, rect) => {
      const dx = Math.max(rect.left - x, 0, x - rect.right)
      const dy = Math.max(rect.top - y, 0, y - rect.bottom)
      return Math.hypot(dx, dy)
    }
    let aligned = 0
    const edges = [...document.querySelectorAll('.aco-edge path')]
    const records = []
    for (const path of edges) {
      const matrix = path.getScreenCTM()
      if (!matrix) continue
      const start = path.getPointAtLength(0).matrixTransform(matrix)
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix)
      const startDistance = Math.min(...nodes.map((node) => distance(start.x, start.y, node)))
      const endDistance = Math.min(...nodes.map((node) => distance(end.x, end.y, node)))
      if (startDistance <= 28 && endDistance <= 28) aligned += 1
      records.push({ startDistance: Math.round(startDistance), endDistance: Math.round(endDistance) })
    }
    return { edges: edges.length, aligned, sample: records.slice(0, 4) }
  })
  record('边端点与节点边界对齐', edgeAlignment.edges >= 8 && edgeAlignment.aligned >= edgeAlignment.edges - 1, JSON.stringify(edgeAlignment))

  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
  await page.mouse.wheel(0, -320)
  await page.waitForTimeout(500)
  const zoomedAlignment = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((node) => {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    })
    const distance = (x, y, rect) => {
      const dx = Math.max(rect.left - x, 0, x - rect.right)
      const dy = Math.max(rect.top - y, 0, y - rect.bottom)
      return Math.hypot(dx, dy)
    }
    let aligned = 0
    const edges = [...document.querySelectorAll('.aco-edge path')]
    for (const path of edges) {
      const matrix = path.getScreenCTM()
      if (!matrix) continue
      const start = path.getPointAtLength(0).matrixTransform(matrix)
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix)
      if (Math.min(...nodes.map((node) => distance(start.x, start.y, node))) <= 28
        && Math.min(...nodes.map((node) => distance(end.x, end.y, node))) <= 28) aligned += 1
    }
    return { edges: edges.length, aligned, zoom: new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')).transform).a }
  })
  record('缩放后连线端点仍对齐', zoomedAlignment.edges >= 8 && zoomedAlignment.aligned >= zoomedAlignment.edges - 1, JSON.stringify(zoomedAlignment))
  await shot('overview-1440-zoom.png')
  await page.locator('.react-flow__controls-fitview').click({ timeout: 3_000 }).catch(() => undefined)
  await page.waitForTimeout(400)

  // In-node approval uses the real decision API, requires explicit risk confirmation and rejects
  // a duplicate decision after the persisted status changes.
  const pendingApproval = (await page.evaluate(async (id) => window.projectos.collaboration.overview(id), projectId)).approvals.find((approval) => approval.status === 'pending')
  if (pendingApproval) {
    await page.locator(`[data-testid="collaboration-approval-${pendingApproval.id}"]`).click()
    await page.waitForSelector('[data-testid="collaboration-inspector"]', { timeout: 10_000 })
    const approvalRequest = await page.locator('[data-testid="approval-request"]').textContent()
    record('点击审批节点加载真实请求参数', Boolean(approvalRequest?.includes('run_command') && approvalRequest.includes('command')), (approvalRequest ?? '').slice(0, 160))
    await page.getByRole('button', { name: '允许本次' }).click()
    await page.waitForSelector('[data-testid="approval-confirm"]', { timeout: 5_000 })
    const confirmDisabledBeforeRisk = await page.getByRole('button', { name: '确认允许本次' }).isDisabled()
    record('未确认风险范围时禁止批准', confirmDisabledBeforeRisk === true, `disabled=${confirmDisabledBeforeRisk}`)
    await shot('approval-inline-confirm.png')
    await page.getByRole('checkbox').check()
    await page.getByRole('button', { name: '确认允许本次' }).click()
    await page.waitForSelector('[data-testid="collaboration-inspector"]', { state: 'detached', timeout: 15_000 })
    await page.waitForTimeout(1_200)
    const afterApproval = await page.evaluate(async (id) => window.projectos.collaboration.overview(id), projectId)
    const stillPending = afterApproval.approvals.some((approval) => approval.id === pendingApproval.id && approval.status === 'pending')
    record('节点审批真实写入并刷新 Run 状态', stillPending === false,
      `pending=${stillPending} status=${afterApproval.approvals.find((approval) => approval.id === pendingApproval.id)?.status ?? 'removed'}`)
    const duplicateDecision = await page.evaluate(async (approvalId) => {
      try {
        await window.projectos.approvals.decide({ approvalId, decision: 'approved', note: 'duplicate probe' })
        return 'accepted'
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }, pendingApproval.id)
    record('重复审批被服务端拒绝', duplicateDecision !== 'accepted', duplicateDecision.slice(0, 160))
    await shot('overview-1440-approved.png')
  } else {
    record('点击审批节点加载真实请求参数', 'SKIP', 'fixture 没有 pending approval')
  }

  // Artifact node opens the inspector with the real persisted body.
  await page.locator('.aco-gnode-artifact').filter({ hasText: '协作总览对象关系' }).first().click()
  await page.waitForSelector('[data-testid="collaboration-inspector"]', { timeout: 10_000 })
  const sheet = await page.evaluate(() => ({
    title: document.querySelector('[data-testid="collaboration-inspector"] h2')?.textContent ?? '',
    body: document.querySelector('[data-testid="collaboration-inspector"] pre')?.textContent ?? '',
    detailRows: document.querySelectorAll('[data-testid="collaboration-inspector"] .aco-detail-list > div').length,
  }))
  record('点击产物节点加载真实 Artifact 详情', sheet.title.includes('协作总览') && sheet.body.includes('对象关系') && sheet.detailRows >= 5, JSON.stringify(sheet).slice(0, 240))
  await shot('artifact-inspector-1440-light.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)

  // Agent node → compact execution context, while the same graph remains the workspace.
  const currentOverview = await page.evaluate(async (id) => window.projectos.collaboration.overview(id), projectId)
  const workingAgentId = currentOverview.agents.find((agent) => agent.activeSessionId)?.id ?? currentOverview.agents[0]?.id
  await page.locator(`[data-testid="collaboration-agent-${workingAgentId}"]`).click()
  await page.waitForSelector('[data-testid="collaboration-inspector"]', { timeout: 10_000 })
  const agentInspector = await page.evaluate(() => document.querySelector('[data-testid="collaboration-inspector"]')?.textContent ?? '')
  record('点击 Agent 节点加载真实 Agent/Run 详情', agentInspector.includes('活动 Run') && agentInspector.includes('待审批'), agentInspector.slice(0, 160))
  await shot('agent-inspector-1440-light.png')
  await page.waitForSelector('[data-testid="agent-context-actions"]', { timeout: 10_000 })
  const graphContext = await page.evaluate(() => ({
    graph: Boolean(document.querySelector('[data-testid="collaboration-graph"]')),
    prompt: Boolean(document.querySelector('[data-testid="agent-context-prompt"]')),
    session: Boolean(document.querySelector('[data-testid="agent-context-session"]')),
    chat: Boolean(document.querySelector('.po-agent-workspace, .po-sender')),
    oldEntry: [...document.querySelectorAll('button')].some(button => /^(打开会话|会话工作台)$/.test(button.textContent?.trim() ?? '')),
  }))
  record('Agent 指令在图对象详情内且无旧整页聊天入口', graphContext.graph && graphContext.prompt && graphContext.session && !graphContext.chat && !graphContext.oldEntry, JSON.stringify(graphContext))
  const legacySessionId = currentOverview.agents.find(agent => agent.id === workingAgentId)?.activeSessionId
  if (legacySessionId) {
    await page.evaluate(({projectId,sessionId})=>{window.location.hash=`#/projects/${projectId}/agents?workspace=sessions&session=${encodeURIComponent(sessionId)}`},{projectId,sessionId:legacySessionId})
    await page.waitForFunction((sessionId)=>!window.location.hash.includes('workspace=sessions')&&document.querySelector('[data-testid="agent-context-session"]')?.value===sessionId,legacySessionId,{timeout:15_000})
    const legacyLanding=await page.evaluate(()=>({graph:Boolean(document.querySelector('[data-testid="collaboration-graph"]')),chat:Boolean(document.querySelector('.po-agent-workspace, .po-sender')),hash:window.location.hash}))
    record('旧会话深链接归位到同一协作图上下文',legacyLanding.graph&&!legacyLanding.chat,JSON.stringify(legacyLanding))
  } else record('旧会话深链接归位到同一协作图上下文','SKIP','该 Agent 没有持久化会话可用于深链接')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="collaboration-inspector"]', { state: 'detached', timeout: 5_000 })

  await page.getByRole('button', { name: '计划 DAG' }).click()
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  const planReturn = await page.getByRole('button', { name: '返回协作图' }).count()
  record('计划 DAG 有返回协作图入口', planReturn === 1, `buttons=${planReturn}`)
  await page.getByRole('button', { name: '返回协作图' }).click()
  await page.waitForSelector('.aco-root', { timeout: 15_000 })
  record('计划 DAG 返回协作图', true, 'returned to .aco-root')

  // Activity drill-down to the real approval/run route.
  const activityButton = page.locator('.aco-activity .aco-btn')
  await activityButton.click()
  await page.waitForTimeout(900)
  const routeAfterActivity = await page.evaluate(() => window.location.hash)
  record('底部活动可下钻到真实审批/运行路由', routeAfterActivity.includes('/approvals') || routeAfterActivity.includes('/runs'), routeAfterActivity)
  await page.goBack()
  await page.waitForSelector('.aco-root', { timeout: 15_000 })

  await setTheme('dark')
  await page.waitForTimeout(600)
  const darkInk = await page.evaluate(() => getComputedStyle(document.querySelector('.aco-root')).getPropertyValue('--pw-ink').trim())
  record('深色主题 token 生效', darkInk.toLowerCase() === '#eff4ff', `ink=${darkInk}`)
  await shot('overview-1440-dark.png')
  await setTheme('light')

  await setWindow(1024, 768)
  await page.waitForTimeout(600)
  const narrow = await page.evaluate(() => ({
    canvas: Boolean(document.querySelector('.aco-canvas')),
    filters: document.querySelectorAll('.aco-filters button').length,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    visibleTasks: [...document.querySelectorAll('.aco-gnode-task')].filter((node) => getComputedStyle(node).display !== 'none').length,
  }))
  record('1024 保持全图而非三栏', narrow.canvas && narrow.filters === 4 && narrow.overflowX === 0 && narrow.visibleTasks >= 3, JSON.stringify(narrow))
  await shot('overview-1024-all.png')
  await page.locator('.aco-filters button').nth(1).click()
  await page.waitForTimeout(600)
  const agentFilter = await page.evaluate(() => ({
    agents: [...document.querySelectorAll('.aco-gnode-agent')].filter((node) => getComputedStyle(node).display !== 'none').length,
    tasks: [...document.querySelectorAll('.aco-gnode-task')].filter((node) => getComputedStyle(node).display !== 'none').length,
  }))
  record('1024 图内筛选只显示 Agent', agentFilter.agents >= 4 && agentFilter.tasks === 0, JSON.stringify(agentFilter))
  await shot('overview-1024-agents.png')
  await page.locator('.aco-filters button').nth(2).click()
  await page.waitForTimeout(500)
  await shot('overview-1024-tasks.png')
  await page.locator('.aco-filters button').nth(0).click()
  await setWindow(1440, 900)

  await win.evaluate((w) => w.webContents.setZoomFactor(1.25))
  await page.waitForTimeout(700)
  const zoom = await page.evaluate(() => ({ dpr: window.devicePixelRatio, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth }))
  record('125% 缩放真实生效且无溢出', Math.abs(zoom.dpr - 1.25) < 0.01 && zoom.overflowX === 0, JSON.stringify(zoom))
  await shot('overview-1440-light-125.png')
  await win.evaluate((w) => w.webContents.setZoomFactor(1))

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await page.waitForSelector('.aco-root', { timeout: 20_000 })
  await page.waitForTimeout(800)
  const reduced = await page.evaluate(() => {
    const handoff = document.querySelector('.aco-edge-handoff path')
    return {
      media: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      handoffDuration: handoff ? getComputedStyle(handoff).animationDuration : 'none',
    }
  })
  record('reduce-motion 下关闭交接流动动画', reduced.media && (reduced.handoffDuration === 'none' || Number.parseFloat(reduced.handoffDuration) < 0.01), JSON.stringify(reduced))
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  // Runtime restart: same data dir, persisted rows must rebuild the projection.
  await app.close()
  app = null
  await launch()
  const projectionAfter = await page.evaluate(async (id) => window.projectos.collaboration.overview(id), projectId)
  await openOverview(projectId)
  await page.waitForFunction(() => document.querySelectorAll('.aco-gnode-agent').length >= 3, null, { timeout: 30_000 })
  await page.waitForTimeout(1200)
  const restored = await page.evaluate(() => ({
    agents: document.querySelectorAll('.aco-gnode-agent').length,
    artifacts: document.querySelectorAll('.aco-gnode-artifact').length,
    waiting: [...document.querySelectorAll('.aco-pill')].filter((node) => node.textContent?.includes('等待审批')).length,
  }))
  const approvalPersisted = projectionAfter.approvals.some((approval) => approval.id === pendingApproval?.id && approval.status === 'approved')
  record('Runtime 重启后真实状态恢复', restored.agents >= 4 && restored.artifacts >= 2 && projectionAfter.tasks.length >= 4 && (approvalPersisted || projectionAfter.metrics.pendingApprovals >= 1),
    JSON.stringify({ restored, approvals: projectionAfter.metrics.pendingApprovals, approvedPersisted: approvalPersisted }))
  await shot('overview-1440-restart-light.png')

  writeFileSync(join(evidenceDir, 'electron-checks.json'), `${JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      projectId,
      planId: plan.id,
      taskIds: approved.taskIds,
      fixture: 'real project/plan/tasks/runs/approvals/artifacts/handoff; local fake OpenAI-compatible provider, no real credentials',
      providerRequests: requestCount,
    },
    results,
    summary: {
      pass: results.filter((item) => item.status === 'PASS').length,
      fail: results.filter((item) => item.status === 'FAIL').length,
    },
  }, null, 2)}\n`, 'utf8')

  console.log('\n===== AGENT OVERVIEW E2E =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((item) => item.status === 'PASS').length} FAIL=${results.filter((item) => item.status === 'FAIL').length}`)
  console.log(`workdir: ${dataDir}`)
  if (results.some((item) => item.status === 'FAIL')) process.exitCode = 1
} catch (error) {
  record('Agent 协作总览 E2E', 'FAIL', String(error).slice(0, 500))
  console.error(error)
  writeFileSync(join(evidenceDir, 'electron-checks.json'), `${JSON.stringify({ results, error: String(error) }, null, 2)}\n`, 'utf8')
  process.exitCode = 1
} finally {
  try { await app?.close() } catch { /* ignore */ }
  server.close()
}
