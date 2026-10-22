/**
 * Real-provider regression for long Planner output (7-layer map goal).
 * Verifies the 8k completion budget avoids the previous 4096-token truncation.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'planner-long-output')
mkdirSync(shots, { recursive: true })
const configPath = join(process.env.APPDATA ?? '', 'ProjectOS', 'data', 'provider.json')
if (!existsSync(configPath)) { console.log('SKIPPED (blocked): no provider config'); process.exit(0) }
const providerConfig = JSON.parse(readFileSync(configPath, 'utf8'))
if (!providerConfig.encryptedApiKey) { console.log('SKIPPED (blocked): no encrypted key'); process.exit(0) }
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-long-output-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-long-output-user-'))
writeFileSync(join(dataDir, 'provider.json'), JSON.stringify({ ...providerConfig, connectionsMigrated: false }, null, 2))
const localState = join(process.env.APPDATA ?? '', 'ProjectOS', 'Local State')
if (existsSync(localState)) copyFileSync(localState, join(userDataDir, 'Local State'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app = null
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForTimeout(3600)
  let connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  for (let i = 0; i < 20 && connections.connections.length === 0; i += 1) { await page.waitForTimeout(500); connections = await page.evaluate(async () => window.projectos.aiConnections.list()) }
  if (!connections.connections.length) throw new Error('connection missing')
  const workspace = join(dataDir, 'game')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'game', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, null, 2))
  writeFileSync(join(workspace, 'README.md'), '# 7-layer game map\n')
  const project = await page.evaluate(async ({ workspace }) => (await window.projectos.projects.create({ name: 'Long Planner 7 Layers', description: '7 层地图，每层不同风格', rootPath: workspace, createDirectory: false, initGit: false })).project, { workspace })
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  const settingsBefore = await page.evaluate(async () => window.projectos.runtime.settings.get())
  const settingsAfter = await page.evaluate(async (current) => window.projectos.runtime.settings.update({
    ...current,
    plannerMaxOutputTokens: 12_288,
    plannerMaxTasks: 12,
    plannerTimeoutMs: 120_000,
  }), settingsBefore)
  const started = Date.now()
  const plan = await page.evaluate(async (id) => window.projectos.plans.generate(id, '7层地图进行替换，每个楼层一个风格', { mode: 'ai', allowRuleFallback: false, maxTasks: 12 }), project.id)
  const usage = await page.evaluate(async (id) => window.projectos.aiUsage.summary(id), project.id)
  const evidence = { capturedAt: new Date().toISOString(), durationMs: Date.now() - started, projectId: project.id, settingsBefore, settingsAfter, generatedBy: plan.generatedBy, model: plan.generation?.model, attempts: plan.generation?.attempts, maxTasks: plan.generation?.maxTasks, tasks: plan.tasks.length, taskTitles: plan.tasks.map((task) => task.title), usage }
  writeFileSync(join(shots, 'long-output.json'), JSON.stringify(evidence, null, 2))
  await page.screenshot({ path: join(shots, 'long-output.png') })
  console.log(JSON.stringify(evidence, null, 2))
  const ok = plan.generatedBy === 'provider' && plan.tasks.length > 0 && (plan.generation?.outputTokens ?? 0) > 0
  if (!ok) process.exitCode = 1
  else console.log(`\nPLANNER LONG OUTPUT PASS — tasks=${plan.tasks.length} outputTokens=${plan.generation?.outputTokens} attempts=${plan.generation?.attempts}`)
} catch (error) {
  console.error('PLANNER LONG OUTPUT FAIL —', error)
  if (app) { try { const p = await app.firstWindow(); await p.screenshot({ path: join(shots, 'long-output-failure.png') }) } catch { /* ignore */ } }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
