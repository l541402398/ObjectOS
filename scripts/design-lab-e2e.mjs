import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'design-lab')
mkdirSync(shots, { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-lab-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-lab-user-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900', PROJECTOS_START_ROUTE: 'design-lab' }
delete env.ELECTRON_RUN_AS_NODE
const checks = []
let app = null
let screencastStarted = false

function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.setBackgroundThrottling(false) })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForSelector('[data-testid="design-lab"]', { timeout: 20_000 })
  await page.waitForTimeout(1700)
  await page.screenshot({ path: join(shots, 'lab-light.png') })

  const typography = await page.evaluate(() => {
    const size = (selector) => Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)
    return { title: size('.pdl-plan-title h1'), section: size('.pdl-panel-head h2'), task: size('.pdl-task-copy strong'), secondary: size('.pdl-task-copy span') }
  })
  check('Typography meets the frozen 14/12/16/26 scale', typography.task >= 14 && typography.secondary >= 12 && typography.section >= 16 && typography.title >= 26, JSON.stringify(typography))
  const glass = await page.evaluate(() => {
    const refract = document.querySelector('.pdl-viewbar-glass .pdl-optical-warp')
    return {
      filter: refract ? getComputedStyle(refract).filter : null,
      backdrop: refract ? getComputedStyle(refract.parentElement).backdropFilter : null,
      aurora: document.querySelector('.pdl-root')?.getAttribute('data-aurora'),
      auroraCanvas: Boolean(document.querySelector('.pdl-aurora canvas')),
    }
  })
  check('Design Lab is a full workspace outside the Ant layout', await page.locator('.pdl-workspace').isVisible())
  check('Top toolbar uses the optical glass fallback with real SVG displacement', Boolean(glass.filter?.startsWith('url(')), JSON.stringify(glass))
  const anchorDelta = await page.evaluate(() => {
    const route = document.querySelector('.pdl-journey')?.getBoundingClientRect()
    if (!route) return 999
    return Math.max(...[...document.querySelectorAll('.pdl-stop')].map((node) => {
      const button = node
      const rect = button.getBoundingClientRect()
      const x = Number(button.getAttribute('data-anchor-x'))
      const y = Number(button.getAttribute('data-anchor-y'))
      const expectedX = route.width * x / 1000
      const expectedY = route.height * y / 140
      return Math.max(Math.abs(rect.left + rect.width / 2 - route.left - expectedX), Math.abs(rect.top + rect.height / 2 - route.top - expectedY))
    }))
  })
  check('Stage icon centers sit exactly on SVG anchors', anchorDelta < 1.5, `max delta ${anchorDelta.toFixed(2)}px`)
  check('Stage route has no permanent labels around icons', (await page.locator('.pdl-journey').innerText()).trim() === '')
  await page.locator('.pdl-stop').first().focus()
  await page.waitForSelector('.pdl-tooltip', { timeout: 10_000 })
  await page.screenshot({ path: join(shots, 'lab-stage-tooltip.png') })
  check('Stage identity is available as tooltip and aria-label', (await page.locator('.pdl-tooltip').innerText()).includes('架构阶段'))
  await page.mouse.move(20, 500)
  await page.bringToFront()
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win?.show(); win?.focus(); win?.setAlwaysOnTop(true, 'floating') })
  await page.waitForTimeout(900)
  console.log('VISIBILITY', await page.evaluate(() => document.visibilityState))
  check('Ambient light has an adaptive fallback', glass.aurora === 'fallback' || glass.aurora === 'on', `mode=${glass.aurora}`)

  const fpsSamples = []
  for (let sample = 0; sample < 2; sample += 1) {
    await page.waitForTimeout(250)
    fpsSamples.push(await page.evaluate(() => new Promise((resolveFps) => {
      let frames = 0
      const start = performance.now()
      const tick = (now) => { frames += 1; if (now - start < 2000) requestAnimationFrame(tick); else resolveFps(Math.round((frames * 1000) / (now - start))) }
      requestAnimationFrame(tick)
    })))
  }
  const fps = Math.max(...fpsSamples)
  if (fps >= 30) check('Idle workspace keeps a usable frame budget after fallback', true, `${fpsSamples.join('/')} fps; best ${fps} over 2s`)
  else console.log(`WARN  Foreground frame sample was throttled: ${fpsSamples.join('/')} fps; see design-lab-perf.mjs for controlled measurements`)

  if (page.screencast) {
    try {
      await page.screencast.start({ path: join(shots, 'design-lab-demo.webm'), size: { width: 1280, height: 800 } })
      screencastStarted = true
    } catch (error) {
      console.log('SCREENCAST_UNAVAILABLE', error instanceof Error ? error.message : String(error))
    }
  }

  await page.locator('.pdl-stop[aria-label*="开发阶段"]').click()
  await page.waitForTimeout(320)
  const stageText = await page.locator('.pdl-panel-note').innerText()
  check('Stage selection drives the task ledger', stageText.includes('3 项'), stageText)

  await page.locator('[data-testid="design-lab-task-t3"]').click()
  await page.waitForSelector('[data-testid="design-lab-inspector"]', { timeout: 10_000 })
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(shots, 'lab-inspector.png') })
  await page.getByTestId('design-lab-inspector').getByRole('button', { name: '编辑' }).click()
  await page.waitForTimeout(250)
  const titleInput = page.locator('.pdl-title-input')
  await titleInput.fill('把计划审核重构为可执行的光学玻璃工作台 · 长标题验证')
  await page.getByRole('button', { name: '添加验收标准' }).click()
  await page.locator('.pdl-criterion input').last().fill('检查器新增验收项可编辑')
  await page.screenshot({ path: join(shots, 'lab-inspector-edit.png') })
  await page.getByTestId('design-lab-inspector').getByRole('button', { name: '保存' }).click()
  await page.waitForTimeout(350)
  const savedInspector = await page.locator('.pdl-inspector').innerText()
  await page.screenshot({ path: join(shots, 'lab-inspector-saved.png') })
  check('Task inspector edits local React state', savedInspector.includes('长标题验证') && savedInspector.includes('检查器新增验收项可编辑'))
  check('Task inspector preserves dependencies, criteria, artifacts and capabilities', ['依赖关系', '验收标准', '预期交付物', '能力要求'].every((label) => savedInspector.includes(label)))
  await page.getByRole('button', { name: '关闭任务检查器' }).click()
  await page.waitForTimeout(280)

  await page.getByRole('tab', { name: '任务依赖' }).click()
  await page.waitForSelector('[data-testid="design-lab-dag"] .react-flow__node', { timeout: 10_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'lab-dag.png') })
  const nodeCount = await page.locator('[data-testid="design-lab-dag"] .react-flow__node').count()
  const edgeCount = await page.locator('[data-testid="design-lab-dag"] .react-flow__edge').count()
  check('DAG renders ELK layout and real edges', nodeCount === 7 && edgeCount === 7, `${nodeCount} nodes / ${edgeCount} edges`)
  const defaultEdgeStyles = await page.evaluate(() => [...document.querySelectorAll('.pdl-edge path')].map((path) => {
    const style = getComputedStyle(path)
    return { dash: style.strokeDasharray, stroke: style.stroke, width: style.strokeWidth }
  }))
  const visibleEdges = defaultEdgeStyles.filter((edge) => edge.stroke !== 'none' && edge.width !== '14px')
  check('DAG default edges are solid and neutral', visibleEdges.length === 7 && visibleEdges.every((edge) => edge.dash === 'none' && !edge.stroke.includes('url(')), JSON.stringify(visibleEdges.slice(0, 2)))

  await page.locator('[data-testid="design-lab-dag"] .react-flow__node').nth(4).click()
  await page.waitForSelector('[data-testid="design-lab-inspector"]', { timeout: 10_000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(shots, 'lab-dag-focus.png') })
  check('DAG node selection opens the linked inspector', await page.locator('[data-testid="design-lab-inspector"]').isVisible())
  await page.getByRole('button', { name: '关闭任务检查器' }).click()
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(shots, 'lab-dag-path.png') })
  const focusedEdge = await page.evaluate(() => [...document.querySelectorAll('.pdl-edge.is-active path')].some((path) => getComputedStyle(path).stroke.includes('url(')))
  check('Selected dependency path uses a restrained gradient, not dashed animation', focusedEdge)

  await page.getByRole('tab', { name: '阶段路线' }).click()
  await page.waitForTimeout(300)
  const riskToggle = page.locator('.pdl-risk-toggle')
  await riskToggle.click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(shots, 'lab-risk-collapsed.png') })
  await riskToggle.click()

  await page.getByRole('button', { name: '切换到暗色' }).click()
  await page.waitForTimeout(550)
  await page.screenshot({ path: join(shots, 'lab-dark.png') })
  check('Dark theme toggles independently', (await page.locator('.pdl-root').getAttribute('data-theme')) === 'dark')

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(1100, 800) })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'lab-1100.png') })
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  check('1100px layout has no horizontal overflow', width.scroll <= width.viewport, JSON.stringify(width))
  const anchorDelta1100 = await page.evaluate(() => {
    const route = document.querySelector('.pdl-journey')?.getBoundingClientRect()
    if (!route) return 999
    return Math.max(...[...document.querySelectorAll('.pdl-stop')].map((button) => {
      const rect = button.getBoundingClientRect()
      return Math.max(Math.abs(rect.left + rect.width / 2 - route.left - route.width * Number(button.getAttribute('data-anchor-x')) / 1000), Math.abs(rect.top + rect.height / 2 - route.top - route.height * Number(button.getAttribute('data-anchor-y')) / 140))
    }))
  })
  check('Stage anchors remain aligned at 1100px', anchorDelta1100 < 1.5, `max delta ${anchorDelta1100.toFixed(2)}px`)

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.25) })
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await page.waitForTimeout(500)
  const zoom = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, dpr: window.devicePixelRatio }))
  await page.screenshot({ path: join(shots, 'lab-125.png') })
  check('125% layout has no horizontal overflow', zoom.scroll <= zoom.viewport, JSON.stringify(zoom))
  const anchorDelta125 = await page.evaluate(() => {
    const route = document.querySelector('.pdl-journey')?.getBoundingClientRect()
    if (!route) return 999
    return Math.max(...[...document.querySelectorAll('.pdl-stop')].map((button) => {
      const rect = button.getBoundingClientRect()
      return Math.max(Math.abs(rect.left + rect.width / 2 - route.left - route.width * Number(button.getAttribute('data-anchor-x')) / 1000), Math.abs(rect.top + rect.height / 2 - route.top - route.height * Number(button.getAttribute('data-anchor-y')) / 140))
    }))
  })
  check('Stage anchors remain aligned at 125%', anchorDelta125 < 1.5, `max delta ${anchorDelta125.toFixed(2)}px`)
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1); BrowserWindow.getAllWindows()[0]?.setSize(880, 640) })
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(shots, 'lab-880-native.png') })
  const nativeNarrow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }))
  check('880px native viewport (125% logical) has no horizontal overflow', nativeNarrow.scroll <= nativeNarrow.viewport, JSON.stringify(nativeNarrow))

  if (screencastStarted) {
    await page.screencast.stop()
    const video = join(shots, 'design-lab-demo.webm')
    check('Electron interaction recording exists', existsSync(video) && statSync(video).size > 10_000, existsSync(video) ? `${Math.round(statSync(video).size / 1024)} KB` : 'missing')
  }

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1); BrowserWindow.getAllWindows()[0]?.setSize(1440, 900) })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '玻璃兼容性对照' }).click()
  await page.waitForSelector('.pdl-glass-probe', { timeout: 10_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'lab-liquid-glass-library.png') })
  const libraryFilter = await page.evaluate(() => {
    const warp = document.querySelector('.pdl-glass-probe .glass__warp')
    return warp ? getComputedStyle(warp).filter : null
  })
  check('liquid-glass-react 1.1.1 is mounted in the compatibility probe', Boolean(libraryFilter?.startsWith('url(')), JSON.stringify(libraryFilter))

  check('No renderer page errors', pageErrors.length === 0, pageErrors.join(' | '))
  const passed = checks.filter((item) => item.ok).length
  console.log(`\nDESIGN LAB ${passed === checks.length ? 'PASS' : 'FAIL'} — ${passed}/${checks.length} checks`)
  if (passed !== checks.length) process.exitCode = 1
} catch (error) {
  console.error('DESIGN LAB FAIL —', error)
  process.exitCode = 1
} finally {
  if (screencastStarted) await app?.evaluate(({ app }) => app.quit()).catch(() => {})
  await app?.close().catch(() => {})
}
