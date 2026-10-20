import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY required')
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-dag-runtime-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1280', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-dag-runtime-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
await page.waitForTimeout(800)
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
const created = await page.evaluate(async () => window.projectos.runtimeProfiles.upsert({
  name: 'DSH DAG Runtime',
  protocol: 'cli',
  executable: 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\dsh-projectos.cmd',
  endpoint: null,
  args: [],
  authRef: null,
  modelRef: null,
  options: {},
  capabilities: {},
}))
const detections = await page.evaluate(async (profileId) => (await window.projectos.runtimeProfiles.detect(profileId)).detections, created.id)
const profiles = await page.evaluate(async () => (await window.projectos.runtimeProfiles.list()).profiles)
const profile = profiles.find((item) => item.id === created.id)
if (!profile || profile.status !== 'available') throw new Error('DSH runtime not available: ' + JSON.stringify(detections))
console.log('runtime', profile.name, profile.protocol, profile.status)
const agent = await page.evaluate(async (profileId) => window.projectos.agentDefinitions.upsert({
  name: 'DAG Runtime Agent', role: 'Runtime 执行工程师', description: 'V1.6 DAG runtime execution probe', category: 'code', avatar: '🤖', visibility: 'project',
  persona: { role: 'Runtime 执行工程师', background: '运行真实 CLI Runtime', responsibilities: '执行任务并回传结果', principles: '真实执行', style: '直接', constraints: '', systemPrompt: '' },
  skillIds: [], runtimeProfileIds: [profileId], primaryRuntimeProfileId: profileId, modelRef: null,
  permissions: { tools: [], files: true, shell: true, network: true },
}), profile.id)
const task = await page.evaluate(async ({ projectId, agentId }) => window.projectos.tasks.create({ projectId, title: 'DAG Runtime Execution', description: 'Execute this task through the custom AgentDefinition Runtime binding.', priority: 2, acceptanceCriteria: ['Runtime executes'], labels: ['runtime'], assigneeAgentId: agentId, milestoneId: null, dependsOn: [], dueAt: null }), { projectId, agentId: agent.id })
const session = await page.evaluate(async ({ projectId, agentId }) => window.projectos.sessions.create({ projectId, agentId, title: 'DAG Runtime Session' }), { projectId, agentId: agent.id })
const started = await page.evaluate(async ({ projectId, sessionId, taskId }) => window.projectos.runs.start({ projectId, sessionId, taskId, prompt: 'Reply with exactly: DAG-RUNTIME-OK' }), { projectId, sessionId: session.session.id, taskId: task.task.id })
let detail = null
for (let index = 0; index < 90; index += 1) {
  await page.waitForTimeout(2000)
  detail = await page.evaluate(async (runId) => window.projectos.runs.get(runId), started.runId)
  if (['completed','failed','cancelled','needs_reconciliation'].includes(detail.run.status)) break
}
console.log('status', detail.run.status, 'taskStatus', detail.task?.status, 'steps', detail.steps.length)
const summary = detail.run.summary ?? ''
console.log('summary-marker', summary.includes('DAG-RUNTIME-OK'), 'summaryLength', summary.length)
if (detail.run.status !== 'completed') throw new Error('runtime DAG run failed: ' + (detail.run.error ?? summary))
if (!detail.steps.some((step) => String(step.title).includes('Runtime 执行'))) throw new Error('run did not record runtime execution step')
if (detail.task?.status !== 'review') throw new Error('task was not moved to review: ' + detail.task?.status)
console.log('DAG RUNTIME EXECUTION PASS', detail.run.id, profile.name)
await app.close()
