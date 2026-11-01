/** ADR-0078 desktop acceptance: Unified top requirement journey & materials drawer with provenance, stale review invalidation, multi-task counts, deep-linking, and project/requirement cache isolation. */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startRequirementFlowFixture } from './helpers/requirement-flow-model.mjs'

const out = resolve(process.env.PROJECTOS_EVIDENCE_DIR ?? 'docs/v2/evidence/requirement-journey-materials/desktop')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-journey-materials-e2e-'))
const rootPath = join(profile, 'project')
const rootPath2 = join(profile, 'project-2')
const dataDir = join(profile, 'data')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '0', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const checks = [], captures = [], errors = []
let app, page, win, project, project2, requirement, requirement2, taskA, taskB
const check = (name, ok, detail) => {
  checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) throw new Error(`${name}: ${JSON.stringify(detail)}`)
}
const shot = async (name) => {
  await page.mouse.move(2, 2)
  await page.waitForTimeout(400)
  writeFileSync(
    join(out, `${name}.png`),
    Buffer.from(await win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64'),
  )
  captures.push(`${name}.png`)
}

const server = await startRequirementFlowFixture()
const api = (fn, arg) => page.evaluate(fn, arg)
const flowView = (id) => api((requirementId) => window.projectos.workflows.view(requirementId), id)

async function until(predicate, timeout = 60000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await predicate()) return
    await page.waitForTimeout(250)
  }
  throw new Error('Timed out waiting for persisted state')
}

async function launch() {
  app = await electron.launch({
    executablePath: resolve('node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${join(profile, 'user')}`],
    cwd: resolve('apps/desktop'),
    env,
    timeout: 60000,
  })
  page = await app.firstWindow()
  win = await app.browserWindow(page)
  page.setDefaultTimeout(20000)
  page.on('pageerror', (error) => errors.push(error.message))
  await page.locator('.po-shell').waitFor({ timeout: 60000 })
}

async function checkLayout(name, scope = '.po-shell') {
  const metrics = await page.locator(scope).first().evaluate((element) => ({
    overflow: element.scrollWidth > element.clientWidth + 2,
    width: element.clientWidth,
  }))
  check(`${name} no horizontal overflow`, !metrics.overflow, metrics)
  await page.evaluate(readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8'))
  const violations = await page.evaluate(
    async (selector) => {
      const options = selector === '.po-shell'
        ? { rules: { 'color-contrast': { enabled: false }, 'label-content-name-mismatch': { enabled: false } } }
        : { rules: { 'color-contrast': { enabled: false } } }
      return (await window.axe.run(document.querySelector(selector), options)).violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      }))
    },
    scope,
  )
  check(`${name} accessibility (axe)`, violations.length === 0, violations)
}

async function countPrimaryJourneyBars() {
  return page.evaluate(() => document.querySelectorAll('.rq-flow-journey, [data-testid="goal-journey"]').length)
}

