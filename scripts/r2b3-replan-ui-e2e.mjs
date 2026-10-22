/**
 * Phase 2B-3 replan UI E2E. Real Electron mouse/keyboard; deterministic local
 * provider for the Planner and Replanner. No Agent execution is needed here.
 */
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b3-ui-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b3-ui-user-'))
const shots = join(root, 'test-results', 'r2b3')
mkdirSync(shots, { recursive: true })

const INITIAL = JSON.stringify({
  assumptions: ['项目已有基础结构'],
  risks: ['UI fixture'],
  tasks: [{
    key: 'implement',
    title: '实现低风险变更',
    description: '在 src/feature.txt 写入 UI fixture 内容。',
    role: 'developer',
    capabilities: ['implement'],
    hardCapabilities: [],
    dependsOn: [],
    acceptanceCriteria: ['src/feature.txt 存在'],
    expectedArtifacts: ['代码 diff'],
    rationale: '验证重规划 UI。',
    requiresApproval: true,
  }],
})

const REPLAN = JSON.stringify({
  reason: '用户要求增加独立验证节点，避免实现与验证由同一角色完成',
  assumptions: ['保持现有实现任务'],
  risks: ['新增测试节点会扩大授权范围'],
  tasks: [
    {
      key: 'implement',
      title: '实现低风险变更',
      description: '在 src/feature.txt 写入 UI fixture 内容。',
      role: 'developer',
      capabilities: ['implement'],
      hardCapabilities: [],
      dependsOn: [],
      acceptanceCriteria: ['src/feature.txt 存在'],
      expectedArtifacts: ['代码 diff'],
      rationale: '保留已完成/待执行的实现任务。',
      requiresApproval: true,
    },
    {
      key: 'verify',
      title: '独立验证变更',
      description: '读取变更并记录真实验证结果。',
      role: 'tester',
      capabilities: ['test'],
      hardCapabilities: [],
      dependsOn: ['implement'],
      acceptanceCriteria: ['记录真实读取结果'],
      expectedArtifacts: ['测试报告'],
      rationale: '新增独立验证节点，避免实现者自证。',
      requiresApproval: true,
    },
  ],
})

let plannerCalls = 0
let replanCalls = 0
function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    let payload = {}
    try { payload = JSON.parse(body) } catch { /* ignore */ }
    const messages = payload.messages ?? []
    const system = messages.find((message) => message.role === 'system')?.content ?? ''
    const isReplan = system.includes('修订计划')
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    if (isReplan) {
      replanCalls += 1
      for (const chunk of REPLAN.match(/.{1,180}/gs) ?? [REPLAN]) sse(res, { choices: [{ delta: { content: chunk } }] })
      sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 300 } })
    } else {
      plannerCalls += 1
      for (const chunk of INITIAL.match(/.{1,180}/gs) ?? [INITIAL]) sse(res, { choices: [{ delta: { content: chunk } }] })
      sse(res, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 300, completion_tokens: 100 } })
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
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
    win.show(); win.focus(); win.moveTop()
  })
  await page.waitForTimeout(3400)
  await page.waitForSelector('#po-main')
  await page.evaluate(async ({ baseUrl }) => window.projectos.settings.update({
    baseUrl, model: 'fake-replan-ui-model', apiKey: 'test-key', temperature: 0,
  }), { baseUrl })
  const workspaceDir = join(dataDir, 'replan-project')
  mkdirSync(join(workspaceDir, 'src'), { recursive: true })
  writeFileSync(join(workspaceDir, 'package.json'), JSON.stringify({ name: 'r2b3-replan-ui', private: true }))
  const project = await page.evaluate(async ({ workspaceDir }) => (await window.projectos.projects.create({
    name: 'R2B3 Replan UI', description: 'dynamic replan fixture', rootPath: workspaceDir, createDirectory: false, initGit: false,
  })).project, { workspaceDir })
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(900)
  await page.locator('.po-orch-actions').getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('[data-testid="plan-generate"]', { timeout: 10_000 })
  await page.locator('.po-plan-modal textarea').first().fill('生成一个可验证的低风险实现计划')
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-source"]', { timeout: 30_000 })
  await page.getByRole('button', { name: '批准并创建任务' }).click()
  await page.waitForSelector('[data-testid="replan-panel"]', { timeout: 20_000 })
  await page.locator('[data-testid="replan-panel"]').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  check('replan UI: panel is in the existing plan modal', await page.locator('[data-testid="replan-panel"]').isVisible(), 'visible')
  check('replan UI: approval alone has no execution', (await page.evaluate(async (projectId) => (await window.projectos.plans.list(projectId)).plans[0].execution, project.id)) === null, 'null')

  const reasonInput = page.locator('[data-testid="replan-panel"] input').first()
  await reasonInput.fill('用户要求增加独立验证节点')
  const proposeButton = page.getByRole('button', { name: '生成修订提案' })
  await proposeButton.click()
  await page.waitForSelector('.po-replan-card', { timeout: 30_000 })
  const proposalText = await page.locator('.po-replan-card').first().innerText()
  check('replan UI: proposal shows trigger, diff and authorization impact', /用户主动调整/.test(proposalText) && /新增/.test(proposalText) && /需要重新签发计划授权/.test(proposalText), proposalText.replace(/\n/g, ' | ').slice(0, 180))
  check('replan UI: proposal did not change the plan before apply', (await page.evaluate(async (projectId) => (await window.projectos.plans.list(projectId)).plans.length, project.id)) === 1, 'one revision')
  await page.screenshot({ path: join(shots, 'replan-proposal.png') })

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25))
  await page.waitForTimeout(500)
  const panelBox = await page.locator('[data-testid="replan-panel"]').boundingBox()
  const windowSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  check(
    'replan UI: panel stays inside the window at 125% zoom',
    Boolean(
      panelBox &&
        panelBox.x >= 0 &&
        panelBox.y >= 0 &&
        panelBox.y < windowSize.height &&
        panelBox.x + panelBox.width <= windowSize.width,
    ),
    JSON.stringify({ panelBox, windowSize }),
  )
  await page.screenshot({ path: join(shots, 'replan-zoom125.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1))
  await page.waitForTimeout(300)
  await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark') })
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(shots, 'replan-dark.png') })
  await page.evaluate(() => { document.documentElement.removeAttribute('data-theme') })
  await page.waitForTimeout(300)

  await page.getByRole('button', { name: '应用为草稿 revision' }).click()
  await page.waitForTimeout(1200)
  const plans = await page.evaluate(async (projectId) => window.projectos.plans.list(projectId), project.id)
  check('replan UI: apply creates a new draft revision and keeps old revision', plans.plans.length === 2 && plans.plans[0].status === 'draft' && plans.plans[0].revision === 2, JSON.stringify(plans.plans.map((plan) => `${plan.revision}:${plan.status}`)))
  check('replan UI: new revision is not auto-approved or auto-authorized', plans.plans[0].execution === null && (await page.evaluate(async (planId) => window.projectos.plans.grant.get(planId), plans.plans[0].id)) === null, 'draft/ungranted')
  await page.screenshot({ path: join(shots, 'replan-applied.png') })
  check('replan UI: model calls were real provider calls', plannerCalls >= 1 && replanCalls >= 1, `planner=${plannerCalls} replan=${replanCalls}`)
  check('replan UI: no renderer page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\nR2B3 REPLAN UI PASS — ${results.length} checks, screenshots in ${shots}`)
} catch (error) {
  console.error('R2B3 REPLAN UI FAIL —', error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: join(shots, 'replan-failure.png') })
    } catch { /* ignore */ }
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  server.close()
}
