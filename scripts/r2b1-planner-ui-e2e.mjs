/**
 * Phase 2B-1 AI Planner UI regression (deterministic local provider).
 *
 * Verifies the real Electron flow with real mouse input:
 *   - AI plan generation from the existing orchestration workspace
 *   - honest source marker (model + connection/model, not local-rules)
 *   - rationale / capabilities / acceptance / artifacts visible and editable
 *   - provider failure surfaces an error and explicit local-rule fallback
 *   - light and dark theme screenshots
 *
 * This script uses a local fake OpenAI-compatible endpoint only for UI
 * determinism. Real-provider planning evidence is produced separately by
 * scripts/r2b1-real-planner.mjs.
 */
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b1-ui-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b1-ui-user-'))
const shots = join(root, 'test-results', 'r2b1')
mkdirSync(shots, { recursive: true })

let providerCalls = 0

function task(overrides) {
  return {
    key: 'task',
    title: '执行任务',
    description: '按需求完成一项可验证的工作。',
    role: 'developer',
    capabilities: ['implement'],
    dependsOn: [],
    acceptanceCriteria: ['命令退出码为 0'],
    expectedArtifacts: ['代码 diff'],
    rationale: '这是完成需求的必要步骤。',
    requiresApproval: true,
    ...overrides,
  }
}

function planFor(goal) {
  if (/权限|RBAC|角色/i.test(goal)) {
    return {
      assumptions: ['项目已存在认证与任务模块', '角色模型需要兼容当前本地用户'],
      risks: ['权限迁移可能影响现有项目数据'],
      tasks: [
        task({ key: 'scope', title: '梳理角色与权限边界', description: '阅读认证、路由与数据访问代码，定义角色权限矩阵。', role: 'architect', capabilities: ['architect', 'analyze'], acceptanceCriteria: ['输出角色权限矩阵', '列出受影响接口'], expectedArtifacts: ['设计/实施方案'], rationale: '权限改动跨数据、接口和 UI，需要先固定边界。' }),
        task({ key: 'data', title: '实现角色数据模型', description: '新增角色表与权限关联迁移，保留现有用户数据。', dependsOn: ['scope'], acceptanceCriteria: ['迁移可重复执行', '现有用户数据不丢失'], expectedArtifacts: ['代码 diff', '测试报告'], rationale: '数据模型是接口与前端的基础，可与接口任务并行。' }),
        task({ key: 'api', title: '实现接口权限校验', description: '在服务端路由加入角色校验。', dependsOn: ['scope'], acceptanceCriteria: ['越权请求返回 403', '有效请求保持成功'], expectedArtifacts: ['代码 diff', '测试报告'], rationale: '接口校验与数据模型可并行，依赖统一权限边界。' }),
        task({ key: 'ui', title: '实现前端角色管理入口', description: '在设置页加入角色分级管理。', dependsOn: ['api'], acceptanceCriteria: ['角色列表可加载', '保存后权限生效'], expectedArtifacts: ['代码 diff'], rationale: '前端依赖接口契约。' }),
        task({ key: 'verify', title: '验证权限矩阵与回归', description: '执行授权测试，覆盖允许、拒绝和角色变更。', role: 'tester', capabilities: ['test'], dependsOn: ['data', 'ui'], acceptanceCriteria: ['越权与授权用例均通过', '记录真实命令与退出码'], expectedArtifacts: ['测试报告'], rationale: '数据与前端完成后才能端到端验证。' }),
      ],
    }
  }
  if (/性能|测量|瓶颈/i.test(goal)) {
    return {
      assumptions: ['可以在隔离环境复现慢请求', '现有指标采集可复用'],
      risks: ['生产样本可能与本地不同'],
      tasks: [
        task({ key: 'baseline', title: '建立性能基线', description: '记录关键接口延迟、错误率和资源使用。', capabilities: ['analyze'], acceptanceCriteria: ['记录 p50/p95 和样本量', '给出复现命令'], expectedArtifacts: ['性能基线数据'], rationale: '没有测量就不能确认瓶颈。' }),
        task({ key: 'profile', title: '定位性能瓶颈', description: '基于基线做 profiling，定位数据库或序列化热点。', capabilities: ['analyze'], dependsOn: ['baseline'], acceptanceCriteria: ['列出至少一个可验证瓶颈'], expectedArtifacts: ['性能分析报告'], rationale: '优化必须建立在定位证据上。' }),
        task({ key: 'optimize', title: '实施针对性优化', description: '只修改已定位热点，保留行为兼容性。', dependsOn: ['profile'], acceptanceCriteria: ['p95 延迟较基线下降'], expectedArtifacts: ['代码 diff', '性能对比报告'], rationale: '优化依赖定位结果。' }),
        task({ key: 'regression', title: '回归性能与正确性', description: '重复基线测试并执行现有回归套件。', role: 'tester', capabilities: ['test'], dependsOn: ['optimize', 'baseline'], acceptanceCriteria: ['重复测量结果稳定', '无新增失败用例'], expectedArtifacts: ['测试报告'], rationale: '确认优化效果真实且无回归。' }),
      ],
    }
  }
  return {
    assumptions: ['按钮样式集中在组件与主题 token 中'],
    risks: ['未提供视觉设计稿，颜色与间距需人工复核'],
    tasks: [
      task({ key: 'locate-button', title: '定位按钮样式与使用位置', description: '读取按钮组件与主题 token，确认影响范围。', capabilities: ['analyze', 'implement'], acceptanceCriteria: ['列出按钮组件与样式 token 文件', '记录受影响页面'], expectedArtifacts: ['样式分析说明'], rationale: '先定位真实组件与 token，避免全局样式回归。' }),
      task({ key: 'apply-style', title: '修改主按钮样式', description: '在按钮组件或主题层实现新样式，并保持可访问性。', dependsOn: ['locate-button'], acceptanceCriteria: ['构建命令退出码为 0', '按钮对比度满足 WCAG AA'], expectedArtifacts: ['代码 diff'], rationale: '这是用户需求的核心改动，依赖定位结果。' }),
      task({ key: 'verify-style', title: '验证按钮视觉与回归', description: '运行现有测试，并在 Electron 中检查按钮状态。', role: 'tester', capabilities: ['test'], dependsOn: ['apply-style'], acceptanceCriteria: ['测试命令退出码为 0', '记录浅色与深色截图'], expectedArtifacts: ['测试报告'], rationale: '验证核心改动没有破坏现有界面。' }),
    ],
  }
}

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    providerCalls += 1
    let payload = {}
    try { payload = JSON.parse(body) } catch { /* ignored */ }
    const userText = (payload.messages ?? [])
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n')
    const goal = /## 用户需求\n([\s\S]*?)\n\n##/.exec(userText)?.[1]?.trim() ?? userText
    // The second project deliberately exercises the bounded-repair failure path.
    const content = goal.includes('非法计划')
      ? '{"tasks":[{"key":"broken","title":"缺少验收","description":"这是一个缺少验收标准的任务。","role":"developer","dependsOn":[],"acceptanceCriteria":[],"expectedArtifacts":["代码 diff"],"rationale":"故意非法"}]}'
      : JSON.stringify(planFor(goal))
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const chunks = content.match(/.{1,180}/gs) ?? [content]
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`)
    }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 900, completion_tokens: 400 } })}\n\n`)
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