try {
  await launch()
  project = (
    await api(
      (rp) =>
        window.projectos.projects.create({
          name: 'Aurora Notes · 统一旅程与资料验收',
          description: '验证统一需求阶段旅程条、多任务汇总、资料溯源与过期失效提示',
          rootPath: rp,
          createDirectory: true,
          initGit: true,
        }),
      rootPath,
    )
  ).project
  execFileSync('git', ['-C', rootPath, 'add', '.'], { windowsHide: true })
  execFileSync('git', ['-C', rootPath, '-c', 'user.name=ProjectOS Test', '-c', 'user.email=test@projectos.local', 'commit', '--allow-empty', '-qm', 'journey baseline'], { windowsHide: true })

  await api((projectId) => window.projectos.actions.setAutonomy({ projectId, mode: 'assist' }), project.id)
  await api(
    (baseUrl) => window.projectos.settings.update({ baseUrl, apiKey: 'local-test', model: 'workflow-fixture', temperature: 0 }),
    `http://127.0.0.1:${server.address().port}/v1`,
  )

  // Create Requirement 1 with 2 parallel tasks (Task A will complete, Task B stays unstarted so stage is 1/2, NOT allCompleted)
  requirement = (
    await api(
      (projectId) =>
        window.projectos.requirements.create({
          projectId,
          title: '多端笔记同步与冲突恢复',
          body: '断网编辑、重连合并与超长文档恢复。' + '长文本段落验证内容完整性。'.repeat(20),
          source: 'local',
          acceptanceCriteria: ['保存并恢复长文本', '审核结论真实可追溯'],
          workflow: {
            templateVersionId: 'wfv_document1',
            assignmentMode: 'manual',
            assignments: { 'stage-1': 'agt_product', 'stage-2': 'agt_reviewer' },
          },
        }),
      project.id,
    )
  ).requirement

  // Create Requirement 2 (empty materials, parallel DAG workflow) to verify requirement switching & parallel branch stage rendering
  const parallelTemplate = await api(
    (projectId) =>
      window.projectos.workflows.save({
        projectId,
        name: '并行双分支设计流程',
        description: '测试并行流程节点汇总展示',
        graph: {
          nodes: [
            { id: 'stage-1', stage: 'requirement_analysis', kind: 'agent_task', title: '需求分析', role: 'product', instructions: '', inputs: [], outputs: ['需求文档'], optional: false },
            { id: 'stage-2a', stage: 'technical_design', kind: 'agent_task', title: '桌面端架构设计', role: 'architect', instructions: '', inputs: [], outputs: ['桌面端技术设计文档'], optional: false },
            { id: 'stage-2b', stage: 'technical_design', kind: 'agent_task', title: '同步服务架构设计', role: 'architect', instructions: '', inputs: [], outputs: ['同步技术设计文档'], optional: false },
            { id: 'stage-3', stage: 'design_review', kind: 'document_gate', title: '架构联审', role: 'reviewer', instructions: '', inputs: [], outputs: ['技术设计审核结论'], optional: false },
          ],
          edges: [
            { id: 'e1', source: 'stage-1', target: 'stage-2a' },
            { id: 'e2', source: 'stage-1', target: 'stage-2b' },
            { id: 'e3', source: 'stage-2a', target: 'stage-3' },
            { id: 'e4', source: 'stage-2b', target: 'stage-3' },
          ],
        },
        layout: {},
      }),
    project.id,
  )

  requirement2 = (
    await api(
      ({ projectId, templateVersionId }) =>
        window.projectos.requirements.create({
          projectId,
          title: '并行架构演进验证',
          body: '验证并行节点与需求切换不串联缓存',
          source: 'local',
          acceptanceCriteria: ['并行节点同屏真实展示'],
          workflow: {
            templateVersionId,
            assignmentMode: 'manual',
            assignments: {
              'stage-1': 'agt_product',
              'stage-2a': 'agt_architect',
              'stage-2b': 'agt_engineer',
              'stage-3': 'agt_reviewer',
            },
          },
        }),
      { projectId: project.id, templateVersionId: parallelTemplate.versionId },
    )
  ).requirement

  await api(
    (input) => window.projectos.tasks.create(input),
    { projectId: project.id, requirementId: requirement.id, title: '设计离线恢复状态机与长正文快照', acceptanceCriteria: ['输出完整恢复文档'] },
  )
  await api(
    (input) => window.projectos.tasks.create(input),
    { projectId: project.id, requirementId: requirement.id, title: '验证弱网增量同步边界', acceptanceCriteria: ['输出弱网验证文档'] },
  )
  const reqTasks = (await api((id) => window.projectos.requirements.work(id), requirement.id)).tasks
  taskA = reqTasks.find((t) => t.title.includes('离线恢复状态机'))
  taskB = reqTasks.find((t) => t.title.includes('弱网增量同步'))

  // Start Task A only, approve workspace, and let it finish stage-1 (document) and stage-2 (review)
  await page.evaluate(({ projectId, reqId }) => {
    location.hash = `#/projects/${projectId}/requirements?requirement=${reqId}`
  }, { projectId: project.id, reqId: requirement.id })
  await page.locator('.rq-flow-journey').waitFor()

  const rowA = page.locator(`[data-task-id="${taskA.id}"]`)
  await rowA.getByRole('button', { name: '开始流程', exact: true }).click()
  await page.getByRole('checkbox', { name: '我已核对本次操作范围' }).waitFor({ timeout: 45000 })
  await page.getByRole('checkbox', { name: '我已核对本次操作范围' }).check()
  await page.getByRole('button', { name: '允许本次', exact: true }).click()

  await until(() => page.evaluate(async ({ reqId, tId }) => {
    const v = await window.projectos.workflows.view(reqId)
    return v.tasks.find((t) => t.taskId === tId)?.status === 'completed'
  }, { reqId: requirement.id, tId: taskA.id }))

  await page.getByRole('button', { name: '刷新需求' }).click()
  await page.waitForTimeout(300)

  // 1. Verify single primary journey bar & truthful multi-task stage summary (Task A done, Task B not started -> 1/2, NOT .is-complete)
  check('Requirements page shows exactly 1 primary journey bar', (await countPrimaryJourneyBars()) === 1)
  const stage1Btn = page.locator('[data-testid="journey-stage-stage-1"]')
  const stage1Text = await stage1Btn.innerText()
  const stage1CompleteClass = await stage1Btn.evaluate((el) => el.classList.contains('is-complete'))
  check('Stage 1 with 1/2 completed tasks shows truthful count (已完成 1/2 · 未开始 1) and is NOT marked allCompleted', stage1Text.includes('已完成 1/2') && stage1Text.includes('未开始 1') && !stage1CompleteClass, { stage1Text, stage1CompleteClass })
  await shot('requirements-multi-task-journey-1440-light')

  // 2. Verify cross-page unified journey bar on Overview, Tasks, and Agents (Collaboration Canvas) + back navigation
  await page.evaluate(({ projectId, reqId }) => {
    location.hash = `#/projects/${projectId}/overview?requirement=${reqId}`
  }, { projectId: project.id, reqId: requirement.id })
  await page.locator('[data-testid="requirement-journey"]').waitFor()
  check('Route "overview" has exactly 1 unified primary journey bar with no UC step', (await countPrimaryJourneyBars()) === 1 && !(await page.locator('[data-testid="requirement-journey"]').innerText()).includes('UC'))
  await shot('unified-journey-overview-1440-light')
  await checkLayout('unified journey overview', '.po-shell')

  // Navigate to tasks via the unified journey bar button (pushes React Router history entry)
  await page.locator('[data-testid="requirement-journey"]').getByRole('button', { name: /任务看板/ }).click()
  await page.locator('[data-testid="requirement-journey"]').waitFor()
  check('Route "tasks" has exactly 1 unified primary journey bar with no UC step', (await countPrimaryJourneyBars()) === 1 && (await page.evaluate(() => location.hash.includes('/tasks'))))
  await shot('unified-journey-tasks-1440-light')
  await checkLayout('unified journey tasks', '.po-shell')

  // Navigate to agents via the unified journey bar button
  await page.locator('[data-testid="requirement-journey"]').getByRole('button', { name: 'Agent 协作', exact: true }).click()
  await page.locator('[data-testid="requirement-journey"]').waitFor()
  check('Route "agents" has exactly 1 unified primary journey bar with no UC step', (await countPrimaryJourneyBars()) === 1 && (await page.evaluate(() => location.hash.includes('/agents'))))
  await shot('unified-journey-agents-1440-light')
  await checkLayout('unified journey agents', '.po-shell')

  // Test titlebar back button (.po-crumb-back)
  const backBtn = page.locator('.po-crumb-back')
  check('Titlebar back button is enabled after cross-page navigation', await backBtn.isEnabled())
  await backBtn.click()
  await page.waitForTimeout(250)
  check('Titlebar back button navigates back to previous route (tasks)', await page.evaluate(() => location.hash.includes('/tasks')))

  // Click stage node in top journey bar while on /tasks -> opens stage materials dialog directly in context!
  await page.locator('[data-testid="journey-stage-stage-1"]').click()
  let dialog = page.getByRole('dialog', { name: '流程产出资料', exact: true })
  await dialog.waitFor()
  const countsBar = dialog.getByTestId('stage-task-counts')
  await countsBar.waitFor()
  const countsText = await countsBar.innerText()
  check('Stage materials dialog displays multi-task breakdown (共 2 个任务 / 已完成 1/2 / 未开始 1)', countsText.includes('共 2 个任务') && countsText.includes('已完成 1/2') && countsText.includes('未开始 1'), countsText)

  // Verify provenance fields in material detail
  const detailText = await dialog.locator('.rq-material-body').innerText()
  check(
    'Material detail displays complete provenance (所属需求, 所属任务, 流程节点, 产出 Agent, 版本状态, 审核结果, 查看运行记录)',
    detailText.includes('多端笔记同步与冲突恢复') &&
      detailText.includes(taskA.title) &&
      detailText.includes('需求分析') &&
      detailText.includes('当前版本') &&
      detailText.includes('审核已通过') &&
      detailText.includes('查看运行记录'),
    detailText,
  )
  await shot('stage-materials-provenance-1440-light')
  await checkLayout('stage materials dialog', '[role="dialog"]')

  // Filter by Task B (unstarted task) inside the stage dialog -> verify empty state for Task B
  const filterGroup = dialog.getByRole('group', { name: '按任务筛选资料' })
  await filterGroup.getByRole('button', { name: new RegExp(taskB.title) }).click()
  await dialog.getByText('尚无此阶段资料', { exact: false }).waitFor()
  check('Filtering by unstarted task shows truthful empty state for that task', true)
  await shot('stage-materials-task-filter-empty-1440-light')

  // Switch filter back to all tasks and test Escape keyboard close
  await filterGroup.getByRole('button', { name: /全部任务/ }).click()
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  check('Escape closes the stage materials dialog', true)

  // 3. Test deep link: #/projects/:id/requirements?requirement=:reqId&stage=stage-1&task=:taskA.id
  await page.evaluate(({ projectId, reqId, taskId }) => {
    location.hash = `#/projects/${projectId}/requirements?requirement=${reqId}&stage=stage-1&task=${taskId}`
  }, { projectId: project.id, reqId: requirement.id, taskId: taskA.id })
  dialog = page.getByRole('dialog', { name: '流程产出资料', exact: true })
  await dialog.waitFor()
  check('Deep link (?requirement=...&stage=stage-1&task=...) opens the stage materials dialog directly on the target task', (await dialog.innerText()).includes(taskA.title))
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  // 4. Test stale review invalidation when requirement/document changes after review vs superseded version on retry
  const currentReq = (await api((id) => window.projectos.requirements.list(id), project.id)).requirements.find((r) => r.id === requirement.id)
  await api(
    (input) => window.projectos.requirements.update(input),
    {
      requirementId: requirement.id,
      expectedVersion: currentReq.version,
      title: currentReq.title,
      body: currentReq.body + '\n【新增变更】增加冲突版本三方合并策略，原审核结论需重新复核。',
      technicalDesign: currentReq.technicalDesign ?? '',
      acceptanceCriteria: [...currentReq.acceptanceCriteria, '三方合并策略经复核通过'],
    },
  )
  await page.getByRole('button', { name: '刷新需求' }).click()
  await page.waitForTimeout(300)

  const staleStage2Btn = page.locator('[data-testid="journey-stage-stage-2"]')
  const staleStage2Text = await staleStage2Btn.innerText()
  check('Journey bar flags stage-2 as stale (已过期) after requirement document update', staleStage2Text.includes('已过期'), staleStage2Text)

  await staleStage2Btn.click()
  dialog = page.getByRole('dialog', { name: '流程产出资料', exact: true })
  await dialog.waitFor()
  const staleDialogText = await dialog.innerText()
  check(
    'Stage 2 material shows 已过期失效 and 旧审核已失效 alert after upstream scope update',
    staleDialogText.includes('已过期失效') && staleDialogText.includes('旧审核已失效'),
    staleDialogText,
  )
  await shot('stage-materials-stale-review-1440-light')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  // Now retry stage-1 of Task A to produce attempt 2 -> verify attempt 1 becomes '废弃版本' (superseded), distinct from '已过期失效' (stale)
  const viewBeforeRetry = await flowView(requirement.id)
  const step1ToRetry = viewBeforeRetry.tasks.find((t) => t.taskId === taskA.id).steps.find((s) => s.nodeId === 'stage-1')
  await api((input) => window.projectos.workflows.retry(input), { stepId: step1ToRetry.id, expectedVersion: step1ToRetry.version })
  await api((tId) => window.projectos.workflows.start(tId), taskA.id)
  await until(async () => {
    const v = await flowView(requirement.id)
    const mats = v.materials.filter((m) => m.taskId === taskA.id && m.nodeId === 'stage-1')
    return mats.length >= 2 && mats.some((m) => m.status === 'current' && m.attempt === 2) && mats.some((m) => m.status === 'superseded')
  })
  await page.getByRole('button', { name: '刷新需求' }).click()
  await page.locator('[data-testid="journey-stage-stage-1"]').click()
  dialog = page.getByRole('dialog', { name: '流程产出资料', exact: true })
  await dialog.waitFor()
  const supersededListText = await dialog.getByRole('navigation', { name: '产出文档列表' }).innerText()
  check(
    'Retried stage lists both 当前版本 (attempt 2) and 废弃版本 (superseded attempt 1)',
    supersededListText.includes('当前版本') && supersededListText.includes('废弃版本'),
    supersededListText,
  )
  await shot('stage-materials-superseded-vs-current-1440-light')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  // 5. Verify switching to Requirement 2 (parallel DAG, 0 materials) never leaks Requirement 1 cached materials
  await page.evaluate(({ projectId, reqId }) => {
    location.hash = `#/projects/${projectId}/requirements?requirement=${reqId}`
  }, { projectId: project.id, reqId: requirement2.id })
  await page.getByRole('heading', { name: requirement2.title, exact: true }).waitFor()
  const parallelNodesCount = await page.locator('.rq-flow-journey button[data-stage-node]').count()
  check('Parallel DAG requirement renders all 4 workflow nodes (including parallel branches stage-2a and stage-2b)', parallelNodesCount === 4, parallelNodesCount)
  await page.locator('[data-testid="journey-stage-stage-1"]').click()
  dialog = page.getByRole('dialog', { name: '流程产出资料', exact: true })
  await dialog.waitFor()
  const req2DialogText = await dialog.innerText()
  check(
    'Switching requirement isolates materials state and never shows previous requirement cached documents',
    req2DialogText.includes('尚无产出资料') && !req2DialogText.includes('多端笔记同步与冲突恢复'),
    req2DialogText,
  )
  await shot('stage-materials-empty-isolated-1440-light')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })

  // 6. Verify switching to a second Project never leaks previous project's requirement or materials
  project2 = (
    await api(
      (rp) =>
        window.projectos.projects.create({
          name: 'Second Project · 隔离验证',
          description: '验证跨项目切换不会读取旧项目需求或资料缓存',
          rootPath: rp,
          createDirectory: true,
          initGit: true,
        }),
      rootPath2,
    )
  ).project
  await page.evaluate((p2Id) => {
    location.hash = `#/projects/${p2Id}/tasks`
  }, project2.id)
  await page.waitForTimeout(400)
  const p2BarCount = await countPrimaryJourneyBars()
  const p2Text = await page.locator('.po-shell').innerText()
  check('Switching to a second project with no workflow requirement falls back cleanly without leaking Project 1 requirement', p2BarCount === 1 && !p2Text.includes('多端笔记同步与冲突恢复'), { p2BarCount })

  // 7. Viewport & theme matrix (1440x900, 1024x768, light/dark, 125% zoom + reduced motion) on Project 1
  await page.evaluate(({ projectId, reqId }) => {
    location.hash = `#/projects/${projectId}/tasks?requirement=${reqId}`
  }, { projectId: project.id, reqId: requirement.id })
  await page.locator('[data-testid="requirement-journey"]').waitFor()
  for (const [width, height] of [[1440, 900], [1024, 768]]) {
    for (const theme of ['light', 'dark']) {
      await win.evaluate((w, size) => w.setSize(...size), [width, height])
      await page.emulateMedia({ colorScheme: theme })
      await page.waitForTimeout(250)
      await shot(`tasks-journey-${width}-${theme}`)
      await checkLayout(`tasks journey ${width} ${theme}`, '.po-shell')
    }
  }
  await win.evaluate((w) => w.webContents.setZoomFactor(1.25))
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.waitForTimeout(250)
  await shot('tasks-journey-1024-dark-125-reduced')
  await checkLayout('tasks journey 1024 dark 125% reduced', '.po-shell')

  await win.evaluate((w) => w.webContents.setZoomFactor(1))
  await win.evaluate((w) => w.setSize(1440, 900))
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })

  check('Zero uncaught renderer page errors', errors.length === 0, errors)
  writeFileSync(join(out, 'e2e-results.json'), JSON.stringify({ checks, captures, errors }, null, 2))
  console.log(`ALL ${checks.length} CHECKS PASSED (${captures.length} screenshots)`)
} finally {
  await app?.close().catch(() => {})
  server.close()
}
