/** Native startup + global journey regression. Only isolated, persisted demo data is used. */
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { compositeContrast } from './lib/premium-contrast.mjs'

const quick = process.argv.includes('--quick')
const out = resolve('docs/design/startup-journey', quick ? 'probe' : 'after')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-startup-journey-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60000 })
const page = await app.firstWindow(), win = await app.browserWindow(page)
const cdp = await page.context().newCDPSession(page)
await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
const checks = [], results = [], errors = []
page.setDefaultTimeout(20000)
page.on('pageerror', error => errors.push(error.message))
page.on('console', msg => { if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(msg.text())) errors.push(msg.text()) })
const check = (name, pass, detail = '') => { checks.push({ name, status: pass ? 'PASS' : 'FAIL', detail }); console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ' ' + detail : ''}`) }
const shot = async name => {
  await page.mouse.move(3, 3)
  await page.waitForTimeout(150)
  writeFileSync(join(out, `${name}.png`), Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
}
const axeSource = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8')
const audit = async (name, scope) => {
  await page.evaluate(axeSource)
  const report = await page.evaluate(async scope => {
    const r = await window.axe.run(document.querySelector(scope), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } })
    return { violations: r.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: r.incomplete.map(({ id }) => id) }
  }, scope)
  results.push({ name, axe: report })
  check(`${name} accessibility`, report.violations.length === 0, JSON.stringify(report.violations))
  const contrast = await compositeContrast(page, win, scope)
  results.push({ name, contrast })
  check(`${name} native text contrast`, contrast.count > 0 && contrast.failures.length === 0, `min=${contrast.minimum.toFixed(2)}, samples=${contrast.count}`)
}
const setSize = async (width, zoom) => {
  await win.evaluate((w, { width, zoom }) => { w.setSize(width, 900); w.webContents.setZoomFactor(zoom) }, { width, zoom })
}
const platformFont = async (name, selector) => {
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  results.push({ name, fonts })
  check(`${name} actual local Chinese font`, fonts.some(f => f.isCustomFont && /Noto Sans SC/.test(f.familyName) && f.glyphCount > 0))
}
try {
  await page.waitForSelector('.po-shell', { timeout: 60000 })
  const projectId = (await page.evaluate(() => window.projectos.projects.list())).projects[0].id
  await page.evaluate(id => { location.hash = `#/projects/${id}/agents` }, projectId)
  await page.locator('.aco-canvas').waitFor()
  // Hold only the renderer's font-ready promise. Real fonts, CSS, IPC and business data still load.
  // This makes the short-lived boot screen inspectable without a delay/fixture flag in the product.
  await page.context().addInitScript(() => {
    const original = document.fonts.load.bind(document.fonts)
    const gate = new Promise(resolve => { window.__releaseBoot = resolve })
    document.fonts.load = async (...args) => { const fonts = await original(...args); await gate; return fonts }
    window.__bootFrames = []
    let started = false
    const frame = () => {
      const boot = document.querySelector('.po-boot'), shell = document.querySelector('.po-shell')
      started ||= !!boot || !!shell
      if (started) window.__bootFrames.push({ time: performance.now(), boot: !!boot, complete: !!boot?.querySelector('.po-boot-artwork svg') && !!boot?.querySelector('.po-boot-status'), shell: !!shell, theme: document.documentElement.dataset.theme, typeface: document.documentElement.dataset.typeface, font: document.fonts.status, faces: shell ? [...document.fonts].map(f => ({ family: f.family, status: f.status })) : undefined })
      if (!shell) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  const matrix = quick ? [[1440, 'light', 1], [1024, 'dark', 1.25]] : [1440, 1024].flatMap(width => ['light', 'dark'].flatMap(mode => [1, 1.25].map(zoom => [width, mode, zoom])))
  for (const [width, mode, zoom] of matrix) {
    const name = `${width}-${mode}${zoom > 1 ? '-125' : ''}`
    await setSize(width, zoom)
    // Deliberately conflict with OS preference, proving saved theme is used before React mounts.
    await page.emulateMedia({ colorScheme: mode === 'light' ? 'dark' : 'light', reducedMotion: 'no-preference' })
    await page.evaluate(mode => {
      const saved = JSON.parse(localStorage.getItem('projectos.ui') || '{}')
      localStorage.setItem('projectos.ui', JSON.stringify({ ...saved, state: { ...saved.state, themeMode: mode, reduceMotion: false } }))
    }, mode)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.po-boot-artwork').waitFor()
    await page.waitForFunction(() => document.fonts.status === 'loaded')
    const first = await page.locator('.po-boot-orbit').first().evaluate(el => getComputedStyle(el).transform)
    await page.waitForTimeout(220)
    const second = await page.locator('.po-boot-orbit').first().evaluate(el => getComputedStyle(el).transform)
    check(`${name} full startup animates`, first !== second)
    check(`${name} saved theme before React`, await page.evaluate(mode => document.documentElement.dataset.theme === mode && !document.querySelector('.po-shell'), mode))
    await shot(`startup-${name}`)
    await platformFont(`startup-${name}`, '.po-boot-status')
    if (!quick && width === 1440 && mode === 'light' && zoom === 1) {
      const fps = await page.evaluate(() => new Promise(resolve => {
        let start, count = 0
        const tick = time => { start ??= time; count++; if (time - start >= 2000) resolve((count - 1) * 1000 / (time - start)); else requestAnimationFrame(tick) }
        requestAnimationFrame(tick)
      }))
      check('Startup animation frame rate', fps >= 45, `${fps.toFixed(1)} fps`)
    }
    await audit(`startup-${name}`, '.po-boot')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    check(`${name} live reduced motion`, await page.locator('.po-boot-orbit').first().evaluate(el => getComputedStyle(el).animationName === 'none'))
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.evaluate(() => window.__releaseBoot())
    await page.locator('.aco-canvas').waitFor()
    await page.locator('.po-journey-step-label').first().waitFor()
    const trace = await page.evaluate(() => window.__bootFrames)
    results.push({ name, trace })
    check(`${name} complete boot until complete product`, trace.some(f => f.boot) && trace.some(f => f.shell) && trace.every(f => f.boot || f.shell) && trace.filter(f => f.boot).every(f => f.complete) && trace.filter(f => f.shell).every(f => f.typeface === 'ready' && f.faces.some(face => face.family === 'ProjectOS Sans') && f.faces.filter(face => face.family === 'ProjectOS Sans').every(face => face.status === 'loaded')))
    check(`${name} no theme flash`, trace.every(f => f.theme === mode))
    const layout = await page.evaluate(() => {
      const labels = [...document.querySelectorAll('.po-journey-step-label')]
      return {
        viewport: [innerWidth, innerHeight], names: labels.map(el => el.textContent),
        visible: labels.every(el => { const r = el.getBoundingClientRect(), b = el.parentElement.getBoundingClientRect(); return r.width > 0 && r.left >= b.left && r.right <= b.right + 1 && r.right < innerWidth && getComputedStyle(el).display !== 'none' }),
        current: document.querySelector('.po-journey-current')?.textContent,
        currentStep: document.querySelector('.po-journey-step-button[aria-current="step"]')?.textContent,
        summary: document.querySelector('.po-journey-location')?.textContent,
        overflow: document.documentElement.scrollWidth > innerWidth + 1 || document.querySelector('.po-main').scrollWidth > document.querySelector('.po-main').clientWidth + 1,
        graphHeight: document.querySelector('.aco-canvas').getBoundingClientRect().height,
      }
    })
    results.push({ name, layout })
    check(`${name} all nine stage names visible`, layout.names.length === 9 && layout.visible, JSON.stringify(layout.names))
    check(`${name} current stage identified without expansion`, !!layout.current && layout.currentStep?.includes(layout.current) && layout.summary.includes('当前阶段'))
    check(`${name} workspace fits`, !layout.overflow && layout.graphHeight >= 240, JSON.stringify({ graphHeight: layout.graphHeight, viewport: layout.viewport }))
    // A saved user viewport is deliberately preserved across reload. Fit the graph for this review size.
    await page.locator('.react-flow__controls-fitview').click()
    await page.waitForTimeout(350)
    await shot(`journey-${name}`)
    await platformFont(`journey-${name}`, '.po-journey-current')
    await audit(`journey-${name}`, '.po-journey')
    await page.getByTestId('journey-toggle').focus()
    await page.keyboard.press('Enter')
    await page.getByTestId('journey-panel').waitFor()
    const unobscured = await page.evaluate(() => {
      const panel = document.querySelector('.po-journey-panel'), rect = panel.getBoundingClientRect()
      const dock = document.querySelector('.aco-standby-toggle')?.getBoundingClientRect()
      if (!dock) return true
      const x = (dock.left + dock.right) / 2, y = (dock.top + dock.bottom) / 2
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return true
      return panel.contains(document.elementFromPoint(x, y))
    })
    check(`${name} journey details stay above canvas controls`, unobscured)
    check(`${name} explicit completed count in details`, /已完成\s+\d+\s*\/\s*9\s+阶段/.test(await page.locator('.po-journey-progress').innerText()))
    await shot(`details-${name}`)
    await audit(`details-${name}`, '.po-journey-panel')
    await page.keyboard.press('Escape')
    check(`${name} keyboard closes details and restores focus`, await page.getByTestId('journey-panel').count() === 0 && await page.getByTestId('journey-toggle').evaluate(el => el === document.activeElement))
  }
  const projection = await page.evaluate(id => window.projectos.work.journey(id), projectId)
  const current = [...projection.stages].reverse().find(s => s.state === 'blocked') ?? [...projection.stages].reverse().find(s => s.state === 'active') ?? projection.stages.at(-1)
  check('Current stage uses persisted journey projection', (await page.locator('.po-journey-current').innerText()) === current.label)
  for (const stage of projection.stages.filter(s => s.entry?.route)) {
    await page.locator('.po-journey-step-button').filter({ has: page.getByText(stage.label, { exact: true }) }).click()
    await page.waitForURL(url => url.hash === `#${stage.entry.route}`)
    check(`Stage entry ${stage.label} navigates`, page.url().endsWith(`#${stage.entry.route}`))
  }
  if (projection.nextAction.route) {
    await page.getByTestId('journey-next').click()
    await page.waitForURL(url => url.hash === `#${projection.nextAction.route}`)
    check('Next action retains its real destination', true)
  }
  // Persisted reduced motion is applied before useUiEffects, independently of the OS preference.
  await page.evaluate(() => { const saved = JSON.parse(localStorage.getItem('projectos.ui')); saved.state.reduceMotion = true; localStorage.setItem('projectos.ui', JSON.stringify(saved)) })
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('.po-boot-orbit').first().waitFor()
  check('Saved reduced motion applies before React', await page.locator('.po-boot-orbit').first().evaluate(el => getComputedStyle(el).animationName === 'none'))
  await shot('startup-reduced-motion')
  await page.evaluate(() => window.__releaseBoot()); await page.locator('.po-shell').waitFor()
  check('No Renderer or CSP errors', errors.length === 0, errors.join(' | '))
} catch (error) { check('Startup/journey regression', false, String(error)); await shot('failure').catch(() => {}) }
finally {
  await app.close().catch(() => {})
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixture: 'Isolated persisted demo. Font-ready promise held by test-only init script for startup capture; no product delays, fake data or bootstrap mutations. Native window/zoom and capturePage.', checks, results, errors }, null, 2))
  if (checks.some(c => c.status === 'FAIL')) process.exitCode = 1
}
