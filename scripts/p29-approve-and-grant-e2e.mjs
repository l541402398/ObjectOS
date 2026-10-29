/**
 * ADR-0051 — real UI verification for the two user-requested improvements.
 *
 *   1. Autonomous mode drafts a plan from a requirement without the user clicking 生成计划, and the
 *      draft is never approved or authorized on its own.
 *   2. The plan review exposes one "批准并授权" action: one confirmation approves the plan, issues the
 *      execution grant with the shown scope and starts the run.
 *
 * Real Electron + real preload API; a separate user-data dir so the packaged app the user is running
 * keeps its single-instance lock.
 *
 * usage: node scripts/p29-approve-and-grant-e2e.mjs
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-ui-'))
const dataDir = join(work, 'data')
mkdirSync(dataDir, { recursive: true })

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function gitProject(name) {
  const dir = join(work, name)
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'README.md'), `# ${name}\n`)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module' }, null, 2))
  git(dir, ['init', '-q'])
  git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'])
  git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'])
  return dir
}
function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' })
}

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

let app = null
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${join(work, 'userdata')}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(1200)

  // ---- project A: autonomous auto-draft from a requirement ----
  const dirA = gitProject('autodraft')
  const projectA = await page.evaluate(async (rootPath) => {
    const created = await window.projectos.projects.create({ name: '自动草案验证', rootPath, createDirectory: false, initGit: false })
    await window.projectos.actions.setAutonomy({
      projectId: created.project.id,
      mode: 'autonomous',
      autoStartPlans: true,
      autoApplyReplans: true,
      autoDeliver: false,
      maxAutoReplans: 3,
    })
    await window.projectos.requirements.create({
      projectId: created.project.id,
      title: '实现便签搜索',
      body: '支持按标题与正文搜索并高亮匹配。',
      acceptanceCriteria: ['搜索返回匹配项'],
      source: 'local',
    })
    await window.projectos.actions.tick(created.project.id)
    return created.project.id
  }, dirA)
  const drafts = await page.evaluate(async (projectId) => {
    const list = await window.projectos.plans.list(projectId)
    return list.plans.map((plan) => ({ id: plan.id, status: plan.status, goal: plan.goal, tasks: plan.createdTaskIds.length }))
  }, projectA)
  record(
    '自主模式根据需求自动生成计划草案',
    drafts.length === 1 && drafts[0].status === 'draft' ? 'PASS' : 'FAIL',
    JSON.stringify(drafts).slice(0, 240),
  )
  record(
    '自动生成的草案没有被自动批准或授权',
    drafts[0]?.status === 'draft' && drafts[0]?.tasks === 0 ? 'PASS' : 'FAIL',
    `status=${drafts[0]?.status} tasks=${drafts[0]?.tasks}`,
  )
  const secondTick = await page.evaluate(async (projectId) => {
    await window.projectos.actions.tick(projectId)
    const list = await window.projectos.plans.list(projectId)
    return list.plans.length
  }, projectA)
  record('重复 tick 不会重复生成草案', secondTick === 1 ? 'PASS' : 'FAIL', `plans=${secondTick}`)

  // ---- project B: one-click 批准并授权 ----
  const dirB = gitProject('oneclick')
  const projectB = await page.evaluate(async (rootPath) => {
    const created = await window.projectos.projects.create({ name: '一键授权验证', rootPath, createDirectory: false, initGit: false })
    await window.projectos.plans.generate(created.project.id, '实现便签导出为 Markdown 并自测', { mode: 'local' })
    return created.project.id
  }, dirB)
  await page.evaluate((id) => {
    window.location.hash = `#/projects/${id}/orchestration`
  }, projectB)
  await page.waitForTimeout(2200)
  // The header「生成计划」opens the review modal with the latest draft — the same path a user takes.
  const openButton = page.getByRole('button', { name: '生成计划', exact: true }).first()
  if ((await openButton.count()) > 0) {
    await openButton.click()
    await page.waitForTimeout(1800)
  }
  const button = page.locator('[data-testid="plan-approve-and-grant"]').first()
  const buttonCount = await button.count()
  record('计划评审提供「批准并授权」按钮', buttonCount > 0 ? 'PASS' : 'FAIL', `count=${buttonCount}`)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-approve-and-grant.png') })
  if (buttonCount > 0) {
    await button.click()
    await page.waitForTimeout(600)
    const confirm = page.getByRole('button', { name: '批准并授权', exact: true }).last()
    record('点击后要求一次确认（人工授权仍在）', (await confirm.count()) > 0 ? 'PASS' : 'FAIL')
    await confirm.click()
    await page.waitForTimeout(2500)
    const state = await page.evaluate(async (projectId) => {
      const list = await window.projectos.plans.list(projectId)
      const plan = list.plans[0]
      const grant = plan ? await window.projectos.plans.grant.get(plan.id) : null
      return { status: plan?.status, tasks: plan?.createdTaskIds.length, execution: plan?.execution?.status ?? null, grantValid: grant?.valid ?? false, grantPaths: grant?.allowedPaths ?? [] }
    }, projectB)
    record(
      '一次确认完成批准 + 签发授权',
      state.status === 'approved' && state.grantValid && state.tasks > 0 ? 'PASS' : 'FAIL',
      JSON.stringify(state).slice(0, 240),
    )
  }
} catch (error) {
  record('一键批准并授权验收', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P29 AUTO DRAFT + APPROVE&GRANT =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  if (failed.length) process.exitCode = 1
}
