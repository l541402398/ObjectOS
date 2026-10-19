import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-v14-success-'))
const workspaceDir = join(dataDir, 'project')
mkdirSync(workspaceDir, { recursive: true })
writeFileSync(join(workspaceDir, 'package.json'), JSON.stringify({
  name: 'v14-success', private: true, scripts: { test: 'node -e "process.exit(0)"' },
}, null, 2))
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    let payload = {}
    try { payload = JSON.parse(body) } catch {}
    if (!payload.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const write = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
    write({ choices: [{ delta: { role: 'assistant', content: '已完成修复任务。' } }] })
    write({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 60, completion_tokens: 12 } })
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const exec = promisify(execFile)
let app = null
let passed = false
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForTimeout(2500)
  const project = await page.evaluate(async (workspaceDir) => (await window.projectos.projects.create({
    name: 'V1.4 Success Project', description: '', rootPath: workspaceDir, createDirectory: false, initGit: true,
  })).project, workspaceDir)
  await exec('git', ['add', '.'], { cwd: workspaceDir })
  await exec('git', ['-c', 'user.name=ProjectOS E2E', '-c', 'user.email=e2e@example.com', 'commit', '-m', 'initial'], { cwd: workspaceDir })
  writeFileSync(join(workspaceDir, 'dirty.txt'), 'uncommitted\n')
  await page.evaluate(async ({ baseUrl }) => window.projectos.settings.update({ baseUrl, model: 'fake-v14-model', apiKey: 'test-key', temperature: 0 }), { baseUrl })
  const checks = await page.evaluate(async (projectId) => window.projectos.operations.runChecks(projectId), project.id)
  const finding = checks.findings.find((item) => item.category === 'git')
  if (!finding) throw new Error('git finding missing')
  const proposal = await page.evaluate(async ({ projectId, findingId }) => window.projectos.operations.propose(projectId, [findingId]), { projectId: project.id, findingId: finding.id })
  await page.evaluate(async (proposalId) => window.projectos.operations.reviewProposal(proposalId, 'approved'), proposal.id)
  await page.evaluate(async (projectId) => window.projectos.operations.grant(projectId, 24, 5), project.id)
  const repair = await page.evaluate(async (proposalId) => window.projectos.operations.startRepair(proposalId), proposal.id)
  if (!repair.proposal.planId) throw new Error('repair plan missing')
  let snapshot = null
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    await page.waitForTimeout(1200)
    snapshot = await page.evaluate(async (projectId) => window.projectos.operations.snapshot(projectId), project.id)
    const current = snapshot.proposals.find((item) => item.id === proposal.id)
    if (current?.status === 'completed') break
    if (current?.status === 'failed') throw new Error('repair failed')
  }
  const proposalView = snapshot.proposals.find((item) => item.id === proposal.id)
  if (proposalView?.status !== 'completed') throw new Error(`repair did not complete: ${proposalView?.status}`)
  const findingView = snapshot.findings.find((item) => item.id === finding.id)
  if (findingView?.status !== 'resolved') throw new Error(`finding not resolved: ${findingView?.status}`)
  const plans = await page.evaluate(async (projectId) => window.projectos.plans.list(projectId), project.id)
  const plan = plans.plans.find((item) => item.id === proposalView.planId)
  if (plan?.execution?.status !== 'completed' || !plan.execution.workspaceRef) throw new Error('repair worktree missing')
  console.log('V1.4 SUCCESS E2E PASS — finding → proposal → grant → worktree repair → tests → completed.')
  console.log(`  findings resolved: ${findingView.status}`)
  console.log(`  proposal: ${proposalView.status}`)
  console.log(`  worktree: ${plan.execution.branch}`)
  passed = true
} finally {
  if (app) await app.close().catch(() => {})
  server.close()
  if (passed) rmSync(dataDir, { recursive: true, force: true })
}
