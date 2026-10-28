/**
 * Phase 2.8.7 — PRODUCT_AUTONOMOUS vs SCRIPT_ORCHESTRATED (strictly separated).
 *
 * MODE A `--mode=script` (baseline regression, honestly labelled SCRIPT_ORCHESTRATED):
 *   the script itself calls plans.replan.apply / plans.approve / plans.grant.issue /
 *   orchestration.start / worktrees.merge. This only proves the business APIs compose.
 *
 * MODE B `--mode=product` (the acceptance target of Phase 2.8.7):
 *   the user submits the goal, approves the initial scope and handles decisions that genuinely
 *   exceed that scope. After `plans.grant.issue` the script ONLY observes: it never calls
 *   orchestration.start, plans.approve, plans.replan.apply or worktrees.merge. The product must
 *   start the plan, detect the failing check, ask the Replanner, apply the revision inside the
 *   granted envelope, re-run the agents, review the current content, and deliver.
 *
 * Every action is counted and attributed so the report cannot confuse product behaviour with
 * script behaviour. Real DeepSeek provider, real git, real `node --test`. No DB writes.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const mode = process.argv.includes('--mode=script') ? 'SCRIPT_ORCHESTRATED' : 'PRODUCT_AUTONOMOUS'
const scriptMode = mode === 'SCRIPT_ORCHESTRATED'
const root = process.cwd()
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })
const dataDir = process.env.PROJECTOS_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), scriptMode ? 'projectos-p287a-' : 'projectos-p287b-'))
mkdirSync(dataDir, { recursive: true })

const realData = join(process.env.APPDATA ?? '', 'ProjectOS', 'data')
let providerAvailable = false
for (const file of ['provider.json', 'ai-secrets.vault.json']) {
  const source = join(realData, file)
  if (!existsSync(source)) continue
  copyFileSync(source, join(dataDir, file))
  if (file === 'provider.json') providerAvailable = true
}
if (providerAvailable) {
  const p = join(dataDir, 'provider.json')
  const parsed = JSON.parse(readFileSync(p, 'utf8'))
  delete parsed.connectionsMigrated
  writeFileSync(p, JSON.stringify(parsed, null, 2), 'utf8')
}

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Which side initiated each business action. */
const actions = {
  product: { started: 0, replanApplied: 0, resumed: 0, delivered: 0, reviewEvidence: 0 },
  script: { starts: 0, replanApplies: 0, approves: 0, grants: 0, merges: 0, taskEdits: 0 },
  human: { planApprovals: 0, grants: 0, toolApprovals: 0, duplicateApprovals: 0, policyChanges: 0 },
  timeline: [],
}
const note = (event, detail) => {
  actions.timeline.push({ at: new Date().toISOString(), event, detail })
  console.log(`        · ${event}${detail ? ` — ${detail}` : ''}`)
}

let app = null
let page = null

