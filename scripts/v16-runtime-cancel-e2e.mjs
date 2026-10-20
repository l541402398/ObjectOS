import { _electron as electron } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-cancel-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1280', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-cancel-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
const profile = await page.evaluate(async () => window.projectos.runtimeProfiles.upsert({ name: 'DSH Cancel Runtime', protocol: 'cli', executable: 'C:\\Users\\Administrator\\AppData\\Roaming\\npm\\dsh-projectos.cmd', endpoint: null, args: [], authRef: null, modelRef: null, options: {}, capabilities: {} }))
await page.evaluate(async (id) => window.projectos.runtimeProfiles.detect(id), profile.id)
const agent = await page.evaluate(async (profileId) => window.projectos.agentDefinitions.upsert({ name: 'Cancel Agent', role: '取消测试', description: '', category: 'code', avatar: '🤖', visibility: 'project', persona: { role: '取消测试', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' }, skillIds: [], runtimeProfileIds: [profileId], primaryRuntimeProfileId: profileId, modelRef: null, permissions: { tools: [], files: true, shell: true, network: true } }), profile.id)
const task = await page.evaluate(async ({ projectId, agentId }) => window.projectos.tasks.create({ projectId, title: 'Cancel Runtime Task', description: 'Long runtime task', priority: 2, acceptanceCriteria: ['cancel'], labels: [], assigneeAgentId: agentId, milestoneId: null, dependsOn: [], dueAt: null }), { projectId, agentId: agent.id })
const session = await page.evaluate(async ({ projectId, agentId }) => window.projectos.sessions.create({ projectId, agentId, title: 'Cancel Session' }), { projectId, agentId: agent.id })
const started = await page.evaluate(async ({ projectId, sessionId, taskId }) => window.projectos.runs.start({ projectId, sessionId, taskId, prompt: 'Write a very long detailed essay about software architecture.' }), { projectId, sessionId: session.session.id, taskId: task.task.id })
await page.waitForTimeout(2500)
await page.evaluate(async (runId) => window.projectos.runs.cancel(runId), started.runId)
await page.waitForTimeout(1500)
const detail = await page.evaluate(async (runId) => window.projectos.runs.get(runId), started.runId)
console.log('status', detail.run.status, 'taskStatus', detail.task?.status)
if (detail.run.status !== 'cancelled') throw new Error('runtime run was not cancelled')
if (detail.task?.status !== 'ready') throw new Error('task not returned to ready')
console.log('RUNTIME CANCEL PASS')
await app.close()
