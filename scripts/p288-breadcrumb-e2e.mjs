/**
 * ADR-0045 — breadcrumb + back navigation.
 *
 * Real ask: from an inner page there was no way back to the previous inner page; the titlebar path
 * looked like decoration. This walks a real project: 运行审计 → 审批 (sidebar), then「返回」must land
 * on 运行审计; the crumb of the project must navigate; the current page must carry aria-current.
 *
 * usage: node scripts/p288-breadcrumb-e2e.mjs <dataDir> <projectId>
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = process.argv[2]
const projectId = process.argv[3]
if (!dataDir || !projectId) {
  console.error('usage: node scripts/p288-breadcrumb-e2e.mjs <dataDir> <projectId>')
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

const CONTRAST = () => {
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
  const bgOf = (node) => {
    let current = node
    while (current && current !== document.documentElement) {
      const parsed = parse(getComputedStyle(current).backgroundColor)
      if (parsed && parsed.a > 0.5) return parsed
      current = current.parentElement
    }
    return { r: 11, g: 18, b: 32, a: 1 }
  }
  const nav = document.querySelector('.po-crumbs')
  if (!nav) return { missing: true }
  const nodes = [
    ['返回按钮', document.querySelector('.po-crumb-back')],
    ...[...nav.querySelectorAll('.po-crumb-link')].map((node, index) => [`层级 ${index + 1}`, node]),
    ['分组', nav.querySelector('.po-crumb-group')],
    ['当前页', nav.querySelector('.po-crumb-page')],
  ]
  const samples = []
  for (const [label, node] of nodes) {
    if (!node) continue
    const style = getComputedStyle(node)
    const fg = parse(style.color)
    const bg = bgOf(node)
    if (!fg) continue
    const light = luminance({ ...fg, a: 1 })
    const dark = luminance(bg)
    samples.push({
      label,
      text: (node.textContent ?? '').trim().slice(0, 24),
      size: style.fontSize,
      ratio: Math.round(((Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)) * 100) / 100,
    })
  }
  return {
    samples,
    current: nav.querySelector('.po-crumb-page')?.getAttribute('aria-current'),
    segments: nodes.filter(([, node]) => node).length,
    hash: window.location.hash,
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
    window.location.hash = `#/projects/${id}/runs`
  }, projectId)
  await page.waitForTimeout(1800)
  record('打开内页（运行审计）', 'PASS', await page.evaluate(() => window.location.hash))

  const first = await page.evaluate(CONTRAST)
  if (first?.missing) throw new Error('breadcrumb missing')
  record(
    '面包屑包含 项目中心 › 项目 › 分组 › 当前页',
    first.segments >= 4 ? 'PASS' : 'FAIL',
    first.samples.map((sample) => `${sample.label}=${sample.text}`).join(' | '),
  )
  record(
    '当前页带 aria-current=page',
    first.current === 'page' ? 'PASS' : 'FAIL',
    `aria-current=${first.current}`,
  )
  const weak = first.samples.filter((sample) => sample.ratio < 4.5)
  record(
    '面包屑文字对比度≥4.5',
    first.samples.length > 0 && weak.length === 0 ? 'PASS' : 'FAIL',
    first.samples.map((sample) => `${sample.label} ${sample.ratio}:1`).join(' · '),
  )
  await page.screenshot({ path: join(shots, 'p288-breadcrumb-runs.png') })

  // Same bar in the other theme (the tokens are theme-aware, so this must hold for both).
  const themeNow = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light')
  const other = themeNow === 'dark' ? 'light' : 'dark'
  await page.evaluate((mode) => {
    const raw = window.localStorage.getItem('projectos.ui')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
    parsed.state = { ...(parsed.state ?? {}), themeMode: mode }
    window.localStorage.setItem('projectos.ui', JSON.stringify(parsed))
  }, other)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  const themed = await page.evaluate(CONTRAST)
  const themedWeak = (themed.samples ?? []).filter((sample) => sample.ratio < 4.5)
  record(
    `面包屑在${other === 'light' ? '亮色' : '暗色'}下对比度≥4.5`,
    themed.samples && themed.samples.length > 0 && themedWeak.length === 0 ? 'PASS' : 'FAIL',
    themed.samples ? themed.samples.map((sample) => `${sample.label} ${sample.ratio}:1`).join(' · ') : 'no samples',
  )
  await page.screenshot({ path: join(shots, `p288-breadcrumb-${other}.png`) })
  // restore the original theme for the remaining navigation checks
  await page.evaluate((mode) => {
    const raw = window.localStorage.getItem('projectos.ui')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
    parsed.state = { ...(parsed.state ?? {}), themeMode: mode }
    window.localStorage.setItem('projectos.ui', JSON.stringify(parsed))
  }, themeNow)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  await page.waitForTimeout(1200)

  // Navigate to a sibling inner page through the real sidebar, then go back with the breadcrumb.
  const approvals = page.getByText('审批', { exact: true }).first()
  await approvals.click()
  await page.waitForTimeout(1500)
  const afterNav = await page.evaluate(() => window.location.hash)
  record('侧栏跳转到另一个内页（审批）', afterNav.includes('/approvals') ? 'PASS' : 'FAIL', afterNav)

  const back = page.locator('.po-crumb-back')
  record('返回按钮可用（存在应用内历史）', (await back.isEnabled()) ? 'PASS' : 'FAIL', `disabled=${!(await back.isEnabled())}`)
  await back.click()
  await page.waitForTimeout(1200)
  const wentBack = await page.evaluate(() => window.location.hash)
  record('点「返回」回到上一个内页（运行审计）', wentBack.includes('/runs') ? 'PASS' : 'FAIL', wentBack)

  // Project crumb navigates.
  await page.locator('.po-crumb-link').nth(1).click()
  await page.waitForTimeout(1200)
  const projectCrumb = await page.evaluate(() => window.location.hash)
  record('点项目层级回到项目页', projectCrumb.startsWith('#/projects/') ? 'PASS' : 'FAIL', projectCrumb)

  // 1100 width + real 125% zoom: the bar must not overflow the titlebar.
  const win = await app.browserWindow(page)
  for (const size of [
    { label: '1100x700', width: 1100, height: 700, zoom: 1 },
    { label: '1440@125%', width: 1440, height: 900, zoom: 1.25 },
  ]) {
    await win.evaluate((w, dims) => w.setSize(dims.width, dims.height), size)
    await win.evaluate((w, factor) => w.webContents.setZoomFactor(factor), size.zoom)
    await page.waitForTimeout(800)
    const layout = await page.evaluate(() => {
      const inner = document.querySelector('.po-titlebar-inner')
      const nav = document.querySelector('.po-crumbs')
      const navRect = nav?.getBoundingClientRect()
      const innerRect = inner?.getBoundingClientRect()
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        navFits: Boolean(navRect && innerRect && navRect.right <= innerRect.right + 1),
        titlebarHeight: innerRect?.height ?? null,
      }
    })
    record(
      `${size.label} 面包屑不溢出标题栏`,
      layout.overflowX === 0 && layout.navFits ? 'PASS' : 'FAIL',
      `overflowX=${layout.overflowX} navFits=${layout.navFits} titlebarH=${layout.titlebarHeight}`,
    )
    await page.screenshot({ path: join(shots, `p288-breadcrumb-${size.label.replace(/[^0-9a-z]/gi, '')}.png`) })
  }
  await win.evaluate((w) => w.webContents.setZoomFactor(1))
} catch (error) {
  record('面包屑验收', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P288 BREADCRUMB =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  if (failed.length) process.exitCode = 1
}