async function waitFor(label, fn, { timeoutMs = 900_000, intervalMs = 2500 } = {}) {
  const started = Date.now()
  const deadline = started + timeoutMs
  let ticks = 0
  let last = null
  while (Date.now() < deadline) {
    last = await fn()
    if (last?.done) return { ok: true, value: last.value }
    ticks += 1
    if (ticks % 12 === 0) {
      console.log(`        … ${label} ${Math.round((Date.now() - started) / 1000)}s ${JSON.stringify(last?.hint ?? null).slice(0, 180)}`)
    }
    await sleep(intervalMs)
  }
  return { ok: false, value: last?.value ?? null, hint: last?.hint ?? null }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
const npmTest = (cwd) => {
  try {
    execFileSync('node', ['--test', 'tests/*.test.mjs'], { cwd, encoding: 'utf8', shell: true })
    return 0
  } catch (error) {
    return error.status ?? 1
  }
}

/**
 * A human approving a real tool request. Only commands/files inside the reviewed scope are
 * approved, and each decision is counted. This is the *only* place the script touches a
 * business decision in product mode, and it is exactly the "necessary human approval" the
 * spec allows.
 */
const approvedIds = new Set()
async function approveNecessary(projectId) {
  const list = await page.evaluate(async (id) => window.projectos.approvals.list({ projectId: id, runId: null }), projectId)
  for (const approval of list.approvals.filter((item) => item.status === 'pending')) {
    if (approvedIds.has(approval.id)) {
      actions.human.duplicateApprovals += 1
      continue
    }
    const tool = String(approval.request?.toolName ?? '')
    const command = String(approval.request?.args?.command ?? '')
    const path = String(approval.request?.args?.path ?? '')
    const safe =
      (tool === 'write_file' && /^(src|tests)\//.test(path)) ||
      (['run_command', 'run_tests'].includes(tool) &&
        /^(node|npm|npx|pnpm)\s/.test(command) &&
        !/rm -rf|sudo|curl|wget|git push|git reset --hard/.test(command)) ||
      (['run_command', 'run_tests'].includes(tool) && /^git (status|diff|log|show|rev-parse|ls-files|branch)/.test(command))
    if (!safe) continue
    await page.evaluate(
      async (id) => window.projectos.approvals.decide({ approvalId: id, decision: 'approved', note: 'Phase 2.8.7 授权范围内工具审批' }),
      approval.id,
    )
    approvedIds.add(approval.id)
    actions.human.toolApprovals += 1
    note('human.toolApproval', `${tool} ${command || path}`.slice(0, 100))
  }
}

/** Counts product-initiated decisions from the durable event log. */
async function attribute(projectId) {
  const events = await page.evaluate(async (id) => (await window.projectos.events.list({ projectId: id, limit: 500 })).events, projectId)
  for (const event of events) {
    const payload = event.payload ?? {}
    if (payload.authorizedBy !== 'policy') continue
    if (event.eventType === 'plan.status.changed' && payload.to === 'running' && payload.reason === 'policy.autoStart') actions.product.started += 1
    if (event.eventType === 'plan.status.changed' && payload.reason === 'approval.settled') actions.product.resumed += 1
    if (event.eventType === 'plan.replan.applied') actions.product.replanApplied += 1
    if (payload.kind === 'plan.autoDelivered') actions.product.delivered += 1
    if (payload.kind === 'plan.reviewEvidenceRecorded') actions.product.reviewEvidence += 1
  }
  return events
}

async function main() {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.'],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  page = await app.firstWindow()
  const errors = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(3000)
  record('Electron 启动', 'PASS', dataDir)
  record('E2E 模式', 'PASS', mode)
  if (!providerAvailable) {
    record('真实 Provider', 'BLOCKED', '未找到 provider.json')
    return summarise()
  }
  const connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  record('真实 Provider 就绪', connections.connections.length > 0 ? 'PASS' : 'FAIL', connections.connections[0]?.defaultModelId ?? 'none')
  if (!connections.connections.length) return summarise()

  // ---- deterministic broken fixture -------------------------------------------------
  const workspace = join(dataDir, 'ws-autonomy')
  mkdirSync(join(workspace, 'src'), { recursive: true })
  mkdirSync(join(workspace, 'tests'), { recursive: true })
  writeFileSync(
    join(workspace, 'package.json'),
    JSON.stringify({ name: 'p287', private: true, type: 'module', scripts: { test: 'node --test tests/*.test.mjs' } }, null, 2),
  )
  writeFileSync(join(workspace, 'src', 'sums.mjs'), ['export function sum(a, b) {', '  // BUG: ignores the second argument', '  return a', '}', ''].join('\n'))
  writeFileSync(
    join(workspace, 'tests', 'sums.test.mjs'),
    [
      "import test from 'node:test'",
      "import assert from 'node:assert/strict'",
      "import { sum } from '../src/sums.mjs'",
      '',
      "test('sum adds two numbers', () => { assert.equal(sum(2, 3), 5) })",
      "test('sum handles negatives', () => { assert.equal(sum(-1, -2), -3) })",
      '',
    ].join('\n'),
  )
  git(workspace, ['init', '-q'])
  git(workspace, ['config', 'user.email', 'e2e@projectos.local'])
  git(workspace, ['config', 'user.name', 'E2E'])
  git(workspace, ['add', '-A'])
  git(workspace, ['commit', '-qm', 'fixture'])
  const baseline = npmTest(workspace)
  record('夹具真实失败（宿主 node --test）', baseline !== 0 ? 'PASS' : 'FAIL', `exit=${baseline}`)

  const project = await page.evaluate(
    async ({ workspace, mode }) =>
      (
        await window.projectos.projects.create({
          name: `P287 ${mode}`,
          description: 'Phase 2.8.7',
          rootPath: workspace,
          createDirectory: false,
          initGit: false,
        })
      ).project,
    { workspace, mode },
  )
  await page.evaluate(async (id) => window.projectos.projectAnalysis.scan(id), project.id)
  const developer = await page.evaluate(
    async ({ projectId }) =>
      window.projectos.agentDefinitions.upsert({
        name: 'P287 Dev',
        role: '开发工程师',
        description: 'dev',
        category: 'engineering',
        persona: { role: '开发工程师', systemPrompt: '你是开发工程师。只做任务要求的最小修改，使用 write_file 修改真实文件，不要伪造测试结果。' },
        skillIds: [],
        runtimeProfileIds: [],
        primaryRuntimeProfileId: null,
        modelRef: null,
        permissions: { tools: [], files: true, shell: true, network: false },
        ownerProjectId: projectId,
      }),
    { projectId: project.id },
  )
  const tester = await page.evaluate(
    async ({ projectId }) =>
      window.projectos.agentDefinitions.upsert({
        name: 'P287 QA',
        role: '测试工程师',
        description: 'qa',
        category: 'engineering',
        persona: { role: '测试工程师', systemPrompt: '你是测试工程师。运行真实测试并如实报告退出码，绝不修改源文件。' },
        skillIds: [],
        runtimeProfileIds: [],
        primaryRuntimeProfileId: null,
        modelRef: null,
        permissions: { tools: [], files: true, shell: true, network: false },
        ownerProjectId: projectId,
      }),
    { projectId: project.id },
  )
  const reviewer = await page.evaluate(
    async ({ projectId }) =>
      window.projectos.agentDefinitions.upsert({
        name: 'P287 Reviewer',
        role: '审查员',
        description: 'reviewer',
        category: 'engineering',
        persona: {
          role: '审查员',
          systemPrompt:
            '你是代码审查员。只读检查真实文件（read_file / git diff），然后创建审查 Artifact：metadata.artifactType="review"，reviewedObjects 必须是真实文件路径，findings/conclusion/blockers 必须如实填写，不得伪造通过。',
        },
        skillIds: [],
        runtimeProfileIds: [],
        primaryRuntimeProfileId: null,
        modelRef: null,
        permissions: { tools: [], files: true, shell: true, network: false },
        ownerProjectId: projectId,
      }),
    { projectId: project.id },
  )

  const goal =
    '目标：让 node --test 全部通过（tests/sums.test.mjs 描述 sum 的必需行为）。计划必须包含：1) 开发任务，先只新增 src/sums.notes.mjs 导出说明常量，不改 src/sums.mjs；2) 测试任务，运行真实测试并如实报告退出码；3) 审查任务，只读检查 src/sums.mjs 与测试结果并创建审查 Artifact。三个任务按依赖顺序排列。'
  const draft = await page.evaluate(
    async ({ projectId, goal }) =>
      window.projectos.plans.generate(projectId, goal, { mode: 'ai', allowRuleFallback: false, maxTasks: 4 }),
    { projectId: project.id, goal },
  )
  record('真实 Planner 生成计划', draft.generatedBy === 'provider' && draft.tasks.length >= 2 ? 'PASS' : 'FAIL', `source=${draft.generatedBy} tasks=${draft.tasks.length}`)
  if (draft.tasks.length < 2) return summarise()

  const devTask = draft.tasks.find((t) => /developer|开发/i.test(t.role)) ?? draft.tasks[0]
  const restKeys = draft.tasks.filter((t) => t.key !== devTask.key)
  const qaTask = restKeys.find((t) => /test|qa|测试/i.test(`${t.role} ${t.title}`)) ?? restKeys[0]
  const reviewTask = restKeys.find((t) => t.key !== qaTask?.key && /review|审查|评审/i.test(`${t.role} ${t.title}`))
  const assigned = await page.evaluate(
    async ({ planId, developerId, testerId, reviewerId, devKey, qaKey, reviewKey }) => {
      const plan = await window.projectos.plans.get(planId)
      return window.projectos.plans.update({
        planId,
        tasks: plan.tasks.map((task) => ({
          ...task,
          agentId: task.key === qaKey ? testerId : reviewKey && task.key === reviewKey ? reviewerId : task.key === devKey ? developerId : developerId,
          assignmentMode: 'explicit',
        })),
      })
    },
    {
      planId: draft.id,
      developerId: developer.id,
      testerId: tester.id,
      reviewerId: reviewer.id,
      devKey: devTask.key,
      qaKey: qaTask?.key ?? null,
      reviewKey: reviewTask?.key ?? null,
    },
  )
  const approved = await page.evaluate(async (id) => window.projectos.plans.approve(id), assigned.id)
  actions.human.planApprovals += 1
  note('human.planApproved', `plan=${approved.plan.id} revision=${approved.plan.revision}`)
  // The verification task explicitly declares its diagnostic contract (ADR-2.8.3). This is a
  // user-side task contract edit made *before* the grant, not product progression.
  const board = await page.evaluate(async (id) => window.projectos.tasks.board(id), project.id)
  const qaCard = board.tasks.find((task) => task.assigneeAgentId === tester.id)
  if (qaCard) {
    await page.evaluate(
      async ({ taskId, expectedVersion }) => window.projectos.tasks.update({ taskId, expectedVersion, workType: 'diagnostic' }),
      { taskId: qaCard.id, expectedVersion: qaCard.version },
    )
    actions.script.taskEdits += 1
    note('contract.diagnosticDeclared', qaCard.id)
  }

  // ---- the user's scope authorization, which also enables the product policies ----------
  const grant = await page.evaluate(
    async ({ planId }) =>
      window.projectos.plans.grant.issue({
        planId,
        actions: ['plan.start', 'workspace-write'],
        allowedPaths: ['src', 'tests'],
        maxRuns: 6,
        maxToolCalls: 150,
        ttlHours: 3,
        allowOverBudget: false,
        note: 'Phase 2.8.7 用户授权',
        confirm: true,
      }),
    { planId: approved.plan.id },
  )
  actions.human.grants += 1
  note('human.grantIssued', grant.id)
  await page.evaluate(
    async ({ projectId }) =>
      window.projectos.actions.setAutonomy({
        projectId,
        mode: 'autonomous',
        autoStartPlans: true,
        autoApplyReplans: true,
        autoDeliver: false,
        maxAutoReplans: 3,
      }),
    { projectId: project.id },
  )
  actions.human.policyChanges += 1
  note('policy.set', 'autoStart/autoApplyReplans enabled, autoDeliver off')

  if (scriptMode) {
    await page.evaluate(
      async ({ planId, grantId }) =>
        window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()),
      { planId: approved.plan.id, grantId: grant.id },
    )
    actions.script.starts += 1
    note('SCRIPT.orchestration.start', 'script-orchestrated mode')
  }

  // ---- observation only from here on ---------------------------------------------------
  const firstPhase = await waitFor('product starts the plan', async () => {
    await approveNecessary(project.id)
    const plan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
    const status = plan.execution?.status ?? 'approved'
    return {
      done: status !== 'approved' && status !== 'draft',
      value: plan,
      hint: { status, error: String(plan.execution?.error ?? '').slice(0, 140) },
    }
  }, { timeoutMs: 240_000, intervalMs: 2000 })
  const startedByProduct = firstPhase.value?.execution?.runIds?.length > 0 || firstPhase.value?.execution?.status === 'running'
  record(
    scriptMode ? '脚本启动执行' : '**产品自行开始执行（未调用 orchestration.start）**',
    startedByProduct ? 'PASS' : 'FAIL',
    `status=${firstPhase.value?.execution?.status} runs=${firstPhase.value?.execution?.runIds?.length ?? 0}`,
  )

  const terminal = ['completed', 'failed', 'cancelled', 'paused']
  const first = await waitFor('first plan settles', async () => {
    await approveNecessary(project.id)
    const plan = await page.evaluate(async (id) => window.projectos.plans.get(id), approved.plan.id)
    const status = plan.execution?.status ?? 'approved'
    return { done: terminal.includes(status), value: plan, hint: { status, error: String(plan.execution?.error ?? '').slice(0, 160) } }
  })
  const firstStatus = first.value?.execution?.status ?? 'unknown'
  record('第一轮执行结束', firstStatus !== 'unknown' ? 'PASS' : 'FAIL', `status=${firstStatus} err=${String(first.value?.execution?.error ?? '').slice(0, 160)}`)

  const proposalWait = await waitFor('replan proposal', async () => {
    await approveNecessary(project.id)
    const list = await page.evaluate(async (id) => (await window.projectos.plans.replan.list(id, null)).proposals, project.id)
    return { done: list.length > 0, value: list, hint: { proposals: list.length, statuses: list.map((p) => p.status) } }
  }, { timeoutMs: 300_000, intervalMs: 3000 })
  let proposals = proposalWait.value ?? []
  record('Replanner 产生修订提案', proposals.length > 0 ? 'PASS' : 'FAIL', `proposals=${proposals.length}${proposals[0] ? ` trigger=${proposals[0].trigger}` : ''}`)

  // In product mode the revision must be applied by the product itself.
  const applied = await waitFor('product applies the revision', async () => {
    await approveNecessary(project.id)
    const list = await page.evaluate(async (id) => (await window.projectos.plans.replan.list(id, null)).proposals, project.id)
    proposals = list
    const auto = list.find((p) => p.status === 'applied' && /自动应用/.test(String(p.decidedReason ?? '')))
    const waiting = list.find((p) => p.status === 'proposed')
    if (auto) return { done: true, value: auto, hint: { applied: auto.id } }
    if (waiting && !scriptMode) {
      const evaluation = await page.evaluate(async (id) => window.projectos.plans.replan.evaluate(id), waiting.id)
      return { done: false, value: null, hint: { waiting: waiting.id, decision: evaluation.decision, diffs: evaluation.diffs.slice(0, 2) } }
    }
    return { done: false, value: null, hint: { proposals: list.map((p) => p.status) } }
  }, { timeoutMs: scriptMode ? 60_000 : 600_000, intervalMs: 3000 })

  if (scriptMode && !applied.value && proposals.length > 0) {
    await page.evaluate(async (id) => window.projectos.plans.replan.apply(id), proposals[0].id)
    actions.script.replanApplies += 1
    note('SCRIPT.replan.apply', proposals[0].id)
  }
  record(
    scriptMode ? '脚本应用修订' : '**产品在授权范围内自动应用修订**',
    applied.value ? 'PASS' : 'FAIL',
    scriptMode ? 'script-orchestrated' : `proposal=${applied.value?.id ?? 'none'}`,
  )

  if (scriptMode) {
    // Baseline: the script keeps driving, exactly like the 2.8.5 harness, to show the contrast.
    const list = await page.evaluate(async (id) => (await window.projectos.plans.replan.list(id, null)).proposals, project.id)
    const pending = list.find((p) => p.status === 'proposed')
    if (pending) {
      await page.evaluate(async (id) => window.projectos.plans.replan.apply(id), pending.id)
      actions.script.replanApplies += 1
    }
    const revised = await page.evaluate(async (id) => (await window.projectos.plans.list(id)).plans, project.id)
    const latest = revised.sort((a, b) => b.revision - a.revision)[0]
    if (latest?.status === 'draft') {
      const reAssigned = await page.evaluate(
        async ({ planId, developerId, testerId, reviewerId }) => {
          const plan = await window.projectos.plans.get(planId)
          return window.projectos.plans.update({
            planId,
            tasks: plan.tasks.map((task) => ({
              ...task,
              agentId: /review|审查|评审/i.test(String(task.role)) ? reviewerId : /test|qa|测试/i.test(String(task.role)) ? testerId : developerId,
              assignmentMode: 'explicit',
            })),
          })
        },
        { planId: latest.id, developerId: developer.id, testerId: tester.id, reviewerId: reviewer.id },
      )
      const reApproved = await page.evaluate(async (id) => window.projectos.plans.approve(id), reAssigned.id)
      actions.script.approves += 1
      const reGrant = await page.evaluate(
        async ({ planId }) =>
          window.projectos.plans.grant.issue({
            planId,
            actions: ['plan.start', 'workspace-write'],
            allowedPaths: ['src', 'tests'],
            maxRuns: 6,
            maxToolCalls: 150,
            ttlHours: 3,
            allowOverBudget: false,
            note: 'Phase 2.8.7 脚本模式修订授权',
            confirm: true,
          }),
        { planId: reApproved.plan.id },
      )
      actions.script.grants += 1
      await page.evaluate(
        async ({ planId, grantId }) => window.projectos.orchestration.start(planId, 2, 1, false, grantId, crypto.randomUUID()),
        { planId: reApproved.plan.id, grantId: reGrant.id },
      )
      actions.script.starts += 1
    }
  }

  const revisionPlan = await waitFor('revision plan settles', async () => {
    await approveNecessary(project.id)
    const plans = await page.evaluate(async (id) => (await window.projectos.plans.list(id)).plans, project.id)
    const latest = plans.sort((a, b) => b.revision - a.revision)[0]
    const status = latest?.execution?.status ?? 'draft'
    return { done: terminal.includes(status) && latest.revision > 1, value: latest, hint: { revision: latest?.revision, status } }
  })
  const latest = revisionPlan.value
  record('修订计划执行结束', latest ? 'PASS' : 'FAIL', `revision=${latest?.revision} status=${latest?.execution?.status} err=${String(latest?.execution?.error ?? '').slice(0, 160)}`)

  // ---- evidence: same test, exit code, review, delivery ---------------------------------
  const worktree = latest?.execution?.workspaceRef ?? workspace
  const after = npmTest(worktree)
  record('**同一测试 exit=1 → exit=0（真实工作区）**', after === 0 ? 'PASS' : 'FAIL', `exit=${after} wt=${String(worktree).split(/[\\/]/).pop()}`)

  const board2 = await page.evaluate(async (id) => window.projectos.tasks.board(id), project.id)
  const reviewArtifact = await page.evaluate(async (id) => {
    const tasks = (await window.projectos.tasks.board(id)).tasks
    const reviews = []
    for (const task of tasks) {
      const detail = await window.projectos.tasks.detail(task.id)
      for (const artifact of detail.artifacts ?? []) {
        const metadata = artifact.metadata ?? {}
        if (metadata.artifactType === 'review') reviews.push({ id: artifact.id, title: artifact.title, metadata })
      }
    }
    return reviews
  }, project.id)
  const snapshotReview = reviewArtifact.find((item) => item.metadata.reviewSnapshot?.fingerprint)
  record(
    '审查绑定真实内容快照',
    snapshotReview ? 'PASS' : 'FAIL',
    snapshotReview
      ? `artifact=${snapshotReview.id} fingerprint=${String(snapshotReview.metadata.reviewSnapshot.fingerprint).slice(0, 12)} files=${snapshotReview.metadata.reviewSnapshot.files?.length ?? 0}`
      : `reviews=${reviewArtifact.length}`,
  )
  record('审查证据来源（reviewer 身份）', snapshotReview?.metadata?.reviewerAgentId ? 'PASS' : 'FAIL', String(snapshotReview?.metadata?.reviewerName ?? 'none'))

  // ---- delivery: the product merges under an explicit policy ---------------------------
  let delivered = null
  if (!scriptMode) {
    await page.evaluate(
      async ({ projectId }) =>
        window.projectos.actions.setAutonomy({ projectId, mode: 'autonomous', autoDeliver: true, maxAutoReplans: 3 }),
      { projectId: project.id },
    )
    actions.human.policyChanges += 1
    note('policy.set', 'autoDeliver enabled by the user')
    delivered = await waitFor('product delivers', async () => {
      await approveNecessary(project.id)
      const info = await page.evaluate(async (id) => window.projectos.worktrees.info(id), latest.id)
      return { done: Boolean(info.mergedAt), value: info, hint: { mergedAt: info.mergedAt, branch: info.branch } }
    }, { timeoutMs: 240_000, intervalMs: 3000 })
    record('**产品自动交付（自动合并）**', delivered.value?.mergedAt ? 'PASS' : 'FAIL', `mergedAt=${delivered.value?.mergedAt ?? 'none'}`)
  } else {
    try {
      await page.evaluate(async (id) => window.projectos.worktrees.merge(id), latest.id)
      actions.script.merges += 1
      record('脚本合并 Worktree', 'PASS', 'script-orchestrated')
      delivered = { value: { mergedAt: Date.now() } }
    } catch (error) {
      record('脚本合并 Worktree', 'FAIL', String(error).slice(0, 160))
    }
  }

  const mainAfter = npmTest(workspace)
  record('目标分支 npm test 通过', mainAfter === 0 ? 'PASS' : 'FAIL', `exit=${mainAfter}`)

  const events = await attribute(project.id)
  record('自动恢复（审批后继续）', actions.product.resumed > 0 ? 'PASS' : 'SKIP', `autoResumed=${actions.product.resumed}`)
  record('审查证据写入 Gate', actions.product.reviewEvidence > 0 ? 'PASS' : 'SKIP', `records=${actions.product.reviewEvidence}`)

  // ---- Action Center consistency: nothing that the AI can still do may look human-only ---
  const center = await page.evaluate(async (id) => window.projectos.actions.center(id), project.id)
  const waitingForAi = center.items.filter((item) => ['replan_scope', 'plan_delivery'].includes(item.kind) && !item.stale)
  record(
    'Action Center 不伪装 AI 可自动完成的事项',
    latest?.execution?.status === 'completed' && delivered?.value?.mergedAt ? (waitingForAi.length === 0 ? 'PASS' : 'FAIL') : 'SKIP',
    `open=${waitingForAi.length} kinds=${center.items.map((i) => i.kind).join(',')}`.slice(0, 200),
  )

  record('渲染进程无 console error', errors.length === 0 ? 'PASS' : 'FAIL', errors.slice(0, 2).join(' | ').slice(0, 200))
  await page
    .evaluate(({ projectId }) => {
      location.hash = `#/projects/${projectId}/work`
    }, { projectId: project.id })
    .catch(() => undefined)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, `p287-${scriptMode ? 'a-script' : 'b-product'}-work-center.png`) }).catch(() => undefined)
  writeFileSync(
    join(dataDir, 'p287-result.json'),
    JSON.stringify({ mode, projectId: project.id, planId: latest?.id ?? null, events: events.length, actions, results }, null, 2),
  )
  summarise()
}

