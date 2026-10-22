#!/usr/bin/env node
/**
 * Phase 2B-3 cross-process authorization competition.
 *
 * Two real OS processes, each with its own SQLite connection and PlanGrantService,
 * race the same grant: one start reservation (maxRuns=1) and one tool-call permit
 * (maxToolCalls=1). This exercises the SQLite atomic guards, not a mocked clock.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { SqliteStore } from '@projectos/persistence'
import { logger } from '../tests/helpers/r1-fixture.js'
import { now } from '@projectos/contracts'

const root = resolve(import.meta.dirname, '..')
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b3-xproc-'))
const dbPath = join(dataDir, 'projectos.db')
const contextPath = join(dataDir, 'context.json')
const results = { alpha: join(dataDir, 'alpha.json'), beta: join(dataDir, 'beta.json') }

function runTsx(script, args, background = false) {
  const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: root,
    stdio: background ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, NODE_OPTIONS: '' },
  })
  if (!background) {
    return new Promise((resolvePromise, reject) => {
      child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${script} exited ${code}`))))
    })
  }
  return child
}

async function main() {
  console.log(`[r2b3-xproc] dataDir=${dataDir}`)
  await runTsx('scripts/r2b3-grant-prepare.ts', [dataDir, dbPath, contextPath])
  const context = JSON.parse(readFileSync(contextPath, 'utf8'))
  const alpha = runTsx('scripts/r2b3-grant-worker.ts', [contextPath, 'alpha', results.alpha], true)
  const beta = runTsx('scripts/r2b3-grant-worker.ts', [contextPath, 'beta', results.beta], true)
  const stderr = { alpha: '', beta: '' }
  alpha.stderr.on('data', (chunk) => (stderr.alpha += chunk.toString()))
  beta.stderr.on('data', (chunk) => (stderr.beta += chunk.toString()))
  writeFileSync(context.goPath, String(Date.now()))
  const codes = await Promise.all([alpha, beta].map((child) => new Promise((resolvePromise) => child.on('exit', resolvePromise))))
  const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { error: 'missing' })
  const a = read(results.alpha)
  const b = read(results.beta)

  const db = new DatabaseSync(dbPath)
  const startGrant = db.prepare('SELECT used_runs, reserved_runs, max_runs FROM plan_execution_grants WHERE id = ?').get(context.grantStartId)
  const toolGrant = db.prepare('SELECT used_tool_calls, max_tool_calls FROM plan_execution_grants WHERE id = ?').get(context.grantToolId)
  const reservations = db.prepare('SELECT status, COUNT(*) AS count FROM plan_grant_start_reservations WHERE grant_id = ? GROUP BY status').all(context.grantStartId)
  db.close()

  const store = new SqliteStore({ filePath: dbPath })
  const grants = new PlanGrantService(store, logger)
  const startRows = store.db.prepare('SELECT * FROM plan_grant_start_reservations WHERE grant_id = ?').all(context.grantStartId)
  for (const row of startRows) {
    store.db.prepare('UPDATE plan_grant_start_reservations SET reserved_at = ? WHERE id = ?').run(now() - 10 * 60_000, row.id)
  }
  const recovered = grants.recoverStartReservations()
  const afterRecovery = grants.getById(context.grantStartId)
  const finalStart = store.db.prepare('SELECT used_runs, reserved_runs FROM plan_execution_grants WHERE id = ?').get(context.grantStartId)
  const revoke = grants.revoke(context.grantToolId, 'cross-process revocation check')
  const revokedDecision = grants.authorizeToolCall({
    projectId: context.projectId,
    workspaceRoot: context.workspaceRoot,
    taskId: context.taskId,
    runId: 'run_xproc_revoked',
    agentId: context.agentId,
    toolName: 'write_file',
    toolCallId: 'call_xproc_revoked',
    args: { path: 'src/shared.txt', content: 'revoked' },
  })
  const expiredGrant = grants.issue({
    planId: context.planId,
    actions: ['plan.start', 'workspace-write'],
    allowedPaths: ['src'],
    maxRuns: 1,
    maxToolCalls: 1,
    ttlHours: 1,
    allowOverBudget: false,
    note: 'expiry check',
    confirm: true,
  })
  store.db.prepare('UPDATE plan_execution_grants SET expires_at = ? WHERE id = ?').run(now() - 1000, expiredGrant.id)
  const expiredDecision = grants.authorizeToolCall({
    projectId: context.projectId,
    workspaceRoot: context.workspaceRoot,
    taskId: context.taskId,
    runId: 'run_xproc_expired',
    agentId: context.agentId,
    toolName: 'write_file',
    toolCallId: 'call_xproc_expired',
    args: { path: 'src/shared.txt', content: 'expired' },
  })

  store.close()

  const starts = [a.start, b.start].sort()
  const tools = [a.toolDecision, b.toolDecision].sort()
  const report = {
    dataDir,
    workerExitCodes: codes,
    workers: [a, b],
    stderr,
    startGrantBeforeRecovery: startGrant,
    toolGrant,
    reservations,
    starts,
    tools,
    revokeStatus: revoke.status,
    revokedDecision,
    expiredDecision,
    recovered,
    startGrantAfterRecovery: finalStart,
    recoveryValid: afterRecovery?.valid ?? null,
    recoveryInvalidReasons: afterRecovery?.invalidReasons ?? [],
    recoveryStatus: afterRecovery?.status ?? null,
  }
  console.log('[r2b3-xproc] evidence:', JSON.stringify(report, null, 2))
  mkdirSync(join(root, 'test-results', 'r2b3'), { recursive: true })
  writeFileSync(join(root, 'test-results', 'r2b3', 'cross-process-grant.json'), JSON.stringify(report, null, 2))

  const failures = []
  if (codes.some((code) => code !== 0)) failures.push(`worker exit codes ${codes.join(',')}`)
  if (starts.filter((item) => item === 'reserved').length !== 1) failures.push(`expected exactly one reserved start, got ${JSON.stringify(starts)}`)
  if (Number(startGrant.used_runs) !== 0) failures.push(`start used_runs must remain 0 before settlement (got ${startGrant.used_runs})`)
  if (Number(startGrant.reserved_runs) !== 1) failures.push(`start reserved_runs must be 1 (got ${startGrant.reserved_runs})`)
  if (tools.filter((item) => item === 'allow').length !== 1) failures.push(`expected exactly one allowed tool call, got ${JSON.stringify(tools)}`)
  if (Number(toolGrant.used_tool_calls) !== 1) failures.push(`tool quota exceeded (${toolGrant.used_tool_calls})`)
  if (revokedDecision.decision !== 'deny') failures.push(`revoked grant must deny, got ${revokedDecision.decision}`)
  if (expiredDecision.decision !== 'deny') failures.push(`expired grant must deny, got ${expiredDecision.decision}`)
  if (recovered.released !== 1) failures.push(`expected 1 released stale reservation, got ${JSON.stringify(recovered)}`)
  if (Number(finalStart.used_runs) !== 0 || Number(finalStart.reserved_runs) !== 0) failures.push('released reservation must not consume used_runs')
  // This shared grant is intentionally exhausted by the tool quota too; the
  // start recovery assertion is about the run counter, not restoring a grant
  // whose tool budget was really consumed.
  if (failures.length > 0) {
    console.error('[r2b3-xproc] FAIL:', failures.join('; '))
    process.exitCode = 1
    return
  }
  console.log(
    `[r2b3-xproc] PASS starts=${starts.join(',')} tools=${tools.join(',')} toolUsed=${toolGrant.used_tool_calls} ` +
      `recovered=${recovered.released} pids=${a.pid},${b.pid}`,
  )
}

main()
  .catch((error) => {
    console.error('[r2b3-xproc] ERROR', error)
    process.exitCode = 1
  })
  .finally(() => rmSync(dataDir, { recursive: true, force: true }))
