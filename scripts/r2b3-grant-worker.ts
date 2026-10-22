import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { SqliteStore } from '@projectos/persistence'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { logger } from '../tests/helpers/r1-fixture.js'

interface Context {
  dbPath: string
  projectId: string
  planId: string
  taskId: string
  agentId: string
  workspaceRoot: string
  grantStartId: string
  grantToolId: string
  goPath: string
}

async function withBusyRetry<T>(fn: () => T): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return fn()
    } catch (error) {
      last = error
      if (!/SQLITE_BUSY|database is locked/i.test(error instanceof Error ? error.message : String(error))) throw error
      await new Promise((resolve) => setTimeout(resolve, 40 + attempt * 30))
    }
  }
  throw last
}

async function main(): Promise<void> {
  const [contextPath, role, resultPath] = process.argv.slice(2)
  if (!contextPath || !role || !resultPath) throw new Error('usage: worker <context> <role> <result>')
  const context = JSON.parse(readFileSync(contextPath, 'utf8')) as Context
  const deadline = Date.now() + 30_000
  while (!existsSync(context.goPath)) {
    if (Date.now() > deadline) throw new Error('barrier timeout')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  const store = new SqliteStore({ filePath: context.dbPath })
  try {
    const grants = new PlanGrantService(store, logger)
    const plan = store.read.getPlanRevision(context.planId)!
    const startGrant = grants.getById(context.grantStartId)!
    let start: 'reserved' | 'rejected' = 'rejected'
    let startError: string | null = null
    try {
      const reservation = await withBusyRetry(() => grants.reserveStart(plan, startGrant, `xproc-start-${role}`))
      start = reservation ? 'reserved' : 'rejected'
    } catch (error) {
      startError = error instanceof Error ? error.message : String(error)
    }
    const tool = await withBusyRetry(() => grants.authorizeToolCall({
      projectId: context.projectId,
      workspaceRoot: context.workspaceRoot,
      taskId: context.taskId,
      runId: `run_xproc_${role}`,
      agentId: context.agentId,
      toolName: 'write_file',
      toolCallId: `call_xproc_${role}`,
      args: { path: 'src/shared.txt', content: role },
    }))
    writeFileSync(resultPath, JSON.stringify({
      pid: process.pid,
      role,
      start,
      startError,
      toolDecision: tool.decision,
      toolReason: tool.reason,
      grantStartId: context.grantStartId,
      grantToolId: context.grantToolId,
    }, null, 2))
  } finally {
    store.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
