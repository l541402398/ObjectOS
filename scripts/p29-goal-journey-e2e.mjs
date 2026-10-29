/**
 * Phase 2.9-P0 — real first-run journey E2E (empty folder → verified delivery boundary).
 *
 * A fresh data dir and a fresh user-data dir, an empty folder, and only real preload API calls:
 * create project → submit requirement → generate plan → approve → authorize → start → watch the
 * journey advance. Nothing is written into the user's own profile or folders.
 *
 * usage: node scripts/p29-goal-journey-e2e.mjs
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-journey-'))
const dataDir = join(work, 'data')
const emptyDir = join(work, 'empty-project')
mkdirSync(dataDir, { recursive: true })
mkdirSync(emptyDir, { recursive: true })

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const stageOf = (journey, key) => journey?.stages?.find((stage) => stage.key === key)
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

async function launch() {
  return electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${join(work, 'userdata')}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
}

let app = null
try {
  app = await launch()
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(1200)

  // The bar exists even with no project selected.
  const noProjectBar = await page.locator('[data-testid="goal-journey"]').count()
  record('没有项目时顶部旅程栏仍存在并给出引导', noProjectBar > 0 ? 'PASS' : 'FAIL', `bars=${noProjectBar}`)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-journey-no-project.png') })

  // 1) Empty folder (git init by the product, ADR-0050 handles the unborn HEAD at start).
  const created = await page.evaluate(async (rootPath) => {
    const result = await window.projectos.projects.create({
      name: '空目录首次旅程',
      rootPath,
      createDirectory: false,
      initGit: true,
    })
    return result.project.id
  }, emptyDir)
  record('空目录创建项目', 'PASS', `project=${created}`)
  let journey = await page.evaluate((id) => window.projectos.work.journey(id), created)
  const setupStage = stageOf(journey, 'setup')
  record(
    '新建项目后旅程显示“项目准备”，并说明空仓库会被处理',
    setupStage && setupStage.state === 'active' && setupStage.detail.includes('基线提交') ? 'PASS' : 'FAIL',
    `${setupStage?.state}: ${setupStage?.detail}`,
  )

  // 2) Requirement
  const requirement = await page.evaluate(async (projectId) => {
    const createdRequirement = await window.projectos.requirements.create({
      projectId,
      title: '实现便签搜索并自测',
      body: '按标题与正文搜索，必须带真实测试。',
      acceptanceCriteria: ['node --test 通过'],
      source: 'local',
    })
    return createdRequirement.id
  }, created)
  journey = await page.evaluate((id) => window.projectos.work.journey(id), created)
  record(
    '提交需求后需求阶段完成，并指向生成计划',
    stageOf(journey, 'requirement')?.state === 'done' && journey.nextAction.route?.includes('/orchestration')
      ? 'PASS'
      : 'FAIL',
    `req=${requirement} next=${journey.nextAction.label} owner=${journey.nextAction.owner}`,
  )

  // 3) Plan draft (local rules keep the E2E deterministic and provider-free)
  const plan = await page.evaluate(async (projectId) => {
    const generated = await window.projectos.plans.generate(projectId, '实现便签搜索并自测', { mode: 'local' })
    return { id: generated.id, revision: generated.revision, tasks: generated.tasks.length }
  }, created)
  journey = await page.evaluate((id) => window.projectos.work.journey(id), created)
  record(
    '生成草案后显示“等待你审核计划”并带真实 planId',
    journey.nextAction.label.includes('审核计划') && journey.nextAction.objectId === plan.id && stageOf(journey, 'review')?.state === 'active'
      ? 'PASS'
      : 'FAIL',
    `selection=${journey.selection.kind} next=${journey.nextAction.label} id=${journey.nextAction.objectId}`,
  )

  // 4) Approve → grant stage must become the next action
  await page.evaluate((planId) => window.projectos.plans.approve(planId), plan.id)
  journey = await page.evaluate((id) => window.projectos.work.journey(id), created)
  record(
    '批准计划后显示待授权（而不是“未生成计划”）',
    stageOf(journey, 'review')?.state === 'done' && stageOf(journey, 'grant')?.state === 'blocked' && journey.nextAction.label.includes('授权')
      ? 'PASS'
      : 'FAIL',
    `review=${stageOf(journey, 'review')?.state} grant=${stageOf(journey, 'grant')?.state} next=${journey.nextAction.label}`,
  )

  // 5) Grant → execute stage says ready / auto-starting
  const grant = await page.evaluate(async (planId) => {
    const issued = await window.projectos.plans.grant.issue({
      planId,
      actions: ['plan.start', 'workspace-write'],
      allowedPaths: ['.'],
      maxRuns: 2,
      maxToolCalls: 120,
      ttlHours: 1,
      allowOverBudget: false,
      note: 'P29 journey E2E',
      confirm: true,
    })
    return { id: issued.id, valid: issued.valid }
  }, plan.id)
  journey = await page.evaluate((id) => window.projectos.work.journey(id), created)
  record(
    '授权后旅程显示可启动/自动启动，且执行阶段进入进行中',
    grant.valid && stageOf(journey, 'grant')?.state === 'done' && stageOf(journey, 'execute')?.state === 'active'
      ? 'PASS'
      : 'FAIL',
    `grant=${grant.id} execute=${stageOf(journey, 'execute')?.state} next=${journey.nextAction.label}`,
  )

  // 6) Start; the journey must keep showing the truth while pages change.
  await page.evaluate(
    async ({ planId, grantId }) => {
      try {
        await window.projectos.orchestration.start(planId, 1, 0, false, grantId, crypto.randomUUID(), 0)
      } catch (error) {
        return String(error?.message ?? error)
      }
      return null
    },
    { planId: plan.id, grantId: grant.id },
  )

  const routes = ['/work', '/tasks', '/approvals', '/runs', '/versions', '/orchestration']
  let barOnEveryPage = true
  for (const route of routes) {
    await page.evaluate(
      ({ projectId, route }) => {
        window.location.hash = `#/projects/${projectId}${route}`
      },
      { projectId: created, route },
    )
    await page.waitForTimeout(900)
    const count = await page.locator('[data-testid="goal-journey"]').count()
    if (count === 0) barOnEveryPage = false
    record(`旅程栏在 ${route} 持续存在`, count > 0 ? 'PASS' : 'FAIL', `bars=${count}`)
  }
  record('换页时旅程栏始终存在', barOnEveryPage ? 'PASS' : 'FAIL')

  // 7) Real execution/verification truth while the run settles.
  let settled = null
  for (let index = 0; index < 40; index += 1) {
    settled = await page.evaluate(async ({ projectId, planId }) => {
      const current = await window.projectos.work.journey(projectId)
      const planView = await window.projectos.plans.get(planId)
      return { current, execution: planView.execution ?? null }
    }, { projectId: created, planId: plan.id })
    if (['completed', 'failed', 'paused'].includes(settled.execution?.status ?? '')) break
    await sleep(3000)
  }
  const executeStage = stageOf(settled.current, 'execute')
  const verifyStage = stageOf(settled.current, 'verify')
  record(
    '真实执行状态进入旅程（失败/暂停时如实显示原因）',
    executeStage && ['active', 'blocked', 'done'].includes(executeStage.state) ? 'PASS' : 'FAIL',
    `execution=${settled.execution?.status} execute=${executeStage?.state} detail=${String(executeStage?.detail).slice(0, 140)}`,
  )
  record(
    '测试未通过时不显示“验证通过”',
    verifyStage?.state !== 'done' || String(settled.execution?.deliveryStatus ?? 'none') === 'verified' ? 'PASS' : 'FAIL',
    `verify=${verifyStage?.state} delivery=${settled.execution?.deliveryStatus ?? 'none'}`,
  )
  const errorVisible = String(settled.execution?.error ?? '').length > 0
  if (errorVisible) {
    record(
      '真实错误在旅程中可见并带恢复入口',
      executeStage?.state === 'blocked' && Boolean(settled.current.nextAction.route) ? 'PASS' : 'FAIL',
      `error=${String(settled.execution.error).slice(0, 140)} next=${settled.current.nextAction.label}`,
    )
  } else {
    record('真实错误在旅程中可见并带恢复入口', 'SKIP', '本次运行没有产生执行错误')
  }

  // 8) Layout matrix + screenshots
  const win = await app.browserWindow(page)
  for (const size of [
    { label: '1440', width: 1440, height: 900, zoom: 1 },
    { label: '1024', width: 1024, height: 700, zoom: 1 },
    { label: '1440-125', width: 1440, height: 900, zoom: 1.25 },
  ]) {
    await win.evaluate((w, dims) => w.setSize(dims.width, dims.height), size)
    await win.evaluate((w, factor) => w.webContents.setZoomFactor(factor), size.zoom)
    await page.waitForTimeout(700)
    const layout = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="goal-journey"]')
      const rect = bar?.getBoundingClientRect()
      const steps = bar?.querySelectorAll('.po-journey-step').length ?? 0
      const truncated = [...(bar?.querySelectorAll('.po-journey-step-label') ?? [])].filter((node) => node.getBoundingClientRect().width < 18).length
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        height: rect?.height ?? null,
        steps,
        truncated,
        compact: bar?.classList.contains('is-compact') ?? false,
      }
    })
    record(
      `${size.label} 旅程栏不溢出且阶段可见`,
      layout.overflowX === 0 && (layout.steps >= 9 || layout.compact ? true : false) && layout.truncated === 0 ? 'PASS' : 'FAIL',
      JSON.stringify(layout),
    )
    await page.screenshot({ path: join(root, 'docs', 'screenshots', `p29-journey-${size.label}.png`) })
  }
  await win.evaluate((w) => w.webContents.setZoomFactor(1))

  // 9) Restart: the journey must come back from persisted facts.
  const before = settled.current
  await app.close()
  app = await launch()
  const page2 = await app.firstWindow()
  await page2.waitForSelector('.po-shell', { timeout: 60_000 })
  await page2.waitForTimeout(1500)
  const after = await page2.evaluate((id) => window.projectos.work.journey(id), created)
  record(
    '重启 Electron 后旅程状态与持久化事实一致',
    after.selection.planId === before.selection.planId && after.stages.length === before.stages.length
      ? 'PASS'
      : 'FAIL',
    `before=${before.selection.planId}/${before.stages.length} after=${after.selection.planId}/${after.stages.length}`,
  )
  await page2.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-journey-restart.png') })
} catch (error) {
  record('首次使用旅程 E2E', 'FAIL', String(error).slice(0, 400))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P29 GOAL JOURNEY =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} SKIP=${results.filter((i) => i.status === 'SKIP').length}`)
  console.log(`workdir kept: ${work}`)
  if (failed.length) process.exitCode = 1
}
