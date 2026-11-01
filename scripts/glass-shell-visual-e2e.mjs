/** Global glass shell visual capture: real Electron + Runtime + SQLite. Usage: node scripts/glass-shell-visual-e2e.mjs <outDir> */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? 'docs/v2/evidence/glass-shell/after')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-glass-'))
const rootPath = join(profile, 'project')
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '0', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], captures = [], errors = []
let app, page, win
const check = (name, ok, detail) => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`) }
const shot = async name => { await page.mouse.move(2, 2); await page.waitForTimeout(600); writeFileSync(join(out, `${name}.png`), Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64')); captures.push(`${name}.png`) }
async function audit(name) {
  await page.evaluate(readFileSync(resolve('node_modules/axe-core/axe.min.js'), 'utf8'))
  const result = await page.evaluate(async () => { const r = await window.axe.run(document.querySelector('.po-shell') ?? document.body); return { violations: r.violations.map(v => ({ id: v.id, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map(n => n.target.join(' ')) })), contrastIncomplete: r.incomplete.filter(v => v.id === 'color-contrast').reduce((n, v) => n + v.nodes.length, 0) } })
  check(`${name} axe`, result.violations.length === 0, result)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2)
  check(`${name} no horizontal overflow`, !overflow)
}
try {
  app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], cwd: resolve('apps/desktop'), env, timeout: 60000 })
  page = await app.firstWindow(); win = await app.browserWindow(page); page.setDefaultTimeout(20000)
  page.on('pageerror', e => errors.push(e.message))
  await page.locator('.po-shell').waitFor({ timeout: 60000 })
  const project = (await page.evaluate(rootPath => window.projectos.projects.create({ name: 'Aurora Notes', description: '跨设备笔记与离线恢复', rootPath, createDirectory: true, initGit: true }), rootPath)).project
  execFileSync('git', ['-C', rootPath, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', 'base'], { windowsHide: true })
  const req = (await page.evaluate(projectId => window.projectos.requirements.create({ projectId, title: '跨设备编辑的一致性与恢复体验', body: '断网、重连和长文本场景中保持编辑内容完整。', source: 'local', acceptanceCriteria: ['重启后恢复原文'], workflow: { templateVersionId: 'wfv_standard1', assignmentMode: 'manual', assignments: { 'stage-1': 'agt_product', 'stage-2': 'agt_reviewer', 'stage-3': 'agt_architect', 'stage-4': 'agt_reviewer', 'stage-5': 'agt_engineer', 'stage-6': 'agt_qa' } } }), project.id)).requirement
  for (const title of ['保存草稿并在重启后恢复', '断网期间的编辑冲突提示', '长文本恢复的性能边界']) await page.evaluate(input => window.projectos.tasks.create(input), { projectId: project.id, requirementId: req.id, title, acceptanceCriteria: ['恢复内容完整'] })
  const routes = [['home', '#/'], ['overview', `#/projects/${project.id}/overview`], ['requirements', `#/projects/${project.id}/requirements?requirement=${req.id}`], ['tasks', `#/projects/${project.id}/tasks`], ['agents', `#/projects/${project.id}/agents`]]
  for (const [width, height] of [[1440, 900], [1024, 768]]) for (const theme of ['light', 'dark']) {
    await win.evaluate((w, s) => w.setSize(...s), [width, height]); await page.emulateMedia({ colorScheme: theme })
    for (const [name, hash] of routes) {
      await page.evaluate(h => { location.hash = h }, hash); await page.waitForTimeout(1500)
      await shot(`${name}-${width}-${theme}`)
      if (width === 1440) await audit(`${name} ${width} ${theme}`)
    }
  }
  await win.evaluate(w => w.setSize(1440, 900)); await page.emulateMedia({ colorScheme: 'light' })
  await page.evaluate(h => { location.hash = h }, `#/projects/${project.id}/requirements?requirement=${req.id}`); await page.waitForTimeout(1200)
  // Rough frame-rate sample while the main region scrolls (rAF count, not a GPU profiler).
  const fps = await page.evaluate(() => new Promise(done => {
    const main = document.querySelector('.po-main'); let frames = 0, dir = 1; const start = performance.now()
    const tick = now => { frames++; if (main) { main.scrollTop += 14 * dir; if (main.scrollTop <= 0 || main.scrollTop + main.clientHeight >= main.scrollHeight) dir *= -1 } if (now - start < 3000) requestAnimationFrame(tick); else done(Math.round(frames / ((now - start) / 1000))) }
    requestAnimationFrame(tick)
  }))
  checks.push({ name: 'scroll rAF frame rate (requirements, 1440 light)', status: 'INFO', detail: { fps } }); console.log(`INFO fps=${fps}`)
  const arrange = page.getByRole('button', { name: '任务安排', exact: true })
  if (await arrange.count()) { await arrange.first().click(); await page.waitForTimeout(800); await shot('dialog-arrangement-1440-light'); await page.emulateMedia({ colorScheme: 'dark' }); await shot('dialog-arrangement-1440-dark'); await page.keyboard.press('Escape'); await page.emulateMedia({ colorScheme: 'light' }) }
  // Verify Item 4 (3D Agent Roster Bar + Drag/Assign + Task Handoff Dialog) & Item 3/6 (Floating Glass Task Drawer + In-Place Assign/Handoff)
  await page.evaluate(h => { location.hash = h }, `#/projects/${project.id}/tasks`); await page.waitForTimeout(1200)
  const rosterCards = page.locator('.po-roster-agent')
  const rosterCount = await rosterCards.count()
  check('Task Board 3D Agent Roster Bar rendered', rosterCount >= 2, { rosterCount })
  const firstTaskCard = page.locator('.po-task-tile').first()
  if (rosterCount >= 2 && await firstTaskCard.count()) {
    const agent1Id = await rosterCards.nth(0).getAttribute('data-agent-id')
    const agent2Id = await rosterCards.nth(1).getAttribute('data-agent-id')
    // 1) Open Task Detail Drawer and verify floating glass inspector + in-place assign button
    await firstTaskCard.click(); await page.waitForTimeout(900)
    await shot('task-drawer-1440-light')
    const assignBtn = page.getByTestId('drawer-assign-agent-btn')
    check('Task Drawer has in-place Assign/Handoff Agent button', await assignBtn.count() === 1)
    // Assign first agent via API, then trigger handoff to second agent to capture Task Handoff Confirmation Dialog
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
    if (agent1Id && agent2Id) {
      // Simulate dropping agent1 onto firstTaskCard (unassigned -> immediate assignment)
      await page.locator('.po-task-tile').first().evaluate((el, a1) => {
        const dt = new DataTransfer()
        dt.setData('application/x-projectos-agent', JSON.stringify({ id: a1, name: 'Avery', role: '产品负责人' }))
        el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      }, agent1Id)
      await page.waitForTimeout(900)
      // Simulate dropping agent2 onto firstTaskCard (already assigned -> opens Task Handoff Confirmation Dialog!)
      await page.locator('.po-task-tile').first().evaluate((el, a2) => {
        const dt = new DataTransfer()
        dt.setData('application/x-projectos-agent', JSON.stringify({ id: a2, name: 'Sage', role: '架构师' }))
        el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
        el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      }, agent2Id)
      await page.waitForTimeout(800)
      const handoffDialog = page.getByTestId('task-handoff-dialog')
      check('Task Handoff Confirmation Dialog opens when dropping new Agent onto assigned task', await handoffDialog.count() === 1)
      await shot('task-handoff-dialog-1440-light')
      const confirmBtn = page.getByTestId('confirm-task-handoff-btn')
      if (await confirmBtn.count()) { await confirmBtn.click(); await page.waitForTimeout(900) }
      await shot('tasks-assigned-1440-light')
    }
  }
  // Verify Item 3 on Collaboration Overview (Floating Glass Inspector Drawer with 3D Avatar Hero + Bento Cards)
  await page.evaluate(h => { location.hash = h }, `#/projects/${project.id}/agents`); await page.waitForTimeout(1400)
  await shot('agents-active-1440-light')
  const firstCollabNode = page.locator('.aco-node').first()
  if (await firstCollabNode.count()) {
    await firstCollabNode.click(); await page.waitForTimeout(800)
    await shot('collaboration-drawer-1440-light')
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  }
  // Verify Item 5 (Orchestration Plan & Task Ledger Hub without redundant graph)
  await page.evaluate(h => { location.hash = h }, `#/projects/${project.id}/orchestration`); await page.waitForTimeout(1200)
  check('Orchestration Plan Hub rendered without duplicate graph canvas', await page.locator('.po-orch-plan-hub').count() === 1)
  await shot('orchestration-hub-1440-light')
  // Verify New Batch: (1) Smooth Switch in Create Project Dialog, (2) Studio Home '...' Menu, (3/4) Studio Home In-Place RequirementCreateModal + Cancel stays on page, (5) Sidebar Execution Order, (6) Pinned Project Hub Secondary Menu Popover
  await page.evaluate(() => { location.hash = '#/' }); await page.waitForTimeout(900)
  const newProjBtn = page.getByRole('button', { name: /新建项目/ })
  if (await newProjBtn.count()) {
    await newProjBtn.first().click(); await page.waitForTimeout(600)
    await shot('create-project-switch-1440-light')
    await page.keyboard.press('Escape'); await page.waitForTimeout(400)
  }
  await page.evaluate(h => { location.hash = h }, `#/projects/${project.id}`); await page.waitForTimeout(1000)
  // Expand sidebar to verify full workflow-ordered labels + pinned Project Hub trigger & right-side secondary menu
  const toggleSideBtn = page.getByRole('button', { name: '切换侧边栏' })
  if (await toggleSideBtn.count()) {
    const isCollapsed = await page.locator('.po-shell.is-collapsed').count()
    if (isCollapsed) { await toggleSideBtn.click(); await page.waitForTimeout(400) }
  }
  const hubTrigger = page.getByTestId('project-hub-trigger')
  check('Pinned Project Hub trigger rendered between project switcher and R&D nav', await hubTrigger.count() === 1)
  if (await hubTrigger.count()) {
    await hubTrigger.click(); await page.waitForTimeout(600)
    await shot('sidebar-project-hub-1440-light')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  }
  const moreBtn = page.getByRole('button', { name: '更多项目操作' })
  if (await moreBtn.count()) {
    await moreBtn.click(); await page.waitForTimeout(600)
    await shot('studio-home-menu-1440-light')
    await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  }
  const proposeBtn = page.getByRole('button', { name: /提出需求/ })
  if (await proposeBtn.count()) {
    await proposeBtn.first().click(); await page.waitForTimeout(700)
    await shot('studio-home-create-req-1440-light')
    const workflowSelect = page.locator('.pui-overlay-dialog .ant-select').first()
    if (await workflowSelect.count()) {
      await workflowSelect.click(); await page.waitForTimeout(300)
      await shot('create-req-workflow-select-1440-light')
      const modalFps = await page.evaluate(() => new Promise(done => {
        let frames = 0; const start = performance.now()
        const tick = now => { frames++; if (now - start < 1000) requestAnimationFrame(tick); else done(Math.round(frames / ((now - start) / 1000))) }
        requestAnimationFrame(tick)
      }))
      checks.push({ name: 'modal + workflow dropdown open rAF frame rate', status: modalFps >= 55 ? 'PASS' : 'INFO', detail: { modalFps } }); console.log(`INFO modal_dropdown_fps=${modalFps}`)
      const secondOption = page.locator('.ant-select-dropdown .ant-select-item-option').nth(1)
      if (await secondOption.count()) { await secondOption.click(); await page.waitForTimeout(250) }
    }
    const cancelBtn = page.getByRole('button', { name: '取消', exact: true })
    if (await cancelBtn.count()) { await cancelBtn.first().click(); await page.waitForTimeout(400) }
    const discardBtn = page.getByRole('button', { name: '放弃修改', exact: true })
    if (await discardBtn.count()) { await discardBtn.first().click(); await page.waitForTimeout(400) }
    const hashAfterCancel = await page.evaluate(() => location.hash)
    check('Cancel on Studio Home Create Requirement stays on Studio Home without switching page', hashAfterCancel === `#/projects/${project.id}`, { hashAfterCancel })
  }
  await page.evaluate(h => { location.hash = h }, `#/projects/${project.id}/requirements?requirement=${req.id}`); await page.waitForTimeout(800)
  await win.evaluate(w => w.webContents.setZoomFactor(1.25)); await win.evaluate(w => w.setSize(1024, 768)); await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(800); await shot('requirements-1024-light-125-reduced')
  check('No renderer exceptions', errors.length === 0, errors)
} catch (error) { process.exitCode = 1; console.error(error); checks.push({ name: 'execution', status: 'FAIL', detail: String(error.stack ?? error) }) }
finally {
  await app?.close().catch(() => {})
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), checks, captures, errors, note: 'Real Electron capturePage. 125% is app zoom, not OS DPI. axe color-contrast cannot always resolve translucent backgrounds; incomplete counts are reported.' }, null, 2))
}
