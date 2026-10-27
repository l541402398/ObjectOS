import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-m1-flow-'))
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1' }
delete env.ELECTRON_RUN_AS_NODE
let app
try {
  app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: desktopDir, env, timeout: 30_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.v16-project-visual, .po-project-card', { timeout: 30_000 })
  const result = await page.evaluate(async () => {
    const project = (await window.projectos.projects.list()).projects[0]
    const lifecycle = await window.projectos.lifecycle.overview(project.id)
    const version = lifecycle.versions[0]
    const plan = await window.projectos.plans.generate(project.id, '为 Markdown 编辑器增加自动保存状态提示，并补充真实测试', {
      mode: 'local',
      maxTasks: 6,
      allowRuleFallback: true,
    })
    await window.projectos.plans.update({ planId: plan.id, versionId: version.id })
    const approved = await window.projectos.plans.approve(plan.id)
    const grant = await window.projectos.plans.grant.issue({
      planId: plan.id,
      actions: ['plan.start', 'workspace-write'],
      allowedPaths: ['.'],
      maxRuns: 1,
      maxToolCalls: 20,
      ttlHours: 1,
      confirm: true,
      note: 'M1 flow test',
    })
    let started = null
    let startError = null
    try {
      started = await window.projectos.orchestration.start(plan.id, 2, 0, false, grant.id)
    } catch (error) {
      startError = String(error?.message ?? error)
    }
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const plans = await window.projectos.plans.list(project.id)
    const board = await window.projectos.tasks.board(project.id)
    const verificationTarget = board.tasks.find((task) => !['done', 'cancelled', 'running'].includes(task.status))
    let verification = null
    let verificationError = null
    if (verificationTarget) {
      try {
        verification = await window.projectos.verification.request(project.id, verificationTarget.id)
      } catch (error) {
        verificationError = String(error?.message ?? error)
      }
    }
    return {
      projectId: project.id,
      version: version?.version ?? null,
      versionId: version?.id ?? null,
      generatedBy: plan.generatedBy,
      taskCount: approved.taskIds.length,
      tasksVersioned: board.tasks.filter((task) => approved.taskIds.includes(task.id) && task.versionId === version?.id).length,
      planVersioned: plans.plans[0]?.versionId ?? null,
      grantValid: grant.valid,
      verificationRunId: verification?.runId ?? null,
      verificationError,
      startError,
      startedStatus: started?.execution?.status ?? null,
      currentStatus: plans.plans[0]?.execution?.status ?? null,
      currentError: plans.plans[0]?.execution?.error ?? null,
    }
  })
  console.log(JSON.stringify(result, null, 2))
  if (
    result.taskCount === 0 ||
    !result.grantValid ||
    result.startError ||
    result.tasksVersioned !== result.taskCount ||
    result.planVersioned !== result.versionId
  ) {
    process.exitCode = 1
  }
} finally {
  try { await app?.close() } catch { /* ignore */ }
  rmSync(dataDir, { recursive: true, force: true })
}
