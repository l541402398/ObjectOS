/** Native source-reuse regression. Real persisted demo/API; no UI fixture or product delay. */
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { compositeContrast } from './lib/premium-contrast.mjs'

const quick = process.argv.includes('--quick')
const out = resolve('docs/design/product-workbench', quick ? 'probe' : 'after')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-workbench-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60000 })
const page = await app.firstWindow(), win = await app.browserWindow(page)
page.setDefaultTimeout(20000)
const checks = [], results = [], errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('console', msg => { if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(msg.text())) errors.push(msg.text()) })
const check = (name, pass, detail = '') => { checks.push({ name, status: pass ? 'PASS' : 'FAIL', detail }); console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name} ${detail}`) }
const shot = async name => {
  await page.mouse.move(3, 3); await page.waitForTimeout(180)
  writeFileSync(join(out, `${name}.png`), Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
}
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const audit = async (name, scope) => {
  await page.evaluate(axeSource)
  const axe = await page.evaluate(async scope => {
    const report = await window.axe.run(document.querySelector(scope), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } })
    return { violations: report.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: report.incomplete.map(({ id }) => id) }
  }, scope)
  check(`${name} accessibility`, axe.violations.length === 0, JSON.stringify(axe.violations))
  const contrast = await compositeContrast(page, win, scope)
  check(`${name} native contrast`, contrast.count > 0 && contrast.failures.length === 0, `min=${contrast.minimum.toFixed(2)}, samples=${contrast.count}`)
  const geometry = await page.evaluate(scope => {
    const root = document.querySelector(scope), rect = root.getBoundingClientRect()
    return { viewport: [innerWidth, innerHeight], width: rect.width, overflow: document.documentElement.scrollWidth > innerWidth + 1 || root.scrollWidth > root.clientWidth + 1,
      small: [...root.querySelectorAll('*')].filter(el => !el.children.length && el.textContent.trim() && el.getBoundingClientRect().width && getComputedStyle(el).visibility !== 'hidden' && !el.closest('svg,.react-flow__renderer') && parseFloat(getComputedStyle(el).fontSize) < 12).map(el => ({ text: el.textContent, size: getComputedStyle(el).fontSize })) }
  }, scope)
  check(`${name} fits and readable type`, !geometry.overflow && geometry.small.length === 0, JSON.stringify(geometry))
  results.push({ name, axe, contrast, geometry })
}
const size = async (width, mode, zoom) => {
  await win.evaluate((w, v) => { w.setSize(v.width, 900); w.webContents.setZoomFactor(v.zoom) }, { width, zoom })
  await page.emulateMedia({ colorScheme: mode })
  await page.waitForFunction(mode => document.documentElement.dataset.theme === mode, mode)
}
const waitSelected = label => page.waitForFunction(label => [...document.querySelectorAll('[role="tab"]')].some(el => el.textContent.includes(label) && el.getAttribute('aria-selected') === 'true'), label)
try {
  await page.locator('.po-shell').waitFor({ timeout: 60000 })
  const projectId = (await page.evaluate(() => window.projectos.projects.list())).projects[0].id
  const route = async (suffix, selector) => {
    await page.evaluate(({ id, suffix }) => { location.hash = `#/projects/${id}${suffix}` }, { id: projectId, suffix })
    await page.locator(selector).first().waitFor(); await page.waitForTimeout(220)
  }
  const matrix = quick ? [[1440, 'light', 1], [1024, 'dark', 1.25]] : [1440, 1024].flatMap(w => ['light', 'dark'].flatMap(m => [1, 1.25].map(z => [w, m, z])))
  for (const [width, mode, zoom] of matrix) {
    const label = `${width}-${mode}${zoom > 1 ? '-125' : ''}`
    await size(width, mode, zoom)
    await route('', '.studio-workbench')
    await page.getByTestId('next-step-panel').getByRole('button').first().waitFor()
    await shot(`home-${label}`); await audit(`home-${label}`, '.studio-workbench')
    check(`${label} explicit journey`, await page.locator('.po-journey-step-label').count() === 9 && !!await page.locator('.po-journey-current').textContent())
    const homeTab = page.getByRole('tab', { name: /进行中/ })
    await homeTab.focus(); await page.keyboard.press('ArrowRight')
    await waitSelected('待审批')
    await page.locator('.studio-approval-row').first().waitFor()
    check(`${label} keyboard opens approvals`, await page.getByRole('tab', { name: /待审批/ }).getAttribute('aria-selected') === 'true' && await page.locator('.studio-approval-row').count() > 0)
    if (width === 1440 && zoom === 1 || width === 1024 && zoom > 1) { await shot(`home-approvals-${label}`); await audit(`home-approvals-${label}`, '.studio-records') }
    await page.keyboard.press('End')
    await waitSelected('最近运行')
    check(`${label} keyboard reaches recent runs`, await page.getByRole('tab', { name: '最近运行' }).getAttribute('aria-selected') === 'true' && await page.locator('.studio-run').count() > 0)
    if (width === 1440 && zoom === 1 || width === 1024 && zoom > 1) await shot(`home-runs-${label}`)
    await page.keyboard.press('Home')
    await waitSelected('进行中')
    check(`${label} Home key returns to first tab`, await homeTab.getAttribute('aria-selected') === 'true')
    await route('/agents', '.aco-canvas')
    await page.getByRole('button', { name: '适应画布', exact: true }).click(); await page.waitForTimeout(350)
    await page.locator('.aco-workbench-title').click()
    await shot(`agents-${label}`); await audit(`agents-${label}`, '.aco-workbench')
    const canvas = await page.evaluate(() => {
      const rect = document.querySelector('.aco-canvas-viewport').getBoundingClientRect()
      const nodes = [...document.querySelectorAll('.react-flow__node')].map(n => n.getBoundingClientRect())
      return { height: rect.height, nodes: nodes.length, fits: nodes.length > 0 && nodes.every(n => n.left >= rect.left - 1 && n.right <= rect.right + 1 && n.top >= rect.top - 1 && n.bottom <= rect.bottom + 1) }
    })
    check(`${label} fit reveals whole graph`, canvas.height >= 240 && canvas.fits, JSON.stringify(canvas))
    await page.getByRole('tab', { name: /^全部/ }).focus(); await page.keyboard.press('ArrowRight')
    await page.waitForTimeout(250)
    check(`${label} agent tab filters actual nodes`, await page.locator('.aco-gnode-task').count() === 0 && await page.locator('.aco-gnode-agent').count() > 0)
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250)
    check(`${label} task tab filters actual nodes`, await page.locator('.aco-gnode-agent').count() === 0 && await page.locator('.aco-gnode-task').count() > 0)
    await page.keyboard.press('Home'); await page.waitForTimeout(250)
    check(`${label} all objects restore`, await page.locator('.aco-gnode-agent').count() > 0 && await page.locator('.aco-gnode-task').count() > 0)
    for (const [suffix, selector, name] of [['/tasks', '.po-task-tile', 'tasks'], ['/deployments', '.dc-head', 'deployments']]) {
      await route(suffix, selector); await shot(`${name}-${label}`); await audit(`${name}-${label}`, '.po-main')
    }
  }
  await size(1440, 'light', 1)
  await route('', '.studio-workbench')
  const action = (await page.evaluate(id => window.projectos.actions.center(id), projectId)).items.find(i => !i.stale)
  check('Next step matches persisted action', !!action && (await page.getByTestId('next-step-panel').innerText()).includes(action.title))
  for (const [mode, label] of [['autonomous', '自主模式'], ['managed', '托管模式'], ['assist', '辅助模式']]) {
    await page.getByLabel('项目工作模式').click()
    await page.locator('.ant-select-item-option-content').getByText(label, { exact: true }).click()
    await page.waitForFunction(async ({ projectId, mode }) => (await window.projectos.actions.autonomy(projectId)).mode === mode, { projectId, mode })
    check(`${label} persists via existing API`, true)
  }
  await page.reload(); await page.locator('.studio-workbench').waitFor()
  check('Mode persists across reload', (await page.locator('.po-project-mode').innerText()).includes('辅助模式'))
  await page.getByRole('button', { name: '提出需求', exact: true }).click()
  await page.getByRole('dialog', { name: /需求/ }).waitFor()
  check('Propose requirement retains direct form entry', true)
  await page.keyboard.press('Escape')
  await route('', '.studio-workbench')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.evaluate(() => {
    window.__frames = []; window.__stop = false
    const frame = () => { window.__frames.push({ home: !!document.querySelector('.studio-workbench'), tasks: document.querySelectorAll('.po-task-tile').length, fonts: document.fonts.status }); if (!window.__stop) requestAnimationFrame(frame) }; frame()
  })
  await page.getByRole('button', { name: '任务看板', exact: true }).click()
  await page.locator('.po-task-tile').first().waitFor(); await page.waitForTimeout(220)
  const frames = await page.evaluate(() => { window.__stop = true; return window.__frames })
  results.push({ name: 'navigation-4x-CPU', frames })
  check('Navigation keeps populated page at 4x CPU', frames.length > 0 && frames.every(f => f.home || f.tasks > 0), `${frames.length} frames`)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await route('/agents', '.aco-canvas')
  const percent = async () => Number((await page.locator('.pui-canvas-zoom').innerText()).replace('%', ''))
  await page.locator('.pui-canvas-zoom').click(); await page.waitForTimeout(250)
  check('Toolbar resets to 100%', await percent() === 100)
  await page.getByRole('button', { name: '缩小画布' }).click(); await page.waitForTimeout(250)
  check('Toolbar zooms out', await percent() < 100)
  await page.getByRole('button', { name: '放大画布' }).click(); await page.waitForTimeout(250)
  check('Toolbar zooms in', await percent() >= 99)
  await page.getByRole('button', { name: '适应画布', exact: true }).click(); await page.waitForTimeout(350)
  await page.locator('.aco-gnode-task').first().click()
  await page.getByTestId('collaboration-inspector').waitFor(); await page.locator('.aco-flow-pulse').first().waitFor()
  check('Graph detail and directional pulses remain', await page.locator('.aco-flow-pulse').count() <= 12)
  await shot('task-inspector-1440-light'); await audit('task-inspector', '[data-testid="collaboration-inspector"]')
  await page.keyboard.press('Escape')
  await page.locator('.aco-gnode-task').first().click()
  await page.locator('[aria-label="暂停流向脉冲"]').evaluate(el => el.click())
  check('Pulse pause works', await page.locator('.aco-flow-pulse').count() === 0)
  await page.locator('[aria-label="开启流向脉冲"]').evaluate(el => el.click())
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(100)
  check('Live reduced-motion removes pulses', await page.locator('.aco-flow-pulse').count() === 0)
  await page.keyboard.press('Escape')
  await page.locator('.pui-canvas-zoom').click()
  check('Reduced-motion zoom is immediate', await percent() === 100)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('button', { name: '设置', exact: true }).first().click()
  await page.getByRole('button', { name: '关于', exact: true }).last().click()
  await page.getByText('界面组件许可 · Sim Studio / shadcn/ui', { exact: true }).click()
  check('Upstream licenses and NOTICE ship with app', (await page.locator('.po-settings-panel').innerText()).includes('Copyright 2026 Sim Studio') && (await page.locator('.po-settings-panel').innerText()).includes('Copyright (c) 2023 shadcn'))
  await shot('upstream-licenses-1440-light')
  check('No renderer or CSP exceptions', errors.length === 0, errors.join(' | '))
} catch (error) { check('Workbench regression', false, String(error)); await shot('failure').catch(() => {}) }
finally {
  await app.close().catch(() => {})
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixture: 'Isolated persisted demo; real API, native Electron capture, native zoom; 4x renderer CPU for navigation. No provider credentials.', checks, results, errors }, null, 2))
  if (checks.some(c => c.status === 'FAIL')) process.exitCode = 1
}
