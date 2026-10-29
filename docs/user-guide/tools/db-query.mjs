import { DatabaseSync } from 'node:sqlite'

const file = process.argv[2]
const db = new DatabaseSync(file, { readOnly: true })
const tables = db
  .prepare("select name from sqlite_master where type='table'")
  .all()
  .map((row) => row.name)
const targets = tables.filter((name) => /connection|ai_/i.test(name))
console.log('tables:', targets.join(', '))
for (const table of targets) {
  const rows = db.prepare(`select * from ${table}`).all()
  console.log(`\n${table}: ${rows.length} rows`)
  for (const row of rows.slice(0, 5)) console.log(JSON.stringify(row).slice(0, 500))
}
