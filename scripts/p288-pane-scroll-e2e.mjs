/**
 * Phase 2.8.8 — master-detail panes own their scrolling (ADR-0037).
 *
 * Real Electron, real project data. For every page that renders a scrolling pane inside a
 * full-height layout, this asserts:
 *   1. the inner page (`.po-main`) does NOT scroll — no page-level scrollbar for a long list;
 *   2. the queue/detail pane DOES scroll, and the wheel over it moves the pane, not the page;
 *   3. the same holds at 1440x900, 1024x700 and 620px height (the short-window case).
 *
 * usage: node scripts/p288-pane-scroll-e2e.mjs <dataDir> <projectId>
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = process.argv[2]
const projectId = process.argv[3]
if (!dataDir || !projectId) {
  console.error('usage: node scripts/p288-pane-scroll-e2e.mjs <dataDir> <projectId>')
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

const pages = [
  { route: 'approvals', list: '.ap-list', pane: '.ap-detail', root: '.ap-shell', body: '.ap-body' },
  { route: 'resources', list: '.rc-list', pane: '.rc-main', root: '.rc-shell', body: '.rc-body' },
]

async function measure(page, spec) {
  return await page.evaluate((selector) => {
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowY: cs.overflowY,
        scrollTop: el.scrollTop,
      }
    }
    const main = document.querySelector('.po-main')
    return {
      mainScrolls: main ? main.scrollHeight - main.clientHeight : null,
      mainScrollTop: main ? main.scrollTop : null,
      list: pick(selector.list),
      pane: pick(selector.pane),
      body: pick(selector.body),
      docScrolls: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      rows: document.querySelectorAll(`${selector.list} > *`).length,
    }
  }, spec)
}

async function wheelProbe(page, selector) {
  const box = await page.locator(selector).boundingBox()
  if (!box) return null
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(120, box.height / 2))
  await page.mouse.wheel(0, 800)
  await page.waitForTimeout(400)
  return await page.evaluate((sel) => ({
    listScrollTop: document.querySelector(sel)?.scrollTop ?? null,
    mainScrollTop: document.querySelector('.po-main')?.scrollTop ?? null,
    windowScrollY: window.scrollY,
  }), selector)
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
  await page.waitForTimeout(1200)
  const win = await app.browserWindow(page)

  for (const spec of pages) {
    await page.evaluate(({ projectId, route }) => {
      window.location.hash = `#/projects/${projectId}/${route}`
    }, { projectId, route: spec.route })
    await page.waitForSelector(spec.root, { timeout: 30_000 })
    await page.waitForTimeout(1400)
    // Show history so the queue has real rows (the default pending filter can be empty).
    const historyTab = page.getByRole('button', { name: '历史', exact: true })
    if (await historyTab.count()) {
      await historyTab.first().click().catch(() => undefined)
      await page.waitForTimeout(800)
    }
    const allScope = page.getByRole('button', { name: '全部', exact: true })
    if (await allScope.count()) {
      await allScope.first().click().catch(() => undefined)
      await page.waitForTimeout(800)
    }

    for (const size of [
      { label: '1440x900', width: 1440, height: 900 },
      { label: '1024x700', width: 1024, height: 700 },
      { label: '620h', width: 1440, height: 620 },
    ]) {
      await win.evaluate((w, dims) => w.setSize(dims.width, dims.height), size)
      await page.waitForTimeout(900)
      const before = await measure(page, spec)
      const rows = before.rows
      if (!before.list || !before.body) {
        record(`${spec.route} ${size.label} 渲染`, 'FAIL', `list=${Boolean(before.list)} body=${Boolean(before.body)}`)
        continue
      }
      record(
        `${spec.route} ${size.label} 页面不滚动（长列表只在栏内滚动）`,
        before.mainScrolls === 0 ? 'PASS' : 'FAIL',
        `mainScrolls=${before.mainScrolls} docScrolls=${before.docScrolls} rows=${rows} list=${before.list.scrollHeight}/${before.list.clientHeight}`,
      )
      const probe = await wheelProbe(page, spec.list)
      record(
        `${spec.route} ${size.label} 栏内滚轮生效且页面不动`,
        probe && probe.listScrollTop > 0 && probe.mainScrollTop === 0 && probe.windowScrollY === 0 ? 'PASS' : 'FAIL',
        `list=${probe?.listScrollTop} main=${probe?.mainScrollTop} window=${probe?.windowScrollY}`,
      )
      if (size.label !== '620h') {
        await page.screenshot({ path: join(shots, `p288-scroll-${spec.route}-${size.label}.png`) })
      }
      await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (el) el.scrollTop = 0
      }, spec.list)
      await page.waitForTimeout(300)
    }
  }
} catch (error) {
  record('pane scroll E2E', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P288 PANE SCROLL =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  if (failed.length) process.exitCode = 1
}
