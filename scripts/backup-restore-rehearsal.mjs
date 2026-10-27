import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const defaultDb = join(homedir(), 'AppData', 'Roaming', 'ProjectOS', 'data', 'projectos.db')
const source = process.env.PROJECTOS_DB ?? defaultDb
const backupDir =
  process.env.PROJECTOS_PHASE0_BACKUP_DIR ??
  join(homedir(), 'Desktop', 'workplace', '_v2_backups', 'phase0')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(backupDir, `projectos-v24-${stamp}.sqlite`)
const restore = join(backupDir, `projectos-v24-${stamp}-restore-check.sqlite`)

if (!existsSync(source)) {
  console.error(JSON.stringify({ ok: false, error: `database not found: ${source}` }))
  process.exit(2)
}
mkdirSync(backupDir, { recursive: true })

for (const suffix of ['', '-wal', '-shm']) {
  const from = source + suffix
  if (existsSync(from)) copyFileSync(from, backup + suffix)
}

function openAndInspect(path, checkpoint) {
  const db = new DatabaseSync(path)
  try {
    if (checkpoint) db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    const integrity = db.prepare('PRAGMA integrity_check').get()
    const version = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()
    const projects = db.prepare('SELECT COUNT(*) AS n FROM projects').get()
    const tasks = db.prepare('SELECT COUNT(*) AS n FROM tasks').get()
    const plans = db.prepare('SELECT COUNT(*) AS n FROM plan_revisions').get()
    const approvals = db.prepare('SELECT COUNT(*) AS n FROM approvals').get()
    return {
      integrity: Object.values(integrity ?? {})[0],
      maxVersion: Number(version?.version ?? 0),
      projects: Number(projects?.n ?? 0),
      tasks: Number(tasks?.n ?? 0),
      plans: Number(plans?.n ?? 0),
      approvals: Number(approvals?.n ?? 0),
    }
  } finally {
    db.close()
  }
}

const backupInspection = openAndInspect(backup, true)
const hash = createHash('sha256').update(readFileSync(backup)).digest('hex')
const size = statSync(backup).size
copyFileSync(backup, restore)
const restoreInspection = openAndInspect(restore, false)
const equal = JSON.stringify(backupInspection) === JSON.stringify(restoreInspection)
console.log(
  JSON.stringify(
    {
      ok: equal && backupInspection.integrity === 'ok',
      source,
      backup,
      restore,
      sha256: hash,
      bytes: size,
      backupInspection,
      restoreInspection,
      equal,
    },
    null,
    2,
  ),
)
if (!equal || backupInspection.integrity !== 'ok') process.exit(1)