function summarise() {
  const failed = results.filter((i) => i.status === 'FAIL')
  console.log(`\n===== PHASE 2.8.7 ${mode} =====`)
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(
    `产品自主动作：start=${actions.product.started} replan=${actions.product.replanApplied} resume=${actions.product.resumed} deliver=${actions.product.delivered} reviewEvidence=${actions.product.reviewEvidence}`,
  )
  console.log(
    `脚本业务调用：start=${actions.script.starts} replanApply=${actions.script.replanApplies} approve=${actions.script.approves} grant=${actions.script.grants} merge=${actions.script.merges} taskEdit=${actions.script.taskEdits}`,
  )
  console.log(
    `人工介入：计划批准=${actions.human.planApprovals} 授权=${actions.human.grants} 工具审批=${actions.human.toolApprovals} 重复审批=${actions.human.duplicateApprovals} 策略变更=${actions.human.policyChanges}`,
  )
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} SKIP=${results.filter((i) => i.status === 'SKIP').length} BLOCKED=${results.filter((i) => i.status === 'BLOCKED').length}`)
  console.log(`dataDir=${dataDir}`)
  if (failed.length) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error('[fatal]', error)
    results.push({ name: 'fatal', status: 'FAIL', detail: String(error).slice(0, 400) })
    summarise()
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await app?.close()
    } catch {
      /* ignore */
    }
  })
