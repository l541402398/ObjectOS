import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from '@projectos/persistence'

const target = join(process.cwd(), 'tests', 'fixtures', 'v24-baseline.sqlite')
mkdirSync(dirname(target), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  const path = target + suffix
  if (existsSync(path)) rmSync(path, { force: true })
}

const db = new DatabaseSync(target)
try {
  db.exec(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL
  )`)
  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 24)) {
    db.exec(migration.sql)
    insertMigration.run(
      migration.version,
      migration.name,
      createHash('sha256').update(migration.sql).digest('hex'),
      Date.now(),
    )
  }

  const now = Date.now()
  db.prepare(
    `INSERT INTO projects (id, name, description, root_path, status, current_stage, version, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', 'testing', 7, 0, ?, ?)`,
  ).run(
    'prj_v24_fixture',
    'V24 Legacy Fixture',
    'Frozen V24 database fixture for Phase 0 migration and compatibility tests.',
    join(process.cwd(), 'tests', 'fixtures', 'v24-project'),
    now,
    now,
  )

  const stages = ['ideation', 'requirements', 'architecture', 'planning', 'implementation', 'testing', 'release', 'maintenance']
  const insertStage = db.prepare(
    'INSERT INTO project_stages (project_id, stage, status, position, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  stages.forEach((stage, index) => {
    insertStage.run('prj_v24_fixture', stage, index <= 5 ? 'completed' : 'pending', index + 1, now)
  })

  db.prepare(
    `INSERT INTO tasks (id, project_id, title, description, status, priority, acceptance_json, labels_json, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'review', 2, ?, ?, 3, ?, ?)`,
  ).run(
    'tsk_v24_fixture',
    'prj_v24_fixture',
    'Legacy V24 task',
    'A task created before V25 lifecycle fields existed.',
    JSON.stringify(['Existing acceptance criteria must remain readable']),
    JSON.stringify(['developer', 'plan']),
    now,
    now,
  )

  db.prepare(
    `INSERT INTO plan_revisions (id, project_id, revision, status, goal, plan_json, approved_at, created_at, updated_at)
     VALUES (?, ?, 1, 'approved', ?, ?, ?, ?, ?)`,
  ).run(
    'pln_v24_fixture',
    'prj_v24_fixture',
    'Legacy plan approved before V26 plan-kind fields existed.',
    JSON.stringify({
      id: 'pln_v24_fixture',
      projectId: 'prj_v24_fixture',
      revision: 1,
      status: 'approved',
      goal: 'Legacy plan approved before V26 plan-kind fields existed.',
      tasks: [{ key: 'T1', title: 'Legacy V24 task' }],
    }),
    now,
    now,
    now,
  )

  db.prepare(
    `INSERT INTO artifacts (id, project_id, task_id, kind, title, body, verified_at, is_demo, created_at)
     VALUES (?, ?, ?, 'test-report', ?, ?, ?, 0, ?)`,
  ).run(
    'art_v24_fixture',
    'prj_v24_fixture',
    'tsk_v24_fixture',
    'Legacy V24 test report',
    'legacy fixture evidence',
    now,
    now,
  )
} finally {
  db.close()
}

const check = new DatabaseSync(target)
try {
  const max = check.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }
  const project = check.prepare('SELECT id, name, current_stage FROM projects WHERE id = ?').get('prj_v24_fixture')
  console.log(JSON.stringify({ target, maxVersion: Number(max.version), project }))
} finally {
  check.close()
}
