/**
 * UX Refactor Consolidation Fixes — Native Electron Visual, A11y & Flow Verification.
 *
 * Captures 1440x900, 1024x768, light & dark, and 125% zoom screenshots across the
 * consolidated surfaces, runs axe-core + native compositor contrast sampling, and
 * verifies deep-link + return-origin navigation between Home / Overview / Runs and
 * the Review Room.
 */
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { compositeContrast } from '../../../../../scripts/lib/premium-contrast.mjs'

const root = process.cwd()
const outDir = resolve(root, 'docs/v2/evidence/ux-refactor-fixes/screenshots')
mkdirSync(outDir, { recursive: true })

const dataDir = mkdtempSync(join(tmpdir(), 'projectos-ux-refactor-evidence-'))
const electronPath = [
  resolve(root, 'node_modules/electron/dist/electron.exe'),
  resolve(root, 'node_modules/electron/dist/electron'),
].find((candidate) => existsSync(candidate))
if (!electronPath) throw new Error('electron binary not found')

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_SEED_DEMO_REVIEW_QUEUE: '1',
  PROJECTOS_SEED_DEMO_REVIEW_HISTORY: '1',
  PROJECTOS_SEED_DEMO_RESOURCES: '1',
  PROJECTOS_SEED_DEMO_FLOW: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

const checks = []
const consoleErrors = []
const audits = []

function record(name, pass, detail = '') {
  checks.push({ name, status: pass ? 'PASS' : 'FAIL', detail })
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!pass) throw new Error(`Check failed: ${name} (${detail})`)
}

