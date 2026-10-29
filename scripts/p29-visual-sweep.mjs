/**
 * Phase 2.9-P0 — visual regression sweep after the 12px text floor and the shell migration.
 * Uses a real profile (decided approvals + a finished run) and captures the main business pages at
 * 1440 and 1024, reporting horizontal overflow and any remaining sub-12px content text.
 *
 * usage: node scripts/p29-visual-sweep.mjs <dataDir>
 */
import { _electron as electron } from 'playwright-core'
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const sourceData = process.argv[2]
if (!sourceData || !existsSync(join(sourceData, 'projectos.db'))) {
  console.error('usage: node scripts/p29-visual-sweep.mjs <dataDir>')
  process.exit(2)
}

const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-sweep-'))
const dataDir = join(work, 'data')
mkdirSync(dataDir, { recursive: true })

const { DatabaseSync } = await import('node:sqlite')
const source = new DatabaseSync(join(sourceData, 'projectos.db'), { readOnly: true })
source.exec(`VACUUM INTO '${join(dataDir, 'projectos.db').replace(/'/g, "''")}'`)
const projectRow = source.prepare('SELECT id FROM projects ORDER BY updated_at DESC LIMIT 1').get()
source.close()

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

const PAGES = [
  { key: 'work', label: '研发工作中心' },
  { key: 'tasks', label: '任务看板' },
  { key: 'orchestration', label: '编排工作台' },
  { key: 'approvals', label: '审批' },
  { key: 'runs', label: '运行审计' },
  { key: 'versions', label: '版本与迭代' },
  { key: 'releases', label: '发布中心' },
  { key: 'deployments', label: '部署中心' },
  { key: 'connections', label: '交付资源' },
  { key: 'resources', label: '资源与连接' },
  { key: 'collaboration', label: 'Agent 协作' },
  { key: 'agents', label: 'Agent 工作台' },
  { key: 'overview', label: '项目概览' },
]

try {
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(1200)
  const theme = process.env.P29_THEME === 'dark' ? 'dark' : 'light'
  if (theme === 'dark') {
    // Apply the same attribute the UI store uses (useUiEffects), then prove the tokens really flipped.
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark'
      document.documentElement.style.colorScheme = 'dark'
    })
    await page.waitForTimeout(500)
    const ink = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--pdl-ink').trim(),
    )
    record('深色主题令牌已生效', ink === '#eff4ff' ? 'PASS' : 'FAIL', `--pdl-ink=${ink}`)
  }
  const screenshotName = (key, size) =>
    `p29-sweep-${key}-${size}${theme === 'dark' ? '-dark' : ''}.png`
  const window = await app.browserWindow(page)

  for (const size of [
    { label: '1440', width: 1440, height: 900 },
    { label: '1024', width: 1024, height: 700 },
  ]) {
    await window.evaluate((w, dims) => w.setSize(dims.width, dims.height), size)
    await page.waitForTimeout(500)
    for (const target of PAGES) {
      await page.evaluate(
        ({ projectId, route }) => {
          window.location.hash = `#/projects/${projectId}/${route}`
        },
        { projectId: projectRow.id, route: target.key },
      )
      await page.waitForTimeout(900)
      // Wait for real content, not the skeleton: measuring a loading page would fake a PASS.
      await page
        .waitForFunction(() => (document.querySelector('.po-main')?.querySelectorAll('*').length ?? 0) > 120, null, { timeout: 15000 })
        .catch(() => undefined)
      await page.waitForTimeout(700)
      const metrics = await page.evaluate(() => {
        const heading = (document.querySelector('.po-main h1')?.textContent ?? document.querySelector('.po-main h2')?.textContent ?? '').trim()
        const notFound = (document.querySelector('.po-main')?.textContent ?? '').includes('页面不存在')
        const main = document.querySelector('.po-main')
        const nodes = [...(main?.querySelectorAll('*') ?? [])].filter(
          (node) => node.children.length === 0 && (node.textContent ?? '').trim().length > 1,
        )
        const tiny = nodes
          .map((node) => parseFloat(getComputedStyle(node).fontSize))
          .filter((size) => size < 12)
        return {
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          tiny: tiny.length,
          journey: document.querySelectorAll('[data-testid="goal-journey"]').length,
          notFound,
          heading: heading.slice(0, 40),
        }
      })
      const pass = metrics.overflowX === 0 && metrics.tiny === 0 && metrics.journey > 0 && metrics.notFound === false && Boolean(metrics.heading)
      record(`${size.label} ${target.label}`, pass ? 'PASS' : 'FAIL', JSON.stringify(metrics))
      await page.screenshot({ path: join(root, 'docs', 'screenshots', screenshotName(target.key, size.label)) })
    }

    // Settings is a global modal, not a route: open it with the product's own shortcut (⌘,/Ctrl+,).
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Control+,')
    await page.waitForTimeout(900)
    {
      const modal = await page.evaluate(() => {
        const root = document.querySelector('.po-settings-dialog')
        const nodes = [...(root?.querySelectorAll('*') ?? [])].filter(
          (node) => node.children.length === 0 && (node.textContent ?? '').trim().length > 1,
        )
        return {
          open: Boolean(root),
          tiny: nodes.map((node) => parseFloat(getComputedStyle(node).fontSize)).filter((size) => size < 12).length,
        }
      })
      record(`${size.label} 设置弹层`, modal.open && modal.tiny === 0 ? 'PASS' : 'FAIL', JSON.stringify(modal))
      await page.screenshot({ path: join(root, 'docs', 'screenshots', screenshotName('settings', size.label)) })
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
  }
} catch (error) {
  record('视觉巡检', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P29 VISUAL SWEEP =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  console.log(`theme: ${process.env.P29_THEME ?? 'light'}`)
  console.log(`workdir: ${work}`)
  if (failed.length) process.exitCode = 1
}
