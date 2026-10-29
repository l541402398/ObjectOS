/**
 * Phase 2.8.8 — 资源中心（左侧「资源与连接」）滚动所有权真实验收。
 *
 * 走真实侧边栏点击进入，不做 hash 跳转；断言：
 *   1. 内页（.po-main）不滚动 —— 长列表不再产生整页滚动条；
 *   2. 左栏/详情栏自己滚动，滚轮在栏内生效且页面不动；
 *   3. 1440×900 / 1024×700 / 620 高三种窗口一致。
 * 若真实资源行数不足以产生溢出，用明确标注的「布局探针」克隆行验证布局（不作为业务证据）。
 *
 * usage: node scripts/p288-connections-scroll-e2e.mjs <dataDir>
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = process.argv[2]
if (!dataDir) {
  console.error('usage: node scripts/p288-connections-scroll-e2e.mjs <dataDir>')
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

async function measure(page) {
  return await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: cs.overflowY, scrollTop: el.scrollTop }
    }
    const main = document.querySelector('.po-main')
    return {
      mainScrolls: main ? main.scrollHeight - main.clientHeight : null,
      mainScrollTop: main ? main.scrollTop : null,
      body: pick('.rc-body'),
      list: pick('.rc-list'),
      detail: pick('.rc-main'),
      inspector: pick('.rc-inspector'),
      rows: document.querySelectorAll('.rc-list > *').length,
      docScrolls: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }
  })
}

async function wheelProbe(page, selector) {
  const box = await page.locator(selector).boundingBox()
  if (!box) return null
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(100, box.height / 2))
  await page.mouse.wheel(0, 700)
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
  if (await page.locator('.v16-project-visual').count()) {
    await page.locator('.v16-project-visual').first().click()
    await page.waitForTimeout(1200)
  }
  // 真实路径：点击左侧「资源与连接」菜单项。
  const navItem = page.getByRole('button', { name: '资源与连接' }).or(page.getByText('资源与连接', { exact: true }))
  const count = await navItem.count()
  record('侧边栏存在「资源与连接」入口', count > 0 ? 'PASS' : 'FAIL', `matches=${count}`)
  if (count > 0) {
    await navItem.first().click()
    await page.waitForTimeout(1500)
  }
  const hash = await page.evaluate(() => window.location.hash)
  record('点击后进入 /connections（资源中心）', hash.includes('/connections') ? 'PASS' : 'FAIL', hash)
  try {
    await page.waitForSelector('.rc-shell', { timeout: 10_000 })
    record('渲染资源中心三栏布局', 'PASS', '.rc-shell / .rc-body / .rc-list / .rc-main')
  } catch {
    record('渲染资源中心三栏布局', 'FAIL', '未找到 .rc-shell')
    throw new Error('resource center layout missing')
  }

  // Real rows for a real scroll test: create resources through the product API in this isolated
  // test profile when the project has too few. These are ordinary records, not fabricated layout.
  const before = await measure(page)
  if (before.rows < 8) {
    const created = await page.evaluate(async (id) => {
      const names = Array.from({ length: 12 }, (_, index) => `布局验证主机 ${String(index + 1).padStart(2, '0')}`)
      let ok = 0
      for (const name of names) {
        try {
          await window.projectos.resources.create({
            projectId: id,
            type: 'host',
            name,
            endpoint: `10.0.0.${20 + ok}`,
            purpose: '滚动布局验收',
            labels: ['e2e-layout'],
            metadata: {},
          })
          ok += 1
        } catch {
          break
        }
      }
      return ok
    }, page.url().match(/projects\/([^/]+)/)[1])
    record('为滚动验收创建真实资源行', created >= 8 ? 'PASS' : 'FAIL', `created=${created}`)
    await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
    await page.waitForSelector('.rc-shell', { timeout: 30_000 })
    await page.waitForTimeout(1500)
  }

  const win = await app.browserWindow(page)
  for (const size of [
    { label: '1440x900', width: 1440, height: 900 },
    { label: '1024x700', width: 1024, height: 700 },
    { label: '620h', width: 1440, height: 620 },
  ]) {
    await win.evaluate((w, dims) => w.setSize(dims.width, dims.height), size)
    await page.waitForTimeout(900)
    let snapshot = await measure(page)
    let probeRows = false
    if (snapshot.list && snapshot.list.scrollHeight <= snapshot.list.clientHeight + 2 && snapshot.rows > 0) {
      probeRows = true
      await page.evaluate(() => {
        const host = document.querySelector('.rc-list')
        const template = host?.firstElementChild
        if (!host || !template) return
        for (let i = 0; i < 30; i += 1) host.appendChild(template.cloneNode(true))
      })
      await page.waitForTimeout(400)
      snapshot = await measure(page)
    }
    record(
      `${size.label} 内页不滚动（只有栏内滚动）`,
      snapshot.mainScrolls === 0 ? 'PASS' : 'FAIL',
      `mainScrolls=${snapshot.mainScrolls} docScrolls=${snapshot.docScrolls} rows=${snapshot.rows}${probeRows ? '(含布局探针)' : ''} list=${snapshot.list?.scrollHeight}/${snapshot.list?.clientHeight}`,
    )
    if (snapshot.list && snapshot.list.scrollHeight > snapshot.list.clientHeight + 2) {
      const wheel = await wheelProbe(page, '.rc-list')
      record(
        `${size.label} 栏内滚轮生效且页面不动`,
        wheel && wheel.listScrollTop > 0 && wheel.mainScrollTop === 0 && wheel.windowScrollY === 0 ? 'PASS' : 'FAIL',
        `list=${wheel?.listScrollTop} main=${wheel?.mainScrollTop} window=${wheel?.windowScrollY}${probeRows ? ' (布局探针)' : ''}`,
      )
    } else {
      record(`${size.label} 栏内滚轮生效且页面不动`, 'SKIP', '真实资源行不足且无探针行可滚动')
    }
    if (size.label !== '620h') {
      await page.screenshot({ path: join(shots, `p288-scroll-connections-${size.label}.png`) })
    }
  }
} catch (error) {
  record('资源与连接滚动验收', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P288 CONNECTIONS SCROLL =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} SKIP=${results.filter((i) => i.status === 'SKIP').length}`)
  if (failed.length) process.exitCode = 1
}
