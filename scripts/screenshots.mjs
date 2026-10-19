import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const outDir = join(root, 'docs', 'screenshots')
mkdirSync(outDir, { recursive: true })
mkdirSync(join(root, 'test-results'), { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-shots-'))
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')

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
  const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: desktopDir, env, timeout: 30_000 })
  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.waitForSelector('.po-project-card, .po-empty-title', { timeout: 30_000 })
  return { app, page }
}

async function setTheme(page, theme) {
  const current = await page.evaluate(() => document.documentElement.dataset.theme)
  if (current === theme) return
  await page.click('button[aria-label="主题"]')
  const label = theme === 'light' ? '浅色' : '深色'
  await page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: label }).click()
  await page.waitForFunction((expected) => document.documentElement.dataset.theme === expected, theme)
  await page.waitForTimeout(350)
}

async function navigate(page, hash, waitFor) {
  await page.evaluate((nextHash) => {
    location.hash = nextHash
  }, hash)
  await page.waitForTimeout(1_200)
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30_000 })
  await page.waitForTimeout(500)
}

async function capture(page, size, theme, name) {
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined))
  await page.mouse.move(2, 2)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  if (overflow) throw new Error(`${size}-${theme}-${name}: horizontal overflow detected`)
  const file = join(outDir, `${size}-${theme}-${name}.png`)
  await page.screenshot({ path: file })
  const bytes = statSync(file).size
  if (bytes < 8_000) throw new Error(`${size}-${theme}-${name}: screenshot looks empty (${bytes} bytes)`)
  captured.push(file)
  console.log(`  captured ${size}-${theme}-${name} (${Math.round(bytes / 1024)} KB)`)
}

