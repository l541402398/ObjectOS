import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
mkdirSync('test-results', { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-e2e-'))
const workspaceDir = join(dataDir, 'my-project')
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')
const baseEnv = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete baseEnv.ELECTRON_RUN_AS_NODE

let activeApp = null
const consoleErrors = []

async function launch() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: desktopDir,
    env: baseEnv,
    timeout: 30_000,
  })
  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  activeApp = app
  return { app, page }
}

async function close(app) {
  try {
    await app.close()
  } catch {
    // The app may already be shutting down.
  }
  activeApp = null
}

try {
  let { app, page } = await launch()
  await page.waitForSelector('.po-empty-title, .po-project-card', { timeout: 30_000 })
  await page.getByRole('button', { name: /新建项目/ }).first().click()
  await page.getByLabel('项目名称').fill('E2E Local Project')
  await page.getByLabel('项目描述').fill('Created by the automated restart-recovery test')
  await page.getByLabel('项目根目录').fill(workspaceDir)
  await page.getByRole('button', { name: '创建项目' }).click()
  await page.waitForFunction(
    () => document.querySelector('.po-page-title')?.textContent?.includes('E2E Local Project'),
    null,
    { timeout: 25_000 },
  )
  const readme = readFileSync(join(workspaceDir, 'README.md'), 'utf8')
  if (!readme.includes('E2E Local Project')) throw new Error('starter README was not created')
  await close(app)

  ;({ app, page } = await launch())
  await page.waitForSelector('.po-project-card', { timeout: 30_000 })
  const cardText = await page.locator('.po-project-card').first().innerText()
  if (!cardText.includes('E2E Local Project')) throw new Error('project did not survive restart')
  await page.locator('.po-project-card').first().click()
  await page.waitForFunction(
    () => document.querySelector('.po-page-title')?.textContent?.includes('E2E Local Project'),
    null,
    { timeout: 25_000 },
  )
  await close(app)

  if (consoleErrors.length > 0) {
    throw new Error(`renderer console errors: ${consoleErrors.join(' | ')}`)
  }
  console.log('E2E PASS — create project through the desktop UI and recover it after restart (T-001).')
  console.log(`  project root: ${workspaceDir}`)
  rmSync(dataDir, { recursive: true, force: true })
} catch (error) {
  console.error('E2E FAIL —', error instanceof Error ? error.message : error)
  if (activeApp) {
    try {
      const page = await activeApp.firstWindow()
      await page.screenshot({ path: 'test-results/e2e-failure.png' })
    } catch {
      // best effort
    }
    await close(activeApp)
  }
  console.error(`  data kept for inspection: ${dataDir}`)
  process.exitCode = 1
} finally {
  if (activeApp) await close(activeApp)
  if (existsSync('test-results/e2e-failure.png')) {
    // keep failure screenshot only
  } else {
    try {
      unlinkSync('test-results/e2e-failure.png')
    } catch {
      // ignore
    }
  }
}
