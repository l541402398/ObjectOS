#!/usr/bin/env node
/**
 * R1-B / P0-02: real Runtime child-process kill/restart E2E.
 *
 * This script starts the *built* Runtime bundle (`apps/runtime/dist/index.mjs`)
 * as a real OS child process, drives it over its NDJSON stdio protocol, lets a
 * CLI Runtime Agent perform a real file write, then kills the process with an
 * OS-level forced termination (`taskkill /T /F` on Windows) while the Run is
 * still executing. It restarts the Runtime, lets startup recovery run and
 * verifies SQLite + workspace files directly with `node:sqlite`.
 *
 * Covered windows:
 *   A. Run running, tool side effect written, completion not recorded  (real kill)
 *   B. Run waiting for a CLI Runtime approval                            (real kill)
 *   C. Handoff accepted + schedulerPreparedAt written, no continuedAt     (seeded state)
 *   D. Pending Inbox delivery                                             (seeded state)
 *
 * C/D are explicitly seeded state (fault injection), not real kill windows; the
 * report states that distinction. No real model/provider or user data is used.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(import.meta.dirname, '..')
const runtimeEntry = join(root, 'apps', 'runtime', 'dist', 'index.mjs')
if (!existsSync(runtimeEntry)) {
  console.error(`[r1b] missing ${runtimeEntry}; run "pnpm build:runtime" first`)
  process.exit(1)
}

const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r1b-'))
const dbPath = join(dataDir, 'projectos.db')
const projectRoot = join(dataDir, 'workspace')
const sideEffectPath = join(dataDir, 'side-effect.json')
mkdirSync(projectRoot, { recursive: true })
writeFileSync(join(projectRoot, 'README.md'), '# R1-B isolated workspace\n')

const childScript = [
  "const fs = require('node:fs')",
  'fs.writeFileSync(process.env.R1B_SIDE_EFFECT, JSON.stringify({ pid: process.pid, at: Date.now(), argv: process.argv.length }))',
  'setTimeout(() => {}, 600000)',
].join('\n')

const db = () => new DatabaseSync(dbPath)
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

class RuntimeClient {
  constructor(label) {
    this.label = label
    this.pending = new Map()
    this.seq = 0
    this.stderr = ''
    this.stdoutLines = []
    this.exited = null
    this.child = spawn(process.execPath, [runtimeEntry], {
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PROJECTOS_DATA_DIR: dataDir,
        PROJECTOS_DB_PATH: dbPath,
        PROJECTOS_SEED_DEMO: '0',
        PROJECTOS_PROVIDER_JSON: JSON.stringify({
          provider: 'openai-compatible',
          protocol: 'openai-chat',
          baseUrl: 'http://127.0.0.1:9/v1',
          model: 'r1b-noop',
          apiKey: '',
          temperature: 0,
        }),
        R1B_SIDE_EFFECT: sideEffectPath,
        PROJECTOS_RUN_TIMEOUT_MS: '600000',
      },
    })
    this.ready = new Promise((resolvePromise) => (this.resolveReady = resolvePromise))
    this.rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    this.rl.on('line', (line) => this.handleLine(line))
    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString()
    })
    this.child.on('exit', (code, signal) => {
      this.exited = { code, signal }
      for (const [, entry] of this.pending) entry.reject(new Error(`${this.label} exited (${code ?? signal})`))
      this.pending.clear()
    })
  }

  handleLine(line) {
    if (!line.trim()) return
    let frame
    try {
      frame = JSON.parse(line)
    } catch {
      return
    }
    this.stdoutLines.push(frame)
    if (frame.kind === 'hello') {
      this.hello = frame
      this.resolveReady(frame)
      return
    }
    if (frame.kind === 'response') {
      const entry = this.pending.get(frame.id)
      if (!entry) return
      this.pending.delete(frame.id)
      if (frame.ok) entry.resolve(frame.result)
      else entry.reject(new Error(`${this.label} ${entry.method}: ${frame.error?.message ?? 'unknown error'}`))
    }
  }

  request(method, input = {}, timeoutMs = 30_000) {
    this.seq += 1
    const id = `${this.label}-${this.seq}`
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${this.label} ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer)
          resolvePromise(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.child.stdin.write(`${JSON.stringify({ kind: 'request', id, method, input })}\n`)
    })
  }

  async stop() {
    try {
      await this.request('runtime.shutdown', {}, 10_000)
    } catch {
      // fall through to a hard kill
    }
    const deadline = Date.now() + 5_000
    while (!this.exited && Date.now() < deadline) await sleep(50)
    if (!this.exited) this.kill('SIGKILL')
  }

  kill(reason) {
    if (!this.child.pid) return
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true })
    } else {
      try {
        process.kill(this.child.pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
    this.killReason = reason
  }
}

function query(sql, ...params) {
  const connection = db()
  try {
    return connection.prepare(sql).all(...params)
  } finally {
    connection.close()
  }
}

function exec(sql, ...params) {
  const connection = db()
  try {
    connection.prepare(sql).run(...params)
  } finally {
    connection.close()
  }
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const state = {}
function assert(condition, message) {
  if (!condition) throw new Error(message)
  state.checks.push(message)
}

async function main() {
  state.checks = []
  state.dataDir = dataDir
  state.dbPath = dbPath
  console.log(`[r1b] dataDir=${dataDir}`)

  // ------------------------------------------------------------------ first boot
  let runtime = new RuntimeClient('boot1')
  globalThis.__r1bRuntime = runtime
  const hello1 = await runtime.ready
  state.firstPid = hello1.pid
  console.log(`[r1b] runtime boot #1 pid=${hello1.pid}`)

  const project = await runtime.request('project.create', {
    name: 'R1B Kill Restart',
    description: '',
    rootPath: projectRoot,
    createDirectory: false,
    initGit: true,
  })
  const projectId = project.project.id

  const profile = await runtime.request('runtime.upsert', {
    name: 'R1B CLI Runtime',
    protocol: 'cli',
    executable: process.execPath,
    endpoint: null,
    args: ['-e', childScript],
    authRef: null,
    modelRef: null,
    options: {},
    capabilities: {},
  })
  await runtime.request('runtime.detect', { profileId: profile.id })
  const profiles = await runtime.request('runtime.list', {})
  const detected = profiles.profiles.find((item) => item.id === profile.id)
  assert(detected?.status === 'available', 'CLI Runtime profile detected as available')

  async function createAgent(name) {
    return runtime.request('agentDefinition.upsert', {
      name,
      role: 'Worker',
      description: 'R1-B kill/restart worker',
      category: 'code',
      avatar: '',
      visibility: 'project',
      persona: {
        role: 'Worker',
        background: '',
        responsibilities: '',
        principles: '',
        style: '',
        constraints: '',
        systemPrompt: 'You are a CLI worker.',
      },
      skillIds: [],
      runtimeProfileIds: [profile.id],
      primaryRuntimeProfileId: profile.id,
      modelRef: null,
      permissions: { tools: [], files: true, shell: true, network: false },
      ownerProjectId: projectId,
    })
  }

  const agentA = await createAgent('R1B Worker A')
  const agentB = await createAgent('R1B Worker B')
  const sessionA = await runtime.request('session.create', {
    projectId,
    agentId: agentA.id,
    title: 'r1b running session',
  })
  const sessionB = await runtime.request('session.create', {
    projectId,
    agentId: agentB.id,
    title: 'r1b approval session',
  })
  const taskA = await runtime.request('task.create', {
    projectId,
    title: 'R1B running task',
    description: 'Run then kill the Runtime',
    priority: 2,
    acceptanceCriteria: [],
    labels: [],
    assigneeAgentId: agentA.id,
    dependsOn: [],
  })
  const taskB = await runtime.request('task.create', {
    projectId,
    title: 'R1B approval task',
    description: 'Wait for approval then kill the Runtime',
    priority: 2,
    acceptanceCriteria: [],
    labels: [],
    assigneeAgentId: agentB.id,
    dependsOn: [],
  })

  // Run A: approve the CLI execution so the child process actually starts.
  const runA = await runtime.request('run.start', {
    projectId,
    sessionId: sessionA.session.id,
    taskId: taskA.task.id,
    prompt: 'R1B run A: write the side-effect file and keep running.',
  })
  state.runA = runA.runId
  const approvalA = await waitFor(
    async () => {
      const list = await runtime.request('approval.list', { projectId, runId: runA.runId })
      return list.approvals.find((item) => item.status === 'pending') ?? null
    },
    15_000,
    'runtime approval A',
  )
  await runtime.request('approval.decide', { approvalId: approvalA.id, decision: 'approved', note: 'r1b e2e' })
  await waitFor(async () => existsSync(sideEffectPath), 20_000, 'CLI side effect file')
  const runARunning = await waitFor(
    async () => {
      const detail = await runtime.request('run.get', { runId: runA.runId })
      return detail.run.status === 'running' ? detail : null
    },
    15_000,
    'run A running',
  )
  assert(runARunning.run.status === 'running', 'Run A is executing the CLI child process')
  const sideEffectBefore = readFileSync(sideEffectPath, 'utf8')

  // Run B: leave the CLI approval pending (no child process yet).
  const runB = await runtime.request('run.start', {
    projectId,
    sessionId: sessionB.session.id,
    taskId: taskB.task.id,
    prompt: 'R1B run B: wait for approval, never approve.',
  })
  state.runB = runB.runId
  const approvalB = await waitFor(
    async () => {
      const list = await runtime.request('approval.list', { projectId, runId: runB.runId })
      return list.approvals.find((item) => item.status === 'pending') ?? null
    },
    15_000,
    'runtime approval B',
  )

  // Seeded windows (fault injection): an accepted Handoff that was prepared but
  // never continued, and a pending Inbox delivery.
  const handoff = await runtime.request('handoff.request', {
    taskId: taskB.task.id,
    toAgentId: agentA.id,
    summary: 'R1B seeded handoff',
    sessionId: sessionB.session.id,
    completed: ['seeded'],
    remaining: ['seeded'],
    risks: [],
    nextActions: [],
    artifactRefs: [],
    riskLevel: 'low',
  })
  await runtime.request('handoff.accept', { handoffId: handoff.handoff.id, sessionId: sessionA.session.id })
  exec(
    "UPDATE handoffs SET payload_json = json_set(payload_json, '$.schedulerPreparedAt', ?) WHERE id = ?",
    Date.now(),
    handoff.handoff.id,
  )
  await runtime.request('inbox.send', {
    projectId,
    fromSessionId: sessionA.session.id,
    toSessionId: sessionB.session.id,
    type: 'agent.message',
    body: 'R1B seeded inbox delivery',
    taskId: null,
    wake: false,
  })

  const beforeKill = {
    runs: query('SELECT id, status, error FROM agent_runs ORDER BY created_at'),
    tasks: query('SELECT id, status FROM tasks ORDER BY created_at'),
    leases: query('SELECT task_id, holder_id, expires_at FROM task_leases'),
    slots: query('SELECT agent_id, run_id, expires_at FROM agent_execution_slots'),
    approvals: query('SELECT id, run_id, status FROM approvals ORDER BY requested_at'),
    handoffs: query('SELECT id, status, payload_json FROM handoffs'),
    inbox: query('SELECT id, status, attempts FROM agent_inbox'),
  }
  assert(beforeKill.runs.filter((row) => row.status === 'running').length === 1, 'exactly one Run is running before the kill')
  assert(beforeKill.slots.filter((row) => row.expires_at > Date.now()).length === 2, 'both running/waiting Runs hold a global Agent slot')

  // ------------------------------------------------------------- real OS kill
  const killAt = Date.now()
  runtime.kill('r1b-os-kill')
  await waitFor(async () => Boolean(runtime.exited), 15_000, 'process exit')
  state.kill = { at: killAt, pid: hello1.pid, exit: runtime.exited }
  console.log(`[r1b] killed runtime pid=${hello1.pid} exit=${JSON.stringify(runtime.exited)}`)

  const afterKill = {
    runs: query('SELECT id, status, error FROM agent_runs ORDER BY created_at'),
    tasks: query('SELECT id, status FROM tasks ORDER BY created_at'),
    leases: query('SELECT task_id, holder_id, expires_at FROM task_leases'),
    slots: query('SELECT agent_id, run_id, expires_at FROM agent_execution_slots'),
    approvals: query('SELECT id, status FROM approvals ORDER BY requested_at'),
  }
  assert(afterKill.runs.find((row) => row.id === runA.runId)?.status === 'running', 'killed Run A is still persisted as running (no terminal write)')
  assert(afterKill.tasks.find((row) => row.id === taskA.task.id)?.status === 'running', 'Task A stays running after the kill')
  assert(afterKill.leases.some((row) => row.task_id === taskA.task.id && row.expires_at > Date.now()), 'Task A lease is still held by the dead Runtime')
  assert(afterKill.slots.some((row) => row.run_id === runA.runId), 'Agent slot is still held by the dead Runtime')
  assert(readFileSync(sideEffectPath, 'utf8') === sideEffectBefore, 'CLI child wrote its side effect before the kill')

  // ---------------------------------------------------------- restart + recover
  runtime = new RuntimeClient('boot2')
  globalThis.__r1bRuntime = runtime
  const hello2 = await runtime.ready
  state.secondPid = hello2.pid
  console.log(`[r1b] runtime boot #2 pid=${hello2.pid}`)

  await waitFor(
    async () => query('SELECT status FROM agent_runs WHERE id = ?', runA.runId)[0]?.status === 'needs_reconciliation',
    20_000,
    'Run A reconciliation',
  )
  await waitFor(
    async () => query('SELECT status FROM agent_runs WHERE id = ?', runB.runId)[0]?.status === 'needs_reconciliation',
    20_000,
    'Run B reconciliation',
  )

  const afterRestart = {
    runs: query('SELECT id, status, error FROM agent_runs ORDER BY created_at'),
    tasks: query('SELECT id, status FROM tasks ORDER BY created_at'),
    leases: query('SELECT task_id, holder_id, expires_at FROM task_leases'),
    slots: query('SELECT agent_id, run_id, expires_at FROM agent_execution_slots'),
    approvals: query('SELECT id, status FROM approvals ORDER BY requested_at'),
    handoffs: query('SELECT id, status, payload_json FROM handoffs'),
    inbox: query('SELECT id, status, attempts FROM agent_inbox'),
  }
  const runAAfter = afterRestart.runs.find((row) => row.id === runA.runId)
  const runBAfter = afterRestart.runs.find((row) => row.id === runB.runId)
  assert(runAAfter?.status === 'needs_reconciliation', 'Run A is needs_reconciliation after restart')
  assert(/副作用|核对/.test(runAAfter?.error ?? ''), 'Run A records that side effects are unknown')
  assert(runBAfter?.status === 'needs_reconciliation', 'Run B (approval window) is needs_reconciliation after restart')
  assert(afterRestart.tasks.find((row) => row.id === taskA.task.id)?.status === 'blocked', 'Task A is blocked after restart')
  assert(afterRestart.tasks.find((row) => row.id === taskB.task.id)?.status === 'blocked', 'Task B is blocked after restart')
  assert(
    afterRestart.leases.filter((row) => [taskA.task.id, taskB.task.id].includes(row.task_id)).every((row) => row.expires_at === 0),
    'Task leases were released by recovery',
  )
  assert(
    afterRestart.slots.filter((row) => [runA.runId, runB.runId].includes(row.run_id)).every((row) => row.expires_at === 0),
    'Agent capacity slots were released by recovery',
  )
  assert(
    afterRestart.approvals.find((row) => row.id === approvalA.id)?.status === 'approved' &&
      afterRestart.approvals.find((row) => row.id === approvalB.id)?.status === 'cancelled',
    'pending approval was cancelled while the historic approval is preserved',
  )
  assert(afterRestart.runs.length === beforeKill.runs.length, 'restart created no new Run (no automatic replay)')
  assert(readFileSync(sideEffectPath, 'utf8') === sideEffectBefore, 'restart did not repeat the file side effect')

  // Seeded state must survive untouched and must not spawn anything.
  const handoffAfter = afterRestart.handoffs.find((row) => row.id === handoff.handoff.id)
  const handoffPayload = JSON.parse(handoffAfter?.payload_json ?? '{}')
  assert(handoffAfter?.status === 'accepted', 'seeded Handoff stays accepted across the restart')
  assert(handoffPayload.schedulerPreparedAt > 0 && !handoffPayload.continuedAt, 'seeded Handoff payload (prepared, not continued) is preserved')
  assert(handoffPayload.targetRunId === undefined, 'seeded Handoff did not create a target Run after recovery')
  assert(afterRestart.inbox.length === 1 && afterRestart.inbox[0].status === beforeKill.inbox[0].status, 'pending Inbox delivery survives the restart unchanged')

  // Give recovery timers a chance to misbehave, then assert idempotency.
  await sleep(3_000)
  const settled = {
    runs: query('SELECT id, status FROM agent_runs ORDER BY created_at'),
    handoffs: query('SELECT id, status, payload_json FROM handoffs'),
    inbox: query('SELECT id, status, attempts FROM agent_inbox'),
  }
  assert(settled.runs.length === beforeKill.runs.length, 'no Run was created after the restart settled')
  assert(JSON.parse(settled.handoffs[0].payload_json).continuedAt === undefined, 'Handoff was not auto-continued without a plan tick')
  state.after = {
    runs: settled.runs,
    tasks: afterRestart.tasks,
    leases: afterRestart.leases,
    slots: afterRestart.slots,
    approvals: afterRestart.approvals,
    handoffs: settled.handoffs,
    inbox: settled.inbox,
    sideEffect: JSON.parse(readFileSync(sideEffectPath, 'utf8')),
  }

  await runtime.request('runtime.shutdown', {})
  await waitFor(async () => Boolean(runtime.exited), 10_000, 'clean shutdown')
  console.log('[r1b] evidence:', JSON.stringify({ ...state, beforeKill, afterKill, killPid: hello1.pid, restartPid: hello2.pid }, null, 2))
  console.log(`[r1b] PASS checks=${state.checks.length} firstPid=${hello1.pid} restartPid=${hello2.pid}`)
}

main()
  .catch((error) => {
    console.error('[r1b] FAIL', error)
    console.error('[r1b] stderr:', globalThis.__r1bRuntime?.stderr ?? '')
    process.exitCode = 1
  })
  .finally(() => {
    const running = globalThis.__r1bRuntime
    try {
      running?.kill('cleanup')
    } catch {
      // ignore
    }
    rmSync(dataDir, { recursive: true, force: true })
  })
