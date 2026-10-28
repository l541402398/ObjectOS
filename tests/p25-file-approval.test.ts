import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertApprovalSnapshotValid,
  captureWriteSnapshot,
  hashText,
  listApprovalFileTargets,
  planWriteSnapshot,
  persistWriteSnapshot,
} from '../apps/runtime/src/file-approval.js'
import { setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p25-file-approval-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Minimal store stub: the tables are created by the real migration set. */
function harnessStore() {
  const harness = setup()
  cleanups.push(harness.close)
  const projectId = 'prj_test'
  harness.store.db
    .prepare("INSERT OR IGNORE INTO projects (id, name, root_path, status, current_stage, created_at, updated_at) VALUES (?, 'p', ?, 'active', 'build', ?, ?)")
    .run(projectId, workspace(), Date.now(), Date.now())
  harness.store.db
    .prepare(
      `INSERT OR IGNORE INTO approval_requests
       (id, project_id, subject_type, subject_id, subject_revision, content_fingerprint, subject_snapshot_json, status, requested_by, requested_at)
       VALUES (?, ?, 'tool_call', 'tc', 1, ?, '{}', 'pending', 'u', ?)`,
    )
    .run('apr_test', projectId, 'f'.repeat(32), Date.now())
  return harness
}

describe('Phase 2.5 approval file snapshots', () => {
  it('captures the baseline and proposed hash for a new file', () => {
    const store = harnessStore()
    const root = workspace()
    const file = join(root, 'src', 'new.ts')
    mkdirSync(join(root, 'src'), { recursive: true })
    const plan = planWriteSnapshot(root, { path: 'src/new.ts', content: 'export const a = 1\n' })!
    expect(plan.target.changeType).toBe('added')
    expect(plan.target.baselineHash).toBeNull()
    expect(plan.target.proposedHash).toBe(hashText('export const a = 1\n'))
    persistWriteSnapshot(store.store, 'apr_test', root, plan)
    const targets = listApprovalFileTargets(store.store, 'apr_test')
    expect(targets).toHaveLength(1)
    expect(targets[0]!.baselineHash).toBeNull()
    expect(file).toContain('new.ts')
  })

  it('rejects the approval when the file changed AFTER the preview (before approval)', () => {
    const store = harnessStore()
    const root = workspace()
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')

    // Preview: the approval snapshot is created from the current content.
    const plan = planWriteSnapshot(root, { path: 'src/a.ts', content: 'export const a = 2\n' })!
    persistWriteSnapshot(store.store, 'apr_test', root, plan)
    expect(() => assertApprovalSnapshotValid(store.store, 'apr_test', root)).not.toThrow()

    // Somebody else edits the file while the approval is still pending.
    writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 999\n')
    expect(() => assertApprovalSnapshotValid(store.store, 'apr_test', root)).toThrow(/审批快照已过期/)
  })

  it('rejects the approval when the file changed AFTER approval, before the write', () => {
    const store = harnessStore()
    const root = workspace()
    writeFileSync(join(root, 'b.ts'), 'v1\n')
    const captured = captureWriteSnapshot(store.store, { approvalId: 'apr_test', projectRoot: root, path: 'b.ts', content: 'v2\n' })
    expect(captured.fingerprint).toHaveLength(32)
    // Approval is accepted, then the file drifts before the tool runs.
    expect(() => assertApprovalSnapshotValid(store.store, 'apr_test', root)).not.toThrow()
    writeFileSync(join(root, 'b.ts'), 'v3-competitor\n')
    expect(() => assertApprovalSnapshotValid(store.store, 'apr_test', root)).toThrow(/审批快照已过期/)
  })

  it('rejects deletion of a file whose approval expects a baseline', () => {
    const store = harnessStore()
    const root = workspace()
    writeFileSync(join(root, 'c.ts'), 'keep\n')
    const plan = planWriteSnapshot(root, { path: 'c.ts', content: 'next\n' })!
    persistWriteSnapshot(store.store, 'apr_test', root, plan)
    rmSync(join(root, 'c.ts'))
    expect(() => assertApprovalSnapshotValid(store.store, 'apr_test', root)).toThrow(/c\.ts/)
  })

  it('validates every file in a multi-file approval and names the drifted path', () => {
    const store = harnessStore()
    const root = workspace()
    writeFileSync(join(root, 'one.ts'), 'one\n')
    writeFileSync(join(root, 'two.ts'), 'two\n')
    for (const name of ['one.ts', 'two.ts']) {
      const plan = planWriteSnapshot(root, { path: name, content: `${name} v2\n` })!
      persistWriteSnapshot(store.store, 'apr_test', root, plan)
    }
    expect(listApprovalFileTargets(store.store, 'apr_test')).toHaveLength(2)
    expect(() => assertApprovalSnapshotValid(store.store, 'apr_test', root)).not.toThrow()

    writeFileSync(join(root, 'two.ts'), 'two changed\n')
    let message = ''
    try {
      assertApprovalSnapshotValid(store.store, 'apr_test', root)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('two.ts')
    expect(message).not.toContain('one.ts')
  })

  it('refuses to snapshot a path outside the project root', () => {
    const root = workspace()
    expect(() => planWriteSnapshot(root, { path: '../escape.ts', content: 'x' })).toThrow(/越出项目根目录/)
  })
})
