/** Current approved DAG / frozen five-fix contract. No phantom demo pages or production approvals. */
import { compositeContrast } from './lib/premium-contrast.mjs'
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const out = resolve('docs/design/system-premium/lab'), profile = mkdtempSync(join(tmpdir(), 'projectos-premium-lab-'))
mkdirSync(out, { recursive: true })
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_START_ROUTE: 'design-lab', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = [], audits = []
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60_000 })
const page = await app.firstWindow(), win = await app.browserWindow(page)
page.on('pageerror', (e) => errors.push(e.message))
const check = (name, condition, detail = '') => { checks.push({ name, status: condition ? 'PASS' : 'FAIL', detail }); console.log(`[${condition ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); if (!condition) throw new Error(name) }
const shot = async (name) => { await page.mouse.move(4, 4); await page.waitForTimeout(400); const bytes = await win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64')); writeFileSync(join(out, `${name}.png`), Buffer.from(bytes, 'base64')) }
const theme = async (mode) => { if (await page.locator('.pdl-root').first().getAttribute('data-theme') !== mode) await page.getByRole('button', { name: mode === 'dark' ? '切换到暗色' : '切换到浅色', exact: true }).click(); await page.waitForTimeout(160) }
const resize = async (width, zoom = 1) => { await win.evaluate((w, v) => { w.setContentSize(v.width, 900); w.webContents.setZoomFactor(v.zoom) }, { width, zoom }); await page.waitForTimeout(200) }
const require = createRequire(import.meta.url), axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const audit = async (state, target) => {
  await page.evaluate(axe)
  const result = await page.evaluate(async (target) => { const r = await window.axe.run(document.querySelector(target), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } }); return { violations: r.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: r.incomplete.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })), passes: r.passes.length } }, target)
  const contrast = await compositeContrast(page, win, target)
  audits.push({ state, ...result, contrast }); writeFileSync(join(out, 'axe.json'), JSON.stringify(audits, null, 2))
}
const anchors = async (name) => {
  const result = await page.evaluate(() => {
    const path = document.querySelector('.pdl-journey-track'), length = path.getTotalLength(), transform = path.getScreenCTM()
    const points = Array.from({ length: 2401 }, (_, i) => { const p = path.getPointAtLength(length * i / 2400); return new DOMPoint(p.x, p.y).matrixTransform(transform) })
    return [...document.querySelectorAll('.pdl-stop')].map((button) => { const r = button.getBoundingClientRect(); return Math.min(...points.map((p) => Math.hypot(p.x - r.left - r.width / 2, p.y - r.top - r.height / 2))) })
  })
  check(`${name}: icon centres meet the actual SVG curve`, Math.max(...result) < 1.5, `${Math.max(...result).toFixed(3)}px`)
}
try {
  await page.waitForSelector('.pdl-node', { timeout: 30_000 }); await page.waitForTimeout(1200)
  check('Approved DAG is the initial workspace', await page.getByTestId('design-lab-dag').isVisible() && await page.locator('.pdl-node').count() === 7)
  check('Default ambient is static optical fallback', await page.locator('[data-testid="design-lab"]').getAttribute('data-aurora') === 'fallback' && await page.locator('.pdl-aurora canvas').count() === 0)
  check('No production project is fabricated', (await page.evaluate(() => window.projectos.projects.list())).projects.length === 0)
  await shot('dag-default-1440-light'); await audit('dag-light', '.pdl-workspace')
  const edges = await page.locator('.pdl-edge .react-flow__edge-path').evaluateAll((items) => items.map((el) => ({ dash: getComputedStyle(el).strokeDasharray, animation: getComputedStyle(el).animationName, width: getComputedStyle(el).strokeWidth })))
  check('DAG connections are solid and do not loop', edges.length === 7 && edges.every((e) => e.dash === 'none' && e.animation === 'none'))
  await theme('dark'); await shot('dag-default-1440-dark'); await audit('dag-dark', '.pdl-workspace');
  for (const [width, mode, zoom] of [[1024,'light',1], [1024,'dark',1], [1440,'light',1.25], [1440,'dark',1.25], [1024,'light',1.25], [1024,'dark',1.25]]) { await resize(width, zoom); await theme(mode); await page.waitForTimeout(400); const fits = await page.evaluate(() => { const graph = document.querySelector('.pdl-dag').getBoundingClientRect(); return [...document.querySelectorAll('.pdl-node')].every((node) => { const r = node.getBoundingClientRect(); return r.left >= graph.left - 1 && r.right <= graph.right + 1 && r.top >= graph.top - 1 && r.bottom <= graph.bottom + 1 }) }); check(`DAG ${width}/${mode}/${zoom} fits all seven nodes after resize`, fits); await shot(`dag-default-${width}-${mode}${zoom === 1.25 ? '-125' : ''}`) }
  await resize(1440); await theme('light')
  await page.getByRole('tab', { name: '阶段路线', exact: true }).click(); await page.waitForTimeout(750)
  check('Stage route has icons without permanent captions', (await page.locator('.pdl-journey').innerText()).trim() === '' && await page.locator('.pdl-stop').count() === 4)
  const typography = await page.evaluate(() => Object.fromEntries([['title', '.pdl-plan-title h1'], ['body', '.pdl-task-copy strong'], ['secondary', '.pdl-task-copy span'], ['section', '.pdl-panel-head h2']].map(([key, selector]) => [key, parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)])))
  check('Typography uses the frozen readable roles', typography.title >= 26 && typography.body >= 14 && typography.secondary >= 12 && typography.section >= 16, JSON.stringify(typography))
  await anchors('1440 light'); await shot('stage-1440-light')
  await page.locator('.pdl-stop').first().focus(); await page.locator('.pdl-tooltip').waitFor(); check('Keyboard focus exposes stage identity', (await page.locator('.pdl-tooltip').innerText()).includes('架构阶段')); await shot('stage-keyboard-tooltip')
  await page.locator('.pdl-stop').nth(1).click(); check('Selecting a stage updates the visible task section', await page.locator('.pdl-stop').nth(1).getAttribute('aria-pressed') === 'true')
  await page.locator('.pdl-stop').first().click()
  for (const [width, mode, zoom] of [[1100, 'dark', 1], [1024, 'light', 1], [1440, 'light', 1.25]]) {
    await resize(width, zoom); await theme(mode); await anchors(`${width} ${mode} ${zoom}`); await shot(`stage-${width}-${mode}${zoom === 1.25 ? '-125' : ''}`)
    check(`Stage ${width}/${zoom} has no page overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
  }
  await resize(1440); await theme('light')
  await page.locator('.pdl-task-row').first().click(); await page.getByTestId('design-lab-inspector').waitFor()
  const inspector = page.getByTestId('design-lab-inspector'), title = page.locator('#pdl-inspector-title')
  await title.fill('长标题验证 · 保持已批准的光学玻璃与任务依赖'); await title.pressSequentially(' · 连续输入')
  check('Typing retains focus through local plan updates', await title.evaluate((el) => el === document.activeElement) && (await title.inputValue()).endsWith('连续输入'))
  await page.getByLabel('任务说明', { exact: true }).fill('保留原有可编辑字段、依赖与验收能力。')
  await inspector.getByRole('button', { name: '添加验收标准', exact: true }).click()
  await page.locator('.pdl-criterion input[type="text"]').last().fill('图标与实际路径对齐，文字清晰可读。')
  await page.locator('.pdl-criterion-check').last().check()
  check('Criteria remain individually editable and checkable', await page.locator('.pdl-criterion-check').last().isChecked())
  await page.getByRole('button', { name: '选择 Agent', exact: true }).click(); await page.getByRole('group', { name: '可选 Agent' }).waitFor(); await shot('inspector-agent-menu')
  await page.getByRole('group', { name: '可选 Agent' }).getByRole('button', { name: 'Nova', exact: true }).click()
  await page.getByRole('button', { name: '选择 Agent', exact: true }).click(); await page.getByRole('group', { name: '可选 Agent' }).waitFor(); await page.keyboard.press('Escape'); await page.getByRole('group', { name: '可选 Agent' }).waitFor({ state: 'hidden' })
  check('Escape dismisses the top popover before its inspector', await inspector.isVisible() && !await page.getByRole('group', { name: '可选 Agent' }).isVisible())
  await inspector.getByRole('button', { name: '添加前置依赖', exact: true }).click()
  check('Origin task rejects cyclic dependencies', await page.getByText('没有可添加的前置任务', { exact: true }).isVisible()); await page.keyboard.press('Escape')
  await inspector.getByRole('button', { name: '添加交付物', exact: true }).click(); await page.getByLabel('交付物名称', { exact: true }).fill('实际截图与可访问性记录'); await page.getByRole('button', { name: '添加交付物', exact: true }).last().click()
  const inspectorText = await inspector.innerText()
  check('All incumbent editable sections remain present', ['前置依赖', '验收标准', '预期交付物', '能力要求', '角色与 Agent'].every((text) => inspectorText.includes(text)) && inspectorText.includes('实际截图与可访问性记录'))
  await shot('inspector-1440-light'); await audit('inspector-light', '[data-testid="design-lab-inspector"]')
  await theme('dark'); await shot('inspector-1440-dark'); await audit('inspector-dark', '[data-testid="design-lab-inspector"]')
  await resize(1024); await shot('inspector-1024-dark'); await resize(1440, 1.25); await shot('inspector-1440-dark-125'); await resize(1440)
  await page.keyboard.press('Escape'); await inspector.waitFor({ state: 'hidden' }); check('Inspector closes and restores workspace interaction', await page.locator('.pdl-workspace').isVisible())
  await theme('light'); await page.getByRole('tab', { name: '任务依赖', exact: true }).click(); await page.waitForTimeout(500)
  const focusPath = await page.locator('.pdl-edge.is-active .react-flow__edge-path').evaluateAll((items) => items.some((el) => getComputedStyle(el).stroke.startsWith('url(') && getComputedStyle(el).strokeDasharray === 'none'))
  check('Selected path uses a solid restrained gradient', focusPath); await shot('dag-focused-path')
  check('Local prototype edits did not create persisted projects', (await page.evaluate(() => window.projectos.projects.list())).projects.length === 0)
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('tab', { name: '阶段路线', exact: true }).click(); await page.waitForTimeout(100)
  check('Reduced motion is interruptible', await page.locator('.pdl-journey-track').evaluate((el) => getComputedStyle(el).animationName === 'none')); await shot('reduced-motion')
  check('No Renderer exceptions', errors.length === 0, errors.join(' | '))
  check('Lab and inspector accessibility audits pass', audits.every((item) => item.violations.length === 0), audits.map((item) => `${item.state}: ${item.violations.length}`).join('; '))
} catch (error) {
  checks.push({ name: 'Journey completion', status: 'FAIL', detail: error instanceof Error ? error.message : String(error) }); console.error(error); process.exitCode = 1; await shot('failure').catch(() => {})
} finally {
  await app.close().catch(() => {})
  const summary = { pass: checks.filter((c) => c.status === 'PASS').length, fail: checks.filter((c) => c.status === 'FAIL').length }
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ summary, checks, audits, errors, note: 'native Electron captures; local prototype state; final user visual acceptance remains separate' }, null, 2))
  console.log('PREMIUM LAB SUMMARY', JSON.stringify(summary))
}
