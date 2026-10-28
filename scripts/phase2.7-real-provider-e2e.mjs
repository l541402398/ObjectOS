/**
 * Phase 2.7 — REAL AI provider, approval pause -> bell -> approve -> auto resume.
 *
 * This deliberately uses the machine's configured DeepSeek provider (safeStorage vault +
 * provider.json copied from the real app data dir). No fake/scripted model server is
 * involved: if the provider is missing or fails, the run reports BLOCKED instead of
 * pretending success.
 *
 * Flow proven here:
 *   run.start  -> model asks for a write_file tool  -> policy pauses the run
 *   -> action center shows one precise todo -> bell deep link opens that approval
 *   -> user approves in the UI -> decideApproval resumes the SAME run
 *   -> model continues, the tool executes, the file really exists, run completes.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = process.env.PROJECTOS_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), 'projectos-phase2-7-'))
mkdirSync(dataDir, { recursive: true })
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })

// Reuse the real provider configuration. safeStorage is DPAPI-bound to this Windows
// user, so the encrypted key decrypts inside the app for this same test data dir.
const realData = join(process.env.APPDATA ?? '', 'ProjectOS', 'data')
let providerAvailable = false
for (const file of ['provider.json', 'ai-secrets.vault.json', 'resource-credentials.vault.json']) {
  const source = join(realData, file)
  if (existsSync(source)) {
    copyFileSync(source, join(dataDir, file))
    if (file === 'provider.json') providerAvailable = true
  }
}
// A fresh data dir has no AI connection row yet. Reset the migration marker so the app
// runs its own legacy->connection migration (it decrypts the key with safeStorage and
// installs it into the runtime vault). We never read or log the key ourselves.
if (providerAvailable) {
  const providerPath = join(dataDir, 'provider.json')
  const parsed = JSON.parse(readFileSync(providerPath, 'utf8'))
  delete parsed.connectionsMigrated
  writeFileSync(providerPath, JSON.stringify(parsed, null, 2), 'utf8')
}

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

let app
const launch = async () => {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 40_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.po-shell.is-collapsed').count()) await page.getByRole('button', { name: '切换侧边栏' }).click()
  if (await page.locator('.v16-project-visual').count()) await page.locator('.v16-project-visual').first().click()
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  return page
}

async function main() {
  const page = await launch()
  record('Electron 启动（真实 Provider 数据目录）', 'PASS', dataDir)

  if (!providerAvailable) {
    record('真实 AI Provider 可用', 'BLOCKED', '未找到 provider.json；需要用户提供 DeepSeek API Key')
    await app.close()
    summarise()
    return
  }
  const providerInfo = await page.evaluate(async () => window.projectos.app.preferences())
  record('真实 AI Provider 可用', providerInfo.provider?.configured || providerInfo.provider?.apiKeyConfigured ? 'PASS' : 'BLOCKED', JSON.stringify(providerInfo.provider ?? {}).slice(0, 160))

  const project = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0])
  const setup = await page.evaluate(async ({ projectId }) => {
    const capture = async (label, fn) => {
      try {
        return { ok: true, value: await fn() }
      } catch (error) {
        return { ok: false, label, message: String(error?.message ?? error), details: error?.details ?? null }
      }
    }
    const agents = await capture('agent.list', () => window.projectos.agents.list(projectId))
    if (!agents.ok) return { error: agents }
    const list = agents.value.agents ?? agents.value
    const agent = list.find((entry) => (entry.agent?.id ?? entry.id) === 'agt_engineer')
      ?? list.find((entry) => /开发|engineer/i.test(`${entry.agent?.role ?? entry.role ?? ''}${entry.agent?.name ?? entry.name ?? ''}`))
      ?? list[0]
    if (!agent) return { error: { label: 'agent.list', message: '项目没有可用 Agent' } }
    const agentId = agent.agent?.id ?? agent.id
    const created = await capture('session.create', () => window.projectos.sessions.create({ projectId, agentId, title: 'Phase 2.7 真实 Provider 审批恢复' }))
    if (!created.ok) return { error: created }
    const task = await capture('task.create', () => window.projectos.tasks.create({
      projectId, title: 'Phase 2.7 真实审批恢复', description: '真实模型写入文件前请求授权',
      priority: 3, acceptanceCriteria: ['file written'], labels: [], assigneeAgentId: agentId,
      milestoneId: null, versionId: null, iterationId: null, dependsOn: [], dueAt: null,
    }))
    if (!task.ok) return { error: task }
    return { sessionId: created.value.session.id, taskId: task.value.task.id, agentId }
  }, { projectId: project.id })
  if (setup.error) {
    record('创建真实会话与任务', 'FAIL', `${setup.error.label}: ${setup.error.message} ${JSON.stringify(setup.error.details ?? '')}`.slice(0, 400))
    await app.close()
    summarise()
    return
  }
  record('创建真实会话与任务', 'PASS', `${setup.sessionId}`)

  // Ask the real model to write a file: policy requires human approval for write_file.
  const prompt = [
    '你现在在 ProjectOS 中执行一个小任务。',
    '请调用 write_file 工具，path 使用 "phase27-real-agent.md"，content 写 "# Phase 2.7 real agent" 加一行说明。',
    '只调用一次工具，不要解释，不要输出其它内容。',
  ].join('\n')
  const started = await page.evaluate(async ({ projectId, sessionId, taskId, prompt }) => {
    return window.projectos.runs.start({ projectId, sessionId, taskId, prompt })
  }, { projectId: project.id, sessionId: setup.sessionId, taskId: setup.taskId, prompt })
  record('真实模型 Run 已启动', 'PASS', started.runId)

  // Wait for the run to pause on a tool approval (real model decision).
  let paused = null
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const state = await page.evaluate(async ({ projectId, runId }) => {
      const center = await window.projectos.actions.center(projectId)
      const item = center.items.find((entry) => entry.kind === 'tool_approval' && entry.runId === runId)
      const runs = await window.projectos.runs.list(projectId, 20)
      const run = (runs.runs ?? runs).find?.((entry) => entry.id === runId) ?? null
      return { item, runStatus: run?.status ?? null }
    }, { projectId: project.id, runId: started.runId })
    if (state.item) { paused = state; break }
    await page.waitForTimeout(2000)
  }
  record('真实模型请求授权 → Run 暂停', paused ? 'PASS' : 'FAIL', paused ? `approval=${paused.item.approvalId} run=${paused.runStatus}` : '未在 180s 内进入审批')

  if (!paused) {
    await app.close()
    summarise()
    return
  }

  // The bell must open the exact approval with its real diff.
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/work` }, { projectId: project.id })
  await page.waitForSelector('[data-testid="action-center-button"]', { timeout: 20_000 })
  await page.waitForTimeout(1200)
  await page.locator('[data-testid="action-center-button"]').click()
  await page.waitForSelector('.ac-panel', { timeout: 10_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(shots, 'p27-01-bell-real-approval.png'), timeout: 15_000 })
  const targetRow = page.locator('.ac-row').filter({ hasText: '工具授权' }).first()
  if (await targetRow.count()) await targetRow.click()
  else await page.locator('.ac-row').first().click()
  await page.waitForTimeout(1500)
  const landed = await page.evaluate(() => location.hash)
  record('铃铛直达该审批', landed.includes(`approval=${encodeURIComponent(paused.item.approvalId)}`) ? 'PASS' : 'FAIL', landed)
  const diffVisible = await page.locator('.ap-diff, .ap-list').count()
  record('审批页显示真实 Diff 区域', diffVisible > 0 ? 'PASS' : 'FAIL', `panels=${diffVisible}`)
  await page.screenshot({ path: join(shots, 'p27-02-real-approval-diff.png'), timeout: 15_000 })

  // Approve through the real UI control (last action button = 批准).
  await page.locator('.ap-actions button').last().click()
  await page.waitForTimeout(1500)
  record('用户批准（真实 UI）', 'PASS')

  // The same run must resume and finish on its own — no returning to chat to type 继续.
  let finished = null
  const doneDeadline = Date.now() + 240_000
  while (Date.now() < doneDeadline) {
    const state = await page.evaluate(async ({ projectId, runId }) => {
      const runs = await window.projectos.runs.list(projectId, 20)
      const list = runs.runs ?? runs
      return list.find((entry) => entry.id === runId) ?? null
    }, { projectId: project.id, runId: started.runId })
    if (state && ['completed', 'failed', 'cancelled'].includes(state.status)) { finished = state; break }
    await page.waitForTimeout(2500)
  }
  record('批准后原 Run 自动恢复并结束', finished?.status === 'completed' ? 'PASS' : 'FAIL', `status=${finished?.status ?? 'timeout'} error=${(finished?.error ?? '').slice(0, 120)}`)

  // The real side effect must exist on disk.
  const filePath = join(dataDir, 'demo', 'aurora-notes', 'phase27-real-agent.md')
  const projectRoot = await page.evaluate(async ({ projectId }) => (await window.projectos.projects.list()).projects.find((p) => p.id === projectId)?.rootPath ?? '', { projectId: project.id })
  const candidates = [join(projectRoot || dataDir, 'phase27-real-agent.md'), filePath]
  const written = candidates.find((candidate) => existsSync(candidate))
  record('Agent 真实写入文件', written ? 'PASS' : 'FAIL', written ?? `未找到 ${candidates.join(' | ')}`)
  if (written) {
    const content = readFileSync(written, 'utf8')
    record('写入内容正确', content.includes('Phase 2.7 real agent') ? 'PASS' : 'FAIL', content.slice(0, 80).replace(/\n/g, ' '))
  }

  const after = await page.evaluate(async ({ projectId }) => window.projectos.actions.center(projectId), { projectId: project.id })
  const stillPending = after.items.filter((item) => item.kind === 'tool_approval' && item.runId === started.runId)
  record('授权完成后待办自动消失', stillPending.length === 0 ? 'PASS' : 'FAIL', `remaining=${stillPending.length}`)
  record('本次 Run 未产生伪已完成', finished?.status === 'completed' ? 'PASS' : 'FAIL')

  await page.screenshot({ path: join(shots, 'p27-03-after-auto-resume.png'), timeout: 15_000 })
  await app.close()
  summarise()
}

function summarise() {
  const failed = results.filter((item) => item.status === 'FAIL')
  const blocked = results.filter((item) => item.status === 'BLOCKED')
  console.log('\n===== PHASE 2.7 REAL PROVIDER APPROVAL->RESUME =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} BLOCKED=${blocked.length}`)
  console.log(`dataDir=${dataDir}`)
  if (failed.length) process.exitCode = 1
}

main().catch(async (error) => {
  console.error('[fatal]', error)
  try { await app?.close() } catch { /* ignore */ }
  process.exitCode = 1
})
