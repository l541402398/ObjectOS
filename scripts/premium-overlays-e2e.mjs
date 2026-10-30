/** Real UI journeys, isolated persisted demo. Never approves production runs or calls a provider. */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
const quick = process.argv.includes('--quick'), only = process.argv.find((v) => v.startsWith('--only='))?.slice(7)
const out = resolve('docs/design/system-premium', quick || only ? 'overlay-probe' : 'overlays')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-premium-overlays-'))
const env = { ...process.env, PROJECTOS_SEED_DEMO: '1', PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60_000 })
const page = await app.firstWindow(), win = await app.browserWindow(page)
page.setDefaultTimeout(8000)
const checks = [], audits = [], errors = []
page.on('pageerror', (e) => errors.push(e.message))
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
let projectId
const check = (name, value, detail = '') => { checks.push({ name, status: value ? 'PASS' : 'FAIL', detail }); console.log(`[${value ? 'PASS' : 'FAIL'}] ${name} ${detail}`) }
const button = (name) => page.getByRole('button', { name: typeof name === 'string' ? new RegExp('(?:^| )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') : name })
const resize = async (width = 1440, zoom = 1, mode = 'light') => {
  await win.evaluate((w, v) => { w.setContentSize(v.width, 900); w.webContents.setZoomFactor(v.zoom) }, { width, zoom })
  await page.emulateMedia({ colorScheme: mode }); await page.waitForTimeout(400)
}
const reset = async (route) => {
  await resize(); await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate((route) => { location.hash = route }, route === 'center' ? '#/' : `#/projects/${projectId}/${route}`)
  await page.reload(); await page.waitForSelector('.po-shell'); await page.waitForTimeout(1700)
}
const settings = async (label) => { await reset('tasks'); await button('设置').first().click(); await button(label).last().click(); await page.waitForTimeout(650) }
const shot = async (name, scope = '.pui-overlay-surface', variants) => {
  await page.locator(scope).last().waitFor()
  for (const [width, mode, zoom] of variants ?? (quick ? [[1440, 'light', 1]] : [[1440, 'light', 1], [1440, 'dark', 1], [1024, 'light', 1], [1024, 'dark', 1], [1440, 'light', 1.25], [1440, 'dark', 1.25], [1024, 'light', 1.25], [1024, 'dark', 1.25]])) {
    await resize(width, zoom, mode); await page.mouse.move(3, 3)
    const key = `${name}-${width}-${mode}${zoom === 1.25 ? '-125' : ''}`
    const image = await win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64'))
    writeFileSync(join(out, `${key}.png`), Buffer.from(image, 'base64'))
    const geometry = await page.locator(scope).last().evaluate((el) => { const r = el.getBoundingClientRect(); return { width: innerWidth, height: innerHeight, x: r.x, y: r.y, right: r.right, bottom: r.bottom, overflow: el.scrollWidth - el.clientWidth } })
    check(`${key} fits`, geometry.x >= -1 && geometry.y >= -1 && geometry.right <= geometry.width + 2 && geometry.bottom <= geometry.height + 2 && geometry.overflow <= 2, JSON.stringify(geometry))
    if (name === 'real-plan') {
      const graph = await page.locator('.pdl-dag').evaluate((el) => {
        const bounds = el.getBoundingClientRect()
        return [...el.querySelectorAll('.react-flow__node')].map((node) => {
          const r = node.getBoundingClientRect(), style = getComputedStyle(node)
          return { id: node.dataset.id, x: r.x, y: r.y, width: r.width, height: r.height, visibility: style.visibility, transform: style.transform, inlineStyle: node.getAttribute('style'), viewport: el.querySelector('.react-flow__viewport')?.getAttribute('style'), visible: style.visibility === 'visible' && r.width > 0 && r.height > 0 && r.left >= bounds.left - 2 && r.right <= bounds.right + 2 && r.top >= bounds.top - 2 && r.bottom <= bounds.bottom + 2 }
        })
      })
      check(`${key} nodes visible`, graph.length > 0 && graph.every((node) => node.visible), JSON.stringify(graph))
    }
    if ((width === 1440 || name === 'navigation-menu') && zoom === 1) {
      await page.evaluate(axe)
      const report = await page.locator(scope).last().evaluate(async (el) => { const r = await window.axe.run(el, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } }); return { violations: r.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: r.incomplete.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })) } })
      audits.push({ name: key, ...report }); check(`${key} accessibility`, !report.violations.length, report.violations.map((v) => v.id).join(', '))
    }
  }
  await resize()
}
const journey = async (name, run) => {
  if (only && name !== only) return
  try { await run(); check(`${name} journey`, true) }
  catch (error) { check(`${name} journey`, false, String(error)); const image = await win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64')); writeFileSync(join(out, `${name}-failure.png`), Buffer.from(image, 'base64')) }
}
try {
  await page.waitForSelector('.po-shell', { timeout: 60_000 }); await page.waitForTimeout(4500)
  projectId = (await page.evaluate(() => window.projectos.projects.list())).projects[0].id
  await journey('project-create', async () => { await reset('center'); await button('新建项目').first().click(); await shot('project-create') })
  await journey('project-import', async () => { await reset('center'); await button('导入项目').first().click(); await shot('project-import') })
  await journey('command-palette', async () => { await reset('tasks'); await page.keyboard.press('Control+k'); await shot('command-palette'); await page.getByLabel('搜索页面、操作或设置').fill('运行审计'); await page.keyboard.press('Enter'); await page.waitForURL('**/runs'); check('Command navigation uses real route', page.url().endsWith('/runs')) })
  await journey('navigation', async () => { await reset('tasks'); await button('切换侧边栏').click(); check('Expanded navigation shows real page labels', !await page.locator('.po-shell').evaluate((el) => el.classList.contains('is-collapsed'))); await shot('navigation-expanded', '.po-shell'); await button('切换侧边栏').click(); await resize(1024); await button('切换侧边栏').click(); await shot('navigation-menu', '.po-navigation-menu', quick ? [[1024, 'light', 1]] : [[1024, 'light', 1], [1024, 'dark', 1], [1024, 'light', 1.25], [1024, 'dark', 1.25]]) })
  await journey('journey-details', async () => { await reset('tasks'); await page.getByTestId('journey-toggle').click(); await shot('journey-details', '[data-testid="journey-panel"]'); check('Full process remains reachable', await page.locator('.po-journey-panel-row').count() === 9) })
  await journey('task-create', async () => { await reset('tasks'); await button('新建任务').click(); await shot('task-create'); await page.getByRole('dialog', { name: '新建任务', exact: true }).getByLabel('优先级', { exact: true }).click(); await page.locator('.ant-select-dropdown').last().waitFor(); await shot('task-priority-menu'); await page.keyboard.press('Escape'); check('Select Escape leaves its form open', await page.getByRole('dialog', { name: '新建任务', exact: true }).isVisible()) })
  await journey('task-detail', async () => { await reset('tasks'); await page.locator('.po-task-tile').first().click(); await shot('task-detail', '[data-testid="task-detail-inspector"]'); await button('编辑').last().click(); await shot('task-edit') })
  await journey('agent-studio', async () => { await reset('agents'); await button('Agent 管理').click(); await shot('agent-studio', '[data-testid="agent-studio-sheet"]'); await page.getByLabel('名称', { exact: true }).fill('视觉检查 Agent'); for (let step = 0; step < 4; step++) await button(/下一步/).click(); await button('创建 Agent').click(); await page.getByTestId('agent-studio-sheet').waitFor({ state: 'hidden' }); await button('Agent 管理').click(); await page.locator('.v16-template-item').filter({ hasText: '视觉检查 Agent' }).click(); await shot('agent-edit', '[data-testid="agent-studio-sheet"]'); await button('提示词').click(); await shot('agent-prompt-preview', '[data-testid="product-decision-dialog"]'); check('Nested decision uses one backdrop', await page.locator('.pui-overlay-backdrop').count() === 1); await page.keyboard.press('Escape'); await page.getByTestId('product-decision-dialog').waitFor({ state: 'hidden' }); check('Closing preview restores its invoker', await button('提示词').evaluate((el) => el === document.activeElement)); if (await button('运行测试').count()) { await button('运行测试').click(); await shot('agent-test', '[data-testid="agent-studio-run"]') } })
  await journey('agent-flow', async () => {
    await reset('agents'); await page.locator('.aco-gnode-task').first().click(); await page.waitForTimeout(500)
    const pulse = page.locator('.aco-flow-pulse').first(); await pulse.waitFor()
    const first = await pulse.evaluate((el) => getComputedStyle(el).offsetDistance); await page.waitForTimeout(700)
    const next = await pulse.evaluate((el) => getComputedStyle(el).offsetDistance)
    check('Pulse actually advances source to target', first !== next, `${first} → ${next}`)
    await shot('agent-context', '[data-testid="collaboration-inspector"]')
    await page.keyboard.press('Escape'); await page.waitForTimeout(350)
    await button('暂停流向脉冲').click(); check('Flow pause removes animations', await page.locator('.aco-flow-pulse').count() === 0)
    await button('开启流向脉冲').click(); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(150)
    check('System reduced-motion removes pulses live', await page.locator('.aco-flow-pulse').count() === 0)
    await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.waitForTimeout(200)
    check('Reduced-motion can be interrupted', await button('暂停流向脉冲').isEnabled())
    await shot('agent-flow', '.aco-canvas')
  })
  await journey('plan-generator', async () => { await reset('orchestration'); await button('生成计划').first().click(); if (await page.getByTestId('plan-review-workspace').count()) { await button('拒绝计划').click(); await page.getByTestId('plan-review-workspace').waitFor({ state: 'hidden' }); await button('生成计划').first().click() }; await shot('plan-generator'); await page.getByRole('radio', { name: /本地/ }).click(); await page.getByPlaceholder('例如：增加角色分级的用户权限管理，覆盖数据、接口、前端与测试').fill('完善团队项目的任务协作与验收体验'); await page.getByTestId('plan-generate').click(); await page.getByTestId('plan-review-workspace').waitFor({ timeout: 30_000 }); await shot('real-plan', '[data-testid="plan-review-workspace"]'); check('Plan shares real navigation and defaults to DAG', await button('任务看板').isVisible() && await page.getByRole('tab', { name: '任务依赖', exact: true }).getAttribute('aria-selected') === 'true'); await page.locator('.pdl-node').first().click(); await shot('real-plan-inspector', '[data-testid="design-lab-inspector"]'); await page.getByLabel('任务标题', { exact: true }).pressSequentially(' · 审核'); check('Real inspector keeps typing focus', await page.getByLabel('任务标题', { exact: true }).evaluate((el) => el === document.activeElement)) })
  await journey('run-detail', async () => { await reset('runs'); await page.locator('.ant-table-tbody tr[data-row-key]').first().click(); await shot('run-detail', '[data-testid="run-detail-sheet"]') })
  await journey('version-create', async () => { await reset('versions'); await button('新建版本').click(); await shot('version-create') })
  await journey('iteration-create', async () => { await reset('versions'); await button('新建迭代').click(); await shot('iteration-create') })
  await journey('environment-create', async () => { await reset('deployments'); await button('登记环境').click(); await shot('environment-create') })
  await journey('evidence-record', async () => { await reset('versions'); await button('记录证据').first().click(); await shot('evidence-record') })
  await journey('release-change', async () => { await reset('releases'); await button('新建变更').click(); await shot('release-change') })
  await journey('deployment-create', async () => { await reset('deployments'); await shot('deployment-readiness', '.po-main'); check('Empty deployment guides to available release', await button('前往发布中心').isVisible()) })
  await journey('deployment-target', async () => { await reset('deployments'); await button('连接部署目标').first().click(); await shot('deployment-target') })
  await journey('resource-create', async () => { await reset('connections'); await button('新建主机').click(); await shot('resource-create') })
  await journey('lifecycle-create', async () => { await reset('overview'); await button('新增').first().click(); await shot('lifecycle-create') })
  await journey('collaboration-message', async () => { await reset('collaboration'); await button('手动投递').click(); await shot('collaboration-message') })
  await journey('connection-editor', async () => {
    await settings('AI 连接'); await button('新增连接').first().click(); await shot('connection-editor', '[data-testid="settings-dialog"]')
    await page.getByLabel('名称', { exact: true }).fill('本机视觉检查'); await page.getByLabel('Base URL').fill('http://127.0.0.1:18899/v1'); await page.getByLabel('默认模型').fill('local-visual-model')
    await button(/保\s*存/).last().click(); await page.locator('.po-ai-connection-card').first().waitFor(); check('Connection edit stays inline in Settings', await page.getByRole('dialog').count() === 1); await page.getByLabel('更多操作：本机视觉检查').click(); await page.getByText('删除连接', { exact: true }).click(); await shot('connection-delete-confirm', '[data-testid="product-decision-dialog"]'); await page.getByTestId('product-decision-dialog').getByRole('button', { name: /取\s*消/ }).click(); await page.getByTestId('product-decision-dialog').waitFor({ state: 'hidden' }); check('Cancelled decision keeps Settings open', await page.getByTestId('settings-dialog').isVisible()); check('Cancelled decision preserves connection', await page.locator('.po-ai-connection-card').count() === 1)
  })
  await journey('model-add', async () => { await settings('模型目录'); await button('手动添加').click(); await shot('model-add'); await page.getByLabel('模型 ID', { exact: true }).fill('visual-check-model'); await page.getByLabel('显示名称', { exact: true }).fill('Visual Check'); await button(/添\s*加/).last().click(); await page.locator('tr').filter({ hasText: 'Visual Check' }).click(); await shot('model-detail', '[data-testid="settings-model-detail"]'); await page.keyboard.press('Escape'); check('Child inspector Escape preserves Settings', await page.getByTestId('settings-dialog').isVisible()) })
  await journey('runtime-create', async () => { await settings('运行时'); await button('自定义').click(); await shot('runtime-create') })
  await journey('runtime-detail', async () => { await settings('工具与插件'); await page.locator('.v16-tool-card').first().click(); await shot('runtime-detail', '[data-testid="settings-runtime-detail"]') })
  await journey('skill-detail', async () => { await settings('Skills 管理'); await page.locator('input[type="file"]').setInputFiles({ name: 'visual-check.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: 视觉验收\ndescription: 检查页面材质、可读性与键盘操作\n---\n# 视觉验收\n验证两种主题与窄窗口。') }); await page.locator('.v16-skill-library-card').filter({ hasText: '视觉验收' }).click(); await shot('skill-detail', '[data-testid="settings-skill-detail"]') })
  check('No Renderer exceptions', !errors.length, errors.join(' | '))
} finally {
  await app.close().catch(() => {})
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixture: 'isolated persisted demo; actual typed IPC; no external provider calls', checks, audits, errors }, null, 2))
  if (checks.some((c) => c.status === 'FAIL')) process.exitCode = 1
}
