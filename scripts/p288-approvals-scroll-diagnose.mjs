/**
 * Phase 2.8.8 UX fix — reproduce the approvals scroll-ownership defect with real data.
 *
 * Opens the real app against a real project data dir, navigates to 审批, and dumps the scroll
 * ownership chain: which ancestor actually scrolls, and whether the list/detail panes do.
 * Then applies a candidate CSS fix in-page (test only) to prove the intended ownership before
 * touching the stylesheet.
 */
import { _electron as electron } from 'playwright-core'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = process.argv[2]
if (!dataDir) {
  console.error('usage: node scripts/p288-approvals-scroll-diagnose.mjs <dataDir>')
  process.exit(2)
}
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.'],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})
try {
  const projectId = process.argv[3]
  if (!projectId) {
    console.error('usage: node scripts/p288-approvals-scroll-diagnose.mjs <dataDir> <projectId>')
    process.exit(2)
  }
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  if (await page.locator('.v16-project-visual').count()) {
    await page.locator('.v16-project-visual').first().click()
  }
  await page.waitForTimeout(1200)
  await page.evaluate((id) => {
    window.location.hash = `#/projects/${id}/approvals`
  }, projectId)
  await page.waitForSelector('.ap-shell', { timeout: 30_000 })
  // The queue defaults to pending; a real project with history needs the 历史 tab to show rows.
  const apiCounts = await page.evaluate(async (id) => {
    const list = await window.projectos.approvals.list({ projectId: id, runId: null })
    return {
      total: list.approvals?.length ?? 0,
      pending: (list.approvals ?? []).filter((item) => item.status === 'pending').length,
    }
  }, projectId)
  console.log('API ' + JSON.stringify(apiCounts))
  const historyTab = page.getByRole('button', { name: '历史', exact: true })
  if (await historyTab.count()) {
    await historyTab.first().click()
    await page.waitForTimeout(1000)
  }
  const allScope = page.getByRole('button', { name: '全部', exact: true })
  if (await allScope.count()) {
    await allScope.first().click()
    await page.waitForTimeout(1000)
  }
  const uiState = await page.evaluate(() => ({
    rows: document.querySelectorAll('.ap-row').length,
    empty: document.querySelector('.ap-empty')?.textContent ?? null,
    activeFilters: [...document.querySelectorAll('.ap-filters button.is-active, .ap-scopes button.is-active')].map((b) => b.textContent),
    text: (document.querySelector('.ap-queue')?.textContent ?? '').slice(0, 160),
  }))
  console.log('UI ' + JSON.stringify(uiState))

  const before = await page.evaluate(() => {
    const describe = (el) => {
      if (!el) return null
      const cs = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString().slice(0, 60),
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        overflowY: cs.overflowY,
        height: cs.height,
        minHeight: cs.minHeight,
        flex: cs.flex,
        display: cs.display,
      }
    }
    const chain = []
    let node = document.querySelector('.ap-shell')
    while (node && node !== document.documentElement) {
      chain.push(describe(node))
      node = node.parentElement
    }
    chain.push(describe(document.documentElement))
    const rows = document.querySelectorAll('.ap-row').length
    return {
      chain,
      rows,
      list: describe(document.querySelector('.ap-list')),
      queue: describe(document.querySelector('.ap-queue')),
      body: describe(document.querySelector('.ap-body')),
      detail: describe(document.querySelector('.ap-detail')),
      mainScrolls: (() => {
        const main = document.querySelector('.po-main')
        return main ? main.scrollHeight - main.clientHeight : null
      })(),
      pageScrolls: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }
  })
  console.log('BEFORE ' + JSON.stringify(before, null, 2))

  // Candidate fix, applied in-page only to prove the intended scroll ownership.
  await page.addStyleTag({
    content: `
      .ap-shell { height: 100%; }
      .ap-body { flex: 1 1 auto; min-height: 0; }
      .ap-queue, .ap-detail, .ap-action { min-height: 0; }
      .ap-list { min-height: 0; }
    `,
  })
  await page.waitForTimeout(600)
  const after = await page.evaluate(() => {
    const describe = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const cs = getComputedStyle(el)
      return { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, overflowY: cs.overflowY, height: cs.height }
    }
    const main = document.querySelector('.po-main')
    return {
      body: describe('.ap-body'),
      list: describe('.ap-list'),
      detail: describe('.ap-detail'),
      mainScrolls: main ? main.scrollHeight - main.clientHeight : null,
      pageScrolls: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    }
  })
  console.log('AFTER ' + JSON.stringify(after, null, 2))

  // Scroll the queue with the wheel over the list: the list must move, the page must not.
  const box = await page.locator('.ap-list').boundingBox()
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(400)
  }
  const wheel = await page.evaluate(() => ({
    listScrollTop: document.querySelector('.ap-list')?.scrollTop ?? null,
    mainScrollTop: document.querySelector('.po-main')?.scrollTop ?? null,
    windowScrollY: window.scrollY,
  }))
  console.log('WHEEL ' + JSON.stringify(wheel))
  await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p288-approvals-scroll-before.png') })
} finally {
  await app.close().catch(() => undefined)
}
