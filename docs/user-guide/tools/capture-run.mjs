/**
 * 全流程真实截图会话：从首次启动一直走到研发成果。
 *
 * 为什么必须在一个进程里跑完：关闭窗口会终止 Runtime，正在执行的任务会被标记为
 * needs_reconciliation（这是产品正确的行为，但会打断演示）。所以本脚本把
 * 01–04 的声明式流程、运行期审批、05–06 的取证放在同一个 Electron 会话中。
 *
 * 用法：node docs/user-guide/tools/capture-run.mjs --data=<隔离数据目录> [--timeout=45]
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { prepareUserData, prepareWorkspace, seedProvider } from './env.mjs'
import { runFlow, sleep } from './flow-runner.mjs'

const root = process.cwd()
const arg = process.argv.find((item) => item.startsWith('--data='))?.slice(7)
const timeoutMinutes = Number(process.argv.find((item) => item.startsWith('--timeout='))?.slice(10) ?? 50)
const dataDir = arg ?? mkdtempSync(join(tmpdir(), 'projectos-guide-run-'))
mkdirSync(dataDir, { recursive: true })

const shotsDir = join(root, 'docs', 'user-guide', 'assets', 'screenshots')
const evidenceDir = join(root, 'docs', 'user-guide', '_evidence')
const progressDir = join(evidenceDir, 'progress')
mkdirSync(shotsDir, { recursive: true })
mkdirSync(evidenceDir, { recursive: true })
mkdirSync(progressDir, { recursive: true })

const workspaceDir = join(dataDir, 'aurora-notes')
if (!existsSync(workspaceDir)) {
  prepareWorkspace(join(root, 'docs', 'user-guide', 'fixtures', 'aurora-notes'), workspaceDir)
  const git = (...args) => execFileSync('git', args, { cwd: workspaceDir, encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 'demo@example.com')
  git('config', 'user.name', 'Demo User')
  git('add', '.')
  git('commit', '-q', '-m', 'chore: aurora-notes 基线')
}
if (!existsSync(join(dataDir, 'provider.json'))) seedProvider(dataDir)
const userData = prepareUserData(dataDir)

const flowDir = join(root, 'docs', 'user-guide', 'flows')
const loadFlow = (id) => {
  const file = readdirSync(flowDir).find((name) => name.startsWith(id))
  const flow = JSON.parse(readFileSync(join(flowDir, file), 'utf8'))
  flow.steps = flow.steps.map((step) => ({
    ...step,
    do: (step.do ?? []).map((action) =>
      JSON.parse(JSON.stringify(action).replaceAll('__WORKSPACE__', workspaceDir.replaceAll('\\', '\\\\'))),
    ),
  }))
  return flow
}

const manifestPath = join(evidenceDir, 'capture-manifest.json')
const manifest = {
  path: manifestPath,
  data: { generatedAt: new Date().toISOString(), dataDir, workspaceDir, flows: [], approvals: [], timeline: [] },
  flows: [],
}

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const consoleErrors = []
const log = (message) => {
  console.log(`[run] ${new Date().toISOString().slice(11, 19)} ${message}`)
  manifest.data.timeline.push({ at: new Date().toISOString(), message })
}

let app = null
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userData}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))
  await page.waitForSelector('.po-empty-title, .v16-project-visual, .po-page-title', { timeout: 90_000 })
  await sleep(1500)

  for (const id of ['01', '02', '03', '04']) {
    const flow = loadFlow(id)
    log(`flow ${flow.id}`)
    await runFlow(page, flow, { shotsDir, manifest })
    writeFileSync(manifestPath, JSON.stringify(manifest.data, null, 2), 'utf8')
  }

  const projectId = await page.evaluate(async () => {
    const projects = await window.projectos.projects.list()
    return (projects.projects ?? projects)[0].id
  })
  log(`project ${projectId}`)

  // —— 运行期：先走一次真实 UI 审批，其余用同一 IPC 批量放行 ——
  let approvalsCaptured = false
  let approveCount = 0
  let idleRounds = 0
  const started = Date.now()
  const deadline = started + timeoutMinutes * 60_000
  let lastProgressAt = 0

  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(async (id) => {
      const approvals = await window.projectos.approvals.list({ projectId: id })
      const plans = await window.projectos.plans.list(id)
      const board = await window.projectos.tasks.board(id)
      const active = plans.plans.find((plan) => plan.status === 'approved')
      const tasks = board.tasks ?? []
      return {
        pending: approvals.approvals.filter((item) => item.status === 'pending').map((item) => ({
          id: item.id,
          kind: item.kind,
          tool: item.request?.toolName ?? null,
        })),
        execution: active?.execution ?? null,
        tasks: tasks.map((task) => ({ id: task.id, status: task.status, title: task.title })),
      }
    }, projectId)

    const activeTasks = snapshot.tasks.filter((task) => ['running', 'review', 'in_progress'].includes(task.status))
    const doneTasks = snapshot.tasks.filter((task) => ['done', 'verified', 'cancelled'].includes(task.status))
    log(
      `pending=${snapshot.pending.length} exec=${snapshot.execution?.status ?? 'none'} tasks=${doneTasks.length}/${snapshot.tasks.length} active=${activeTasks.length}`,
    )

    if (snapshot.pending.length > 0 && !approvalsCaptured) {
      approvalsCaptured = true
      const flow = loadFlow('05')
      try {
        await runFlow(page, flow, { shotsDir, manifest })
      } catch (error) {
        log(`flow05 failed: ${error}`)
      }
      writeFileSync(manifestPath, JSON.stringify(manifest.data, null, 2), 'utf8')
    }

    for (const approval of snapshot.pending.filter((item) => item.kind === 'tool')) {
      const result = await page.evaluate(
        async ({ approvalId }) => {
          try {
            await window.projectos.approvals.decide({
              approvalId,
              decision: 'approved',
              note: '用户手册演示：授权范围内的工具调用',
            })
            return true
          } catch {
            return false
          }
        },
        { approvalId: approval.id },
      )
      if (result) {
        approveCount += 1
        manifest.data.approvals.push({ at: new Date().toISOString(), tool: approval.tool, approvalId: approval.id })
      }
    }

    const finished =
      snapshot.execution && ['completed', 'failed', 'cancelled'].includes(snapshot.execution.status)
    if (finished && snapshot.pending.length === 0) idleRounds += 1
    if (idleRounds >= 3) break

    if (Date.now() - lastProgressAt > 90_000) {
      lastProgressAt = Date.now()
      await page.screenshot({ path: join(progressDir, `progress-${Date.now()}.png`) })
    }
    await sleep(4000)
  }

  log(`drive loop finished, approvals=${approveCount}`)
  await page.screenshot({ path: join(evidenceDir, 'after-drive.png') })

  for (const id of ['06']) {
    const flow = loadFlow(id)
    log(`flow ${flow.id}`)
    try {
      await runFlow(page, flow, { shotsDir, manifest })
    } catch (error) {
      log(`flow06 failed: ${error}`)
    }
    writeFileSync(manifestPath, JSON.stringify(manifest.data, null, 2), 'utf8')
  }

  manifest.data.consoleErrors = consoleErrors
  manifest.data.finishedAt = new Date().toISOString()
  writeFileSync(manifestPath, JSON.stringify(manifest.data, null, 2), 'utf8')
  log(`manifest ${manifestPath}`)
  console.log(`[console] ${consoleErrors.length} errors`)
} catch (error) {
  console.error('[run] FAIL', error)
  try {
    const page = await app?.firstWindow()
    if (page) await page.screenshot({ path: join(evidenceDir, 'failure.png') })
  } catch {
    // ignore
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  writeFileSync(manifestPath, JSON.stringify(manifest.data, null, 2), 'utf8')
  console.log(`[data] ${dataDir}`)
}
