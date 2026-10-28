import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS, SqliteStore } from '@projectos/persistence'
import { OrchestrationScheduler } from '../apps/runtime/src/orchestrator.js'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'
import {
  FakeProvider,
  createGitProject,
  logger,
  planWithTasks,
  setup,
  waitFor,
} from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

const persona = {
  role: '替代执行者',
  background: '',
  responsibilities: '',
  principles: '',
  style: '',
  constraints: '',
  systemPrompt: 'Execute safely.',
}

function agentWithRuntime(
  harness: ReturnType<typeof setup>,
  projectId: string,
  name: string,
  role: string,
  profileId: string,
) {
  const studio = new AgentStudioService(harness.store)
  return studio.upsertAgent({
    name,
    role,
    description: '',
    category: 'quality',
    avatar: '',
    visibility: 'project',
    persona,
    skillIds: [],
    runtimeProfileIds: [profileId],
    primaryRuntimeProfileId: profileId,
    modelRef: null,
    permissions: { tools: [], files: false, shell: false, network: false },
    ownerProjectId: projectId,
  })
}

function profile(harness: ReturnType<typeof setup>, name: string, protocol: 'cli' | 'acp' | 'native') {
  const studio = new AgentStudioService(harness.store)
  const created = studio.upsertRuntime({
    name,
    protocol,
    executable: protocol === 'native' ? null : process.execPath,
    endpoint: null,
    args: [],
    authRef: null,
    modelRef: null,
    options: {},
    capabilities: {},
  })
  return harness.store.upsertRuntimeProfile({ ...created, status: 'available' })
}

