/**
 * ADR-0055 — a decided approval must be read-only.
 *
 * Reproduces the reported defect ("已经执行审批的记录，怎么还能继续点击审批") against a real profile that
 * already contains decided approvals: opens 审批, selects an approved record, and asserts the decision
 * form is gone (no 批准/拒绝, no note box) and the persisted decision is shown instead.
 *
 * usage: node scripts/p29-approvals-readonly-e2e.mjs <dataDir>
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const sourceData = process.argv[2]
if (!sourceData || !existsSync(join(sourceData, 'projectos.db'))) {
  console.error('usage: node scripts/p29-approvals-readonly-e2e.mjs <dataDir with decided approvals>')
  process.exit(2)
}

const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-approvals-'))
const dataDir = join(work, 'data')
mkdirSync(dataDir, { recursive: true })

const { DatabaseSync } = await import('node:sqlite')
const source = new DatabaseSync(join(sourceData, 'projectos.db'), { readOnly: true })
source.exec(`VACUUM INTO '${join(dataDir, 'projectos.db').replace(/'/g, "''")}'`)
const projectRow = source.prepare("SELECT project_id AS id FROM approvals WHERE status IN ('approved','rejected') ORDER BY requested_at DESC LIMIT 1").get()
source.close()
if (!projectRow) {
  console.error('no decided approval in that profile')
  process.exit(2)
}

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${join(work, 'userdata')}`],
  cwd: resolve(root, 'apps/desktop'),
  env,
  timeout: 60_000,
})

try {
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(1200)
  await page.evaluate((projectId) => {
    window.location.hash = `#/projects/${projectId}/approvals`
  }, projectRow.id)
  await page.waitForTimeout(2000)

  const historyTab = page.getByText('历史', { exact: true }).first()
  if (await historyTab.count()) {
    await historyTab.click()
    await page.waitForTimeout(800)
  }
  const decidedRow = page.getByText('已批准', { exact: true }).first()
  if ((await decidedRow.count()) === 0) {
    record('找到已批准的历史记录', 'FAIL', 'no 已批准 row')
  } else {
    record('找到已批准的历史记录', 'PASS')
    await decidedRow.click()
    await page.waitForTimeout(900)
  }

  const state = await page.evaluate(() => {
    const rail = document.querySelector('.ap-action')
    const text = (rail?.textContent ?? '').replace(/\s+/g, ' ')
    const buttons = [...(rail?.querySelectorAll('button') ?? [])].map((button) => button.textContent?.trim() ?? '')
    return {
      decidedBlock: document.querySelectorAll('[data-testid="approval-decided"]').length,
      approveButton: buttons.filter((label) => label === '批准').length,
      rejectButton: buttons.filter((label) => label === '拒绝').length,
      noteBox: rail?.querySelectorAll('textarea').length ?? 0,
      text: text.slice(0, 220),
    }
  })
  record(
    '已处理审批展示只读结论，不再出现批准/拒绝',
    state.decidedBlock > 0 && state.approveButton === 0 && state.rejectButton === 0 && state.noteBox === 0 ? 'PASS' : 'FAIL',
    JSON.stringify(state),
  )
  record('只读结论包含可追溯信息', /已批准|已拒绝/.test(state.text) ? 'PASS' : 'FAIL', state.text)

  // Text floor: no rendered content text below 12px on this page.
  const tiny = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll('.ap-action *, .ap-detail *, .ap-list *')]
      .filter((node) => node.children.length === 0 && (node.textContent ?? '').trim().length > 1)
    return nodes
      .map((node) => ({
        text: (node.textContent ?? '').trim().slice(0, 24),
        size: parseFloat(getComputedStyle(node).fontSize),
        cls: node.className || null,
        parent: node.parentElement?.className || null,
        em: getComputedStyle(node).fontSize,
      }))
      .filter((entry) => entry.size < 12)
      .slice(0, 10)
  })
  record('审批页没有小于 12px 的内容文字', tiny.length === 0 ? 'PASS' : 'FAIL', JSON.stringify(tiny))

  await page.screenshot({ path: join(root, 'docs', 'screenshots', 'p29-approvals-decided-readonly.png') })
} catch (error) {
  record('已处理审批只读验收', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P29 APPROVALS READ-ONLY =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  console.log(`workdir: ${work}`)
  if (failed.length) process.exitCode = 1
}
