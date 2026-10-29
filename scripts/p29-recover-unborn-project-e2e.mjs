/**
 * ADR-0050 — real recovery of the reported failure ("fatal: invalid reference: projectos/plan-…").
 *
 * The user's project folder is a git repository with **no commit**, so isolated worktrees could not be
 * created. This runs the real app (real Electron + preload API) against a *copy* of the user's data
 * directory and project folder, starts the failed plan again, and checks that the product now creates
 * the baseline commit, cuts the worktree from it and stops failing.
 *
 * The original data dir and project folder are never modified.
 *
 * usage: node scripts/p29-recover-unborn-project-e2e.mjs
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const sourceData = join(process.env.APPDATA ?? '', 'ProjectOS', 'data')
const sourceProject = process.argv[2] ?? 'C:\\Users\\Administrator\\Desktop\\workplace\\test'
if (!existsSync(join(sourceData, 'projectos.db'))) {
  console.error('no source database at', sourceData)
  process.exit(2)
}

const work = mkdtempSync(join(tmpdir(), 'p29-recover-'))
const dataDir = join(work, 'data')
const projectDir = join(work, 'project')
mkdirSync(dataDir, { recursive: true })
// Copy the database through SQLite itself: copying db + -wal + -shm while the app may have touched
// them produces a copy that cannot be opened, and the app then exits before Playwright connects.
const sourceSqlite = (await import('node:sqlite')).DatabaseSync
const source = new sourceSqlite(join(sourceData, 'projectos.db'), { readOnly: true })
source.exec(`VACUUM INTO '${join(dataDir, 'projectos.db').replace(/'/g, "''")}'`)
source.close()
for (const name of ['provider.json', 'ai-secrets.vault.json']) {
  if (existsSync(join(sourceData, name))) cpSync(join(sourceData, name), join(dataDir, name))
}
cpSync(sourceProject, projectDir, { recursive: true })

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

// Point the copied database at the copied folder so the original is untouched.
const sqlite = await import('node:sqlite').catch(() => null)
if (!sqlite) {
  // Node < 22.5 fallback: use the app's own database through better-sqlite3-less path is not possible,
  // so require a modern Node.
  console.error('node:sqlite is required (Node >= 22.5)')
  process.exit(2)
}
const db = new sqlite.DatabaseSync(join(dataDir, 'projectos.db'))
const projectRow = db.prepare('SELECT id, name FROM projects ORDER BY created_at DESC LIMIT 1').get()
db.prepare('UPDATE projects SET root_path = ? WHERE id = ?').run(projectDir, projectRow.id)
const planRow = db
  .prepare("SELECT id FROM plan_revisions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1")
  .get(projectRow.id)
db.close()
console.log(`copied project ${projectRow.name} -> ${projectDir}`)
console.log(`plan under test: ${planRow.id}`)

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

let app = null
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    // The user may be running the packaged app; the single-instance lock is keyed by userData, so a
    // separate user-data dir lets this verification run beside it without touching their session.
    args: ['.', `--user-data-dir=${join(work, 'userdata')}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(1500)

  const before = await page.evaluate((planId) => window.projectos.plans.get(planId), planRow.id)
  record(
    '复现起点：计划执行失败且没有 Worktree',
    (before.execution?.status === 'failed' || before.execution?.status === 'paused') && !before.execution?.workspaceRef
      ? 'PASS'
      : 'SKIP',
    `status=${before.execution?.status} error=${String(before.execution?.error ?? '').slice(0, 120)}`,
  )

  const hasCommitBefore = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: projectDir, encoding: 'utf8' }).trim().length > 0
    } catch {
      return false
    }
  })()
  record('复现起点：项目目录没有任何提交', hasCommitBefore ? 'SKIP' : 'PASS', `hasCommit=${hasCommitBefore}`)

  const started = await page.evaluate(
    async ({ planId }) => {
      try {
        const plan = await window.projectos.orchestration.start(planId, 1, 0, false, null, `p29-recover-${Date.now()}`, 0)
        return { ok: true, status: plan.execution?.status, error: plan.execution?.error ?? null }
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) }
      }
    },
    { planId: planRow.id },
  )
  record('重新启动计划（真实产品 API）', started.ok ? 'PASS' : 'FAIL', JSON.stringify(started).slice(0, 300))

  let finalPlan = null
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    finalPlan = await page.evaluate((planId) => window.projectos.plans.get(planId), planRow.id)
    if (finalPlan?.execution?.workspaceRef) break
    if (['failed', 'completed'].includes(finalPlan?.execution?.status ?? '')) break
    await page.waitForTimeout(2000)
  }

  record(
    '创建了隔离 Worktree 并从基线提交切出',
    finalPlan?.execution?.workspaceRef && /^[0-9a-f]{40}$/.test(finalPlan?.execution?.baseCommit ?? '')
      ? 'PASS'
      : 'FAIL',
    `workspaceRef=${finalPlan?.execution?.workspaceRef ?? 'null'} baseCommit=${String(finalPlan?.execution?.baseCommit ?? 'null').slice(0, 12)} status=${finalPlan?.execution?.status}`,
  )
  record(
    '不再出现 invalid reference',
    String(finalPlan?.execution?.error ?? '').includes('invalid reference') ? 'FAIL' : 'PASS',
    String(finalPlan?.execution?.error ?? '无错误').slice(0, 200),
  )
  const head = (() => {
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectDir, encoding: 'utf8' }).trim()
    } catch {
      return ''
    }
  })()
  record('项目目录已建立基线提交', /^[0-9a-f]{40}$/.test(head) ? 'PASS' : 'FAIL', head.slice(0, 12))
  await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-recover-unborn-project.png') })
} catch (error) {
  record('空仓库计划启动恢复', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P29 RECOVER UNBORN PROJECT =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length} SKIP=${results.filter((i) => i.status === 'SKIP').length}`)
  console.log(`temp copy kept at: ${work}`)
  if (failed.length) process.exitCode = 1
}
