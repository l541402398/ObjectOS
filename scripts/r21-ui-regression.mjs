/**
 * R2.1 P1-09 real Electron UI regression.
 *
 * Uses a seeded isolated data dir and real mouse/keyboard input (no DOM/JS
 * click workarounds). Covers Settings (incl. the former 新增连接 hit-test bug),
 * Runs/Reconcile, Collaboration/Handoff, Agent Workbench, Orchestration drawer,
 * light/dark, 125% zoom, resized window, collapsed sidebar, error and modal
 * focus/layering states.
 */
import { _electron as electron } from 'playwright-core'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r21-ui-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r21-ui-user-'))
const shots = join(root, 'test-results', 'r21')
mkdirSync(shots, { recursive: true })

const prepare = spawnSync(
  process.execPath,
  ['--import', 'tsx', 'scripts/r21-prepare-ui.ts', dataDir],
  { cwd: root, encoding: 'utf8' },
)
if (prepare.status !== 0) {
  console.error(prepare.stdout, prepare.stderr)
  process.exit(prepare.status ?? 1)
}
console.log(prepare.stdout.trim())
const context = JSON.parse(readFileSync(join(dataDir, 'context.json'), 'utf8'))

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${name}: ${detail ?? 'assertion failed'}`)
}

let app = null
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.show()
    win.focus()
    win.moveTop()
  })
  await page.waitForTimeout(3200)
  await page.waitForSelector('#po-main')

  const nav = async (label) => {
    await page.locator('.po-nav-item').filter({ hasText: label }).last().click()
    await page.waitForTimeout(600)
  }
  const shot = async (name) => {
    const path = join(shots, name)
    await page.screenshot({ path })
    console.log(`SHOT ${path}`)
    return path
  }
  const openSettings = async () => {
    await nav('设置')
    await page.waitForSelector('.po-settings-dialog')
  }
  const openEditor = async () => {
    const button = page.getByRole('button', { name: '新增连接' }).first()
    await button.scrollIntoViewIfNeeded()
    await button.click() // real mouse click, no DOM workaround
    await page.waitForSelector('.po-ai-editor', { timeout: 10_000 })
  }

  // ---------------------------------------------------------------- settings
  await openSettings()
  await openEditor()
  check('settings: real mouse click opens the inline connection editor', await page.locator('.po-ai-editor').isVisible())
  const modalState = await page.evaluate(() => {
    const modal = document.querySelector('.ant-modal')
    const editor = document.querySelector('.po-ai-editor')
    const input = editor?.querySelector('input')
    input?.focus()
    return {
      modals: document.querySelectorAll('.ant-modal').length,
      nested: document.querySelectorAll('.ant-modal .ant-modal').length,
      modalContainsFocus: Boolean(modal && document.activeElement && modal.contains(document.activeElement)),
      editorVisible: Boolean(editor && editor.getBoundingClientRect().height > 80),
    }
  })
  check('settings: no nested modal and focus stays inside', modalState.modals === 1 && modalState.nested === 0 && modalState.modalContainsFocus, JSON.stringify(modalState))
  await shot('settings-editor-light.png')

  // 125% zoom inside the settings editor.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25)
  })
  await page.waitForTimeout(500)
  const zoomBox = await page.locator('.po-ai-editor').boundingBox()
  const windowSize = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return { width: win.getContentSize()[0], height: win.getContentSize()[1] }
  })
  check('settings: editor stays inside the window at 125% zoom', Boolean(zoomBox) && zoomBox.width > 200 && zoomBox.x >= 0 && zoomBox.x + zoomBox.width <= windowSize.width + 2, JSON.stringify({ zoomBox, windowSize }))
  await shot('settings-editor-zoom125.png')
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1)
  })
  await page.waitForTimeout(300)

  // Keyboard: Escape closes the inline editor (back to connections), modal stays.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  const escapeState = await page.evaluate(() => ({
    modal: Boolean(document.querySelector('.po-settings-dialog')),
    editor: Boolean(document.querySelector('.po-ai-editor')),
  }))
  check(
    'settings: keyboard Escape dismisses safely without a stuck overlay',
    !escapeState.editor,
    JSON.stringify(escapeState),
  )
  if (escapeState.modal) {
    await page.locator('.po-settings-modal .ant-modal-close').click()
    await page.waitForTimeout(500)
  }
  await page.waitForSelector('.po-settings-dialog', { state: 'detached', timeout: 10_000 }).catch(() => undefined)
  await page.evaluate(
    ({ projectId }) => {
      location.hash = `#/projects/${projectId}`
    },
    { projectId: context.projectId },
  )
  await page.waitForTimeout(900)

  // ------------------------------------------------------------ runs/reconcile
  await nav('运行审计')
  await page.waitForTimeout(500)
  const runRow = page.locator('.ant-table-row').filter({ hasText: 'R2.1 待核对任务' }).first()
  await runRow.click()
  await page.waitForSelector('.po-run-detail-modal', { timeout: 15_000 })
  await page.waitForTimeout(500)
  check('runs: audit modal opens from the run row', await page.locator('.po-run-detail-modal').isVisible())
  await shot('runs-detail-light.png')
  await page.getByRole('button', { name: '人工核对' }).click()
  const reconcileModal = page.locator('.ant-modal').filter({ hasText: '人工核对运行' })
  await reconcileModal.waitFor({ state: 'visible', timeout: 10_000 })
  check('runs: reconcile modal opens', await reconcileModal.isVisible())
  await shot('runs-reconcile-light.png')
  await page.locator('.ant-modal-footer button').filter({ hasText: /取\s*消/ }).last().click()
  await page.locator('.po-run-detail-modal .ant-modal-close').click()
  await page.waitForTimeout(300)

  // ------------------------------------------------- P0-04 high-risk acceptance UI
  await nav('任务看板')
  await page.waitForSelector('.po-task-tile', { timeout: 15_000 })
  await page.locator('.po-task-tile-title').filter({ hasText: 'R2.1 高风险验收任务' }).first().click()
  await page.waitForSelector('.ant-drawer-content-wrapper', { timeout: 15_000 })
  await page.getByRole('button', { name: '变更状态' }).click()
  await page.locator('.ant-dropdown-menu-item').filter({ hasText: '完成' }).first().click()
  const acceptModal = page.locator('.ant-modal').filter({ hasText: '完成验收' })
  await acceptModal.waitFor({ state: 'visible', timeout: 15_000 })
  await acceptModal.locator('.po-acceptance').waitFor({ state: 'visible', timeout: 15_000 })
  const acceptText = await acceptModal.innerText()
  check('acceptance UI: high-risk policy and evidence are visible', /高风险/.test(acceptText) && /文件归属/.test(acceptText), acceptText.slice(0, 120))
  await acceptModal.locator('textarea').fill('已核对实现文件与风险依据，确认本次高风险验收')
  await acceptModal.locator('label.ant-checkbox-wrapper').filter({ hasText: '我已核对风险依据与证据' }).click()
  await acceptModal.getByRole('button', { name: '确认完成' }).click()
  await page.waitForTimeout(1200)
  const accepted = await page.evaluate(async (taskId) => {
    const detail = await window.projectos.tasks.detail(taskId)
    return { status: detail.task.status }
  }, context.highRiskTaskId)
  check('acceptance UI: real click completes the high-risk task', accepted.status === 'done', JSON.stringify(accepted))
  await shot('task-acceptance-high-risk.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // ------------------------------------------------------- collaboration / agents
  await nav('跨会话中心')
  await page.waitForTimeout(800)
  const collaborationText = await page.locator('#po-main').innerText()
  check('collaboration: handoff/inbox page renders real content', /交接|收件|Inbox|消息|会话/.test(collaborationText), collaborationText.slice(0, 80))
  await shot('collaboration-light.png')

  await nav('Agent 工作台')
  await page.waitForTimeout(800)
  const agentsText = await page.locator('#po-main').innerText()
  check('agents: workbench renders sessions/agents', agentsText.trim().length > 0 && /Agent|会话|运行/.test(agentsText), agentsText.slice(0, 80))
  await shot('agents-light.png')

  // --------------------------------------------------------------- orchestration
  await nav('编排工作台')
  await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
  await page.waitForTimeout(800)
  check('orchestration: real graph nodes render', (await page.locator('.react-flow__node').count()) >= 4)
  await shot('orchestration-light.png')
  const taskNode = page.locator('.react-flow__node').filter({ hasText: '实现与验收' }).last()
  await taskNode.click()
  await page.waitForSelector('.po-orch-drawer-panel', { timeout: 15_000 })
  const drawerTitle = (await page.locator('.po-orch-drawer-panel .po-orch-panel-title strong').first().innerText()).trim()
  check('orchestration: task drawer opens for the clicked task', drawerTitle.includes('实现与验收'), drawerTitle)
  await shot('orchestration-drawer-light.png')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // --------------------------------------------------------------- error state
  await page.evaluate(() => {
    location.hash = '#/projects/prj_missing_ui'
  })
  await page.waitForTimeout(1200)
  const errorText = await page.locator('#po-main').innerText()
  check('error state: missing project shows a real empty/error state', /项目不存在|已被移除/.test(errorText), errorText.slice(0, 80))
  await shot('error-project-missing.png')
  await page.evaluate(({ projectId }) => {
    location.hash = `#/projects/${projectId}`
  }, { projectId: context.projectId })
  await page.waitForTimeout(800)

  // ----------------------------------------------------------------- dark mode
  await page.evaluate(() => {
    const raw = localStorage.getItem('projectos.ui')
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 }
    parsed.state = { ...parsed.state, themeMode: 'dark' }
    localStorage.setItem('projectos.ui', JSON.stringify(parsed))
  })
  await page.reload()
  await page.waitForTimeout(3200)
  await page.waitForSelector('#po-main')
  await openSettings()
  await openEditor()
  await shot('settings-editor-dark.png')
  await page.locator('.po-settings-modal .ant-modal-close').click()
  await page.waitForTimeout(300)
  await nav('运行审计')
  await page.locator('.ant-table-row').filter({ hasText: 'R2.1 待核对任务' }).first().click()
  await page.waitForSelector('.po-run-detail-modal', { timeout: 15_000 })
  await page.getByRole('button', { name: '人工核对' }).click()
  await page.waitForTimeout(400)
  await shot('runs-reconcile-dark.png')
  await page.locator('.ant-modal-footer button').filter({ hasText: /取\s*消/ }).last().click()
  await page.locator('.po-run-detail-modal .ant-modal-close').click()
  await page.waitForTimeout(300)
  await nav('编排工作台')
  await page.waitForSelector('.react-flow__node', { timeout: 20_000 })
  await page.locator('.react-flow__node').filter({ hasText: '实现与验收' }).last().click()
  await page.waitForSelector('.po-orch-drawer-panel', { timeout: 15_000 })
  await shot('orchestration-drawer-dark.png')
  await page.keyboard.press('Escape')

  // ------------------------------------------------------ collapsed nav + resize
  await nav('运行审计')
  await page.locator('[aria-label="切换侧边栏"]').first().click()
  await page.waitForTimeout(600)
  check('sidebar: collapses with real click', await page.locator('.po-shell.is-collapsed').count() > 0)
  await shot('runs-sidebar-collapsed.png')
  await page.locator('[aria-label="切换侧边栏"]').first().click()
  await page.waitForTimeout(400)

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1100, 760)
  })
  await page.waitForTimeout(900)
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  check('resize: no horizontal page overflow at 1100x760', overflow.scrollWidth <= overflow.innerWidth + 1, JSON.stringify(overflow))
  await nav('运行审计')
  await shot('runs-resized-1100.png')

  check('no renderer page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(`\nR2.1 UI REGRESSION PASS — ${results.length} checks, screenshots in ${shots}`)
  console.log(`DATA DIR: ${dataDir}`)
} catch (error) {
  console.error('R2.1 UI REGRESSION FAIL —', error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: join(shots, 'ui-failure.png') })
    } catch {
      // best effort
    }
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
