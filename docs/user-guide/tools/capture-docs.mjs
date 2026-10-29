/**
 * ProjectOS 用户手册 — 真实 Electron 截图采集入口。
 *
 * 用法：
 *   node docs/user-guide/tools/capture-docs.mjs                      # 全部流程，新隔离环境
 *   node docs/user-guide/tools/capture-docs.mjs --flows=01,02        # 只跑指定流程
 *   node docs/user-guide/tools/capture-docs.mjs --data=<dir>         # 复用已准备的数据目录（可续跑）
 *   node docs/user-guide/tools/capture-docs.mjs --no-provider        # 完全不预置 AI 连接（用于“全新安装”画面）
 *
 * 产物：
 *   docs/user-guide/assets/screenshots/<shot>.png
 *   docs/user-guide/_evidence/capture-manifest.json   （截图 ↔ 步骤 ↔ 标注框）
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { prepareUserData, prepareWorkspace, seedProvider } from './env.mjs'
import { runFlow, sleep } from './flow-runner.mjs'

const root = process.cwd()
const argv = process.argv.slice(2)
const flag = (name) => argv.find((item) => item.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const has = (name) => argv.includes(`--${name}`)

const flowsDir = join(root, 'docs', 'user-guide', 'flows')
const shotsDir = join(root, 'docs', 'user-guide', 'assets', 'screenshots')
const evidenceDir = join(root, 'docs', 'user-guide', '_evidence')
mkdirSync(shotsDir, { recursive: true })
mkdirSync(evidenceDir, { recursive: true })

const dataDir = flag('data') ?? mkdtempSync(join(tmpdir(), 'projectos-guide-'))
mkdirSync(dataDir, { recursive: true })
const workspaceDir = join(dataDir, 'aurora-notes')
if (!existsSync(workspaceDir)) {
  prepareWorkspace(join(root, 'docs', 'user-guide', 'fixtures', 'aurora-notes'), workspaceDir)
  const git = (...args) => execFileSync('git', args, { cwd: workspaceDir, encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 'demo@example.com')
  git('config', 'user.name', 'Demo User')
  git('add', '.')
  git('commit', '-q', '-m', 'chore: aurora-notes 基线')
}
if (!has('no-provider') && !existsSync(join(dataDir, 'provider.json'))) seedProvider(dataDir)
const userData = prepareUserData(dataDir)

const requested = flag('flows')?.split(',').filter(Boolean)
const files = readdirSync(flowsDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => JSON.parse(readFileSync(join(flowsDir, file), 'utf8')))
  .filter((flow) => !requested || requested.includes(flow.id.split('-')[0]))
  .sort((a, b) => a.order - b.order)

for (const flow of files) {
  flow.steps = flow.steps.map((step) => ({
    ...step,
    do: (step.do ?? []).map((action) =>
      JSON.parse(JSON.stringify(action).replaceAll('__WORKSPACE__', workspaceDir.replaceAll('\\', '\\\\'))),
    ),
  }))
}

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

const manifestPath = join(evidenceDir, 'capture-manifest.json')
const manifest = {
  path: manifestPath,
  data: { generatedAt: new Date().toISOString(), dataDir, workspaceDir, flows: [] },
  flows: [],
}

const consoleErrors = []
let app = null
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userData}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.waitForSelector('.po-empty-title, .v16-project-visual, .po-page-title', { timeout: 90_000 })
  await sleep(1500)

  for (const flow of files) {
    console.log(`\n[flow] ${flow.id} ${flow.title}`)
    await runFlow(page, flow, { shotsDir, manifest })
  }

  manifest.data.consoleErrors = consoleErrors
  writeFileSync(manifestPath, JSON.stringify(manifest.data, null, 2), 'utf8')
  console.log(`\n[manifest] ${manifestPath}`)
  console.log(`[console] ${consoleErrors.length} errors`)
} catch (error) {
  console.error('\n[capture] FAIL', error)
  try {
    const page = await app?.firstWindow()
    if (page) await page.screenshot({ path: join(evidenceDir, 'failure.png') })
  } catch {
    // ignore
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  console.log(`[data] ${dataDir}`)
}
