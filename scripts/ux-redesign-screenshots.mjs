import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const outDir = resolve('/workspace/objectos-ux/redesign')
const docsDir = join(root, 'docs', 'ux', 'redesign')
mkdirSync(outDir, { recursive: true })
mkdirSync(docsDir, { recursive: true })
mkdirSync(join(root, 'test-results'), { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-ux-shots-'))

const candidates = [
  resolve(root, 'node_modules/electron/dist/electron'),
  resolve(root, 'node_modules/.pnpm/electron@44.9.0/node_modules/electron/dist/electron'),
  resolve(root, 'node_modules/electron/dist/electron.exe'),
]
const electronPath = candidates.find((p) => existsSync(p))
if (!electronPath) throw new Error('Electron binary not found')
const desktopDir = resolve(root, 'apps/desktop')
console.log('using electron', electronPath)

const consoleErrors = []
const captured = []

async function launch(width, height) {
  const env = {
    ...process.env,
    PROJECTOS_DATA_DIR: dataDir,
    PROJECTOS_SEED_DEMO: '1',
    PROJECTOS_WINDOW_WIDTH: String(width),
    PROJECTOS_WINDOW_HEIGHT: String(height),
  }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--no-sandbox', '--disable-gpu'],
    cwd: desktopDir,
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.waitForSelector('.po-project-card, .po-empty-title, .po-shell', { timeout: 60_000 })
  return { app, page }
}

async function setTheme(page, theme) {
  const current = await page.evaluate(() => document.documentElement.dataset.theme)
  if (current === theme) return
  await page.click('button[aria-label="主题"]')
  const label = theme === 'light' ? '浅色' : '深色'
  await page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: label }).click()
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme)
  await page.waitForTimeout(400)
}

async function navigate(page, hash, waitFor) {
  await page.evaluate((nextHash) => {
    location.hash = nextHash
  }, hash)
  await page.waitForTimeout(1_200)
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 45_000 })
  await page.waitForTimeout(600)
}

async function capture(page, theme, name) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await page.mouse.move(2, 2)
  const file = join(outDir, `1440x900-${theme}-${name}.png`)
  await page.screenshot({ path: file })
  const bytes = statSync(file).size
  if (bytes < 8_000) throw new Error(`${theme}-${name}: screenshot looks empty (${bytes} bytes)`)
  copyFileSync(file, join(docsDir, `1440x900-${theme}-${name}.png`))
  captured.push(file)
  console.log(`  captured ${theme}-${name} (${Math.round(bytes / 1024)} KB)`)
}

async function seedNextActions(page, projectId) {
  // Force a visible next-action rail by injecting a pending-looking plan draft if none exist.
  await page.evaluate(async (pid) => {
    try {
      const plans = await window.projectos.plans.list({ projectId: pid })
      if (!plans.plans?.length) {
        // best-effort: create a draft plan if API exists
        if (window.projectos.plans.generate) {
          await window.projectos.plans.generate({ projectId: pid, goal: 'UX redesign visual seed: 实现合并门与授权流' })
        }
      }
    } catch (error) {
      console.warn('seed plans skipped', String(error))
    }
  }, projectId)
}

async function main() {
  const { app, page } = await launch(1440, 900)
  try {
    const initiallyCollapsed = await page.evaluate(() =>
      document.querySelector('.po-shell')?.classList.contains('is-collapsed'),
    )
    if (initiallyCollapsed) {
      await page.locator('.po-titlebar-left > .po-icon-button').click()
      await page.waitForTimeout(400)
    }

    const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
    await seedNextActions(page, projectId)

    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme)
      await navigate(page, `#/projects/${projectId}/orchestration`, '.po-orchestration-page')
      await page.waitForSelector('.po-task-flow, .react-flow__node', { timeout: 30_000 })
      await page.waitForTimeout(1_200)
      await capture(page, theme, 'orchestration-flow')

      // Zoom to task flow / merge gate region if present
      const flow = page.locator('.po-task-flow')
      if ((await flow.count()) > 0) {
        await flow.first().scrollIntoViewIfNeeded()
        await page.waitForTimeout(300)
        const box = await flow.first().boundingBox()
        if (box) {
          const file = join(outDir, `1440x900-${theme}-task-flow-detail.png`)
          await page.screenshot({ path: file, clip: { x: Math.max(0, box.x - 12), y: Math.max(0, box.y - 12), width: Math.min(1440, box.width + 24), height: Math.min(900, box.height + 24) } })
          copyFileSync(file, join(docsDir, `1440x900-${theme}-task-flow-detail.png`))
          captured.push(file)
          console.log(`  captured ${theme}-task-flow-detail`)
        }
      }

      await navigate(page, `#/projects/${projectId}/agents`, '.po-session-row, .po-page')
      await page.waitForTimeout(800)
      await capture(page, theme, 'approvals-workbench')

      await navigate(page, `#/projects/${projectId}/runs`, '.po-page')
      await page.waitForTimeout(700)
      await capture(page, theme, 'approvals-runs')

      // Overview often shows next-action bar when pending items exist
      await navigate(page, `#/projects/${projectId}`, '.po-page')
      await page.waitForTimeout(700)
      await capture(page, theme, 'next-action-overview')
    }

    console.log('\\nOK', captured.length, 'screenshots →', outDir)
    if (consoleErrors.length) {
      console.log('console errors (non-fatal):', consoleErrors.slice(0, 8))
    }
  } finally {
    await app.close().catch(() => {})
    rmSync(dataDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
