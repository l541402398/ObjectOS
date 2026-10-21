#!/usr/bin/env node
/**
 * R1-A / P0-08B cross-process concurrency proof.
 *
 * Two real OS processes, each with its own SQLite connection and Scheduler, are
 * released by a file barrier at the same moment and both try to start a Plan
 * for the same Agent (global capacity 1). The parent samples the database and
 * asserts: peak concurrent Run for that Agent <= 1, no duplicate Run, and both
 * plans complete without manual retry.
 *
 * Everything runs against a temporary data directory and database.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(import.meta.dirname, '..')
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r1a-xproc-'))
const dbPath = join(dataDir, 'projectos.db')
const contextPath = join(dataDir, 'context.json')
const results = { alpha: join(dataDir, 'alpha.json'), beta: join(dataDir, 'beta.json') }

function runTsx(script, args, { background = false } = {}) {
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
  console.log(`[r1a-xproc] dataDir=${dataDir}`)
  await runTsx('scripts/r1a-prepare.ts', [dataDir, dbPath, contextPath])
  const context = JSON.parse(readFileSync(contextPath, 'utf8'))
  console.log(`[r1a-xproc] agent=${context.agentId} plans=${Object.values(context.roles).map((r) => r.planId).join(',')}`)

  // Observe the real database while both processes run.
  const reader = new DatabaseSync(dbPath)
  const peak = { runs: 0, slots: 0, samples: 0 }
  const samples = []
  const sampling = setInterval(() => {
    try {
      const running = reader
        .prepare(`SELECT COUNT(*) AS c FROM agent_runs WHERE agent_id = ? AND status = 'running'`)
        .get(context.agentId).c
      const slots = reader
        .prepare(`SELECT COUNT(*) AS c FROM agent_execution_slots WHERE expires_at > ?`)
        .get(Date.now()).c
      peak.runs = Math.max(peak.runs, Number(running))
      peak.slots = Math.max(peak.slots, Number(slots))
      peak.samples += 1
      samples.push({ at: Date.now(), running: Number(running), slots: Number(slots) })
    } catch {
      // database may be locked for a moment; skip the sample
    }
  }, 20)

  const startedAt = Date.now()
  const alpha = runTsx('scripts/r1a-worker.ts', [contextPath, 'alpha', results.alpha], { background: true })
  const beta = runTsx('scripts/r1a-worker.ts', [contextPath, 'beta', results.beta], { background: true })
  const output = { alpha: '', beta: '' }
  alpha.stderr.on('data', (chunk) => (output.alpha += chunk.toString()))
  beta.stderr.on('data', (chunk) => (output.beta += chunk.toString()))
  // Release both workers at the same instant.
  writeFileSync(join(dataDir, 'go.flag'), String(Date.now()))

  const codes = await Promise.all(
    [alpha, beta].map(
      (child) =>
        new Promise((resolvePromise) => child.on('exit', (code) => resolvePromise(code))),
    ),
  )
  clearInterval(sampling)
  reader.close()

  const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { error: 'missing result' })
  const a = read(results.alpha)
  const b = read(results.beta)
  const verify = new DatabaseSync(dbPath)
  const rows = verify
    .prepare(
      `SELECT r.id, r.status, r.started_at, r.finished_at, t.title
       FROM agent_runs r LEFT JOIN tasks t ON t.id = r.task_id
       WHERE r.agent_id = ? ORDER BY r.created_at ASC`,
    )
    .all(context.agentId)
  const openSlots = verify
    .prepare(`SELECT COUNT(*) AS c FROM agent_execution_slots WHERE expires_at > ?`)
    .get(Date.now()).c
  verify.close()

  const overlaps = []
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const first = rows[i]
      const second = rows[j]
      const firstEnd = first.finished_at ?? Number.MAX_SAFE_INTEGER
      const secondEnd = second.finished_at ?? Number.MAX_SAFE_INTEGER
      if (first.started_at < secondEnd && second.started_at < firstEnd) {
        overlaps.push([first.id, second.id])
      }
    }
  }

  const report = {
    dataDir,
    durationMs: Date.now() - startedAt,
    workerExitCodes: codes,
    workers: [a, b],
    peak,
    runRows: rows,
    overlaps,
    openSlots: Number(openSlots),
    stderr: output,
  }
  console.log('[r1a-xproc] evidence:', JSON.stringify(report, null, 2))

  const failures = []
  if (codes.some((code) => code !== 0)) failures.push(`worker exit codes ${codes.join(',')}`)
  if (a.planStatus !== 'completed' || b.planStatus !== 'completed') failures.push('both plans must complete')
  if (peak.runs > 1) failures.push(`peak concurrent runs ${peak.runs} > 1`)
  if (peak.slots > 1) failures.push(`peak capacity slots ${peak.slots} > 1`)
  if (overlaps.length > 0) failures.push(`runs overlapped: ${JSON.stringify(overlaps)}`)
  if (rows.length !== 2) failures.push(`expected 2 runs, got ${rows.length}`)
  if (rows.some((row) => row.status !== 'completed')) failures.push('not every run completed')
  if (Number(openSlots) !== 0) failures.push(`capacity slot still held after completion: ${openSlots}`)
  if (peak.samples === 0) failures.push('no database samples collected')

  if (failures.length > 0) {
    console.error('[r1a-xproc] FAIL:', failures.join('; '))
    process.exitCode = 1
    return
  }
  console.log(
    `[r1a-xproc] PASS peakRuns=${peak.runs} peakSlots=${peak.slots} runs=${rows.length} ` +
      `overlaps=0 openSlots=0 samples=${peak.samples} workers=${a.pid},${b.pid}`,
  )
}

main()
  .catch((error) => {
    console.error('[r1a-xproc] ERROR', error)
    process.exitCode = 1
  })
  .finally(() => {
    rmSync(dataDir, { recursive: true, force: true })
  })