async function runViewport(width, height) {
  const size = `${width}x${height}`
  const { app, page } = await launch(width, height)
  try {
    if (width > 1179) {
      const initiallyCollapsed = await page.evaluate(() =>
        document.querySelector('.po-shell')?.classList.contains('is-collapsed'),
      )
      if (initiallyCollapsed) {
        await page.locator('.po-titlebar-left > .po-icon-button').click()
        await page.waitForTimeout(400)
      }
    }
    await setTheme(page, 'light')
    await page.waitForTimeout(600)
    const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
    await page.evaluate(async () => {
      const list = await window.projectos.aiConnections.list()
      if (list.connections.length === 0) {
        await window.projectos.aiConnections.create({
          name: 'DeepSeek',
          providerId: 'deepseek',
          protocol: 'openai-chat',
          backendKind: 'native-llm',
          baseUrl: 'https://api.deepseek.com/v1',
          apiKey: 'sk-demo-not-a-real-key',
          defaultModelId: 'deepseek-chat',
          enabled: true,
          isDefault: true,
        })
      }
    })

    await navigate(page, '#/')
    await capture(page, size, 'light', 'project-center')
    await navigate(page, `#/projects/${projectId}`, '.po-overview-page')
    await capture(page, size, 'light', 'overview')
    await navigate(page, `#/projects/${projectId}/tasks`, '.po-task-tile')
    await capture(page, size, 'light', 'tasks')
    await navigate(page, `#/projects/${projectId}/knowledge`, '.po-knowledge-search')
    await page.waitForTimeout(500)
    await capture(page, size, 'light', 'knowledge')
    await navigate(page, `#/projects/${projectId}/operations`, '.po-operations-grid')
    await page.waitForTimeout(500)
    await capture(page, size, 'light', 'operations')
    await navigate(page, `#/projects/${projectId}/orchestration`, '.po-orchestration-page')
    await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
    await page.waitForTimeout(1_100)
    await capture(page, size, 'light', 'orchestration')
    await navigate(page, `#/projects/${projectId}/agents`, '.po-session-row')
    const kaiSession = page.locator('.po-session-row').filter({ hasText: 'Kai · 图谱视图实现' })
    if ((await kaiSession.count()) > 0) {
      await kaiSession.first().click()
      await page.waitForTimeout(900)
    }
    await capture(page, size, 'light', 'agent-workbench')
    await navigate(page, `#/projects/${projectId}/collaboration`, '.po-inbox-row')
    await capture(page, size, 'light', 'cross-session')
    await navigate(page, `#/projects/${projectId}/workspace`, '.monaco-editor')
    await page.waitForTimeout(800)
    await capture(page, size, 'light', 'workspace')
    await navigate(page, `#/projects/${projectId}/runs`, '.po-run-detail-panel')
    await capture(page, size, 'light', 'runs')

    await page.locator('.po-nav-item').filter({ hasText: '设置' }).last().click()
    await page.waitForSelector('.po-settings-dialog')
    await page.waitForTimeout(700)
    await capture(page, size, 'light', 'settings')
    await page.getByRole('button', { name: '新增连接' }).first().click()
    await page.waitForSelector('.po-ai-editor', { timeout: 10_000 })
    await page.waitForTimeout(350)
    await capture(page, size, 'light', 'settings-connection-editor')
    await page.locator('.po-ai-editor-top button').first().click()
    if (size.startsWith('1440')) {
      await page.locator('.po-settings-nav-item').filter({ hasText: 'Agent 路由' }).click()
      await page.waitForTimeout(400)
      await capture(page, size, 'light', 'settings-routing')
    }
    await page.locator('.po-settings-nav-item').filter({ hasText: '模型目录' }).click()
    await page.waitForTimeout(500)
    await capture(page, size, 'light', 'settings-models')
    await page.locator('.po-settings-modal .ant-modal-close').click()
    await page.waitForTimeout(300)

    const wasCollapsed = await page.evaluate(() => document.querySelector('.po-shell')?.classList.contains('is-collapsed'))
    if (width > 1179) {
      if (!wasCollapsed) {
        await page.locator('.po-titlebar-left > .po-icon-button').click()
        await page.waitForTimeout(450)
      }
      await capture(page, size, 'light', 'sidebar-collapsed')
      await page.locator('.po-titlebar-left > .po-icon-button').click()
      await page.waitForTimeout(300)
    } else {
      await capture(page, size, 'light', 'sidebar-collapsed')
    }

    await setTheme(page, 'dark')
    await navigate(page, `#/projects/${projectId}`, '.po-overview-page')
    await capture(page, size, 'dark', 'overview')
    await navigate(page, `#/projects/${projectId}/tasks`, '.po-task-tile')
    await capture(page, size, 'dark', 'tasks')
    await navigate(page, `#/projects/${projectId}/agents`, '.po-session-row')
    const kaiDark = page.locator('.po-session-row').filter({ hasText: 'Kai · 图谱视图实现' })
    if ((await kaiDark.count()) > 0) {
      await kaiDark.first().click()
      await page.waitForTimeout(900)
    }
    await capture(page, size, 'dark', 'agent-workbench')
    await navigate(page, `#/projects/${projectId}/collaboration`, '.po-inbox-row')
    await capture(page, size, 'dark', 'cross-session')
    await navigate(page, `#/projects/${projectId}/workspace`, '.monaco-editor')
    await page.waitForTimeout(800)
    await capture(page, size, 'dark', 'workspace')
    await navigate(page, `#/projects/${projectId}/orchestration`, '.po-orchestration-page')
    await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
    await page.waitForTimeout(900)
    await capture(page, size, 'dark', 'orchestration')
    await navigate(page, `#/projects/${projectId}/operations`, '.po-operations-grid')
    await page.waitForTimeout(500)
    await capture(page, size, 'dark', 'operations')

    await page.locator('.po-nav-item').filter({ hasText: '设置' }).last().click()
    await page.waitForSelector('.po-settings-dialog')
    await page.waitForTimeout(700)
    await capture(page, size, 'dark', 'settings')
    await page.locator('.po-settings-modal .ant-modal-close').click()
    await page.waitForTimeout(300)
    const collapsedNow = await page.evaluate(() => document.querySelector('.po-shell')?.classList.contains('is-collapsed'))
    if (width > 1179) {
      if (!collapsedNow) {
        await page.locator('.po-titlebar-left > .po-icon-button').click()
        await page.waitForTimeout(450)
      }
      await capture(page, size, 'dark', 'sidebar-collapsed')
      await page.locator('.po-titlebar-left > .po-icon-button').click()
      await page.waitForTimeout(300)
    } else {
      await capture(page, size, 'dark', 'sidebar-collapsed')
    }
  } finally {
    await app.close().catch(() => undefined)
  }
}

try {
  console.log('Capturing 1440x900…')
  await runViewport(1440, 900)
  console.log('Capturing 1024x768…')
  await runViewport(1024, 768)
  if (consoleErrors.length > 0) throw new Error(`renderer console errors: ${consoleErrors.join(' | ')}`)
  console.log(`SCREENSHOTS PASS — ${captured.length} images written to docs/screenshots`)
  rmSync(dataDir, { recursive: true, force: true })
} catch (error) {
  console.error('SCREENSHOTS FAIL —', error instanceof Error ? error.message : error)
  console.error(`  data kept for inspection: ${dataDir}`)
  process.exitCode = 1
}

if (!existsSync(outDir)) process.exitCode = 1



