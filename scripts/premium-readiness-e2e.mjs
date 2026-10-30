/** Cold native frames and actual font use. Data comes from isolated persisted demo through IPC. */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const out = resolve('docs/design/system-premium/readiness')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-premium-readiness-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60000 })
const page = await app.firstWindow(), win = await app.browserWindow(page)
const checks = [], traces = [], fontSamples = [], errors = []
page.setDefaultTimeout(15000)
page.on('pageerror', (e) => errors.push(e.message))
const check = (name, ok, detail = '') => { checks.push({ name, status: ok ? 'PASS' : 'FAIL', detail }); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} ${detail}`) }
const shot = async (name) => writeFileSync(join(out, `${name}.png`), Buffer.from(await win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64'))
const begin = async (scope, content) => page.evaluate(({ scope, content }) => {
  window.__readyFrames = []; window.__readyStop = false
  const frame = () => {
    const surface = document.querySelector(scope), body = document.querySelector(content)
    window.__readyFrames.push({ time: performance.now(), surface: !!surface, content: !!body && !!body.textContent.trim(), typeface: document.documentElement.dataset.typeface, fontStatus: document.fonts.status })
    if (!window.__readyStop) requestAnimationFrame(frame)
  }; frame()
}, { scope, content })
const end = async (name) => {
  await page.waitForTimeout(200)
  const frames = await page.evaluate(() => { window.__readyStop = true; return window.__readyFrames })
  const visible = frames.filter((f) => f.surface)
  const partial = visible.filter((f) => !f.content || f.typeface !== 'ready' || f.fontStatus !== 'loaded')
  traces.push({ name, frames })
  check(name, visible.length > 0 && partial.length === 0, JSON.stringify({ frames: frames.length, destinationFrames: visible.length, partialFrames: partial.length }))
}
let cdp
const font = async (selector, name) => {
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector })
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId })
  const computed = await page.locator(selector).first().evaluate((el) => {
    const style = getComputedStyle(el)
    return { text: el.textContent, family: style.fontFamily, weight: style.fontWeight, size: style.fontSize, lineHeight: style.lineHeight }
  })
  fontSamples.push({ name, computed, fonts })
  check(`${name} uses packaged Noto Sans SC`, fonts.some((f) => f.isCustomFont && /Noto Sans SC/i.test(f.familyName) && f.glyphCount > 0), JSON.stringify(fonts))
}
try {
  await page.waitForSelector('.po-shell', { timeout: 60000 })
  const projectId = (await page.evaluate(() => window.projectos.projects.list())).projects[0].id
  cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
  await page.context().addInitScript(() => {
    window.__startupFrames = []
    const frame = () => {
      const shell = !!document.querySelector('.po-shell')
      window.__startupFrames.push({ time: performance.now(), shell, typeface: document.documentElement.dataset.typeface, fonts: document.fonts.status })
      if (!shell) requestAnimationFrame(frame)
    }; requestAnimationFrame(frame)
  })
  await page.evaluate((id) => { location.hash = `#/projects/${id}/overview` }, projectId)
  await page.reload(); await page.waitForSelector('.po-page-header')
  const startup = await page.evaluate(() => ({ frames: window.__startupFrames, sources: [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules].filter((rule) => rule.type === CSSRule.FONT_FACE_RULE && rule.style.fontFamily.includes('ProjectOS Sans')).map((rule) => {
    const src = rule.style.getPropertyValue('src').match(/url\(["']?([^"')]+)/)?.[1]
    const url = new URL(src, sheet.href).href
    return { name: url.replace(/^.*\/assets\//, 'assets/'), local: url.startsWith('file:') }
  })) }))
  traces.push({ name: 'startup', ...startup })
  check('First product frame has its local typeface', startup.frames.some((f) => f.shell) && startup.frames.filter((f) => f.shell).every((f) => f.typeface === 'ready' && f.fonts === 'loaded'))
  check('Loaded font face points to the packaged app only', startup.sources.length > 0 && startup.sources.every((r) => r.local), JSON.stringify(startup.sources))
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await begin('.po-tasks-page', '.po-task-tile-title')
  await page.getByRole('button', { name: '任务看板', exact: true }).click()
  await page.locator('.po-task-tile-title').first().waitFor(); await end('Cold task route mounts complete content')
  await font('.po-task-tile-title', 'Task title')
  await begin('[data-testid="task-detail-inspector"]', '.po-task-detail')
  await page.locator('.po-task-tile').first().click()
  await page.locator('.po-task-detail').waitFor(); await end('Cold task inspector mounts complete content')
  await font('[data-testid="task-detail-inspector"] .pui-overlay-title', 'Inspector heading')
  await shot('task-inspector'); await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '设置', exact: true }).first().click()
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor()
  await begin('.v17-runtime-panel', '.v17-runtime-card')
  await page.getByRole('button', { name: '运行时', exact: true }).click()
  await page.locator('.v17-runtime-card').first().waitFor(); await end('Cold settings tab mounts its runtime records')
  await font('.v17-runtime-title strong', 'Settings runtime title')
  await shot('runtime-settings'); await page.keyboard.press('Escape')
  await begin('.po-runs-page', '.ant-table-tbody tr[data-row-key]')
  await page.getByRole('button', { name: '运行审计', exact: true }).click()
  await page.locator('.ant-table-tbody tr[data-row-key]').first().waitFor(); await end('Cold run route mounts populated records')
  await begin('[data-testid="run-detail-sheet"]', '.po-run-detail')
  await page.locator('.ant-table-tbody tr[data-row-key]').last().click()
  await page.locator('.po-run-detail').waitFor(); await end('Cold run sheet mounts complete content')
  await shot('run-detail')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '审批', exact: true }).first().click()
  await page.locator('.studio-evidence pre').first().waitFor()
  await font('.studio-evidence pre', 'Chinese within code evidence')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  check('No Renderer exceptions', errors.length === 0, errors.join(' | '))
} catch (error) { check('Readiness journey', false, String(error)); await shot('failure').catch(() => {}) }
finally {
  await app.close().catch(() => {})
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixture: 'fresh isolated persisted demo; cold query cache, 4x CPU throttling, actual platform-font inspection; delayed read ordering separately exercised by ui-readiness.test.ts', checks, fontSamples, traces, errors }, null, 2))
  if (checks.some((c) => c.status === 'FAIL')) process.exitCode = 1
}
