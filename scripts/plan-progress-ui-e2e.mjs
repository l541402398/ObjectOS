import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'plan-progress')
mkdirSync(shots, { recursive: true })
const providerPath = join(process.env.APPDATA ?? '', 'ProjectOS', 'data', 'provider.json')
if (!existsSync(providerPath)) { console.log('SKIPPED (blocked): no provider config'); process.exit(0) }
const provider = JSON.parse(readFileSync(providerPath, 'utf8'))
if (!provider.encryptedApiKey) { console.log('SKIPPED (blocked): no encrypted key'); process.exit(0) }
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-progress-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-progress-user-'))
writeFileSync(join(dataDir, 'provider.json'), JSON.stringify({ ...provider, connectionsMigrated: false }, null, 2))
const localState = join(process.env.APPDATA ?? '', 'ProjectOS', 'Local State')
if (existsSync(localState)) copyFileSync(localState, join(userDataDir, 'Local State'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app = null
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForTimeout(3600)
  const workspace = join(dataDir, 'progress-project')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'progress-project', private: true }, null, 2))
  writeFileSync(join(workspace, 'README.md'), '# progress\n')
  const project = await page.evaluate(async ({ workspace }) => (await window.projectos.projects.create({ name: 'Progress Project', description: '', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  await page.evaluate((id) => { location.hash = `#/projects/${id}/orchestration` }, project.id)
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.getByRole('button', { name: '生成计划' }).click()
  await page.waitForSelector('.po-plan-modal textarea', { timeout: 10_000 })
  await page.locator('.po-plan-modal textarea').fill('把游戏 7 层地图替换为每层不同风格')
  await page.locator('[data-testid="plan-generate"]').click()
  await page.waitForSelector('[data-testid="plan-generate-progress"]', { timeout: 10_000 })
  await page.waitForTimeout(1600)
  const progress = await page.locator('[data-testid="plan-generate-progress"]').innerText()
  const elapsed = Number(progress.match(/已等待\s+(\d+)s/)?.[1] ?? -1)
  const dots = await page.locator('.po-plan-progress-dots i').count()
  const track = await page.locator('.po-plan-progress-track i').count()
  const spinnerAnimation = await page.locator('.po-plan-actions .ant-btn-loading-icon .anticon').first().evaluate((el) => getComputedStyle(el).animationName)
  await page.screenshot({ path: join(shots, 'plan-progress.png') })
  const checks = [
    ['progress status is visible while generating', progress.includes('已等待') && progress.includes('正在')],
    ['elapsed timer advances', elapsed >= 1],
    ['animated dots are present', dots === 3],
    ['progress track is present', track === 1],
    ['Ant loading icon has an animation', spinnerAnimation !== 'none'],
  ]
  for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (checks.some(([, ok]) => !ok)) process.exitCode = 1
  else console.log(`\nPLAN PROGRESS UI PASS — ${checks.length} checks, elapsed=${elapsed}s`)
} catch (error) {
  console.error('PLAN PROGRESS UI FAIL —', error)
  if (app) { try { const p = await app.firstWindow(); await p.screenshot({ path: join(shots, 'failure.png') }) } catch { /* ignore */ } }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