function writeProjectFiles(dir) {
  mkdirSync(join(dir, 'src', 'components'), { recursive: true })
  mkdirSync(join(dir, 'src', 'styles'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'r2b1-planner-ui',
    private: true,
    scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"' },
    dependencies: { react: '^19' },
  }, null, 2))
  writeFileSync(join(dir, 'src', 'components', 'PrimaryButton.tsx'), [
    'export function PrimaryButton() {',
    '  // 主按钮样式：读取主题 token，保持对比度和焦点可见。',
    '  return <button className="primary-button">确定</button>',
    '}',
  ].join('\n'))
  writeFileSync(join(dir, 'src', 'styles', 'tokens.css'), ':root { --button-radius: 10px; --button-accent: #2f6fe4; }')
  writeFileSync(join(dir, 'README.md'), '# Planner UI fixture\n主按钮与次级按钮的样式说明。\n')
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
    model: 'fake-planner-model',
    apiKey: 'test-key',
    temperature: 0,
  }), { baseUrl })

  const workspaceDir = join(dataDir, 'planner-ui-project')
  mkdirSync(workspaceDir, { recursive: true })
  writeProjectFiles(workspaceDir)
  const project = await page.evaluate(async ({ workspaceDir }) => (await window.projectos.projects.create({
    name: 'R2B1 Planner UI',
    description: 'AI planner UI fixture',
    rootPath: workspaceDir,
    createDirectory: false,
    initGit: false,
  })).project, { workspaceDir })
  await page.evaluate(async (projectId) => window.projectos.projectAnalysis.scan(projectId), project.id)
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(1200)

  const openPlanner = async (expectDraft = false) => {
    await page.locator('.po-orch-actions').getByRole('button', { name: '生成计划' }).click()
    await page.waitForSelector('.po-plan-modal', { timeout: 10_000 })
    await page.waitForSelector(expectDraft ? '[data-testid="plan-review-workbench"]' : '[data-testid="plan-generate"]', { timeout: 10_000 })
  }

  await openPlanner()
  await page.locator('[data-testid="plan-generate"]').scrollIntoViewIfNeeded()
  await page.locator('.po-plan-modal textarea').first().fill('修改主按钮的样式')
  await page.getByRole('radio', { name: /AI 生成/ }).click()
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-review-workbench"]', { timeout: 30_000 })
  await page.locator('.po-plan-generation-details summary').click()
  const sourceText = await page.locator('.po-plan-generation-details').innerText()
  const taskCount = await page.locator('[data-testid="plan-task-list"] .po-plan-compact-task').count()
  check('AI planner: generation details name the real model source', /fake-planner-model/.test(sourceText), sourceText.replace(/\n/g, ' | '))
  check('AI planner: dynamic three-task DAG (not the fixed four-node template)', taskCount === 3, `tasks=${taskCount}`)
  await page.locator('[data-testid="plan-task-list"] .po-plan-compact-task').first().click()
  await page.waitForSelector('.po-plan-task-detail', { timeout: 10_000 })
  const detailText = await page.locator('.po-plan-task-detail').innerText()
  check('AI planner: rationale and capability requirements are visible in task detail', detailText.includes('能力需求') && (await page.locator('.po-plan-task-rationale').count()) >= 1, detailText.slice(0, 200))
  const firstAcceptance = page.locator('.po-plan-task-detail label').filter({ hasText: '验收标准' }).locator('input')
  await firstAcceptance.fill('人工复核样式对比')
  await firstAcceptance.press('Enter')
  await page.waitForTimeout(300)
  const editedAcceptance = await page.locator('.po-plan-task-detail').innerText()
  check('AI planner: real keyboard edit updates the draft criterion', editedAcceptance.includes('人工复核样式对比'), editedAcceptance.slice(0, 200))
  await page.locator('.po-plan-task-drawer .ant-drawer-close').click()
  await page.waitForTimeout(250)
  check('AI planner: no task/run is created before approval', (await page.evaluate(async (projectId) => {
    const [board, plans] = await Promise.all([
      window.projectos.tasks.board(projectId),
      window.projectos.plans.list(projectId),
    ])
    const plan = plans.plans[0]
    return board.tasks.filter((item) => plan?.createdTaskIds.includes(item.id)).length === 0 && plan?.createdTaskIds.length === 0
  }, project.id)), 'draft has no created tasks')
  await page.screenshot({ path: join(shots, 'plan-ai-light.png') })
  console.log(`SHOT ${join(shots, 'plan-ai-light.png')}`)

  // Close, then reopen from the latest plan row and verify the dark theme.
  await page.locator('.po-plan-modal .ant-modal-close').click()
  await page.waitForTimeout(300)
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
  await openPlanner(true)
  await page.waitForSelector('[data-testid="plan-review-workbench"]', { timeout: 15_000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(shots, 'plan-ai-dark.png') })
  console.log(`SHOT ${join(shots, 'plan-ai-dark.png')}`)
  await page.locator('.po-plan-modal .ant-modal-close').click()
  await page.waitForTimeout(300)

  // Failure + explicit local fallback in a second, plan-free project.
  const errorWorkspace = join(dataDir, 'planner-ui-error-project')
  mkdirSync(errorWorkspace, { recursive: true })
  writeProjectFiles(errorWorkspace)
  const errorProject = await page.evaluate(async ({ workspaceDir }) => (await window.projectos.projects.create({
    name: 'R2B1 Planner Error',
    description: 'AI planner failure fixture',
    rootPath: workspaceDir,
    createDirectory: false,
    initGit: false,
  })).project, { workspaceDir: errorWorkspace })
  await page.evaluate(async (projectId) => window.projectos.projectAnalysis.scan(projectId), errorProject.id)
  await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, errorProject.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForTimeout(900)
  await openPlanner()
  await page.locator('.po-plan-modal textarea').first().fill('生成一个非法计划')
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-generate-error"]', { timeout: 30_000 })
  const errorText = await page.locator('[data-testid="plan-generate-error"]').innerText()
  check('failure: validation error is shown in the planner panel', /未保存任何计划/.test(errorText) && /未通过校验/.test(errorText), errorText.replace(/\n/g, ' | '))
  await page.screenshot({ path: join(shots, 'plan-error.png') })
  console.log(`SHOT ${join(shots, 'plan-error.png')}`)
  await page.getByRole('button', { name: '改用本地规则' }).click()
  await page.waitForSelector('[data-testid="plan-review-workbench"]', { timeout: 20_000 })
  await page.locator('.po-plan-generation-details summary').click()
  const fallbackSource = await page.locator('.po-plan-generation-details').innerText()
  const fallbackTasks = await page.locator('[data-testid="plan-task-list"] .po-plan-compact-task').count()
  check('fallback: explicit local rules are honestly marked', /本地规则模板/.test(fallbackSource), fallbackSource.replace(/\n/g, ' | '))
  check('fallback: local template is not presented as model output', fallbackTasks === 4, `tasks=${fallbackTasks}`)
  await page.screenshot({ path: join(shots, 'plan-local-fallback.png') })
  console.log(`SHOT ${join(shots, 'plan-local-fallback.png')}`)

  check('provider was called for AI generation and the invalid repair path', providerCalls >= 2, `calls=${providerCalls}`)
  check('no renderer page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\nR2B1 PLANNER UI PASS — ${results.length} checks, screenshots in ${shots}`)
} catch (error) {
  console.error('R2B1 PLANNER UI FAIL —', error)
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
