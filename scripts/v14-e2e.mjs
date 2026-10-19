import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-v14-e2e-'))
const workspaceDir = join(dataDir, 'health-project')
mkdirSync(join(workspaceDir, 'src'), { recursive: true })
writeFileSync(join(workspaceDir, 'package.json'), JSON.stringify({
  name: 'health-project', private: true, scripts: { test: 'node -e "process.exit(1)"' },
}, null, 2))
writeFileSync(join(workspaceDir, 'src', 'index.js'), 'export const ok = false\n')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const desktopDir = resolve(root, 'apps/desktop')
let app
let passed = false
try {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: desktopDir, env, timeout: 60_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  const project = await page.evaluate(async (workspaceDir) => (await window.projectos.projects.create({
    name: 'V1.4 Health Project', description: '', rootPath: workspaceDir, createDirectory: false, initGit: true,
  })).project, workspaceDir)
  await page.reload()
  await page.waitForTimeout(1800)
  const snapshot = await page.evaluate(async (projectId) => window.projectos.operations.runChecks(projectId), project.id)
  if (!snapshot.findings.length) throw new Error('no findings created')
  const testFinding = snapshot.findings.find((finding) => finding.category === 'test')
  if (!testFinding) throw new Error('test failure finding missing')
  const proposal = await page.evaluate(async ({ projectId, findingId }) => window.projectos.operations.propose(projectId, [findingId]), { projectId: project.id, findingId: testFinding.id })
  if (proposal.status !== 'pending_approval') throw new Error('proposal status invalid')
  const approved = await page.evaluate(async (proposalId) => window.projectos.operations.reviewProposal(proposalId, 'approved'), proposal.id)
  if (approved.status !== 'approved') throw new Error('proposal approval failed')
  const repair = await page.evaluate(async (proposalId) => window.projectos.operations.startRepair(proposalId), proposal.id)
  if (!repair.proposal.planId || repair.plan.status !== 'approved') throw new Error('repair plan not started')
  await page.evaluate(async (projectId) => window.projectos.operations.setMode(projectId, 'propose'), project.id)
  const trigger = await page.evaluate(async (projectId) => window.projectos.operations.setTrigger(projectId, 15, true), project.id)
  if (!trigger.enabled || trigger.intervalMinutes !== 15) throw new Error('trigger not persisted')
  await page.goto(`http://localhost/#/projects/${project.id}/operations`).catch(() => {})
  await app.close()
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: desktopDir, env, timeout: 60_000 })
  const page2 = await app.firstWindow()
  await page2.waitForSelector('.po-nav-item', { timeout: 30_000 })
  const recovered = await page2.evaluate(async (projectId) => window.projectos.operations.snapshot(projectId), project.id)
  if (!recovered.findings.length || !recovered.proposals[0]?.planId) throw new Error('operations recovery failed')
  if (recovered.mode !== 'propose') throw new Error('autonomy mode not persisted')
  const recoveredTrigger = await page2.evaluate(async (projectId) => window.projectos.operations.getTrigger(projectId), project.id)
  if (!recoveredTrigger?.enabled) throw new Error('trigger not recovered')
  console.log('V1.4 E2E PASS — health checks create evidence-backed findings, proposals approve and survive restart.')
  console.log(`  findings: ${recovered.findings.length}`)
  console.log(`  proposals: ${recovered.proposals.length} · ${recovered.proposals[0].status}`)
  console.log(`  mode: ${recovered.mode}`)
  passed = true
} finally {
  if (app) await app.close().catch(() => {})
  if (passed) rmSync(dataDir, { recursive: true, force: true })
}



