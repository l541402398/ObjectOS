/**
 * Create a legacy V18 SQLite database for the packaged-app migration test.
 * Usage: tsx scripts/r2-prepare-legacy-db.ts <dbPath>
 */
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from '@projectos/persistence'

const dbPath = process.argv[2]
if (!dbPath) throw new Error('missing db path')
const db = new DatabaseSync(dbPath)
try {
  db.exec(`CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL
  )`)
  const insert = db.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  )
  for (const migration of MIGRATIONS.filter((item) => item.version <= 18)) {
    db.exec(migration.sql)
    insert.run(
      migration.version,
      migration.name,
      createHash('sha256').update(migration.sql).digest('hex'),
      Date.now(),
    )
  }
  const timestamp = Date.now()
  db.prepare(
    `INSERT INTO projects (id, name, description, root_path, status, current_stage, version, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', 'execution', 7, 0, ?, ?)`,
  ).run('prj_r2_legacy', 'R2 Legacy V18 Project', 'must survive migration', process.argv[3] ?? process.cwd(), timestamp, timestamp)
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)`,
  ).run('r2_legacy_marker', JSON.stringify({ preserved: true, version: 18 }), timestamp)
  console.log(`[r2-legacy] prepared v18 db=${dbPath}`)
} finally {
  db.close()
}
