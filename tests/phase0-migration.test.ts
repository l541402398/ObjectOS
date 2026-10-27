import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { SqliteStore } from '@projectos/persistence'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'v24-baseline.sqlite')
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

describe('Phase 0 V24 historical database fixture', () => {
  it('keeps the frozen V24 schema and legacy project/task/plan/artifact readable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'projectos-v24-fixture-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const dbPath = join(dir, 'v24-copy.sqlite')
    copyFileSync(fixture, dbPath)

    const raw = new DatabaseSync(dbPath)
    try {
      const max = raw.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }
      expect(Number(max.version)).toBe(24)
      const project = raw.prepare('SELECT id, name, current_stage FROM projects WHERE id = ?').get('prj_v24_fixture') as {
        id: string
        name: string
        current_stage: string
      }
      expect(project).toEqual({ id: 'prj_v24_fixture', name: 'V24 Legacy Fixture', current_stage: 'testing' })
    } finally {
      raw.close()
    }

    const store = new SqliteStore({ filePath: dbPath })
    try {
      expect(Number(store.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version)).toBe(24)
      expect(store.read.getProject('prj_v24_fixture')?.currentStage).toBe('testing')
      expect(store.read.getTask('tsk_v24_fixture')?.title).toBe('Legacy V24 task')
      expect(store.read.getPlanRevision('pln_v24_fixture')?.goal).toContain('Legacy plan')
      expect(store.read.listArtifacts('prj_v24_fixture', 'tsk_v24_fixture')).toHaveLength(1)
    } finally {
      store.close()
    }
  })
})
