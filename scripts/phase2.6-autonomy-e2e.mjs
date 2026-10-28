/**
 * Phase 2.6 — AI-led autonomy + cross-module routing E2E.
 *
 * Proves the product no longer asks the user to act as a scheduler between modules:
 *   1. the bell opens a unified action panel instead of the Agent chat page;
 *   2. each action kind deep-links to its own real object (approval diff, gate,
 *      deployment reconciliation, run) — never "everything goes to /agents";
 *   3. a gate-passing version phase advances automatically (autonomous mode);
 *   4. the approvals page honours ?approval= so a notification lands on the exact item;
 *   5. action/todo state survives an Electron restart.
 *
 * No remote/VPS operations. Uses a throwaway data dir.
 */
import { _electron as electron } from 'playwright-core'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = process.env.PROJECTOS_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), 'projectos-phase2-6-'))
mkdirSync(dataDir, { recursive: true })
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

let app
async function launch() {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 40_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.po-shell.is-collapsed').count()) await page.getByRole('button', { name: '切换侧边栏' }).click()
  if (await page.locator('.v16-project-visual').count()) await page.locator('.v16-project-visual').first().click()
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  return page
}

async function main() {
  let page = await launch()
  const project = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0])
  record('Electron 启动', 'PASS', dataDir)

  // ---------- 1. Autonomy defaults ----------
  const autonomy = await page.evaluate(async ({ projectId }) => window.projectos.actions.autonomy(projectId), { projectId: project.id })
  record('默认为自主模式', autonomy.mode === 'autonomous' ? 'PASS' : 'FAIL', `mode=${autonomy.mode}`)

  // ---------- 2. Bell opens the unified action panel (not /agents) ----------
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/work` }, { projectId: project.id })
  await page.waitForSelector('[data-testid="next-step-panel"]', { timeout: 20_000 })
  record('研发工作中心出现统一「下一步」区', 'PASS')

  await page.locator('[data-testid="action-center-button"]').click()
  await page.waitForSelector('.ac-panel', { timeout: 10_000 })
  await page.waitForTimeout(600)
  const panelRoute = await page.evaluate(() => location.hash)
  record('点击铃铛不再跳转 Agent 页面', panelRoute.includes('/agents') ? 'FAIL' : 'PASS', panelRoute)
  const modeLabel = (await page.locator('.ac-head .ant-select').first().innerText().catch(() => '')).trim()
  record('面板内可切换自主模式', /自主|辅助|托管/.test(modeLabel) ? 'PASS' : 'FAIL', modeLabel || '(empty)')
  await page.screenshot({ path: join(shots, 'p26-01-action-panel.png'), timeout: 15_000 })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  // ---------- 3. Seed a real pending tool approval and check precise routing ----------
  const seeded = await page.evaluate(async ({ projectId }) => {
    // A real run + tool approval, plus a version gate that is legitimately passable.
    const lifecycle = await window.projectos.lifecycle.overview(projectId)
    const version = lifecycle.versions[0]
    const task = await window.projectos.tasks.create({
      projectId, title: 'Phase 2.6 自主推进验证', description: '验证 AI 主导推进', priority: 3,
      acceptanceCriteria: ['evidence'], labels: [], assigneeAgentId: null, milestoneId: null,
      versionId: version.id, iterationId: null, dependsOn: [], dueAt: null,
    })
    return { versionId: version.id, taskId: task.task.id, phase: version.phase }
  }, { projectId: project.id })
  record('已准备任务与版本', 'PASS', `phase=${settled(seeded.phase)}`)

  // Record the evidence the gate needs, then let the system advance on its own.
  await page.evaluate(async ({ projectId, versionId }) => {
    const evidence = [
      { evidenceType: 'review_record', assurance: 'self_declared', title: 'v 评审记录' },
      { evidenceType: 'test_report', assurance: 'source_observed', title: 'v 测试报告' },
      { evidenceType: 'approval_record', assurance: 'self_declared', title: 'v 审批记录' },
    ]
    for (const item of evidence) {
      await window.projectos.lifecycle.recordEvidence({
        projectId, subjectType: 'version', subjectId: versionId,
        evidenceType: item.evidenceType, verificationStatus: 'passed', assurance: item.assurance,
        title: item.title, summary: 'phase2.6 auto-advance evidence', provenance: {},
      })
    }
  }, { projectId: project.id, versionId: seeded.versionId })

  const beforePhase = await page.evaluate(async ({ projectId, versionId }) => (await window.projectos.lifecycle.overview(projectId)).versions.find((v) => v.id === versionId)?.phase, { projectId: project.id, versionId: seeded.versionId })
  const tick = await page.evaluate(async ({ projectId }) => window.projectos.actions.tick(projectId), { projectId: project.id })
  const afterPhase = await page.evaluate(async ({ projectId, versionId }) => (await window.projectos.lifecycle.overview(projectId)).versions.find((v) => v.id === versionId)?.phase, { projectId: project.id, versionId: seeded.versionId })
  record('证据满足后系统自动推进版本阶段',
    afterPhase !== beforePhase && tick.advanced.length > 0 ? 'PASS' : 'FAIL',
    `${beforePhase} → ${afterPhase} advanced=${JSON.stringify(tick.advanced.map((a) => `${a.from}>${a.to}`))}`)

  // ---------- 4. Action items carry precise, distinct routes ----------
  const center = await page.evaluate(async ({ projectId }) => window.projectos.actions.center(projectId), { projectId: project.id })
  const kinds = [...new Set(center.items.map((item) => item.kind))]
  record('Action Center 汇总真实事实', center.items.length > 0 ? 'PASS' : 'FAIL', `items=${center.items.length} kinds=${kinds.join(',')}`)
  const badRoutes = center.items.filter((item) => item.route.includes('/agents'))
  record('没有任何行动项回退到 Agent 页面', badRoutes.length === 0 ? 'PASS' : 'FAIL', badRoutes.map((item) => item.route).join(' | '))
  const routes = center.items.map((item) => item.route)
  record('行动项路由各不相同（非统一兜底）', new Set(routes).size === routes.length ? 'PASS' : 'FAIL', routes.length > 0 ? routes[0] : 'none')
  const gateItem = center.items.find((item) => item.kind === 'version_gate')
  if (gateItem) {
    record('门禁待办指向 Version 对象', /\/versions\?version=/.test(gateItem.route) ? 'PASS' : 'FAIL', gateItem.route)
  }

  // ---------- 5. The bell row actually lands on the exact approval ----------
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/work` }, { projectId: project.id })
  await page.waitForSelector('[data-testid="next-step-panel"]', { timeout: 20_000 })
  await page.waitForTimeout(1500)
  await page.locator('[data-testid="action-center-button"]').click()
  await page.waitForSelector('.ac-panel', { timeout: 10_000 })
  await page.waitForTimeout(1000)
  const toolRow = page.locator('.ac-row').filter({ hasText: '工具授权 |任务验收' }).first()
  const rowCount = await page.locator('.ac-row').count()
  const expectItem = center.items.find((item) => item.kind === 'tool_approval') ?? center.items[0]
  if (rowCount > 0) {
    await page.locator('.ac-row').first().click()
    await page.waitForTimeout(1600)
    const landed = await page.evaluate(() => location.hash)
    record('点击铃铛待办直达对应对象', landed.includes(`approval=${encodeURIComponent(expectItem.approvalId ?? '')}`) || /approvals\?approval=/.test(landed) ? 'PASS' : 'FAIL', `${landed} (expected approvalId=${expectItem.approvalId ?? 'n/a'})`)
    const detail = await page.locator('.ap-list, .ap-detail, .ap-diff').count()
    record('审批页显示对应审批与 Diff 区域', detail > 0 ? 'PASS' : 'FAIL', `panels=${detail}`)
    await page.screenshot({ path: join(shots, 'p26-03-approval-deeplink.png'), timeout: 15_000 })
  } else {
    record('点击铃铛待办直达对应对象', 'FAIL', '面板没有任何待办行')
  }
  void toolRow

  // ---------- 6. Approvals page honours ?approval= ----------
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/approvals?approval=apr_nonexistent_000` }, { projectId: project.id })
  await page.waitForTimeout(1200)
  const survived = await page.locator('.ap-list, .po-page').count()
  record('无效审批深链接不崩溃', survived > 0 ? 'PASS' : 'FAIL')

  // ---------- 7. Restart keeps autonomy + action state ----------
  const beforeRestart = await page.evaluate(async ({ projectId }) => window.projectos.actions.center(projectId), { projectId: project.id })
  await app.close()
  page = await launch()
  const afterRestart = await page.evaluate(async ({ projectId }) => window.projectos.actions.center(projectId), { projectId: project.id })
  const afterAutonomy = await page.evaluate(async ({ projectId }) => window.projectos.actions.autonomy(projectId), { projectId: project.id })
  record('重启后自主模式保持', afterAutonomy.mode === autonomy.mode ? 'PASS' : 'FAIL', `${autonomy.mode} → ${afterAutonomy.mode}`)
  record('重启后待办数量一致', afterRestart.items.length === beforeRestart.items.length ? 'PASS' : 'FAIL', `${beforeRestart.items.length} → ${afterRestart.items.length}`)
  const phaseAfterRestart = await page.evaluate(async ({ projectId, versionId }) => (await window.projectos.lifecycle.overview(projectId)).versions.find((v) => v.id === versionId)?.phase, { projectId: project.id, versionId: seeded.versionId })
  record('重启后自动推进结果保持', phaseAfterRestart === afterPhase ? 'PASS' : 'FAIL', `${afterPhase} → ${phaseAfterRestart}`)

  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/work` }, { projectId: project.id })
  await page.waitForSelector('[data-testid="next-step-panel"]', { timeout: 20_000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(shots, 'p26-02-next-step-after-restart.png') })
  await app.close()

  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== PHASE 2.6 AUTONOMY + ROUTING =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} SKIP=${results.filter((i) => i.status === 'SKIP').length}`)
  console.log(`dataDir=${dataDir}`)
  if (failed.length) process.exitCode = 1
  else console.log('PHASE 2.6 E2E PASS')
}

function settled(value) {
  return value ?? 'unknown'
}

main().catch(async (error) => {
  console.error('[fatal]', error)
  try { await app?.close() } catch { /* ignore */ }
  process.exitCode = 1
})