describe('R2 Phase 1: missing R1 verification', () => {
  it('migrates a V18 database to V35 without losing existing data', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2-migrate-'))
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }))
    const dbPath = join(dataDir, 'legacy-v18.db')
    const legacy = new DatabaseSync(dbPath)
    try {
      legacy.exec(`CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL
      )`)
      const insert = legacy.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      )
      for (const migration of MIGRATIONS.filter((item) => item.version <= 18)) {
        legacy.exec(migration.sql)
        insert.run(
          migration.version,
          migration.name,
          createHash('sha256').update(migration.sql).digest('hex'),
          Date.now(),
        )
      }
      legacy
        .prepare(
          `INSERT INTO projects (id, name, description, root_path, status, current_stage, version, is_demo, created_at, updated_at)
           VALUES (?, ?, '', ?, 'active', 'execution', 3, 0, ?, ?)`,
        )
        .run('prj_legacy_r2', 'Legacy V18 Project', join(dataDir, 'legacy-root'), Date.now(), Date.now())
    } finally {
      legacy.close()
    }

    const before = (() => {
      const check = new DatabaseSync(dbPath)
      try {
        return check.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }
      } finally {
        check.close()
      }
    })()
    expect(Number(before.version)).toBe(18)

    const store = new SqliteStore({ filePath: dbPath })
    try {
      const versions = (
        store.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
      ).map((row) => Number(row.version))
      expect(versions).toContain(19)
      expect(versions).toContain(20)
      expect(versions).toContain(21)
      expect(versions).toContain(22)
      expect(versions).toContain(23)
      expect(versions).toContain(24)
      expect(versions).toContain(25)
      expect(versions).toContain(26)
      expect(versions).toContain(27)
      const maxVersion = store.db
        .prepare('SELECT MAX(version) AS version FROM schema_migrations')
        .get() as { version: number }
      expect(Number(maxVersion.version)).toBe(35)
      const runColumns = (store.db.prepare('PRAGMA table_info(agent_runs)').all() as Array<{ name: string }>).map(
        (column) => column.name,
      )
      expect(runColumns).toContain('deadline_at')
      expect(runColumns).toContain('budget_json')
      const slotTable = store.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_execution_slots'")
        .get() as { name?: string } | undefined
      expect(slotTable?.name).toBe('agent_execution_slots')
      const grantTable = store.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plan_execution_grants'")
        .get() as { name?: string } | undefined
      expect(grantTable?.name).toBe('plan_execution_grants')
      const plannerUsageTable = store.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'planner_usage_records'")
        .get() as { name?: string } | undefined
      expect(plannerUsageTable?.name).toBe('planner_usage_records')
      const grantColumns = (
        store.db.prepare('PRAGMA table_info(plan_execution_grants)').all() as Array<{ name: string }>
      ).map((column) => column.name)
      expect(grantColumns).toContain('reserved_runs')
      const reservationTable = store.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plan_grant_start_reservations'")
        .get() as { name?: string } | undefined
      expect(reservationTable?.name).toBe('plan_grant_start_reservations')
      const replanTable = store.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'plan_replan_proposals'")
        .get() as { name?: string } | undefined
      expect(replanTable?.name).toBe('plan_replan_proposals')
      const project = store.read.getProject('prj_legacy_r2')
      expect(project?.name).toBe('Legacy V18 Project')
      expect(project?.version).toBe(3)
      console.log(`[r2-migrate] v18 -> v24 versions=${versions.slice(-5).join(',')} project=${project?.name} preserved`)
    } finally {
      store.close()
    }
  })
  it('requires confirmation when the substitute Runtime raises the risk level', async () => {
    let handoffCreated = false
    let receiverId = ''
    const provider = new FakeProvider((call) => {
      const system = String(call.messages[0]?.content ?? '')
      if (system.includes('R2 ACP Receiver') || system.includes('R2 CLI Candidate')) {
        return { text: 'must not run' }
      }
      if (!handoffCreated) {
        if (call.toolResults.length === 0) {
          return {
            tool: {
              name: 'create_artifact',
              args: { title: '风险测试证据', kind: 'test-report', body: 'risk escalation' },
            },
          }
        }
        if (call.toolResults.length === 1) {
          handoffCreated = true
          return {
            tool: {
              name: 'handoff_task',
              args: {
                toAgentId: receiverId,
                summary: '交给 ACP 接收方',
                completed: ['seed'],
                remaining: ['continue'],
                risks: [],
                nextActions: ['continue'],
                riskLevel: 'low',
              },
            },
          }
        }
      }
      return { text: 'source done' }
    })
    const harness = setup(provider)
    cleanups.push(harness.close)
    const { store, services, orchestration, scheduler, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r2-risk-escalation')
    services.collaboration.setPolicy(project.id, 'auto')
    const acp = profile(harness, 'R2 ACP Profile', 'acp')
    const cli = profile(harness, 'R2 CLI Profile', 'cli')
    const receiver = agentWithRuntime(harness, project.id, 'R2 ACP Receiver', '测试接收方', acp.id)
    const candidate = agentWithRuntime(harness, project.id, 'R2 CLI Candidate', '测试替代', cli.id)
    receiverId = receiver.id

    const planned = planWithTasks(orchestration, project.id, [
      {
        key: 'impl',
        title: '风险升级交接',
        description: '接收方为 ACP，替代为 CLI',
        role: 'tester',
        agentId: null,
        assignmentBlocked: false,
        dependsOn: [],
        acceptanceCriteria: ['完成'],
        expectedArtifacts: [],
        requiresApproval: false,
      },
    ])
    await scheduler.start(planned.plan.id, 1, 0)
    await waitFor(
      () => services.collaboration.listHandoffs(project.id).some((item) => item.status === 'accepted'),
      15_000,
      'handoff acceptance',
    )
    // Break the ACP receiver after acceptance; the CLI candidate is eligible.
    new AgentStudioService(store).setStatus(receiver.id, 'disabled')

    const reassignment = () => {
      const handoff = services.collaboration
        .listHandoffs(project.id)
        .find((item) => item.taskId === planned.taskIds[0] && item.status === 'accepted')
      return (handoff?.payload.reassignment ?? null) as Record<string, unknown> | null
    }
    await waitFor(() => reassignment()?.status === 'needs_confirmation', 20_000, 'risk proposal')
    const proposal = reassignment()!
    expect(proposal.status).toBe('needs_confirmation')
    const reasons = (proposal.reasons as string[]).join('；')
    expect(reasons).toMatch(/Runtime 风险更高/)
    expect(reasons).toMatch(/ACP/)
    const candidates = proposal.candidates as Array<{ agentId: string; name: string }>
    expect(candidates[0]?.agentId).toBe(candidate.id)
    expect(store.read.getTask(planned.taskIds[0]!)?.status).toBe('blocked')
    console.log(`[r2-risk] candidate=${candidate.id} reasons=${JSON.stringify(proposal.reasons)}`)
  }, 60_000)

  it('stops a Run before the tool side effect when its capacity slot was fenced', async () => {
    const provider = new FakeProvider((call) =>
      call.hasToolResult
        ? { text: 'done' }
        : {
            delayMs: 400,
            tool: {
              name: 'create_artifact',
              args: { title: '不应创建', kind: 'document', body: 'fenced' },
            },
          },
    )
    const harness = setup(provider, {
      limits: { runWallClockMs: 60_000, maxAgentSteps: 5, maxToolCalls: 5 },
    })
    cleanups.push(harness.close)
    const { store, services, runner, dataDir } = harness
    const project = await createGitProject(services, dataDir, 'r2-fencing')
    const session = services.sessions.create(
      { projectId: project.id, agentId: 'agt_engineer', title: 'fencing' },
      { kind: 'system', id: 'test', name: 'test' },
    )
    const started = await runner.startRun({
      projectId: project.id,
      sessionId: session.id,
      prompt: '写一个文件（fencing 测试）',
    })
    await waitFor(() => store.getAgentExecutionSlot('agt_engineer')?.runId === started.runId, 5_000, 'slot')
    // Simulate a competing process winning the slot after the TTL boundary.
    store.db.exec("UPDATE agent_execution_slots SET expires_at = 0 WHERE agent_id = 'agt_engineer'")
    store.acquireAgentExecutionSlot('agt_engineer', 'run_thief', 60_000)

    const result = await runner.awaitRunTerminal(started.runId, { timeoutMs: 10_000, pollMs: 50 })
    expect(result.run.status).toBe('failed')
    expect(result.run.error).toMatch(/容量已失效|fencing/)
    expect(store.read.listArtifacts(project.id).filter((artifact) => artifact.runId === started.runId)).toHaveLength(0)
    expect(store.read.getToolCalls(started.runId)).toHaveLength(0)
    const thief = store.getAgentExecutionSlot('agt_engineer')
    expect(thief?.runId).toBe('run_thief')
    console.log(`[r2-fencing] run=${started.runId} status=${result.run.status} artifacts=0 thiefSlot=${thief?.runId}`)
  }, 40_000)

  it('cancels one plan, releases the Agent slot and lets a queued plan finish', async () => {
    const provider = new FakeProvider((call) => {
      if (call.messages.some((message) => message.content.includes('HANG-R2'))) return { hang: true }
      if (!call.hasToolResult) {
        return {
          tool: { name: 'create_artifact', args: { title: '取消后执行', kind: 'document', body: 'ok' } },
        }
      }
      return { text: 'done' }
    })
    const harness = setup(provider, { limits: { runWallClockMs: 60_000 } })
    cleanups.push(harness.close)
    const { store, services, runner, orchestration, scheduler, dataDir } = harness
    const second = new OrchestrationScheduler(store, services, runner, logger, dataDir)
    cleanups.push(() => second.shutdown())
    const projectA = await createGitProject(services, dataDir, 'r2-cancel-a')
    const projectB = await createGitProject(services, dataDir, 'r2-cancel-b')
    const taskTemplate = (title: string, description: string) => ({
      key: 'impl',
      title,
      description,
      role: 'custom',
      agentId: 'agt_engineer',
      assignmentReasons: ['用户手动指定'],
      assignmentBlocked: false,
      dependsOn: [],
      acceptanceCriteria: ['完成'],
      expectedArtifacts: [],
      requiresApproval: false,
    })
    const planA = planWithTasks(orchestration, projectA.id, [
      taskTemplate('HANG-R2 长任务', '持有容量槽直到取消'),
    ])
    const planB = planWithTasks(orchestration, projectB.id, [taskTemplate('排队任务 B', '等待容量释放')])

    let peak = 0
    const sampler = setInterval(() => {
      peak = Math.max(peak, store.read.countActiveRunsForAgent('agt_engineer'))
    }, 20)
    try {
      await scheduler.start(planA.plan.id, 1, 0)
      await waitFor(() => store.getAgentExecutionSlot('agt_engineer') !== null, 10_000, 'slot A')
      await second.start(planB.plan.id, 1, 0)
      await new Promise((resolve) => setTimeout(resolve, 3_000))
      expect(store.read.getTaskCard(planB.taskIds[0]!)?.status).toBe('ready')
      await scheduler.cancel(planA.plan.id)
      await waitFor(
        () => store.read.getPlanRevision(planB.plan.id)?.execution?.status === 'completed',
        25_000,
        'queued plan B completion',
      )
    } finally {
      clearInterval(sampler)
    }
    expect(store.read.getPlanRevision(planA.plan.id)?.execution?.status).toBe('cancelled')
    const runA = store.read.getLatestRunForTask(planA.taskIds[0]!)
    expect(runA?.status).toBe('cancelled')
    const runsB = store.read.listRunSummaries(projectB.id, 20).filter((run) => run.taskId === planB.taskIds[0])
    expect(runsB).toHaveLength(1)
    expect(runsB[0]?.status).toBe('completed')
    expect(peak).toBe(1)
    expect(store.getAgentExecutionSlot('agt_engineer')).toBeNull()
    console.log(`[r2-cross-plan-cancel] peak=${peak} planA=cancelled planB=completed runsB=${runsB.length} slot=free`)
  }, 60_000)
})
