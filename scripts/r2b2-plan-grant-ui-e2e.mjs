/**
 * Phase 2B-2 plan-grant UI regression.
 *
 * Uses a deterministic local provider for planner output and one scoped
 * write_file tool call. Real Electron mouse/keyboard only: approve plan, issue
 * a scoped grant, start execution, observe the granted write, and revoke.
 * Screenshots cover light, dark, revoked and 125% zoom states.
 */
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b2-ui-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b2-ui-user-'))
const shots = join(root, 'test-results', 'r2b2')
mkdirSync(shots, { recursive: true })

let plannerCalls = 0
let agentCalls = 0

const PLAN = JSON.stringify({
  assumptions: ['项目已有 React 与 TypeScript 结构'],
  risks: ['测试脚本为占位实现'],
  tasks: [
    {
      key: 'write-notes',
      title: '写入授权范围内的说明文件',
      description: '在 src/notes.txt 写入一行授权验证内容，并确认文件可读。',
      role: 'developer',
      capabilities: ['implement'],
      hardCapabilities: [],
      dependsOn: [],
      acceptanceCriteria: ['src/notes.txt 内容为 granted by plan', '记录真实写入结果'],
      expectedArtifacts: ['代码 diff'],
      rationale: '验证计划授权能在指定路径内完成低风险写文件。',
      requiresApproval: true,
    },
  ],
})

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    let payload = {}
    try { payload = JSON.parse(body) } catch { /* ignored */ }
    const messages = payload.messages ?? []
    const system = messages.find((message) => message.role === 'system')?.content ?? ''
    const isPlanner = system.includes('AI 规划器')
    const hasToolResult = messages.some((message) => message.role === 'tool')
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    if (isPlanner) {
      plannerCalls += 1
      for (const chunk of PLAN.match(/.{1,180}/gs) ?? [PLAN]) {
        sse(res, { choices: [{ delta: { content: chunk } }] })
      }
      sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 400, completion_tokens: 200 } })
    } else if (hasToolResult) {
      agentCalls += 1
      sse(res, { choices: [{ delta: { content: '文件已写入并通过读取确认。' } }] })
      sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 80, completion_tokens: 20 } })
    } else {
      agentCalls += 1
      sse(res, {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: 'call_grant_write',
              type: 'function',
              function: { name: 'write_file', arguments: JSON.stringify({ path: 'src/notes.txt', content: 'granted by plan' }) },
            }],
          },
        }],
      })
      sse(res, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    }
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
  await page.waitForTimeout(3400)
  await page.waitForSelector('#po-main')

  await page.evaluate(async ({ baseUrl }) => window.projectos.settings.update({
    baseUrl,
    model: 'fake-grant-model',
    apiKey: 'test-key',
    temperature: 0,
  }), { baseUrl })

  const workspaceDir = join(dataDir, 'grant-project')
  mkdirSync(join(workspaceDir, 'src'), { recursive: true })
  writeFileSync(join(workspaceDir, 'package.json'), JSON.stringify({
    name: 'r2b2-grant-ui',
    private: true,
    scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
  }, null, 2))
  writeFileSync(join(workspaceDir, 'README.md'), '# Grant UI fixture\n')
  const project = await page.evaluate(async ({ workspaceDir }) => (await window.projectos.projects.create({
    name: 'R2B2 Grant UI',
    description: 'Plan execution grant UI fixture',
    rootPath: workspaceDir,
    createDirectory: false,
    initGit: false,
  })).project, { workspaceDir })
  await page.evaluate(async (projectId) => window.projectos.projectAnalysis.scan(projectId), project.id)
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(1000)

  await page.locator('.po-orch-actions').getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('[data-testid="plan-generate"]', { timeout: 10_000 })
  await page.locator('.po-plan-modal textarea').first().fill('在授权范围内写入说明文件')
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-source"]', { timeout: 30_000 })
  await page.getByRole('button', { name: '批准并创建任务' }).click()
  await page.waitForSelector('[data-testid="plan-grant-panel"]', { timeout: 20_000 })
  const beforeGrant = await page.locator('[data-testid="plan-grant-panel"]').innerText()
  // Resolve the approved plan from the API rather than trusting the UI state.
  const plans = await page.evaluate(async (projectId) => window.projectos.plans.list(projectId), project.id)
  const approved = plans.plans[0]
  check('grant UI: approval alone does not start execution', approved?.execution === null, `execution=${approved?.execution?.status ?? 'null'}`)
  check('grant UI: approval shows a separate execution grant form', /尚未授权执行/.test(beforeGrant) && /批准任务计划只创建任务/.test(beforeGrant), beforeGrant.replace(/\n/g, ' | ').slice(0, 140))
  await page.screenshot({ path: join(shots, 'grant-before.png') })

  // A dangerous permission must not be preselected.
  const writeRow = page.locator('.po-grant-form-row').filter({ hasText: '允许在下列项目路径内写文件' })
  const writeCheckbox = writeRow.locator('input[type="checkbox"]')
  check('grant UI: workspace-write starts unchecked', !(await writeCheckbox.isChecked()))
  await writeCheckbox.check()
  const pathSelect = page.locator('[data-testid="plan-grant-paths"]')
  const pathInput = pathSelect.locator('input')
  await pathInput.fill('src')
  await pathInput.press('Enter')
  await page.waitForTimeout(250)
  const ack = page.locator('.po-grant-form .ant-checkbox-wrapper').filter({ hasText: '我已核对任务' }).locator('input')
  await ack.check()
  await page.waitForTimeout(250)
  check('grant UI: explicit confirmation enables the grant action', await page.locator('[data-testid="plan-grant-start"]').isEnabled())
  await page.locator('[data-testid="plan-grant-start"]').click()

  // Wait for the granted write and the plan to leave the unauthorised state.
  const deadline = Date.now() + 30_000
  let grant = null
  let fileContent = null
  while (Date.now() < deadline) {
    await page.waitForTimeout(300)
    grant = await page.evaluate(async (planId) => window.projectos.plans.grant.get(planId), approved.id)
    try {
      const file = await page.evaluate(async ({ projectId, path }) => window.projectos.workspace.readFile(projectId, path), { projectId: project.id, path: 'src/notes.txt' })
      fileContent = file.content
    } catch {
      fileContent = null
    }
    if (grant?.usedToolCalls >= 1 && fileContent === 'granted by plan') break
  }
  check('grant UI: scoped write completed without a per-call approval', fileContent === 'granted by plan' && grant?.usedToolCalls >= 1, `usedToolCalls=${grant?.usedToolCalls} file=${JSON.stringify(fileContent)}`)
  const approvals = await page.evaluate(async (projectId) => window.projectos.approvals.list({ projectId, runId: null }), project.id)
  check('grant UI: no pending approval was created for the granted write', approvals.approvals.every((item) => item.status !== 'pending'), `pending=${approvals.approvals.filter((item) => item.status === 'pending').length}`)
  const runs = await page.evaluate(async (projectId) => window.projectos.runs.list(projectId, 20), project.id)
  check('grant UI: execution produced a real Run', runs.runs.length >= 1, `runs=${runs.runs.length}`)
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'grant-active.png') })

  // Revoke is a real product action; it must flip the persisted grant to revoked.
  const grantPanel = page.locator('[data-testid="plan-grant-panel"]')
  await grantPanel.getByRole('button', { name: '撤销授权' }).click()
  await page.waitForSelector('.ant-popconfirm-buttons', { timeout: 5_000 })
  await page.locator('.ant-popconfirm-buttons .ant-btn-primary').last().click()
  await page.waitForTimeout(1000)
  grant = await page.evaluate(async (planId) => window.projectos.plans.grant.get(planId), approved.id)
  check('grant UI: revoke persists a revoked grant', grant?.status === 'revoked', `status=${grant?.status}`)
  const revokedPlan = await page.evaluate(async (planId) => window.projectos.plans.get(planId), approved.id)
  check('grant UI: revoke stops the running plan', revokedPlan?.execution?.status !== 'running', `execution=${revokedPlan?.execution?.status}`)
  const resetWriteCheckbox = page.locator('.po-grant-form-row').filter({ hasText: '允许在下列项目路径内写文件' }).locator('input[type="checkbox"]')
  check('grant UI: revoked form resets dangerous defaults', !(await resetWriteCheckbox.isChecked()))
  await page.screenshot({ path: join(shots, 'grant-revoked.png') })

  // 125% zoom keeps the grant panel inside the Electron window.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  await page.waitForTimeout(500)
  const zoomBox = await page.locator('.po-plan-modal .ant-modal-container, .po-plan-modal .ant-modal-content').first().boundingBox()
  const panelBox = await grantPanel.boundingBox()
  const windowSize = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return { width: win.getContentBounds().width, height: win.getContentBounds().height }
  })
  check(
    'grant UI: modal stays inside the window at 125% zoom and the grant panel remains visible',
    Boolean(zoomBox) &&
      Boolean(panelBox) &&
      zoomBox.x >= 0 &&
      zoomBox.y >= 0 &&
      zoomBox.x + zoomBox.width <= windowSize.width + 1 &&
      zoomBox.y + zoomBox.height <= windowSize.height + 1 &&
      panelBox.width > 0,
    JSON.stringify({ zoomBox, panelBox, windowSize }),
  )
  await page.screenshot({ path: join(shots, 'grant-zoom125.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))

  // Dark theme screenshot.
  await page.evaluate(() => {
    const raw = localStorage.getItem('projectos.ui')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
    parsed.state = { ...parsed.state, themeMode: 'dark' }
    localStorage.setItem('projectos.ui', JSON.stringify(parsed))
  })
  await page.reload()
  await page.waitForTimeout(3200)
  await page.waitForSelector('#po-main')
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(900)
  await page.locator('.po-orch-actions').getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('[data-testid="plan-grant-panel"]', { timeout: 15_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'grant-dark.png') })

  check('no renderer page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\nR2B2 GRANT UI PASS — ${results.length} checks, screenshots in ${shots}`)
  console.log(`provider calls: planner=${plannerCalls} agent=${agentCalls}`)
} catch (error) {
  console.error('R2B2 GRANT UI FAIL —', error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: join(shots, 'ui-failure.png') })
    } catch {
      // best effort
    }
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  server.close()
}
