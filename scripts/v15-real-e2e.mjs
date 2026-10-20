import { _electron as electron } from 'playwright-core'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const key = process.env.DEEPSEEK_API_KEY
if (!key) throw new Error('DEEPSEEK_API_KEY is required')
const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-v15-real-'))
const projectDir = join(dataDir, 'real-project')
mkdirSync(projectDir, { recursive: true })
writeFileSync(join(projectDir, 'README.md'), '# Real runtime probe\n')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, DEEPSEEK_API_KEY: key, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const exec = promisify(execFile)
let app = null
let passed = false
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  const project = await page.evaluate(async (rootPath) => (await window.projectos.projects.create({ name: 'V1.5 Real Runtime', description: '', rootPath, createDirectory: false, initGit: false })).project, projectDir)
  const dshPath = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\runtime\\cli\\bin\\dsh.cmd'
  const opencodePath = 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe'
  const dsh = await page.evaluate(async ({ dshPath }) => window.projectos.runtimeProfiles.upsert({ name: 'DeepSeek Harness Real', protocol: 'cli', executable: dshPath, endpoint: null, args: ['headless'], authRef: null, modelRef: null, options: {}, capabilities: {} }), { dshPath })
  const opencode = await page.evaluate(async ({ opencodePath }) => window.projectos.runtimeProfiles.upsert({ name: 'OpenCode Real', protocol: 'acp', executable: opencodePath, endpoint: null, args: ['acp'], authRef: null, modelRef: null, options: {}, capabilities: {} }), { opencodePath })
  const runtimes = [
    { name: 'DSH Real Agent', profile: dsh, prompt: 'Reply with exactly: DSH-REAL-OK' },
    { name: 'OpenCode Real Agent', profile: opencode, prompt: 'Reply with exactly: OPENCODE-REAL-OK' },
  ]
  const results = []
  for (const item of runtimes) {
    const agent = await page.evaluate(async ({ projectId, name, profileId }) => window.projectos.agentDefinitions.upsert({
      name, role: '执行', description: '', category: 'general', avatar: '', visibility: 'project',
      persona: { role: '执行', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [], runtimeProfileIds: [profileId], primaryRuntimeProfileId: profileId, modelRef: null,
      permissions: { tools: [], files: false, shell: true, network: false },
    }), { projectId: project.id, name: item.name, profileId: item.profile.id })
    const result = await page.evaluate(async ({ agentId, projectId, prompt }) => window.projectos.agentDefinitions.run({ agentId, projectId, prompt }), { agentId: agent.id, projectId: project.id, prompt: item.prompt })
    if (result.status !== 'completed') throw new Error(item.name + ' failed: ' + result.output.slice(-4000))
    if (!result.output.trim()) throw new Error(item.name + ' returned empty output')
    results.push({ name: item.name, execution: result.executionId, chars: result.output.length, workspaceRef: result.workspaceRef })
  }
  console.log('V1.5 REAL RUNTIME E2E PASS — DSH and OpenCode executed real tasks through AgentRun.')
  for (const result of results) console.log(`  ${result.name}: ${result.chars} chars · ${result.execution} · worktree=${Boolean(result.workspaceRef)}`)
  passed = true
} finally {
  if (app) await app.close().catch(() => {})
  if (passed) rmSync(dataDir, { recursive: true, force: true })
}







