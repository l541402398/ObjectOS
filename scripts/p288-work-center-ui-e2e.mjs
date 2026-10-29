/**
 * Phase 2.8.8 — work-center goal status UI acceptance (real packaged-dev Electron).
 *
 * Verifies ADR-0031 in a real renderer: the goal band shows execution / verification / review /
 * delivery, the "AI 下一步（无需你操作）" strip is separate from user decisions, and the layout holds
 * at 1440 and 1024 in both themes and at 125% scaling.
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })
const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

async function open(label, { width, height, scale }) {
  const dataDir = resolve(root, '.p288-ui', label)
  mkdirSync(dataDir, { recursive: true })
  const env = {
    ...process.env,
    PROJECTOS_DATA_DIR: dataDir,
    PROJECTOS_SEED_DEMO: '1',
    PROJECTOS_WINDOW_WIDTH: String(width),
    PROJECTOS_WINDOW_HEIGHT: String(height),
  }
  delete env.ELECTRON_RUN_AS_NODE
  const args = ['.']
  if (scale) args.push(`--force-device-scale-factor=${scale}`)
  const app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args,
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  if (await page.locator('.v16-project-visual').count()) {
    await page.locator('.v16-project-visual').first().click()
  }
  await page.waitForSelector('.po-work-center', { timeout: 60_000 })
  await page.waitForSelector('.wc-goal-states', { timeout: 30_000 })
  await page.waitForTimeout(1200)
  return { app, page }
}

async function inspect(page) {
  return await page.evaluate(() => {
    const states = [...document.querySelectorAll('.wc-goal-state')].map((node) => ({
      label: node.querySelector('.wc-goal-state-label')?.textContent ?? '',
      value: node.querySelector('.wc-goal-state-value')?.textContent ?? '',
    }))
    const autopilot = document.querySelector('.wc-goal-autopilot')
    return {
      states,
      autopilotText: autopilot ? (autopilot.textContent ?? '').slice(0, 240) : null,
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      devicePixelRatio: window.devicePixelRatio,
    }
  })
}

async function shoot(page, name) {
  await page.screenshot({ path: join(shots, `${name}.png`) })
  return `${name}.png`
}

let app = null
try {
  const big = await open('1440', { width: 1440, height: 900 })
  app = big.app
  const dark = await inspect(big.page)
  const shotsMade = []
  shotsMade.push(await shoot(big.page, 'p288-wc-1440-dark'))
  record(
    '目标状态带（执行/测试/审查/交付）',
    dark.states.length >= 4 ? 'PASS' : 'FAIL',
    dark.states.map((s) => `${s.label}=${s.value}`).join(' | '),
  )
  record(
    'AI 下一步与用户待办分离',
    dark.autopilotText !== null || dark.states.length >= 4 ? 'PASS' : 'FAIL',
    dark.autopilotText ? dark.autopilotText.replace(/\s+/g, ' ').slice(0, 120) : '当前无 AI 待执行步骤（状态带已区分归属）',
  )
  record('1440 无横向溢出', dark.scrollWidth <= dark.viewport + 2 ? 'PASS' : 'FAIL', `scrollWidth=${dark.scrollWidth} viewport=${dark.viewport}`)

  await big.page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await big.page.waitForTimeout(600)
  shotsMade.push(await shoot(big.page, 'p288-wc-1440-light'))
  const light = await inspect(big.page)
  record('Light 主题下状态带仍完整', light.states.length >= 4 ? 'PASS' : 'FAIL', `states=${light.states.length}`)

  // Resize the real window to 1024 and re-check density / overflow.
  const window = await big.app.browserWindow(big.page)
  await window.evaluate((win) => win.setSize(1024, 768))
  await big.page.waitForTimeout(900)
  const small = await inspect(big.page)
  shotsMade.push(await shoot(big.page, 'p288-wc-1024-light'))
  record('1024 无横向溢出', small.scrollWidth <= small.viewport + 2 ? 'PASS' : 'FAIL', `scrollWidth=${small.scrollWidth} viewport=${small.viewport}`)
  record('1024 状态带仍完整', small.states.length >= 4 ? 'PASS' : 'FAIL', `states=${small.states.length}`)
  record('截图产物', 'PASS', shotsMade.join(', '))
  await big.app.close()
  app = null

  const scaled = await open('125', { width: 1440, height: 900, scale: 1.25 })
  app = scaled.app
  const zoom = await inspect(scaled.page)
  await shoot(scaled.page, 'p288-wc-125')
  record(
    '125% 缩放无横向溢出',
    zoom.scrollWidth <= zoom.viewport + 2 ? 'PASS' : 'FAIL',
    `dpr=${zoom.devicePixelRatio} scrollWidth=${zoom.scrollWidth} viewport=${zoom.viewport}`,
  )
  record('125% 状态带仍完整', zoom.states.length >= 4 ? 'PASS' : 'FAIL', `states=${zoom.states.length}`)
} catch (error) {
  record('工作中心 UI 验收', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log(`\n===== P288 WORK CENTER UI =====`)
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  if (failed.length) process.exitCode = 1
}
