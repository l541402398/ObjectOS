/**
 * ProjectOS 用户手册 — UI 清点扫描器
 *
 * 目的：在隔离数据目录里启动真实 Electron 应用，用真实界面创建一个演示项目，
 * 然后逐页访问正式路由，记录：页面标题、可见按钮、空状态、报错、截图。
 *
 * 这不是截图脚本，而是“文档覆盖率”的证据来源：扫描结果直接决定手册写哪些页面、
 * 以及哪些页面必须标记为未验证。
 *
 * 用法：node docs/user-guide/tools/scan-ui.mjs
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const outDir = join(root, 'docs', 'user-guide', '_evidence')
const pageShots = join(outDir, 'pages')
mkdirSync(pageShots, { recursive: true })

const dataDir = mkdtempSync(join(tmpdir(), 'projectos-guide-scan-'))
const workspaceDir = join(dataDir, 'aurora-notes')

function prepareWorkspace() {
  const fixture = join(root, 'docs', 'user-guide', 'fixtures', 'aurora-notes')
  cpSync(fixture, workspaceDir, { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: workspaceDir, encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 'demo@example.com')
  git('config', 'user.name', 'Demo User')
  git('add', '.')
  git('commit', '-q', '-m', 'chore: aurora-notes 基线')
}

function seedProvider() {
  const real = join(process.env.APPDATA ?? '', 'ProjectOS', 'data')
  for (const file of ['provider.json', 'ai-secrets.vault.json']) {
    const source = join(real, file)
    if (existsSync(source)) copyFileSync(source, join(dataDir, file))
  }
}

const ROUTES = [
  ['项目中心', '/'],
  ['通知中心', '/notifications'],
  ['研发工作中心', '/projects/:id'],
  ['研发工作中心(work)', '/projects/:id/work'],
  ['版本与迭代', '/projects/:id/versions'],
  ['发布中心', '/projects/:id/releases'],
  ['部署中心', '/projects/:id/deployments'],
  ['资源与连接', '/projects/:id/connections'],
  ['项目姿态', '/projects/:id/overview'],
  ['任务看板', '/projects/:id/tasks'],
  ['编排工作台', '/projects/:id/orchestration'],
  ['Agent 工作台', '/projects/:id/agents'],
  ['跨会话中心', '/projects/:id/collaboration'],
  ['工作区', '/projects/:id/workspace'],
  ['知识库', '/projects/:id/knowledge'],
  ['自主运营', '/projects/:id/operations'],
  ['资源中心', '/projects/:id/resources'],
  ['审批中心', '/projects/:id/approvals'],
  ['项目设置', '/projects/:id/project-settings'],
  ['项目健康', '/projects/:id/health'],
  ['运行审计', '/projects/:id/runs'],
]
const DESIGN_LAB = ['设计实验室(独立路由)', '/design-lab']

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function slug(label, index) {
  return `${String(index + 1).padStart(2, '0')}-${label.replace(/[^\w\u4e00-\u9fa5]+/g, '-')}`
}

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

let app = null
try {
  prepareWorkspace()
  seedProvider()

  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${join(dataDir, 'userdata')}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  const consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(e.message))
  await page.waitForSelector('.po-empty-title, .v16-project-visual', { timeout: 60_000 })
  await sleep(800)
  await page.screenshot({ path: join(pageShots, '00-first-launch.png') })

  // 真实界面创建项目
  await page.getByRole('button', { name: /新建项目/ }).first().click()
  await page.getByLabel('项目名称').fill('Aurora Notes 演示')
  await page.getByLabel('项目描述').fill('本地优先 Markdown 笔记应用，用于演示完整研发生命周期。')
  await page.getByLabel('项目根目录').fill(workspaceDir)
  await page.getByRole('button', { name: '创建项目' }).click()
  await page.waitForFunction(() => document.querySelector('.po-page-title')?.textContent?.includes('Aurora'), null, {
    timeout: 30_000,
  })
  const projectId = await page.evaluate(() => location.hash.split('/')[2])
  await sleep(800)

  const inventory = []
  for (const [index, [label, template]] of ROUTES.entries()) {
    const path = template.replace(':id', projectId)
    await page.evaluate((hash) => {
      location.hash = hash
    }, path)
    await sleep(1200)
    const probe = await page.evaluate(() => {
      const text = (selector) => document.querySelector(selector)?.textContent?.trim() ?? ''
      const buttons = [...document.querySelectorAll('button')]
        .map((el) => (el.innerText || el.getAttribute('aria-label') || '').trim())
        .filter(Boolean)
      return {
        path: location.hash,
        pageTitle: text('.po-page-title'),
        eyebrow: text('.po-eyebrow'),
        emptyTitle: text('.po-empty-title') || text('[class*="empty"] strong'),
        buttons: [...new Set(buttons)].slice(0, 40),
        hasLoading: Boolean(document.querySelector('[class*="loading"], [class*="skeleton"]')),
        bodyPreview: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 600),
      }
    })
    await page.screenshot({ path: join(pageShots, `${slug(label, index)}.png`) })
    inventory.push({ label, ...probe })
    console.log(`[scan] ${label} ${probe.path} — title="${probe.pageTitle}" buttons=${probe.buttons.length}`)
  }

  // 设置中心（全局弹窗，不是路由）
  await page.evaluate((id) => {
    location.hash = `/projects/${id}`
  }, projectId)
  await sleep(800)
  // 侧边栏在 1440×900 下需要滚动才能看到「全局」分组；键盘快捷键是等价入口。
  await page.keyboard.press('Control+,')
  await sleep(1500)
  const settings = await page.evaluate(() => {
    const sections = [...document.querySelectorAll('[class*="settings-nav"] button, [role="tab"]')]
      .map((el) => (el.innerText || '').trim())
      .filter(Boolean)
    return { sections, body: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 800) }
  })
  await page.screenshot({ path: join(pageShots, '90-settings-modal.png') })

  // 设计实验室是独立路由（无项目外壳），最后访问
  await page.keyboard.press('Escape')
  await sleep(500)
  await page.evaluate(() => {
    location.hash = '/design-lab'
  })
  await sleep(2000)
  const designLab = await page.evaluate(() => ({
    path: location.hash,
    bodyPreview: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
  }))
  await page.screenshot({ path: join(pageShots, '91-design-lab.png') })

  writeFileSync(
    join(outDir, 'ui-inventory.json'),
    JSON.stringify({ scannedAt: new Date().toISOString(), projectId, workspaceDir, routes: inventory, settings, consoleErrors }, null, 2),
    'utf8',
  )
  console.log(`[scan] settings sections: ${settings.sections.join(' / ')}`)
  console.log(`[scan] console errors: ${consoleErrors.length}`)
  console.log(`[scan] evidence → ${outDir}`)
} catch (error) {
  console.error('[scan] FAIL', error)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