let app
try {
  app = await electron.launch({
    executablePath: electronPath,
    cwd: resolve(root, 'apps/desktop'),
    args: ['.', `--user-data-dir=${join(dataDir, 'electron-user')}`],
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  const win = await app.browserWindow(page)
  page.on('pageerror', (err) => consoleErrors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.evaluate(() => document.fonts.ready)
  const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
  record('Demo project loaded', Boolean(projectId), projectId)

  const setViewport = async (width, height, zoom = 1) => {
    await win.evaluate((w, v) => {
      w.setContentSize(v.width, v.height)
      w.webContents.setZoomFactor(v.zoom)
    }, { width, height, zoom })
    await page.waitForTimeout(350)
  }

  const setTheme = async (mode) => {
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' })
    const current = await page.evaluate(() => document.documentElement.dataset.theme)
    if (current !== mode) {
      await page.click('button[aria-label="主题"]')
      await page
        .locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item')
        .filter({ hasText: mode === 'light' ? '浅色' : '深色' })
        .click()
      await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, mode)
      await page.waitForTimeout(350)
    }
  }

  const capture = async (name) => {
    await page.mouse.move(4, 4)
    await page.waitForTimeout(250)
    const file = join(outDir, `${name}.webp`)
    // Capture PNG via Playwright and convert via canvas to compact WebP so repo size stays small
    const pngBase64 = (await page.screenshot({ type: 'png' })).toString('base64')
    const webpBase64 = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bmp.width
      canvas.height = bmp.height
      canvas.getContext('2d').drawImage(bmp, 0, 0)
      bmp.close()
      return canvas.toDataURL('image/webp', 0.88).split(',')[1]
    }, pngBase64)
    writeFileSync(file, Buffer.from(webpBase64, 'base64'))
    const kb = Math.round(statSync(file).size / 1024)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
    record(`Capture ${name}`, !overflow && kb >= 4, `${kb} KB`)
  }

  const runAxeAndContrast = async (label, scopeSelector) => {
    await page.evaluate(axeSource)
    const axeRes = await page.evaluate(async (sel) => {
      const target = document.querySelector(sel) ?? document.querySelector('.po-shell')
      const r = await window.axe.run(target, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      })
      return {
        passes: r.passes.length,
        violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length })),
      }
    }, scopeSelector)
    const contrast = await compositeContrast(page, win, scopeSelector)
    audits.push({
      label,
      axePasses: axeRes.passes,
      axeViolations: axeRes.violations,
      contrastSamples: contrast.count,
      contrastMin: Number(contrast.minimum.toFixed(2)),
      contrastBelow45: contrast.failures.length,
    })
    record(`${label} axe WCAG AA`, axeRes.violations.length === 0, JSON.stringify(axeRes.violations))
  }

  // 1. Functional flow verification: Overview KPI (<button>) -> Review Room (?return=overview) -> Back to Overview
  await setViewport(1440, 900, 1)
  await setTheme('light')
  await page.evaluate((pid) => { location.hash = `#/projects/${pid}/overview` }, projectId)
  await page.waitForSelector('.po-overview-page .kpi-rail', { timeout: 30_000 })
  await page.waitForTimeout(500)
  const kpiTag = await page.evaluate(() => document.querySelector('.kpi-rail button.kpi-block')?.tagName ?? '')
  record('KpiRail interactive block renders as native <button>', kpiTag === 'BUTTON', kpiTag)
  await page.locator('.kpi-rail button.kpi-block').filter({ hasText: '待授权' }).click()
  await page.waitForSelector('.rv-room', { timeout: 20_000 })
  const backOverviewText = await page.locator('.rv-room .studio-back, .rv-room header button, .rv-room header a').first().innerText()
  record('Overview -> Review Room preserves return=overview back label', backOverviewText.includes('返回项目姿态'), backOverviewText)
  await page.locator('.rv-room').getByRole('button', { name: /返回项目姿态/ }).click()
  await page.waitForSelector('.po-overview-page', { timeout: 15_000 })
  record('Review Room back button returns to 项目态势', true)

  // 2. Functional flow verification: Runs banner -> Review Room (?return=runs) -> Back to Runs
  await page.evaluate((pid) => { location.hash = `#/projects/${pid}/runs` }, projectId)
  await page.waitForSelector('.ra-page .ra-await', { timeout: 20_000 })
  await page.locator('.ra-await').click()
  await page.waitForSelector('.rv-room', { timeout: 20_000 })
  const backRunsVisible = await page.locator('.rv-room').getByRole('button', { name: /返回运行审计/ }).isVisible()
  record('Runs -> Review Room preserves return=runs back button', backRunsVisible)
  await page.locator('.rv-room').getByRole('button', { name: /返回运行审计/ }).click()
  await page.waitForSelector('.ra-page', { timeout: 15_000 })
  record('Review Room back button returns to 运行审计', true)

  // 3. Functional flow verification: Home approval row carries ?approval=<id>
  await page.evaluate((pid) => { location.hash = `#/projects/${pid}` }, projectId)
  await page.waitForSelector('.studio-workbench', { timeout: 20_000 })
  await page.getByRole('tab', { name: /待审批/ }).click()
  await page.waitForSelector('.studio-approval-row', { timeout: 10_000 })
  await page.locator('.studio-approval-row').first().click()
  await page.waitForSelector('.rv-room', { timeout: 15_000 })
  const hashHasApproval = await page.evaluate(() => location.hash.includes('approval='))
  record('Home approval row deep-links ?approval=<id>', hashHasApproval, await page.evaluate(() => location.hash))

  // 4. Multi-viewport, light/dark & 125% screenshot matrix across key refactored surfaces
  const routes = [
    { name: 'home', hash: `#/projects/${projectId}`, wait: '.studio-workbench', scope: '.studio-workbench' },
    { name: 'review-pending', hash: `#/projects/${projectId}/approvals`, wait: '.rv-room .rv-sheet', scope: '.rv-room' },
    { name: 'review-history', hash: `#/projects/${projectId}/approvals?lens=history`, wait: '.rv-layout.is-history', scope: '.rv-room' },
    { name: 'requirements', hash: `#/projects/${projectId}/requirements`, wait: '.rq-page', scope: '.rq-page', openCriteria: true },
    { name: 'overview', hash: `#/projects/${projectId}/overview`, wait: '.po-overview-page', scope: '.po-overview-page' },
    { name: 'tasks', hash: `#/projects/${projectId}/tasks`, wait: '.po-board-columns, .po-page', scope: '.po-page' },
    { name: 'runs', hash: `#/projects/${projectId}/runs`, wait: '.ra-page', scope: '.ra-page' },
    { name: 'versions', hash: `#/projects/${projectId}/versions`, wait: '.po-lifecycle-page', scope: '.po-lifecycle-page' },
    { name: 'resources', hash: `#/projects/${projectId}/connections`, wait: '.rh-page', scope: '.rh-page' },
  ]

  const configs = [
    { tag: '1440-light', width: 1440, height: 900, zoom: 1, theme: 'light', audit: true },
    { tag: '1440-dark', width: 1440, height: 900, zoom: 1, theme: 'dark', audit: true },
    { tag: '1024-light', width: 1024, height: 768, zoom: 1, theme: 'light', audit: false },
    { tag: '1024-dark', width: 1024, height: 768, zoom: 1, theme: 'dark', audit: false },
    { tag: '1440-125-light', width: 1440, height: 900, zoom: 1.25, theme: 'light', audit: false },
    { tag: '1440-125-dark', width: 1440, height: 900, zoom: 1.25, theme: 'dark', audit: false },
  ]

  for (const cfg of configs) {
    await setViewport(cfg.width, cfg.height, cfg.zoom)
    await setTheme(cfg.theme)
    for (const route of routes) {
      // Keep 1024 & 125 focused on the 5 core touched surfaces so total frame count stays sharp & reviewable
      if (!cfg.audit && !['home', 'review-pending', 'requirements', 'overview', 'versions'].includes(route.name)) {
        continue
      }
      await page.evaluate((h) => { location.hash = h }, route.hash)
      await page.waitForSelector(route.wait, { timeout: 30_000 })
      await page.waitForTimeout(550)
      if (route.openCriteria) {
        const toggle = page.locator('.rq-criteria-toggle:not(:disabled)')
        if (await toggle.count()) {
          const expanded = await toggle.first().getAttribute('aria-expanded')
          if (expanded !== 'true') {
            await toggle.first().click()
            await page.waitForTimeout(250)
          }
        }
      }
      await capture(`${cfg.tag}-${route.name}`)
      if (cfg.audit && ['review-pending', 'requirements', 'overview', 'versions'].includes(route.name)) {
        await runAxeAndContrast(`${cfg.tag}-${route.name}`, route.scope)
      }
    }
  }

  // Protected Design Lab baseline capture (1440 light & dark)
  await setViewport(1440, 900, 1)
  await page.evaluate(() => { location.hash = '#/design-lab' })
  await page.waitForSelector('[data-testid="design-lab-dag"]', { timeout: 30_000 })
  await page.waitForTimeout(900)
  await capture('1440-light-design-lab-dag')
  await page.getByRole('button', { name: '切换到暗色', exact: true }).click()
  await page.waitForTimeout(350)
  await capture('1440-dark-design-lab-dag')

  record('Zero uncaught renderer errors', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '))

  writeFileSync(
    resolve(root, 'docs/v2/evidence/ux-refactor-fixes/checks.json'),
    JSON.stringify({ checks, audits, consoleErrors }, null, 2),
  )
  console.log(`UX REFACTOR EVIDENCE PASS — ${checks.length} checks, ${audits.length} audits`)
} finally {
  try { await app?.close() } catch { /* ignore */ }
  rmSync(dataDir, { recursive: true, force: true })
}
