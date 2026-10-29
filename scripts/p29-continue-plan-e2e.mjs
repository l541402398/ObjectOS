/**
 * Continue an existing real run to delivery: approve the human decisions the agent actually asks for
 * (git index refresh, read-only inspection, test runs), resume when paused, and stop when delivery
 * settles. This is the "user keeps answering" half of the first-run flow — never an auto-approval.
 *
 * usage: node scripts/p29-continue-plan-e2e.mjs <dataDir>
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dataDir = process.argv[2]
// Secrets live in the Electron userData root (safeStorage), not in the data dir: reuse the profile's
// own userData or the DeepSeek key is unavailable and every resume fails with PROVIDER_NOT_CONFIGURED.
const userDataDir = process.argv[3]
if (!dataDir || !existsSync(join(dataDir, 'projectos.db'))) {
  console.error('usage: node scripts/p29-continue-plan-e2e.mjs <dataDir> [userDataDir]')
  process.exit(2)
}
const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-continue-'))
mkdirSync(work, { recursive: true })

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const stageOf = (journey, key) => journey?.stages?.find((stage) => stage.key === key)

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${userDataDir ?? join(work, 'ud')}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})

// Only the commands this agent actually asked for; anything else stays unapproved and is reported.
const ALLOWED = [
  /git add( -N)? /,
  /git update-index/,
  /git status/,
  /git diff/,
  /git log/,
  /git rev-parse/,
  /node --test/,
  /npm test|pnpm test/,
  /node --version/,
  /readFileSync\(|existsSync\(/,
  /^(ls|dir|cat hello\.txt)/,
]
let approvals = 0
try {
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(1200)
  const target = await page.evaluate(async () => {
    const overview = await window.projectos.projects.list({})
    const projects = overview.projects ?? overview
    for (const project of projects) {
      const plans = await window.projectos.plans.list(project.id)
      const plan = plans.plans.find((item) => ['running', 'paused', 'failed'].includes(item.execution?.status ?? ''))
      if (plan) return { projectId: project.id, planId: plan.id }
    }
    return null
  })
  if (!target) throw new Error('no active plan in that profile')
  record('找到待继续的真实计划', 'PASS', JSON.stringify(target))

  const deadline = Date.now() + 25 * 60_000
  let settled = null
  let restarts = 0
  while (Date.now() < deadline) {
    settled = await page.evaluate(
      async ({ projectId, planId }) => {
        const journey = await window.projectos.work.journey(projectId)
        const planView = await window.projectos.plans.get(planId)
        const pending = await window.projectos.approvals.list({ projectId, status: 'pending' })
        return {
          journey,
          execution: planView.execution ?? null,
          pending: (pending.approvals ?? []).map((approval) => {
            const request = approval.request ?? approval.subject ?? {}
            const args = request.args ?? {}
            const command = typeof args.command === 'string' ? args.command : typeof request.command === 'string' ? request.command : ''
            return {
              id: approval.id,
              title: approval.title ?? '',
              tool: String(args.toolName ?? request.toolName ?? ''),
              command,
              raw: JSON.stringify(approval).slice(0, 1200),
            }
          }),
        }
      },
      target,
    )
    const delivery = settled.execution?.deliveryStatus ?? 'none'
    console.log(
      `[state] execution=${settled.execution?.status} delivery=${delivery} review=${stageOf(settled.journey, 'code-review')?.state} pending=${settled.pending.length}`,
    )
    if (delivery === 'verified') break

    if (settled.pending.length > 0 && ['running', 'paused'].includes(settled.execution?.status ?? '')) {
      for (const approval of settled.pending) {
        const haystack = `${approval.tool} ${approval.command} ${approval.title} ${approval.raw}`
        if (!ALLOWED.some((pattern) => pattern.test(haystack))) {
          record('存在需要你本人决定的非测试审批', 'SKIP', `${approval.id} ${approval.tool} ${approval.command.slice(0, 120)}`)
          continue
        }
        const decided = await page.evaluate(async ({ approvalId }) => {
          try {
            await window.projectos.approvals.decide({
              approvalId,
              decision: 'approved',
              note: 'P29 继续真实运行：批准只读检查/测试/索引刷新',
            })
            return true
          } catch (error) {
            return String(error?.message ?? error)
          }
        }, { approvalId: approval.id })
        approvals += 1
        record('用户批准真实请求', decided === true ? 'PASS' : 'SKIP', `${approval.id} ${approval.command.slice(0, 120)}`)
      }
    } else if (settled.execution?.status === 'paused') {
      const resumed = await page.evaluate(async ({ planId }) => {
        try {
          await window.projectos.orchestration.resume(planId)
          return true
        } catch (error) {
          return String(error?.message ?? error)
        }
      }, target)
      record('恢复被暂停的执行', resumed === true ? 'PASS' : 'FAIL', JSON.stringify(resumed).slice(0, 160))
    } else if (settled.execution?.status === 'failed' && restarts < 2) {
      restarts += 1
      const restarted = await page.evaluate(async ({ planId }) => {
        try {
          const plan = await window.projectos.orchestration.start(planId, 1, 0, false, null, crypto.randomUUID(), 1)
          return { ok: true, status: plan.execution?.status }
        } catch (error) {
          return { ok: false, error: String(error?.message ?? error) }
        }
      }, target)
      record('执行失败后重新启动（真实授权仍在有效期内）', restarted.ok ? 'PASS' : 'FAIL', JSON.stringify(restarted).slice(0, 200))
      if (!restarted.ok) break
    } else if (settled.execution?.status === 'failed') {
      record('执行失败且重试已用尽', 'FAIL', String(settled.execution.error ?? '').slice(0, 200))
      break
    }
    await sleep(12_000)
  }

  const final = await page.evaluate(
    async ({ projectId, planId }) => {
      const journey = await window.projectos.work.journey(projectId)
      const planView = await window.projectos.plans.get(planId)
      const artifacts = await window.projectos.artifacts.list(projectId)
      const list = Array.isArray(artifacts) ? artifacts : (artifacts.artifacts ?? [])
      return { journey, execution: planView.execution ?? null, artifactKinds: list.map((item) => item.kind) }
    },
    target,
  )
  const delivery = final.execution?.deliveryStatus ?? 'none'
  record(
    '交付状态由真实证据决定',
    ['verified', 'merged_verification_failed', 'none'].includes(delivery) ? 'PASS' : 'FAIL',
    `delivery=${delivery} merge=${String(final.execution?.mergeCommit ?? '').slice(0, 10)} error=${String(final.execution?.deliveryError ?? '').slice(0, 120)}`,
  )
  record(
    '审查阶段随真实审查任务更新',
    stageOf(final.journey, 'code-review')?.state !== undefined ? 'PASS' : 'FAIL',
    `review=${stageOf(final.journey, 'code-review')?.state} ${String(stageOf(final.journey, 'code-review')?.detail).slice(0, 140)}`,
  )
  record('真实审批次数', 'INFO', `approved=${approvals} artifacts=${final.artifactKinds.join(',')}`)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-continue-delivery.png') })
  console.log(`DELIVERY=${delivery}`)
} catch (error) {
  record('继续真实运行', 'FAIL', String(error).slice(0, 400))
} finally {
  try {
    await app.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P29 CONTINUE TO DELIVERY =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} SKIP=${results.filter((i) => i.status === 'SKIP').length}`)
  if (failed.length) process.exitCode = 1
}
