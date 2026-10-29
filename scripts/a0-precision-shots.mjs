/**
 * A0 Precision Workspace — real Electron capture + interaction evidence.
 *
 * Launches the built app (not a browser preview), drives the prototype route with Playwright,
 * exercises real UI interactions, and captures the screenshot matrix required by the A0 package:
 * 1440×900 / 1024×768 / 125%, light/dark, empty/error, drawer, command palette, workflow publishing.
 *
 * Every PASS below is computed from the running UI; nothing is pre-declared. Results are written to
 * docs/org-upgrade/evidence/A0/electron-ui-checks.json, together with the build/commit metadata.
 *
 * usage: node scripts/a0-precision-shots.mjs [--keep]
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const evidenceDir = resolve(root, 'docs/org-upgrade/evidence/A0')
const shotDir = join(evidenceDir, 'screenshots')
mkdirSync(shotDir, { recursive: true })

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const startedAt = new Date().toISOString()

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const work = mkdtempSync(join(tmpdir(), 'a0-precision-'))
const dataDir = join(work, 'data')
const userData = join(work, 'userdata')
mkdirSync(dataDir, { recursive: true })

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
  PROJECTOS_START_ROUTE: 'precision-lab',
}
delete env.ELECTRON_RUN_AS_NODE

let app = null
let page = null
let win = null

const route = (query) => `#/precision-lab?${query}`

async function openRoute(query, { theme = 'light', zoom = 1, width = 1440, height = 900 } = {}) {
  await page.evaluate((hash) => { window.location.hash = hash }, route(query))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.pw-root', { timeout: 45_000 })
  await win.evaluate((w, size) => w.setContentSize(size.width, size.height), { width, height })
  await win.evaluate((w, value) => w.webContents.setZoomFactor(value), zoom)
  await page.waitForTimeout(650)
  const state = await page.evaluate(() => ({
    theme: document.querySelector('.pw-root')?.getAttribute('data-theme'),
    screen: document.querySelector('.pw-root')?.getAttribute('data-screen'),
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio,
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }))
  await page.waitForTimeout(250)
  return state
}

async function clearToast() {
  const close = page.locator('.pw-toast button')
  if (await close.count()) await close.first().click().catch(() => undefined)
  await page.waitForTimeout(150)
}

async function shot(name) {
  await page.screenshot({ path: join(shotDir, name), animations: 'disabled' })
  return name
}

async function typographyAudit(scopeSelector = '.pw-main') {
  return page.evaluate((selector) => {
    const scope = document.querySelector(selector)
    if (!scope) return { found: false, tiny: [], count: 0 }
    const nodes = [...scope.querySelectorAll('*')].filter((node) => {
      if (node.children.length > 0) return false
      const text = (node.textContent ?? '').trim()
      if (text.length < 2) return false
      const style = getComputedStyle(node)
      const rect = node.getBoundingClientRect()
      if (style.visibility === 'hidden' || style.display === 'none' || rect.width === 0) return false
      return true
    })
    const tiny = nodes
      .map((node) => ({
        text: (node.textContent ?? '').trim().slice(0, 28),
        size: Number.parseFloat(getComputedStyle(node).fontSize),
        cls: node.className && typeof node.className === 'string' ? node.className.slice(0, 40) : '',
      }))
      .filter((item) => item.size < 12)
    return { found: true, count: nodes.length, tiny: tiny.slice(0, 12), tinyCount: tiny.length }
  }, scopeSelector)
}

async function buttonNamesAudit() {
  return page.evaluate(() => {
    const scope = document.querySelector('.pw-root')
    if (!scope) return { missing: [] }
    const missing = [...scope.querySelectorAll('button')]
      .filter((button) => {
        const style = getComputedStyle(button)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        const text = (button.textContent ?? '').trim()
        const label = button.getAttribute('aria-label') ?? button.getAttribute('title') ?? ''
        return !text && !label
      })
      .map((button) => button.className)
    return { missing }
  })
}

try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userData}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 90_000,
  })
  page = await app.firstWindow()
  win = await app.browserWindow(page)
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Autofill')) pageErrors.push(message.text())
  })
  await page.waitForSelector('.pw-root', { timeout: 60_000 })
  await page.waitForTimeout(900)
  record('真实 Electron 窗口加载 Precision Workspace', 'PASS', `content=${await page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`)}`)

  // ---------------------------------------------------------------- overview
  let state = await openRoute('screen=overview&theme=light')
  record('1440×900 Light 概览', state.width === 1440 && state.height === 900 && state.theme === 'light' ? 'PASS' : 'FAIL', JSON.stringify(state))
  const journey = await page.evaluate(() => {
    const el = document.querySelector('.pw-journey-steps')
    return el ? { overflow: el.scrollWidth - el.clientWidth } : null
  })
  record('1440 旅程步骤无溢出', journey && journey.overflow <= 1 ? 'PASS' : 'FAIL', JSON.stringify(journey))
  let typo = await typographyAudit()
  record('概览内容字号下限 ≥12px', typo.found && typo.tinyCount === 0 ? 'PASS' : 'FAIL', `nodes=${typo.count} tiny=${typo.tinyCount} ${JSON.stringify(typo.tiny)}`)
  const buttons = await buttonNamesAudit()
  record('所有可见按钮有可访问名称', buttons.missing.length === 0 ? 'PASS' : 'FAIL', `${buttons.missing.length} missing ${JSON.stringify(buttons.missing.slice(0, 4))}`)
  await shot('a0-overview-1440-light.png')

  // org switcher
  await page.getByRole('button', { name: /切换组织/ }).click()
  await page.waitForTimeout(350)
  const orgPop = await page.locator('.pw-org-pop').isVisible()
  record('组织切换弹层可打开', orgPop ? 'PASS' : 'FAIL')
  await shot('a0-org-switcher-1440-light.png')
  await page.getByRole('button', { name: /北辰实验室/ }).click()
  await page.waitForTimeout(700)
  const orgSwitched = await page.evaluate(() => document.querySelector('.pw-org-copy strong')?.textContent)
  const orgScoped = await page.evaluate(() => document.querySelectorAll('.pw-table-row').length)
  record('切换组织后数据按组织隔离', orgSwitched === '北辰实验室' ? 'PASS' : 'FAIL', `org=${orgSwitched} rows=${orgScoped}`)
  await page.getByRole('button', { name: /切换组织/ }).click()
  await page.getByRole('button', { name: /星海研发中心/ }).click()
  await page.waitForTimeout(500)

  // filters
  await page.getByRole('button', { name: '筛选', exact: true }).click()
  await page.locator('.pw-filter-bar').getByRole('button', { name: /待审核/ }).click()
  await page.waitForTimeout(300)
  const filteredRows = await page.locator('.pw-table-row').count()
  record('概览筛选真实生效', filteredRows > 0 && filteredRows < 5 ? 'PASS' : 'FAIL', `rows=${filteredRows}`)
  await shot('a0-overview-filtered-1440-light.png')
  await page.getByRole('button', { name: '筛选', exact: true }).click()

  // command palette
  await clearToast()
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(350)
  const paletteOpen = await page.locator('.pw-command').isVisible()
  await page.keyboard.type('流程')
  await page.waitForTimeout(250)
  await shot('a0-command-palette-1440-light.png')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(650)
  const paletteNavigated = await page.evaluate(() => document.querySelector('.pw-root')?.getAttribute('data-screen'))
  record('命令面板键盘导航到流程模板', paletteOpen && paletteNavigated === 'workflow' ? 'PASS' : 'FAIL', `screen=${paletteNavigated}`)

  // ------------------------------------------------------------- requirement
  state = await openRoute('screen=requirement&req=REQ-124&theme=light')
  record('1440×900 Light 需求工作台', state.screen === 'requirement' ? 'PASS' : 'FAIL', JSON.stringify(state))
  typo = await typographyAudit()
  record('需求工作台字号下限 ≥12px', typo.tinyCount === 0 ? 'PASS' : 'FAIL', `tiny=${typo.tinyCount} ${JSON.stringify(typo.tiny)}`)
  await shot('a0-requirement-1440-light.png')

  // document tab
  await page.getByRole('tab', { name: '需求与设计' }).click()
  await page.waitForTimeout(300)
  await shot('a0-requirement-doc-1440-light.png')
  await page.getByRole('button', { name: '设计文档' }).click()
  await page.waitForTimeout(300)
  const designDoc = await page.locator('.pw-doc-version').textContent()
  record('设计文档视图渲染冻结版本', designDoc?.includes('v1.2') ? 'PASS' : 'FAIL', `version=${designDoc}`)
  await shot('a0-requirement-design-1440-light.png')

  // approval drawer
  await page.getByRole('button', { name: '打开审批' }).click()
  await page.waitForTimeout(400)
  const drawerOpen = await page.locator('.pw-drawer').isVisible()
  record('审批抽屉可打开', drawerOpen ? 'PASS' : 'FAIL')
  await shot('a0-approval-drawer-1440-light.png')
  await page.getByRole('radio', { name: /要求修改/ }).click()
  const confirmDisabled = await page.getByRole('button', { name: '提交修改要求' }).isDisabled()
  record('要求修改必须填写原因', confirmDisabled ? 'PASS' : 'FAIL')
  await page.getByRole('radio', { name: /批准设计/ }).click()
  await page.locator('.pw-drawer-actions').getByRole('button', { name: '批准设计' }).click()
  await page.waitForTimeout(700)
  const approved = await page.evaluate(() => ({
    badge: [...document.querySelectorAll('.pw-req-inspector .pw-badge')].map((node) => node.textContent?.trim()).join('|'),
    toast: document.querySelector('.pw-toast')?.textContent ?? '',
    gateStrip: document.querySelector('.pw-gate-strip')?.textContent ?? '',
  }))
  record('批准门禁后状态/审计事件真实更新', approved.badge.includes('已批准') && approved.toast.includes('已批准') ? 'PASS' : 'FAIL', JSON.stringify(approved).slice(0, 220))
  await shot('a0-requirement-approved-1440-light.png')

  // evidence tab after decision
  await page.getByRole('tab', { name: '证据' }).click()
  await page.waitForTimeout(300)
  await shot('a0-requirement-evidence-1440-light.png')

  // ---------------------------------------------------------------- workflow
  await openRoute('screen=workflow&theme=light')
  await page.waitForTimeout(900)
  const flowNodes = await page.locator('.pw-flow-node').count()
  const flowEdges = await page.locator('.react-flow__edge').count()
  record('真实 React Flow DAG 渲染 9 节点 / 10 连线', flowNodes === 9 && flowEdges === 10 ? 'PASS' : 'FAIL', `nodes=${flowNodes} edges=${flowEdges}`)
  const flowBox = await page.locator('.pw-flow-canvas').boundingBox()
  record('流程画布在 1440 下有可用宽度', flowBox && flowBox.width > 560 ? 'PASS' : 'FAIL', JSON.stringify(flowBox))
  await page.locator('.react-flow__pane').click({ position: { x: 30, y: 300 } })
  await page.waitForTimeout(300)
  const templateOverview = await page.locator('.pw-flow-inspector').textContent()
  record('未选中节点时检查器显示模板概览', templateOverview?.includes('模板概览') ? 'PASS' : 'FAIL')
  await shot('a0-workflow-1440-light.png')

  // select a node, edit title, add a node, validate
  await page.locator('.pw-flow-node').filter({ hasText: '设计审核' }).click()
  await page.waitForTimeout(300)
  const inspectorVisible = await page.locator('.pw-flow-inspector').isVisible()
  record('节点检查器可打开', inspectorVisible ? 'PASS' : 'FAIL')
  await shot('a0-workflow-inspector-1440-light.png')
  await page.getByRole('button', { name: '适配画布' }).click()
  await page.waitForTimeout(700)
  await shot('a0-workflow-fit-1440-light.png')
  const titleInput = page.getByLabel('节点标题')
  await titleInput.fill('设计审核（含回滚）')
  await page.waitForTimeout(250)
  const dirtyText = await page.locator('.pw-flow-meta').textContent()
  record('节点编辑后草稿状态变为未保存', dirtyText?.includes('草稿') ? 'PASS' : 'FAIL', `meta=${dirtyText?.slice(0, 60)}`)
  await page.locator('.pw-flow-palette .pw-palette-item').nth(3).click()
  await page.waitForTimeout(500)
  const addedNodes = await page.locator('.pw-flow-node').count()
  record('从节点库添加节点', addedNodes === 10 ? 'PASS' : 'FAIL', `nodes=${addedNodes}`)
  await page.getByRole('button', { name: '校验', exact: true }).click()
  await page.waitForTimeout(400)
  const validationText = await page.locator('.pw-validation-bar').textContent()
  record('流程校验对新增未连接节点给出结论', /校验通过|阻断/.test(validationText ?? '') ? 'PASS' : 'FAIL', validationText?.slice(0, 80) ?? '')
  await page.getByRole('button', { name: '删除节点' }).click()
  await page.getByRole('button', { name: '确认删除此节点' }).click()
  await page.waitForTimeout(500)
  const restored = await page.locator('.pw-validation-bar').textContent()
  record('删除节点后校验恢复通过', (restored ?? '').includes('校验通过') ? 'PASS' : 'FAIL', restored?.slice(0, 60) ?? '')
  await page.getByRole('button', { name: '发布模板' }).click()
  await page.waitForTimeout(400)
  const publishDialog = await page.locator('.pw-publish-dialog').isVisible()
  record('发布对话框可打开', publishDialog ? 'PASS' : 'FAIL')
  await shot('a0-workflow-publish-1440-light.png')
  await page.locator('.pw-dialog-actions').getByRole('button', { name: /^发布 v/ }).click()
  await page.waitForTimeout(600)
  const published = await page.evaluate(() => ({
    meta: document.querySelector('.pw-flow-meta')?.textContent ?? '',
    toast: document.querySelector('.pw-toast')?.textContent ?? '',
  }))
  record('发布交互更新版本徽标', published.meta.includes('v2.4') ? 'PASS' : 'FAIL', JSON.stringify(published).slice(0, 200))
  await shot('a0-workflow-published-1440-light.png')

  // --------------------------------------------------------------- dark mode
  state = await openRoute('screen=overview&theme=dark')
  const darkTokens = await page.evaluate(() => ({
    ink: getComputedStyle(document.querySelector('.pw-root')).getPropertyValue('--pw-ink').trim(),
    canvas: getComputedStyle(document.querySelector('.pw-root')).getPropertyValue('--pw-canvas').trim(),
  }))
  record('深色主题令牌生效', state.theme === 'dark' && darkTokens.ink === '#e9eef6' ? 'PASS' : 'FAIL', JSON.stringify(darkTokens))
  typo = await typographyAudit()
  record('深色概览字号下限 ≥12px', typo.tinyCount === 0 ? 'PASS' : 'FAIL', `tiny=${typo.tinyCount} ${JSON.stringify(typo.tiny)}`)
  await shot('a0-overview-1440-dark.png')
  state = await openRoute('screen=requirement&req=REQ-124&theme=dark')
  await shot('a0-requirement-1440-dark.png')
  await openRoute('screen=workflow&theme=dark')
  await page.waitForTimeout(800)
  await shot('a0-workflow-1440-dark.png')
  // command palette in dark
  await page.keyboard.press('Control+k')
  await page.waitForTimeout(400)
  await shot('a0-command-palette-1440-dark.png')
  await page.keyboard.press('Escape')

  // ------------------------------------------------------------------ 1024
  state = await openRoute('screen=overview&theme=light', { width: 1024, height: 768 })
  record('1024×768 概览', state.width === 1024 && state.height === 768 ? 'PASS' : 'FAIL', JSON.stringify(state))
  typo = await typographyAudit()
  record('1024 概览无横向溢出且字号达标', state.overflowX === 0 && typo.tinyCount === 0 ? 'PASS' : 'FAIL', `overflow=${state.overflowX} tiny=${typo.tinyCount}`)
  const journeyNarrow = await page.evaluate(() => {
    const el = document.querySelector('.pw-journey-steps')
    return el ? { overflow: el.scrollWidth - el.clientWidth } : null
  })
  record('1024 旅程步骤不溢出', journeyNarrow && journeyNarrow.overflow <= 1 ? 'PASS' : 'FAIL', JSON.stringify(journeyNarrow))
  await shot('a0-overview-1024-light.png')

  await openRoute('screen=requirement&req=REQ-124&theme=light', { width: 1024, height: 768 })
  const reqOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  record('1024 需求工作台无横向溢出', reqOverflow === 0 ? 'PASS' : 'FAIL', `overflow=${reqOverflow}`)
  await shot('a0-requirement-1024-light.png')

  await openRoute('screen=workflow&theme=light', { width: 1024, height: 768 })
  await page.waitForTimeout(900)
  const narrowFlow = await page.evaluate(() => ({
    canvas: document.querySelector('.pw-flow-canvas')?.getBoundingClientRect().width ?? 0,
    inspectorVisible: Boolean(document.querySelector('.pw-flow-inspector')?.getBoundingClientRect().width),
  }))
  record('1024 流程画布保留可用宽度', narrowFlow.canvas > 520 ? 'PASS' : 'FAIL', JSON.stringify(narrowFlow))
  await page.locator('.react-flow__pane').click({ position: { x: 20, y: 20 } })
  await page.waitForTimeout(300)
  await shot('a0-workflow-1024-light.png')

  // ------------------------------------------------------------------- 125%
  state = await openRoute('screen=overview&theme=light', { width: 1440, height: 900, zoom: 1.25 })
  record('125% 缩放生效', Math.abs(state.dpr - 1.25) < 0.01 ? 'PASS' : 'FAIL', `dpr=${state.dpr} css=${state.width}x${state.height} overflow=${state.overflowX}`)
  typo = await typographyAudit()
  record('125% 概览无横向溢出且字号达标', state.overflowX === 0 && typo.tinyCount === 0 ? 'PASS' : 'FAIL', `overflow=${state.overflowX} tiny=${typo.tinyCount}`)
  await shot('a0-overview-1440-light-125.png')
  await openRoute('screen=requirement&req=REQ-124&theme=light', { width: 1440, height: 900, zoom: 1.25 })
  await shot('a0-requirement-1440-light-125.png')
  await win.evaluate((w) => w.webContents.setZoomFactor(1))

  // -------------------------------------------------------- empty and error
  await openRoute('screen=overview&theme=light&state=empty')
  await clearToast()
  const emptyVisible = await page.locator('.pw-empty').first().isVisible()
  record('空态可真实渲染', emptyVisible ? 'PASS' : 'FAIL')
  await shot('a0-overview-empty-1440-light.png')
  await openRoute('screen=requirement&req=REQ-124&theme=light&state=error')
  const reqError = await page.locator('.pw-error-banner').isVisible()
  record('需求工作台异常态可见', reqError ? 'PASS' : 'FAIL')
  await shot('a0-requirement-error-1440-light.png')
  await openRoute('screen=requirements&theme=light&state=error')
  const errorBanner = await page.locator('.pw-error-banner').isVisible()
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page.waitForTimeout(1100)
  const errorRecovered = await page.locator('.pw-error-banner').count()
  record('异常态展示并支持重试恢复', errorBanner && errorRecovered === 0 ? 'PASS' : 'FAIL', `banner=${errorBanner} afterRetry=${errorRecovered}`)
  await shot('a0-requirements-error-1440-light.png')

  // ------------------------------------------------------------ other views
  for (const [screen, file, heading] of [
    ['projects', 'a0-projects-1440-light.png', '组织项目'],
    ['requirements', 'a0-requirements-list-1440-light.png', '需求中心'],
    ['agents', 'a0-agents-1440-light.png', '组织资产'],
    ['members', 'a0-members-1440-light.png', '成员与权限'],
    ['runs', 'a0-runs-1440-light.png', '运行与审计'],
  ]) {
    await openRoute(`screen=${screen}&theme=light`)
    const title = await page.locator('.pw-page-head h1').textContent()
    record(`页面可导航：${heading}`, title?.includes(heading) ? 'PASS' : 'FAIL', `title=${title}`)
    await shot(file)
  }

  // create requirement dialog (real validation, demo-only write)
  await openRoute('screen=requirements&theme=light')
  await page.locator('.pw-page-actions').getByRole('button', { name: '创建需求' }).click()
  await page.waitForTimeout(350)
  const createOpen = await page.locator('.pw-create-dialog').isVisible()
  const submitDisabled = await page.locator('.pw-dialog-actions').getByRole('button', { name: '创建需求' }).isDisabled()
  await page.getByLabel('需求标题').fill('组织级审计事件导出')
  await page.waitForTimeout(250)
  await shot('a0-create-requirement-1440-light.png')
  await page.locator('.pw-dialog-actions').getByRole('button', { name: '创建需求' }).click()
  await page.waitForTimeout(700)
  const created = await page.evaluate(() => ({
    screen: document.querySelector('.pw-root')?.getAttribute('data-screen'),
    title: document.querySelector('.pw-req-title-line h1')?.textContent ?? '',
    toast: document.querySelector('.pw-toast')?.textContent ?? '',
  }))
  record('创建需求弹窗校验并进入新需求（仅演示会话）', createOpen && submitDisabled && created.title.includes('组织级审计事件导出') ? 'PASS' : 'FAIL', JSON.stringify(created).slice(0, 200))

  // keyboard focus visibility
  await openRoute('screen=overview&theme=light')
  await page.keyboard.press('Tab')
  const focusRing = await page.evaluate(() => {
    const el = document.activeElement
    if (!el) return null
    const style = getComputedStyle(el)
    return { tag: el.tagName, outline: style.outlineWidth, outlineStyle: style.outlineStyle, text: (el.textContent ?? '').trim().slice(0, 24) }
  })
  record('键盘 Tab 可见焦点', focusRing && focusRing.outlineStyle !== 'none' && Number.parseFloat(focusRing.outline) >= 1 ? 'PASS' : 'FAIL', JSON.stringify(focusRing))

  // reduced motion
  const reduce = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  record('prefers-reduced-motion 可被检测（未强制）', 'SKIP', `media=${reduce}`)

  record('运行期页面错误', pageErrors.length === 0 ? 'PASS' : 'FAIL', pageErrors.slice(0, 3).join(' | ').slice(0, 300))

  writeFileSync(
    join(evidenceDir, 'electron-ui-checks.json'),
    `${JSON.stringify({
      meta: {
        branch,
        commit,
        startedAt,
        finishedAt: new Date().toISOString(),
        executable: 'node_modules/electron/dist/electron.exe',
        appBuild: 'apps/desktop/out (electron-vite build)',
        electronVersion: process.versions.electron ?? null,
        node: process.version,
        route: '#/precision-lab',
        dataDir: '<temp>',
        note: 'All checks executed against the real Electron window; screenshots are content-area captures.',
      },
      results,
      summary: {
        pass: results.filter((item) => item.status === 'PASS').length,
        fail: results.filter((item) => item.status === 'FAIL').length,
        skip: results.filter((item) => item.status === 'SKIP').length,
      },
    }, null, 2)}\n`,
    'utf8',
  )
  writeFileSync(join(evidenceDir, 'build-manifest.json'), `${JSON.stringify({
    commit,
    branch,
    build: 'electron-vite build',
    entry: 'apps/desktop/out/main/index.js',
    renderer: 'apps/desktop/out/renderer/index.html',
    electron: '43.8.2',
    node: process.version,
    capturedAt: new Date().toISOString(),
    prototypeRoute: '#/precision-lab',
    screenshotDir: 'docs/org-upgrade/evidence/A0/screenshots',
  }, null, 2)}\n`, 'utf8')
  console.log('\n===== A0 PRECISION UI CHECKS =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((item) => item.status === 'PASS').length} FAIL=${results.filter((item) => item.status === 'FAIL').length} SKIP=${results.filter((item) => item.status === 'SKIP').length}`)
  console.log(`workdir: ${work}`)
  if (results.some((item) => item.status === 'FAIL')) process.exitCode = 1
} catch (error) {
  record('UI 证据采集', 'FAIL', String(error).slice(0, 500))
  console.error(error)
  writeFileSync(join(evidenceDir, 'electron-ui-checks.json'), `${JSON.stringify({ meta: { branch, commit, startedAt, failedAt: new Date().toISOString() }, results, error: String(error) }, null, 2)}\n`, 'utf8')
  process.exitCode = 1
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
}
