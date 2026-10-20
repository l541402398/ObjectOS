import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-v15-e2e-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app = null
let passed = false
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  let page = await app.firstWindow()
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  await page.waitForTimeout(2200)
  const runtimes = await page.evaluate(async () => window.projectos.runtimeProfiles.list())
  if (runtimes.profiles.length < 2) throw new Error('default runtime profiles missing')
  const native = runtimes.profiles.find((profile) => profile.protocol === 'native')
  if (!native) throw new Error('native runtime missing')
  const agent = await page.evaluate(async (profileId) => window.projectos.agentDefinitions.upsert({
    name: 'V1.5 Reviewer', role: '审查员', description: 'V1.5 E2E', category: 'quality', avatar: '', visibility: 'project',
    persona: { role: '审查员', background: '安全背景', responsibilities: '审查变更', principles: '不隐瞒风险', style: '简洁', constraints: '只读', systemPrompt: 'Review carefully.' },
    skillIds: [], runtimeProfileIds: [profileId], primaryRuntimeProfileId: profileId, modelRef: null,
    permissions: { tools: [], files: false, shell: false, network: false },
  }), native.id)
  if (agent.currentVersion !== 1) throw new Error('agent version invalid')
  const preview = await page.evaluate(async (id) => window.projectos.agentDefinitions.preview(id), agent.id)
  if (!preview.prompt.includes('Review carefully.')) throw new Error('prompt preview missing persona')
  const custom = await page.evaluate(async () => window.projectos.runtimeProfiles.upsert({
    name: 'Local Test Runtime', protocol: 'cli', executable: 'node', endpoint: null, args: ['--version'], authRef: null, modelRef: null, options: {}, capabilities: {},
  }))
  const detected = await page.evaluate(async (id) => window.projectos.runtimeProfiles.detect(id), custom.id)
  if (!detected.detections[0]?.installed) throw new Error('custom runtime detection failed')
  await page.evaluate(async (id) => window.projectos.runtimeProfiles.delete(id), custom.id)

  const projectId = await page.evaluate(async () => (await window.projectos.app.bootstrap()).projects[0].id)
  await page.evaluate((id) => { window.location.hash = '#/projects/' + id + '/agents' }, projectId)
  await page.waitForTimeout(1800)
  await page.getByRole('button', { name: 'Agent 管理' }).click()
  await page.getByText('V1.5 Reviewer', { exact: true }).first().waitFor({ timeout: 10_000 })

  await app.close()
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  page = await app.firstWindow()
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  const recovered = await page.evaluate(async () => window.projectos.agentDefinitions.list())
  if (!recovered.agents.some((item) => item.name === 'V1.5 Reviewer' && item.currentVersion === 1)) throw new Error('agent not recovered after restart')
  console.log('V1.5 E2E PASS — custom agent, persona preview, runtime detection and restart recovery.')
  console.log(`  agents: ${recovered.agents.length}`)
  console.log(`  runtimes: ${runtimes.profiles.length}`)
  passed = true
} finally {
  if (app) await app.close().catch(() => {})
  if (passed) rmSync(dataDir, { recursive: true, force: true })
}


