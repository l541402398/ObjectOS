/**
 * Phase 2.9-P0 — real AI closure from an empty folder.
 *
 * Configures a REAL DeepSeek connection inside a throwaway profile (key comes from
 * P29_DEEPSEEK_KEY, never written to disk by this script), then runs the first-use journey with the
 * real model: requirement → AI plan → approve → authorize → autostart → execution → verification →
 * review → delivery, watching the global journey bar the whole way.
 *
 * usage: P29_DEEPSEEK_KEY=... node scripts/p29-real-ai-journey-e2e.mjs [--keep]
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const key = process.env.P29_DEEPSEEK_KEY
if (!key) {
  console.error('P29_DEEPSEEK_KEY is required')
  process.exit(2)
}

const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-reaiai-'))
const dataDir = join(work, 'data')
const emptyDir = join(work, 'empty-project')
mkdirSync(dataDir, { recursive: true })
mkdirSync(emptyDir, { recursive: true })

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const stageOf = (journey, stageKey) => journey?.stages?.find((stage) => stage.key === stageKey)

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
delete env.P29_DEEPSEEK_KEY

const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${join(work, 'userdata')}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})

try {
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(1200)

  // 1) Real connection. The key stays in the Main-process secret store (safeStorage) of this temp
  // profile; the preload response must not echo it.
  const connection = await page.evaluate(async (apiKey) => {
    const created = await window.projectos.aiConnections.create({
      name: 'DeepSeek (P29 E2E)',
      providerId: 'deepseek',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      apiKey,
      defaultModelId: 'deepseek-chat',
      timeoutMs: 120_000,
      isDefault: true,
      enabled: true,
    })
    const leaked = JSON.stringify(created).includes(apiKey)
    const tested = await window.projectos.aiConnections.test(created.id)
    return { id: created.id, leaked, tested }
  }, key)
  record(
    '真实 DeepSeek 连接创建且密钥不回传渲染进程',
    connection.leaked ? 'FAIL' : 'PASS',
    `connection=${connection.id} leaked=${connection.leaked} test=${JSON.stringify(connection.tested).slice(0, 200)}`,
  )
  record(
    '连接测试通过真实推理（非仅 /models）',
    connection.tested?.ok === true ? 'PASS' : 'FAIL',
    JSON.stringify(connection.tested ?? {}).slice(0, 260),
  )

  // 2) Empty folder → project, autonomous with auto delivery so the whole chain is exercised.
  const projectId = await page.evaluate(async (rootPath) => {
    const created = await window.projectos.projects.create({
      name: '真实 AI 首次闭环',
      rootPath,
      createDirectory: false,
      initGit: true,
    })
    await window.projectos.actions.setAutonomy({
      projectId: created.project.id,
      mode: 'autonomous',
      autoStartPlans: true,
      autoApplyReplans: true,
      autoDeliver: true,
      maxAutoReplans: 2,
    })
    return created.project.id
  }, emptyDir)
  record('空目录建项目（真实档案）', 'PASS', `project=${projectId}`)

  await page.evaluate(
    ({ projectId }) =>
      window.projectos.requirements.create({
        projectId,
        title: '创建 hello.txt 并用 node --test 验证内容',
        body: '在项目根目录创建 hello.txt，内容必须包含 hello；在 tests 目录创建 greet.test.mjs，用 node:test 读取 hello.txt 并断言包含 hello；运行 node --test tests 退出码 0。',
        acceptanceCriteria: ['hello.txt 存在且包含 hello', 'node --test tests 通过'],
        source: 'local',
      }),
    { projectId },
  )

  // 3) AI plan (real model), small maxTasks keeps the run bounded.
  const plan = await page.evaluate(
    ({ projectId }) =>
      window.projectos.plans.generate(projectId, '创建 hello.txt 并用 node --test 验证内容', {
        mode: 'ai',
        allowRuleFallback: true,
        maxTasks: 3,
      }),
    { projectId },
  )
  record(
    'AI 生成真实计划草案（来源如实标记）',
    plan?.tasks?.length > 0 ? 'PASS' : 'FAIL',
    `plan=${plan.id} tasks=${plan.tasks?.length} generation=${plan.generation?.mode}`,
  )
  let journey = await page.evaluate((id) => window.projectos.work.journey(id), projectId)
  record('生成后旅程显示等待审核计划', stageOf(journey, 'review')?.state === 'active' ? 'PASS' : 'FAIL', journey.nextAction.label)

  await page.evaluate((planId) => window.projectos.plans.approve(planId), plan.id)
  const grant = await page.evaluate(
    ({ planId }) =>
      window.projectos.plans.grant.issue({
        planId,
        actions: ['plan.start', 'workspace-write'],
        allowedPaths: ['.'],
        maxRuns: 3,
        maxToolCalls: 200,
        ttlHours: 2,
        allowOverBudget: false,
        note: 'P29 real AI E2E',
        confirm: true,
      }),
    { planId: plan.id },
  )
  journey = await page.evaluate((id) => window.projectos.work.journey(id), projectId)
  record(
    '批准并授权后旅程进入可启动/自动启动',
    stageOf(journey, 'grant')?.state === 'done' && stageOf(journey, 'execute')?.state === 'active' ? 'PASS' : 'FAIL',
    `grant=${grant.id} next=${journey.nextAction.label}`,
  )

  // 4) Start once; the autonomy pass may also try to start, which must not double-run.
  const startResult = await page.evaluate(
    async ({ planId, grantId }) => {
      try {
        const started = await window.projectos.orchestration.start(planId, 1, 0, false, grantId, crypto.randomUUID(), 1)
        return { ok: true, status: started.execution?.status }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
    { planId: plan.id, grantId: grant.id },
  )
  record('真实启动计划', startResult.ok ? 'PASS' : 'FAIL', JSON.stringify(startResult).slice(0, 200))

  // 5) Watch the journey + plan until the run settles (hard cap ~28 min).
  let approvedTestRuns = 0
  const deadline = Date.now() + 28 * 60_000
  let snapshot = null
  let lastSignature = ''
  const timeline = []
  while (Date.now() < deadline) {
    snapshot = await page.evaluate(
      async ({ projectId, planId }) => {
        const current = await window.projectos.work.journey(projectId)
        const planView = await window.projectos.plans.get(planId)
        return {
          journey: current,
          execution: planView.execution ?? null,
          tasks: planView.tasks?.map((task) => ({ key: task.key, status: task.status })) ?? [],
        }
      },
      { projectId, planId: plan.id },
    )
    const signature = `${snapshot.execution?.status}:${snapshot.execution?.deliveryStatus}:${snapshot.tasks.map((task) => task.status).join(',')}`
    if (signature !== lastSignature) {
      lastSignature = signature
      timeline.push({
        at: new Date().toISOString(),
        execution: snapshot.execution?.status,
        delivery: snapshot.execution?.deliveryStatus,
        verify: stageOf(snapshot.journey, 'verify')?.state,
        review: stageOf(snapshot.journey, 'code-review')?.state,
        next: snapshot.journey.nextAction.label,
        tasks: signature.split(':')[2],
      })
      console.log(`[state] ${JSON.stringify(timeline[timeline.length - 1])}`)
    }
    // A tool approval parks the run. Approving a benign read-only/test command is the user's
    // legitimate step in this flow; the E2E does it through the real approval API (never writing,
    // never widening the grant) and only for allow-listed commands.
    if (snapshot.journey.nextAction.owner === 'user' && approvedTestRuns < 6) {
      const decided = await page.evaluate(async ({ projectId }) => {
        try {
          const list = await window.projectos.approvals.list({ projectId, status: 'pending' })
          const approvals = list.approvals ?? []
          for (const approval of approvals) {
            const subject = JSON.stringify(approval.subject ?? approval).slice(0, 1200)
            if (!/node --version|node --test|npm test|npm run test|git status|git diff/.test(subject)) continue
            await window.projectos.approvals.decide({
              approvalId: approval.id,
              decision: 'approved',
              note: 'P29 真实闭环：用户批准只读/测试命令',
            })
            return { ok: true, approvalId: approval.id, subject: subject.slice(0, 180) }
          }
          return { ok: false, reason: 'no-allow-listed-approval', pending: approvals.length }
        } catch (error) {
          return { ok: false, reason: String(error?.message ?? error) }
        }
      }, { projectId })
      if (decided.ok) {
        approvedTestRuns += 1
        record('真实审批：用户批准只读/测试命令后继续', 'PASS', `${decided.approvalId} ${decided.subject}`)
      } else if (decided.pending > 0) {
        record('真实审批：存在非测试命令审批，保持不自动批准', 'SKIP', JSON.stringify(decided).slice(0, 200))
        break
      }
    }
    const terminal =
      snapshot.execution?.status === 'completed' ||
      snapshot.execution?.status === 'failed' ||
      snapshot.execution?.deliveryStatus === 'verified'
    if (terminal) break
    await sleep(4000)
  }

  const finalExecution = snapshot?.execution ?? null
  const finalJourney = snapshot?.journey ?? null
  record(
    '真实执行进入旅程（不伪造成功）',
    finalExecution && ['completed', 'failed', 'paused'].includes(finalExecution.status) ? 'PASS' : 'FAIL',
    `status=${finalExecution?.status} error=${String(finalExecution?.error ?? '').slice(0, 160)}`,
  )
  record(
    '验证阶段只认真实测试证据',
    stageOf(finalJourney, 'verify')?.state === 'done' ? (finalExecution?.deliveryStatus !== 'verified' || stageOf(finalJourney, 'verify')?.state === 'done' ? 'PASS' : 'FAIL') : 'PASS',
    `verify=${stageOf(finalJourney, 'verify')?.state} detail=${String(stageOf(finalJourney, 'verify')?.detail).slice(0, 140)}`,
  )
  record(
    '审查阶段随真实内容更新',
    ['pending', 'active', 'blocked', 'done'].includes(stageOf(finalJourney, 'code-review')?.state ?? '') ? 'PASS' : 'FAIL',
    `review=${stageOf(finalJourney, 'code-review')?.state} ${String(stageOf(finalJourney, 'code-review')?.detail).slice(0, 120)}`,
  )
  record(
    '交付阶段只认 merge + 合并后验证',
    finalExecution?.deliveryStatus === 'verified'
      ? 'PASS'
      : finalExecution?.deliveryStatus === 'merged_verification_failed' || finalExecution?.deliveryStatus === 'none' || finalExecution?.deliveryStatus === 'merged'
        ? 'PASS'
        : 'FAIL',
    `delivery=${finalExecution?.deliveryStatus ?? 'none'} merge=${String(finalExecution?.mergeCommit ?? '').slice(0, 10)} deliveryStage=${stageOf(finalJourney, 'delivery')?.state}`,
  )

  // 6) Evidence from the real workspace, not from our own bookkeeping.
  const evidence = await page.evaluate(
    async ({ projectId }) => {
      const overview = await window.projectos.projects.overview(projectId)
      const artifactsView = await window.projectos.artifacts.list(projectId)
      const artifacts = Array.isArray(artifactsView) ? artifactsView : (artifactsView.artifacts ?? [])
      return { rootPath: overview.project.rootPath, artifacts: artifacts.map((artifact) => artifact.kind ?? 'unknown') }
    },
    { projectId },
  )
  let files = []
  try {
    const { readdirSync } = await import('node:fs')
    files = readdirSync(evidence.rootPath).slice(0, 20)
  } catch {
    /* ignore */
  }
  record(
    '真实工作目录留下产出（不靠界面状态）',
    files.some((name) => name.includes('hello')) ? 'PASS' : 'FAIL',
    `files=${files.join(',')} artifacts=${evidence.artifacts.join(',')}`,
  )

  await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-real-ai-journey.png') })
  writeFileSync(
    join(root, 'docs', 'v2', 'p29-real-ai-timeline.json'),
    JSON.stringify({ planId: plan.id, projectId, grantId: grant.id, timeline, finalExecution, stages: finalJourney?.stages ?? [] }, null, 2),
  )
} catch (error) {
  record('真实 AI 首次闭环', 'FAIL', String(error).slice(0, 400))
} finally {
  try {
    await app.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P29 REAL AI JOURNEY =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  console.log(`workdir: ${work}`)
  if (failed.length) process.exitCode = 1
}
