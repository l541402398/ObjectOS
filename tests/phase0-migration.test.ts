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
  it('keeps the V24 fixture readable and upgrades it to V31 with lifecycle and release defaults', () => {
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
      expect(Number(store.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version)).toBe(31)
      const tables = new Set(
        (store.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name),
      )
      expect(tables.has('change_requests')).toBe(true)
      expect(tables.has('approval_requests')).toBe(true)
      expect(tables.has('release_candidates')).toBe(true)
      expect(tables.has('releases')).toBe(true)
      expect(tables.has('deployments')).toBe(true)
      expect(tables.has('deployment_events')).toBe(true)
      expect(store.read.getProject('prj_v24_fixture')?.currentStage).toBe('testing')
      expect(store.read.getTask('tsk_v24_fixture')?.title).toBe('Legacy V24 task')
      expect(store.read.listProducts('prj_v24_fixture')).toHaveLength(1)
      expect(store.read.listProductVersions('prj_v24_fixture')[0]?.version).toBe('0.1.0')
      expect(store.read.listEnvironments('prj_v24_fixture')[0]?.key).toBe('local')
      expect(store.read.getProjectFocus('prj_v24_fixture')?.subjectType).toBe('version')
      expect(store.read.getPlanRevision('pln_v24_fixture')?.goal).toContain('Legacy plan')
      expect(store.read.listArtifacts('prj_v24_fixture', 'tsk_v24_fixture')).toHaveLength(1)

      const backupPath = join(dir, 'backup-v31.sqlite')
      store.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)
      const backup = new DatabaseSync(backupPath, { readOnly: true })
      try {
        expect((backup.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok')
        expect(Number((backup.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version)).toBe(31)
        expect(Number((backup.prepare('SELECT COUNT(*) AS count FROM projects WHERE id=?').get('prj_v24_fixture') as { count: number }).count)).toBe(1)
        expect(Number((backup.prepare('SELECT COUNT(*) AS count FROM releases').get() as { count: number }).count)).toBe(0)
      } finally {
        backup.close()
      }
    } finally {
      store.close()
    }
  })
})
