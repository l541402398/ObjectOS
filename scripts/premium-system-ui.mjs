/** Native Electron route inventory. Baseline is diagnostic; final mode enforces the shared UI gates. */
import { compositeContrast } from './lib/premium-contrast.mjs'
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const baseline = process.argv.includes('--baseline')
const quick = process.argv.includes('--quick')
const routeFilter = process.argv.find((arg) => arg.startsWith('--route='))?.slice(8)
const settingsFilter = process.argv.find((arg) => arg.startsWith('--settings='))?.slice(11).split(',').map(Number)
const updateEvidence = process.argv.includes('--update-evidence')
if (updateEvidence && ((!routeFilter && !settingsFilter) || quick || baseline)) throw new Error('Evidence updates require a full eight-state scoped recheck')
const root = process.cwd(), folder = resolve('docs/design/system-premium', baseline ? 'before' : quick || routeFilter || settingsFilter ? 'probe' : 'after')
mkdirSync(folder, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-premium-ui-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const results = [], errors = [], checks = []
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60_000 })
const page = await app.firstWindow(), win = await app.browserWindow(page)
page.on('pageerror', (e) => errors.push({ route: page.url(), message: e.message }))
const check = (name, passed, detail = '') => { checks.push({ name, status: passed ? 'PASS' : 'FAIL', detail }); console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`) }
const require = createRequire(import.meta.url), axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const theme = async (mode) => { await page.emulateMedia({ colorScheme: mode }); await page.waitForFunction((v) => document.documentElement.dataset.theme === v, mode) }
const capture = async (name) => {
  await page.mouse.move(4, 4)
  await page.waitForTimeout(350)
  const bytes = await win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(folder, `${name}.png`), Buffer.from(bytes, 'base64'))
  const geometry = await page.evaluate(() => {
    const main = document.querySelector('.po-main'), modal = document.querySelector('.pui-overlay-surface')
    const badType = [...document.querySelectorAll('.po-shell *, .pui-overlay-surface *')].filter((el) => {
      if (!el.children.length && el.textContent.trim() && el.getBoundingClientRect().width && el.getBoundingClientRect().height) {
        const style = getComputedStyle(el), rect = el.getBoundingClientRect()
        return rect.bottom > 0 && rect.top < innerHeight && style.visibility !== 'hidden' && Number(style.opacity) > 0 && parseFloat(style.fontSize) < 12 && !el.closest('svg,.react-flow__renderer,.monaco-editor')
      }
      return false
    }).slice(0, 30).map((el) => ({ className: el.className, text: el.textContent.trim().slice(0, 45), size: getComputedStyle(el).fontSize }))
    return { viewport: { width: innerWidth, height: innerHeight }, documentOverflow: document.documentElement.scrollWidth > innerWidth + 2, mainOverflow: main ? main.scrollWidth > main.clientWidth + 2 : false, modalOverflow: modal ? modal.scrollWidth > modal.clientWidth + 2 : false, sub12px: badType }
  })
  results.push({ name, ...geometry })
  if (!baseline) check(`${name} fits`, !geometry.documentOverflow && !geometry.mainOverflow && !geometry.modalOverflow)
}
const audit = async (name) => {
  await page.evaluate(axeSource)
  const report = await page.evaluate(async () => {
    const result = await window.axe.run(document.querySelector('.pui-overlay-surface') ?? document.querySelector('.po-shell'), { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] } })
    return { violations: result.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })) })), incomplete: result.incomplete.map(({ id, nodes }) => ({ id, targets: nodes.map(({ target }) => target) })), passes: result.passes.length }
  })
  results.push({ name: `${name}-axe`, ...report })
  check(`${name} accessibility`, report.violations.length === 0, report.violations.map((v) => v.id).join(', '))
  const contrast = await compositeContrast(page, win, await page.locator('.pui-overlay-surface').count() ? '.pui-overlay-surface' : '.po-shell')
  results.push({ name: `${name}-composite`, ...contrast })
}
try {
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(4000)
  const projectId = (await page.evaluate(() => window.projectos.projects.list())).projects[0]?.id
  if (!projectId) throw new Error('The persisted demo fixture was not created')
  const routes = [
    ['project-center', '#/'], ['project-home', `#/projects/${projectId}`],
    ['work-center', `#/projects/${projectId}/work`], ['tasks', `#/projects/${projectId}/tasks`],
    ['agents', `#/projects/${projectId}/agents`], ['orchestration', `#/projects/${projectId}/orchestration`],
    ['approvals', `#/projects/${projectId}/approvals`], ['approval-center', `#/projects/${projectId}/approvals/center`],
    ['runs', `#/projects/${projectId}/runs`], ['versions', `#/projects/${projectId}/versions`],
    ['releases', `#/projects/${projectId}/releases`], ['deployments', `#/projects/${projectId}/deployments`],
    ['connections', `#/projects/${projectId}/connections`], ['overview', `#/projects/${projectId}/overview`],
    ['knowledge', `#/projects/${projectId}/knowledge`], ['project-settings', `#/projects/${projectId}/project-settings`],
    ['workspace', `#/projects/${projectId}/workspace`], ['resources', `#/projects/${projectId}/resources`],
    ['collaboration', `#/projects/${projectId}/collaboration`], ['operations', `#/projects/${projectId}/operations`],
    ['health', `#/projects/${projectId}/health`], ['notifications', '#/notifications'],
  ]
  for (const [name, route] of routes) {
    if (settingsFilter && !routeFilter) continue
    if (routeFilter && !routeFilter.split(',').includes(name)) continue
    await page.evaluate((path) => { location.hash = path }, route)
    await page.waitForTimeout(name === 'agents' || name === 'orchestration' ? 1600 : 750)
    const matrix = baseline || quick ? [[1440, 'light', 1]] : [[1440, 'light', 1], [1440, 'dark', 1], [1024, 'light', 1], [1024, 'dark', 1], [1440, 'light', 1.25], [1440, 'dark', 1.25], [1024, 'light', 1.25], [1024, 'dark', 1.25]]
    for (const [width, mode, zoom] of matrix) {
      await win.evaluate((w, v) => { w.setContentSize(v.width, 900); w.webContents.setZoomFactor(v.zoom) }, { width, zoom })
      await theme(mode)
      await capture(`${name}-${width}-${mode}${zoom === 1.25 ? '-125' : ''}`)
      if (!baseline && width === 1440 && zoom === 1) await audit(`${name}-${mode}`)
    }
    console.log(`Captured route: ${name}`)
  }
  await win.evaluate((w) => { w.setContentSize(1440, 900); w.webContents.setZoomFactor(1) })
  await theme('light')
  if (baseline) await page.locator('.po-nav-item[title="设置"]').first().click()
  else await page.getByRole('button', { name: '设置', exact: true }).first().click()
  const sections = ['设置概览', '账号与组织', 'AI 连接', '模型目录', '运行时', '通用与限制', '工具与插件', 'Skills 管理', '工具权限', '存储与安全', '用量与价格', 'OpenSpec', '偏好设置', '关于']
  for (let index = 0; (!routeFilter || settingsFilter) && index < sections.length; index++) {
    if (settingsFilter && !settingsFilter.includes(index)) continue
    const label = sections[index]
    if (baseline) await page.locator('.po-settings-nav button').filter({ hasText: label }).last().click()
    else await page.getByRole('button', { name: label, exact: true }).last().click()
    await page.waitForTimeout(500)
    const matrix = baseline || quick ? [[1440, 'light', 1]] : [[1440, 'light', 1], [1440, 'dark', 1], [1024, 'light', 1], [1024, 'dark', 1], [1440, 'light', 1.25], [1440, 'dark', 1.25], [1024, 'light', 1.25], [1024, 'dark', 1.25]]
    for (const [width, mode, zoom] of matrix) {
      await win.evaluate((w, v) => { w.setContentSize(v.width, 900); w.webContents.setZoomFactor(v.zoom) }, { width, zoom })
      await theme(mode); await capture(`settings-${index}-${width}-${mode}${zoom === 1.25 ? '-125' : ''}`)
      if (!baseline && zoom === 1) await audit(`settings-${label}-${mode}`)
    }
  }
  check('No Renderer exceptions', errors.length === 0, errors.map((e) => e.message).join(' | '))
} catch (error) {
  check('Journey completion', false, error instanceof Error ? error.message : String(error))
  await capture('failure').catch(() => {})
  process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  const report = { phase: baseline ? 'diagnostic-before' : quick || routeFilter || settingsFilter ? 'diagnostic-probe' : 'system-premium-after', head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixture: 'isolated persisted demo data; actual Electron / typed IPC', results, checks, errors }
  writeFileSync(join(folder, 'inventory.json'), JSON.stringify(report, null, 2) + '\n')
  if (updateEvidence && !checks.some((c) => c.status === 'FAIL')) {
    const target = resolve('docs/design/system-premium/after'), previous = JSON.parse(readFileSync(join(target, 'inventory.json'), 'utf8'))
    for (const result of results.filter((r) => r.viewport)) copyFileSync(join(folder, `${result.name}.png`), join(target, `${result.name}.png`))
    for (const key of ['results', 'checks']) {
      const updated = new Set(report[key].map((item) => item.name))
      previous[key] = [...previous[key].filter((item) => !updated.has(item.name)), ...report[key]]
    }
    previous.rechecks = [...(previous.rechecks ?? []), { recordedAt: new Date().toISOString(), command: `node scripts/premium-system-ui.mjs${routeFilter ? ` --route=${routeFilter}` : ''}${settingsFilter ? ` --settings=${settingsFilter.join(',')}` : ''} --update-evidence`, head: report.head, routes: routeFilter?.split(','), settings: settingsFilter, checks: checks.length, errors }]
    writeFileSync(join(target, 'inventory.json'), JSON.stringify(previous, null, 2) + '\n')
    writeFileSync(resolve(`docs/design/system-premium/diagnostics/final-${routeFilter ? 'route' : 'settings'}-recheck.json`), JSON.stringify(report, null, 2) + '\n')
  }
  if (!baseline && checks.some((c) => c.status === 'FAIL')) process.exitCode = 1
}
