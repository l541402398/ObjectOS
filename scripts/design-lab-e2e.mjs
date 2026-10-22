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
  check('Idle workspace keeps a usable frame budget after fallback', fps >= 30, `${fpsSamples.join('/')} fps; best ${fps} over 2s`)

  if (page.screencast) {
    try {
      await page.screencast.start({ path: join(shots, 'design-lab-demo.webm'), size: { width: 1280, height: 800 } })
      screencastStarted = true
    } catch (error) {
      console.log('SCREENCAST_UNAVAILABLE', error instanceof Error ? error.message : String(error))
    }
  }

  await page.locator('.pdl-stop').filter({ hasText: '开发阶段' }).click()
  await page.waitForTimeout(320)
  const stageText = await page.locator('.pdl-panel-note').innerText()
  check('Stage selection drives the task ledger', stageText.includes('3 项'), stageText)

  await page.locator('[data-testid="design-lab-task-t3"]').click()
  await page.waitForSelector('[data-testid="design-lab-inspector"]', { timeout: 10_000 })
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(shots, 'lab-inspector.png') })
  const titleInput = page.locator('.pdl-title-input')
  await titleInput.fill('把计划审核重构为可执行的光学玻璃工作台 · 长标题验证')
  await page.getByRole('button', { name: '添加验收标准' }).click()
  await page.locator('.pdl-criterion input').last().fill('检查器新增验收项可编辑')
  await page.screenshot({ path: join(shots, 'lab-inspector-edit.png') })
  check('Task inspector edits local React state', (await titleInput.inputValue()).includes('长标题验证'))
  await page.getByRole('button', { name: '关闭任务检查器' }).click()
  await page.waitForTimeout(280)

  await page.getByRole('tab', { name: '任务依赖' }).click()
  await page.waitForSelector('[data-testid="design-lab-dag"] .react-flow__node', { timeout: 10_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'lab-dag.png') })
  const nodeCount = await page.locator('[data-testid="design-lab-dag"] .react-flow__node').count()
  const edgeCount = await page.locator('[data-testid="design-lab-dag"] .react-flow__edge').count()
  check('DAG renders ELK layout and real edges', nodeCount === 7 && edgeCount === 7, `${nodeCount} nodes / ${edgeCount} edges`)

  await page.locator('[data-testid="design-lab-dag"] .react-flow__node').nth(4).click()
  await page.waitForSelector('[data-testid="design-lab-inspector"]', { timeout: 10_000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(shots, 'lab-dag-focus.png') })
  check('DAG node selection opens the linked inspector', await page.locator('.pdl-title-input').isVisible())
  await page.getByRole('button', { name: '关闭任务检查器' }).click()
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(shots, 'lab-dag-path.png') })

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

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1.25) })
  await page.evaluate(() => window.dispatchEvent(new Event('resize')))
  await page.waitForTimeout(500)
  const zoom = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, dpr: window.devicePixelRatio }))
  await page.screenshot({ path: join(shots, 'lab-125.png') })
  check('125% layout has no horizontal overflow', zoom.scroll <= zoom.viewport, JSON.stringify(zoom))
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










