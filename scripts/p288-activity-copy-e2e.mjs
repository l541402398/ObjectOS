/**
 * Phase 2.8.8 — 项目中心「最近动态」与运行审计事件流的可理解性 / 可点击性验收（ADR-0038）。
 *
 * 真实 Electron + 真实项目数据：
 *   1. 「全部」必须是可点击控件，点击后在卡片内展开全部动态（aria-expanded 切换、可收起）；
 *   2. 动态与事件流里不得出现 run.status.changed / project.event 之类原始英文类型；
 *   3. 展开后列表在卡片内滚动，不把整页撑高。
 *
 * usage: node scripts/p288-activity-copy-e2e.mjs <dataDir> [projectId]
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = process.argv[2]
if (!dataDir) {
  console.error('usage: node scripts/p288-activity-copy-e2e.mjs <dataDir>')
  process.exit(2)
}
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const RAW_TYPE = /^[a-z]+(\.[a-zA-Z_]+)+$/
const DOTTED = /\b(?:run|tool|plan|task|approval|artifact|project|handoff|message|session)\.[a-zA-Z_.]+/i

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

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
  await page.waitForSelector('.v16-activity-compact', { timeout: 30_000 })
  await page.waitForTimeout(1500)

  const initial = await page.evaluate(() => {
    const lines = [...document.querySelectorAll('.v16-activity-line strong')].map((el) => el.textContent ?? '')
    const title = document.querySelector('.v16-card-title .v16-card-link')
    const fallback = [...document.querySelectorAll('.v16-card-title span')].map((el) => el.textContent ?? '')
    return {
      lines,
      controls: title ? [{ text: title.textContent, tag: title.tagName, expanded: title.getAttribute('aria-expanded') }] : [],
      fallback,
      docScrolls: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }
  })

  const rawLines = initial.lines.filter((text) => RAW_TYPE.test(text.trim()) || DOTTED.test(text))
  record(
    '最近动态文案为可理解的中文（无原始事件类型）',
    rawLines.length === 0 ? 'PASS' : 'FAIL',
    rawLines.length === 0 ? `${initial.lines.length} 条动态：${initial.lines[0]?.slice(0, 60)}` : rawLines.slice(0, 3).join(' | '),
  )

  const control = initial.controls[0]
  record(
    '「全部」是可点击控件（不是静态文字）',
    control && control.tag === 'BUTTON' ? 'PASS' : 'FAIL',
    control ? `<${control.tag}> ${control.text} aria-expanded=${control.expanded}` : `控件缺失；标题区文本=${initial.fallback.join('/')}`,
  )
  if (!control) throw new Error('activity control missing')

  // Visual integration: the control must read as a quiet card action (tertiary text, no primary
  // link), meet WCAG AA for 12px, and stay consistent in both themes.
  const contrast = async () =>
    await page.evaluate(() => {
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
      const link = document.querySelector('.v16-card-link')
      if (!link) return null
      const card = link.closest('.v16-glass-card')
      const style = getComputedStyle(link)
      let background = null
      let node = card
      while (node && !background) {
        const parsed = parse(getComputedStyle(node).backgroundColor)
        if (parsed && parsed.a > 0.5) background = parsed
        node = node.parentElement
      }
      background = background ?? { r: 13, g: 20, b: 36, a: 1 }
      const fg = parse(style.color)
      const solid = flatten(fg, background)
      const light = luminance(solid)
      const dark = luminance(background)
      const ratio = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05)
      return {
        color: style.color,
        fontSize: style.fontSize,
        background: `rgb(${background.r}, ${background.g}, ${background.b})`,
        ratio: Math.round(ratio * 100) / 100,
        theme: document.documentElement.dataset.theme ?? 'dark',
      }
    })

  const dark = await contrast()
  record(
    `暗色「全部」为低调卡片动作且对比度≥4.5`,
    dark && dark.fontSize === '12px' && dark.ratio >= 4.5 ? 'PASS' : 'FAIL',
    dark ? `color=${dark.color} bg=${dark.background} size=${dark.fontSize} contrast=${dark.ratio}` : '未找到控件',
  )
  await page.screenshot({ path: join(shots, 'p288-activity-collapsed.png') })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light'
  })
  await page.waitForTimeout(600)
  const light = await contrast()
  record(
    `亮色「全部」为低调卡片动作且对比度≥4.5`,
    light && light.fontSize === '12px' && light.ratio >= 4.5 ? 'PASS' : 'FAIL',
    light ? `color=${light.color} bg=${light.background} size=${light.fontSize} contrast=${light.ratio}` : '未找到控件',
  )
  await page.screenshot({ path: join(shots, 'p288-activity-light.png') })
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'dark'
  })
  await page.waitForTimeout(500)
  const beforeCount = initial.lines.length
  await page.locator('.v16-card-title .v16-card-link').click()
  await page.waitForTimeout(700)
  const expanded = await page.evaluate(() => {
    const el = document.querySelector('.v16-card-link')
    const compact = document.querySelector('.v16-activity-compact')
    return {
      label: el?.textContent ?? '',
      ariaExpanded: el?.getAttribute('aria-expanded'),
      count: document.querySelectorAll('.v16-activity-line').length,
      scrolls: compact ? compact.scrollHeight > compact.clientHeight : null,
      docScrolls: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }
  })
  record(
    '点击「全部」展开全部动态并可收起',
    expanded.ariaExpanded === 'true' && expanded.count >= beforeCount && expanded.label === '收起' ? 'PASS' : 'FAIL',
    `label=${expanded.label} aria-expanded=${expanded.ariaExpanded} rows=${beforeCount}→${expanded.count}`,
  )
  record(
    '展开后列表在卡片内滚动，不撑高整页',
    expanded.docScrolls === 0 ? 'PASS' : 'FAIL',
    `compactScrolls=${expanded.scrolls} docScrolls=${expanded.docScrolls}`,
  )
  await page.screenshot({ path: join(shots, 'p288-activity-expanded.png') })

  await page.locator('.v16-card-title .v16-card-link').click()
  await page.waitForTimeout(500)
  const collapsed = await page.evaluate(() => ({
    label: document.querySelector('.v16-card-link')?.textContent ?? '',
    count: document.querySelectorAll('.v16-activity-line').length,
  }))
  record(
    '再次点击可收起',
    collapsed.label === '全部' && collapsed.count === beforeCount ? 'PASS' : 'FAIL',
    `label=${collapsed.label} rows=${collapsed.count}`,
  )

  // 1100 宽 + 真实 125% 缩放（webContents.setZoomFactor），验证卡片与控件不溢出。
  const win = await app.browserWindow(page)
  for (const size of [
    { label: '1100x700', width: 1100, height: 700, zoom: 1 },
    { label: '1440x900@125%', width: 1440, height: 900, zoom: 1.25 },
  ]) {
    await win.evaluate((w, dims) => w.setSize(dims.width, dims.height), size)
    await win.evaluate((w, factor) => w.webContents.setZoomFactor(factor), size.zoom)
    await page.waitForTimeout(900)
    const layout = await page.evaluate(() => {
      const card = document.querySelector('.v16-activity-compact')
      const link = document.querySelector('.v16-card-link')
      const rect = link?.getBoundingClientRect()
      return {
        docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        cardWidth: card?.clientWidth ?? null,
        linkVisible: rect ? rect.width > 0 && rect.height >= 20 : false,
        linkFontSize: link ? getComputedStyle(link).fontSize : null,
        docScrolls: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }
    })
    record(
      `${size.label} 无横向溢出且「全部」可点`,
      layout.docOverflowX === 0 && layout.linkVisible ? 'PASS' : 'FAIL',
      `overflowX=${layout.docOverflowX} card=${layout.cardWidth} link=${layout.linkVisible} font=${layout.linkFontSize} docScrolls=${layout.docScrolls}`,
    )
    await page.screenshot({ path: join(shots, `p288-activity-${size.label.replace(/[^0-9a-z]/gi, '')}.png`) })
  }
  await win.evaluate((w) => w.webContents.setZoomFactor(1))
  await win.evaluate((w) => w.setSize(1440, 900))

  // 运行审计 · 项目事件流：可见文字不能是原始事件类型（原始类型只作为 tooltip）。
  const projectId =
    process.argv[3] ||
    (await page.evaluate(() => {
      const match = window.location.hash.match(/projects\/([^/]+)/)
      return match?.[1] ?? null
    }))
  if (projectId) {
    await page.evaluate((id) => {
      window.location.hash = `#/projects/${id}/runs`
    }, projectId)
    await page.waitForSelector('.po-runs-tabs', { timeout: 30_000 })
    await page.waitForTimeout(1200)
    const eventsTab = page.getByRole('tab', { name: '项目事件' })
    if (await eventsTab.count()) {
      await eventsTab.first().click()
      await page.waitForTimeout(1200)
      const badges = await page.evaluate(() =>
        [...document.querySelectorAll('.po-event-type')].map((el) => ({
          text: el.textContent ?? '',
          title: el.getAttribute('title'),
        })),
      )
      const raw = badges.filter((badge) => RAW_TYPE.test(badge.text.trim()) || badge.text.includes('.'))
      record(
        '运行审计事件流徽标为中文分类（原始类型仅 tooltip）',
        badges.length > 0 && raw.length === 0 ? 'PASS' : badges.length === 0 ? 'SKIP' : 'FAIL',
        badges.length === 0
          ? '无事件行'
          : `${badges.length} 行，首行=${String(badges[0].text)} / tooltip=${String(badges[0].title)}`,
      )
      await page.screenshot({ path: join(shots, 'p288-event-stream.png') })
    } else {
      record('运行审计事件流徽标为中文分类（原始类型仅 tooltip）', 'SKIP', '未找到「项目事件」页签')
    }
  }
} catch (error) {
  record('最近动态验收', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P288 ACTIVITY COPY =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} SKIP=${results.filter((i) => i.status === 'SKIP').length}`)
  if (failed.length) process.exitCode = 1
}
