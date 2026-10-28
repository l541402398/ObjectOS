/**
 * Phase 2.5 UI/UX audit — measured, not eyeballed.
 *
 * Launches the real Electron app against an existing data dir and records geometry
 * evidence for the defects this phase must fix:
 *   - overlay (toast) covering global header controls
 *   - panels clipped by their container (content taller than the box, no scroll)
 *   - dead space in the release workbench detail column
 *   - light-theme control/metric inconsistencies
 *
 * Usage:
 *   $env:PROJECTOS_E2E_DATA_DIR="C:\...\p25-ui"
 *   node scripts/p25-ui-audit.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = process.env.PROJECTOS_E2E_DATA_DIR
if (!dataDir) throw new Error('PROJECTOS_E2E_DATA_DIR is required')
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const findings = []
const add = (id, severity, detail) => {
  findings.push({ id, severity, detail })
  console.log(`${severity}\t${id}\t${detail}`)
}
const rect = (r) => (r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null)
const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 40_000 })
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.po-shell.is-collapsed').count()) await page.getByRole('button', { name: '切换侧边栏' }).click()
  if (await page.locator('.v16-project-visual').count()) await page.locator('.v16-project-visual').first().click()
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  const project = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0])
  const lifecycle = await page.evaluate(async ({ projectId }) => window.projectos.lifecycle.overview(projectId), { projectId: project.id })
  const versionId = lifecycle.versions[0].id
  const go = (path) => page.evaluate(({ path }) => { location.hash = path }, { path })
  const setTheme = async (theme) => {
    await page.evaluate(({ theme }) => { document.documentElement.dataset.theme = theme }, { theme })
    await page.waitForTimeout(350)
  }

  // ---------- A. toast vs global header controls ----------
  // A deterministic toast source: saving an unchanged resource always notifies.
  for (const theme of ['light', 'dark']) {
    await setTheme(theme)
    await go(`#/projects/${project.id}/connections`)
    await page.waitForSelector('.rc-shell', { timeout: 30_000 })
    await page.waitForTimeout(600)
    const editButton = page.getByRole('button', { name: '编辑资源' })
    if (await editButton.count()) {
      await editButton.first().click()
      await page.waitForSelector('.ant-modal:visible', { timeout: 10_000 })
      await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
      await page.waitForTimeout(900)
    }
    const geo = await page.evaluate(() => {
      const pick = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      }
      const messages = [...document.querySelectorAll('.ant-message-notice, .ant-message-notice-content')].map((el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height, text: (el.textContent ?? '').slice(0, 60) }
      })
      return {
        messages,
        search: pick('.po-global-search, [class*="global-search"], [class*="search"]'),
        header: pick('.po-topbar, .po-header, header'),
        breadcrumb: pick('.po-breadcrumb, [class*="breadcrumb"]'),
      }
    })
    for (const message of geo.messages) {
      if (overlaps(message, geo.search)) add('toast-covers-search', 'HIGH', `${theme}: toast ${JSON.stringify(rect(message))} overlaps search ${JSON.stringify(rect(geo.search))} "${message.text}"`)
      if (overlaps(message, geo.breadcrumb)) add('toast-covers-breadcrumb', 'MEDIUM', `${theme}: toast overlaps breadcrumb ${JSON.stringify(rect(geo.breadcrumb))}`)
    }
    if (!geo.messages.length) add('toast-not-observed', 'INFO', `${theme}: no toast captured`)
    else add('toast-clears-header', 'INFO', `${theme}: toast ${JSON.stringify(rect(geo.messages[0]))} vs search ${JSON.stringify(rect(geo.search))}`)
    await page.screenshot({ path: join(shots, `p25-audit-toast-${theme}.png`) })
  }

  // ---------- B. release workbench dead space ----------
  const dead = await page.evaluate(() => {
    const pageEl = document.querySelector('.po-delivery-page')
    if (!pageEl) return null
    const panels = [...pageEl.querySelectorAll('.rw-detail, [class*="detail"], [class*="panel"]')]
    return panels.map((el) => {
      const r = el.getBoundingClientRect()
      const children = [...el.children]
      const contentBottom = children.length
        ? Math.max(...children.map((child) => child.getBoundingClientRect().bottom))
        : r.top
      return { cls: el.className.slice(0, 60), h: Math.round(r.height), contentH: Math.round(contentBottom - r.top), deadPx: Math.round(r.bottom - contentBottom) }
    })
  })
  if (dead) {
    for (const panel of dead.filter((item) => item.deadPx > 120)) {
      add('panel-dead-space', 'MEDIUM', `${panel.cls}: height=${panel.h}px content=${panel.contentH}px dead=${panel.deadPx}px`)
    }
  }

  // ---------- C. clipped panels (content taller than box, no scroll affordance) ----------
  await go(`#/projects/${project.id}/versions`)
  await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
  await page.waitForTimeout(600)
  const clipped = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('.po-lifecycle-page *')) {
      const style = getComputedStyle(el)
      const scrollable = ['auto', 'scroll'].includes(style.overflowY)
      if (!scrollable && el.scrollHeight > el.clientHeight + 8 && el.clientHeight > 80 && (el.className ?? '').toString().match(/gate|panel|card|rail|aside/i)) {
        out.push({ cls: String(el.className).slice(0, 70), clientH: el.clientHeight, scrollH: el.scrollHeight, overflowY: style.overflowY })
      }
    }
    return out.slice(0, 8)
  })
  for (const item of clipped) add('panel-clipped', 'MEDIUM', `${item.cls}: client=${item.clientH} scroll=${item.scrollH} overflowY=${item.overflowY}`)

  // ---------- D. gate badge vs latest evaluation ----------
  const gateBadge = await page.evaluate(() => {
    const text = document.querySelector('.po-lifecycle-page')?.textContent ?? ''
    const badge = /未评估/.test(text)
    const failure = /门禁未通过/.test(text)
    return { badge, failure }
  })
  if (gateBadge.badge && gateBadge.failure) add('gate-status-contradiction', 'HIGH', '面板同时显示「未评估」与「门禁未通过」')

  // ---------- E. light theme control consistency ----------
  await setTheme('light')
  for (const path of ['versions', 'deployments', 'connections']) {
    await go(`#/projects/${project.id}/${path}`)
    await page.waitForTimeout(900)
    const controls = await page.evaluate(() => {
      const sample = (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const style = getComputedStyle(el)
        return { bg: style.backgroundColor, border: style.borderColor, radius: style.borderRadius, h: Math.round(el.getBoundingClientRect().height) }
      }
      return { select: sample('.ant-select-selector'), input: sample('.ant-input'), button: sample('.ant-btn') }
    })
    const heights = [controls.select?.h, controls.input?.h].filter((value) => typeof value === 'number')
    if (heights.length === 2 && Math.abs(heights[0] - heights[1]) > 4) {
      add('control-height-mismatch', 'LOW', `${path}: select=${heights[0]}px input=${heights[1]}px`)
    }
    await page.screenshot({ path: join(shots, `p25-audit-${path}-light.png`) })
  }

  // ---------- F. 1024 layout overflow ----------
  await go(`#/projects/${project.id}/deployments?version=${versionId}`)
  await page.waitForSelector('.dc-shell', { timeout: 20_000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1024, 768))
  await page.waitForTimeout(700)
  const overflow = await page.evaluate(() => ({
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
    consoleScroll: document.querySelector('.dc-shell')?.scrollWidth ?? null,
    consoleClient: document.querySelector('.dc-shell')?.clientWidth ?? null,
  }))
  if (overflow.docScroll > overflow.docClient + 2) add('horizontal-overflow-1024', 'HIGH', JSON.stringify(overflow))
  await page.screenshot({ path: join(shots, 'p25-audit-1024.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
  await page.waitForTimeout(400)

  console.log('\n===== PHASE 2.5 UI AUDIT =====')
  const counts = findings.reduce((acc, item) => ({ ...acc, [item.severity]: (acc[item.severity] ?? 0) + 1 }), {})
  console.log(JSON.stringify(counts))
  console.log(`findings=${findings.length}`)
} finally {
  await app.close().catch(() => undefined)
}
