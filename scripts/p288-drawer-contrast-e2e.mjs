/**
 * ADR-0044 — the task drawer must render in the app theme with readable contrast.
 *
 * Real defect: the drawer used the light overlay tokens (white sheet) while the content inside used
 * the app's dark-theme text tokens, so 任务说明 / 执行信息 text was light-gray on white.
 *
 * This opens a real project's task board, clicks a real task, and measures the WCAG contrast of the
 * drawer's key text nodes against their own composited background — in both themes.
 *
 * usage: node scripts/p288-drawer-contrast-e2e.mjs <dataDir> <projectId>
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = process.argv[2]
const projectId = process.argv[3]
if (!dataDir || !projectId) {
  console.error('usage: node scripts/p288-drawer-contrast-e2e.mjs <dataDir> <projectId>')
  process.exit(2)
}
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

const CONTRAST_SCRIPT = () => {
  const parse = (value) => {
    const match = value.match(/rgba?\(([^)]+)\)/)
    if (!match) return null
    const parts = match[1].split(',').map((item) => Number(item.trim()))
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
  }
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const srgb = value / 255
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  }
  const flatten = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  })
  const ratioOf = (fg, bg) => {
    const solid = flatten(fg, bg)
    const light = luminance(solid)
    const dark = luminance(bg)
    return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)
  }
  const backgroundOf = (node) => {
    let current = node
    while (current && current !== document.documentElement) {
      const parsed = parse(getComputedStyle(current).backgroundColor)
      if (parsed && parsed.a > 0.5) return parsed
      current = current.parentElement
    }
    return { r: 17, g: 27, b: 48, a: 1 }
  }
  const panel = document.querySelector('.pui-overlay-inspector')
  if (!panel) return { missing: true }
  const samples = []
  const push = (label, node) => {
    if (!node) return
    const style = getComputedStyle(node)
    const fg = parse(style.color)
    if (!fg) return
    const bg = backgroundOf(node)
    const size = Number.parseFloat(style.fontSize)
    const bold = Number(style.fontWeight) >= 600
    const large = size >= 24 || (size >= 18.66 && bold)
    samples.push({
      label,
      text: (node.textContent ?? '').trim().slice(0, 40),
      size,
      large,
      ratio: Math.round(ratioOf(fg, bg) * 100) / 100,
      fg: style.color,
      bg: `rgb(${bg.r}, ${bg.g}, ${bg.b})`,
    })
  }
  push('面板标题', panel.querySelector('.pui-overlay-title'))
  push('眉标', panel.querySelector('.pui-overlay-eyebrow'))
  push('元信息', panel.querySelector('.pui-overlay-meta'))
  const scroll = panel.querySelector('.po-task-detail-scroll') ?? panel
  const paragraphs = [...scroll.querySelectorAll('p, dd, td, li')].filter((node) => (node.textContent ?? '').trim().length > 8)
  paragraphs.slice(0, 4).forEach((node, index) => push(`正文 ${index + 1}`, node))
  const labels = [...scroll.querySelectorAll('dt, .po-task-detail-label, .po-kv-label, .ant-descriptions-item-label')].filter(
    (node) => (node.textContent ?? '').trim().length > 0,
  )
  labels.slice(0, 4).forEach((node, index) => push(`字段名 ${index + 1}`, node))
  const headings = [...scroll.querySelectorAll('h2, h3, h4, .po-task-detail-section-title')]
  headings.slice(0, 3).forEach((node, index) => push(`小标题 ${index + 1}`, node))
  return {
    theme: panel.getAttribute('data-theme'),
    panelBackground: getComputedStyle(panel).backgroundColor,
    samples,
  }
}

let app = null
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.evaluate((id) => {
    window.location.hash = `#/projects/${id}/tasks`
  }, projectId)
  await page.waitForTimeout(2500)

  // Open the first real task card.
  const card = page.locator('.po-task-tile').first()
  if ((await card.count()) === 0) {
    record('打开真实任务抽屉', 'FAIL', '任务看板上没有可点击的任务卡')
    throw new Error('no task card')
  }
  await card.click()
  await page.waitForSelector('.pui-overlay-inspector', { timeout: 15_000 })
  await page.waitForTimeout(900)
  record('打开真实任务抽屉', 'PASS', await page.locator('.pui-overlay-title').first().innerText())

  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light')
  const dark = await page.evaluate(CONTRAST_SCRIPT)
  if (dark?.missing) throw new Error('drawer panel not found')

  const judge = (label, data, expectedTheme) => {
    const themed = data.theme === expectedTheme
    const weak = data.samples.filter((sample) => sample.ratio < (sample.large ? 3 : 4.5))
    record(
      `${label} 抽屉跟随应用主题（data-theme=${expectedTheme}）`,
      themed ? 'PASS' : 'FAIL',
      `panel data-theme=${data.theme} background=${data.panelBackground} samples=${data.samples.length}`,
    )
    record(
      `${label} 文字对比度达标（正文≥4.5，大字≥3）`,
      data.samples.length > 0 && weak.length === 0 ? 'PASS' : 'FAIL',
      weak.length === 0
        ? data.samples.map((sample) => `${sample.label} ${sample.ratio}:1`).join(' · ')
        : weak.map((sample) => `${sample.label} ${sample.ratio}:1 (${sample.fg} on ${sample.bg})`).join(' · '),
    )
  }
  judge(themeBefore === 'dark' ? '暗色' : '亮色', dark, themeBefore)
  await page.screenshot({ path: join(shots, 'p288-drawer-dark.png') })

  // Flip the app theme the way the product persists it (zustand `projectos.ui`), then reload so the
  // real store/theme effect runs. The open drawer covers the titlebar, so close it first.
  const next = themeBefore === 'dark' ? 'light' : 'dark'
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)
  await page.evaluate((mode) => {
    const raw = window.localStorage.getItem('projectos.ui')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
    parsed.state = { ...(parsed.state ?? {}), themeMode: mode }
    window.localStorage.setItem('projectos.ui', JSON.stringify(parsed))
  }, next)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  await page.waitForTimeout(1800)
  const applied = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light')
  record('应用主题切换为 ' + next, applied === next ? 'PASS' : 'FAIL', `data-theme=${applied}`)
  const reopen = page.locator('.po-task-tile').first()
  await reopen.click()
  await page.waitForSelector('.pui-overlay-inspector', { timeout: 15_000 })
  await page.waitForTimeout(900)
  // Re-measure after the theme change (the drawer is a fresh instance in the new theme).
  const afterTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light')
  void afterTheme
  const light = await page.evaluate(CONTRAST_SCRIPT)
  if (light?.missing) throw new Error('drawer panel not found after theme switch')
  judge(next === 'dark' ? '暗色' : '亮色', light, next)
  await page.screenshot({ path: join(shots, `p288-drawer-${next}.png`) })
} catch (error) {
  record('任务抽屉对比度验收', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P288 DRAWER CONTRAST =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  if (failed.length) process.exitCode = 1
}
