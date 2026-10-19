import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
mkdirSync('test-results', { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-v13-e2e-'))
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
const appPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')
const workspaceDir = join(dataDir, 'v13-project')
mkdirSync(join(workspaceDir, 'src'), { recursive: true })
writeFileSync(
  join(workspaceDir, 'package.json'),
  JSON.stringify({
    name: 'v13-project',
    private: true,
    dependencies: { react: '^19', antd: '^6' },
    devDependencies: { vite: '^8', electron: '^44' },
  }),
)
writeFileSync(join(workspaceDir, 'tsconfig.json'), '{}')
writeFileSync(join(workspaceDir, 'pnpm-lock.yaml'), '')
writeFileSync(join(workspaceDir, 'pnpm-workspace.yaml'), 'packages: []')
writeFileSync(join(workspaceDir, 'src', 'index.ts'), 'export const ready = true\n')
let app = null
let passed = false
const errors = []

async function launch() {
  const next = await electron.launch({ executablePath: appPath, args: ['.'], cwd: desktopDir, env, timeout: 60_000 })
  const page = await next.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return { app: next, page }
}

try {
  let current = await launch()
  app = current.app
  let page = current.page
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })

  const project = await page.evaluate(
    async ({ workspaceDir }) =>
      (
        await window.projectos.projects.create({
          name: 'V1.3 RBAC Project',
          description: '',
          rootPath: workspaceDir,
          createDirectory: false,
          initGit: false,
        })
      ).project,
    { workspaceDir },
  )
  await page.reload()
  await page.waitForTimeout(2200)
  const snapshot = await page.evaluate(async (projectId) => window.projectos.projectAnalysis.scan(projectId), project.id)
  if (!snapshot.languages.length || !snapshot.frameworks.length) throw new Error('project scan returned no stack')

  const plan = await page.evaluate(
    async ({ projectId }) => window.projectos.plans.generate(projectId, '增加 RBAC 权限管理'),
    { projectId: project.id },
  )
  if (plan.status !== 'draft' || plan.tasks.length !== 4) throw new Error('plan draft invalid')
  const approved = await page.evaluate(async (planId) => window.projectos.plans.approve(planId), plan.id)
  if (approved.plan.status !== 'approved' || approved.taskIds.length !== 4) throw new Error('plan approval failed')
  const revised = await page.evaluate(
    async (plan) =>
      window.projectos.plans.revise({
        planId: plan.id,
        goal: `${plan.goal}（修订）`,
        tasks: plan.tasks,
        assumptions: plan.assumptions,
        risks: plan.risks,
      }),
    approved.plan,
  )
  if (revised.revision !== 2 || revised.status !== 'draft' || revised.createdTaskIds.length !== 0) {
    throw new Error('approved plan revision was not created as a new draft')
  }

  const graph = await page.evaluate(async (projectId) => window.projectos.graph.snapshot(projectId), project.id)
  const planTasks = graph.nodes.filter((node) => node.kind === 'task' && approved.taskIds.includes(node.taskId))
  if (planTasks.length !== 4) throw new Error('approved plan tasks missing from graph')
  if (!graph.edges.some((edge) => edge.kind === 'dependency')) throw new Error('dependency edges missing')
  if (!graph.positions[planTasks[0].id]) throw new Error('graph positions missing')

  const moved = { ...graph.positions, [planTasks[0].id]: { x: 620, y: 40 } }
  await page.evaluate(
    async ({ projectId, positions }) => window.projectos.graph.saveLayout(projectId, positions),
    { projectId: project.id, positions: moved },
  )

  await page.evaluate(
    ({ projectId }) => {
      location.hash = `#/projects/${projectId}/orchestration`
    },
    { projectId: project.id },
  )
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
  await page.waitForTimeout(800)
  const graphTasks = await page.locator('.react-flow__node').count()
  if (graphTasks < 4) throw new Error('orchestration canvas did not render graph nodes')
  const taskNode = page.locator('.react-flow__node').filter({ hasText: plan.tasks[0].title }).first()
  await taskNode.click()
  await page.waitForSelector('.po-inspector-identity', { timeout: 10_000 })
  await page.screenshot({ path: 'test-results/v13-orchestration.png' })

  await page.locator('.po-nav-item').filter({ hasText: '设置' }).last().click()
  await page.waitForSelector('.po-settings-dialog')
  await page.getByRole('button', { name: '新增连接' }).first().click()
  await page.waitForSelector('.po-ai-editor', { timeout: 10_000 })
  const nestedModals = await page.locator('.ant-modal .ant-modal').count()
  if (nestedModals !== 0) throw new Error('connection editor still renders as a nested modal')
  await page.screenshot({ path: 'test-results/v13-connection-editor.png' })
  await page.locator('.po-ai-editor-top button').first().click()
  await page.locator('.po-settings-modal .ant-modal-close').click()
  await page.waitForTimeout(300)

  await app.close()
  app = null
  current = await launch()
  app = current.app
  page = current.page
  await page.waitForSelector('.po-project-card', { timeout: 30_000 })
  const persisted = await page.evaluate(
    async ({ projectId, planId }) => ({
      plans: await window.projectos.plans.list(projectId),
      graph: await window.projectos.graph.snapshot(projectId),
      planId,
    }),
    { projectId: project.id, planId: plan.id },
  )
  const savedPlan = persisted.plans.plans.find((item) => item.id === persisted.planId)
  if (savedPlan?.status !== 'approved') throw new Error('approved plan did not survive restart')
  const movedPosition = persisted.graph.positions[planTasks[0].id]
  if (movedPosition?.x !== 620 || movedPosition?.y !== 40) throw new Error('saved graph layout did not survive restart')
  if (errors.length > 0) throw new Error(`renderer errors: ${errors.join(' | ')}`)

  console.log('V1.3 E2E PASS — scan, plan DAG approval, real graph projection, saved layout, inline connection editor and restart recovery.')
  console.log(`  project: ${project.name}`)
  console.log(`  stack: ${snapshot.languages.join(' / ')} · ${snapshot.frameworks.map((item) => item.name).join(' / ')}`)
  console.log(`  plan: r${savedPlan.revision} · ${savedPlan.tasks.length} tasks · ${savedPlan.status}`)
  console.log(`  graph: ${persisted.graph.nodes.length} nodes / ${persisted.graph.edges.length} edges`)
  passed = true
} catch (error) {
  console.error('V1.3 E2E FAIL —', error instanceof Error ? error.message : error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: 'test-results/v13-e2e-failure.png' })
    } catch {
      // best effort
    }
  }
  console.error(`  data kept for inspection: ${dataDir}`)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  if (passed) {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // best-effort temp cleanup
    }
  }
}



