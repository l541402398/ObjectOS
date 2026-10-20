import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const exe = resolve(root, 'release', 'win-unpacked', 'ProjectOS.exe')
const runtime = resolve(root, 'release', 'win-unpacked', 'resources', 'runtime', 'index.mjs')
if (!existsSync(exe) || !existsSync(runtime)) {
  console.error('Packaged app not found. Run `pnpm package:dir` first.')
  process.exit(1)
}

const dataDir = mkdtempSync(join(tmpdir(), 'projectos-package-'))
const workspaceDir = join(dataDir, 'created-project')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE

let app = null
let passed = false
try {
  app = await electron.launch({ executablePath: exe, args: [], env, timeout: 60_000 })
  let page = await app.firstWindow()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForSelector('.po-empty-title, .v16-project-visual', { timeout: 60_000 })
  await page.getByRole('button', { name: /新建项目/ }).first().click()
  await page.getByLabel('项目名称').fill('Packaged Project')
  await page.getByLabel('项目描述').fill('Created from the packaged Windows executable')
  await page.getByLabel('项目根目录').fill(workspaceDir)
  await page.getByRole('button', { name: '创建项目' }).click()
  await page.waitForFunction(
    () => document.querySelector('.po-page-title')?.textContent?.includes('Packaged Project'),
    null,
    { timeout: 30_000 },
  )
  const readme = readFileSync(join(workspaceDir, 'README.md'), 'utf8')
  if (!readme.includes('Packaged Project')) throw new Error('packaged app did not create starter files')
  await app.close()
  app = null

  app = await electron.launch({ executablePath: exe, args: [], env, timeout: 60_000 })
  page = await app.firstWindow()
  await page.waitForSelector('.v16-project-visual', { timeout: 60_000 })
  const card = await page.locator('.v16-project-visual').first().innerText()
  if (!card.includes('Packaged Project')) throw new Error('packaged app did not persist the project')
  if (errors.length > 0) throw new Error(`renderer errors: ${errors.join(' | ')}`)
  console.log('PACKAGE SMOKE PASS — packaged EXE creates a project, writes starter files and recovers after restart.')
  console.log(`  executable: ${exe}`)
  console.log(`  runtime: ${runtime}`)
  passed = true
} catch (error) {
  console.error('PACKAGE SMOKE FAIL —', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  if (passed) {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // best-effort temp cleanup on Windows
    }
  } else {
    console.error(`  data kept for inspection: ${dataDir}`)
  }
}

