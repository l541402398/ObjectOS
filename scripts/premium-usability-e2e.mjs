/** Native checks of existing work modes, destination readiness and bounded graph motion. */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const out = resolve('docs/design/system-premium/usability')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-premium-usability-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60000 })
const page = await app.firstWindow(), win = await app.browserWindow(page), checks = [], errors = []
page.setDefaultTimeout(12000)
page.on('pageerror', (error) => errors.push(error.message))
const check = (name, passed, detail = '') => { checks.push({ name, status: passed ? 'PASS' : 'FAIL', detail }); console.log(`[${passed ? 'PASS' : 'FAIL'}] ${name} ${detail}`) }
const shot = async (name) => { await page.waitForTimeout(350); writeFileSync(join(out, `${name}.png`), Buffer.from(await win.evaluate(async (w) => (await w.webContents.capturePage()).toPNG().toString('base64')), 'base64')) }
try {
  await page.waitForSelector('.po-shell', { timeout: 60000 }); await page.waitForTimeout(3500)
  const projectId = (await page.evaluate(() => window.projectos.projects.list())).projects[0].id
  await page.evaluate((id) => { location.hash = `#/projects/${id}` }, projectId)
  await page.getByLabel('项目工作模式').waitFor()
  for (const [mode, label] of [['autonomous', '自主模式'], ['managed', '托管模式'], ['assist', '辅助模式']]) {
    await page.getByLabel('项目工作模式').click()
    await page.locator('.ant-select-item-option-content').getByText(label, { exact: true }).click()
    await page.waitForFunction(async ({ projectId, mode }) => (await window.projectos.actions.autonomy(projectId)).mode === mode, { projectId, mode })
    check(`${label} persists through the real API`, true)
  }
  await page.reload(); await page.getByLabel('项目工作模式').waitFor(); await page.waitForTimeout(500)
  check('Reload retains assisted mode', await page.locator('.po-project-mode').innerText().then((s) => s.includes('辅助模式')))
  const action = await page.evaluate((id) => window.projectos.actions.center(id), projectId)
  const first = action.items.find((item) => !item.stale)
  check('Home next step is a persisted action', !!first && (await page.getByTestId('next-step-panel').innerText()).includes(first.title))
  await shot('home-assisted-next-step')
  await page.getByRole('button', { name: '提出需求', exact: true }).click()
  await page.getByRole('dialog', { name: /需求/ }).waitFor()
  check('Propose requirement opens its existing form directly', true)
  await shot('requirement-direct-entry'); await page.keyboard.press('Escape')
  await page.waitForTimeout(350)

  // Slow the real renderer (not mock data). Each sampled frame must retain the old content or
  // contain the destination title AND task data, without an intermediate empty page.
  await page.getByRole('button', { name: '研发工作中心', exact: true }).click()
  await page.locator('.studio-home').waitFor()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  await page.evaluate(() => {
    window.__navFrames = []; window.__navStop = false
    const sample = () => { const main = document.querySelector('#po-main'); window.__navFrames.push({ time: performance.now(), text: main?.textContent?.trim().slice(0, 350), tasks: document.querySelectorAll('.po-task-tile').length, home: !!document.querySelector('.studio-home'), loading: !!document.querySelector('.po-route-progress') }); if (!window.__navStop) requestAnimationFrame(sample) }; sample()
  })
  const start = Date.now()
  await page.getByRole('button', { name: '任务看板', exact: true }).click()
  await page.locator('.po-task-tile').first().waitFor(); await page.waitForTimeout(250)
  const frames = await page.evaluate(() => { window.__navStop = true; return window.__navFrames })
  check('Slower renderer keeps a coherent destination', frames.every((frame) => frame.home || frame.tasks > 0), JSON.stringify({ elapsedMs: Date.now() - start, frames: frames.length, intermediateEmpty: frames.filter((f) => !f.home && !f.tasks).length }))
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await page.getByRole('button', { name: '研发工作中心', exact: true }).click(); await page.locator('.studio-home').waitFor()
  const revisit = Date.now(); await page.getByRole('button', { name: '任务看板', exact: true }).click(); await page.locator('.po-task-tile').first().waitFor()
  check('Cached revisit renders populated tasks', true, `${Date.now() - revisit} ms including native input`)
  await page.getByRole('button', { name: '版本与迭代', exact: true }).click({ noWaitAfter: true })
  await page.getByRole('button', { name: 'Agent 协作', exact: true }).click({ noWaitAfter: true })
  await page.locator('.aco-canvas').waitFor(); await page.waitForTimeout(400)
  check('Rapid navigation ends at the latest chosen page', page.url().endsWith('/agents'))

  await page.locator('.aco-gnode-task').first().click(); await page.locator('.aco-flow-pulse').first().waitFor()
  const sampleMotion = async () => page.evaluate(() => new Promise((resolve) => {
    const times = [], begin = performance.now(); let last = begin
    const step = (now) => { times.push(now - last); last = now; if (now - begin < 2500) requestAnimationFrame(step); else { times.sort((a,b) => a-b); resolve({ frames: times.length, fps: times.length * 1000 / (now - begin), p95FrameMs: times[Math.floor(times.length * .95)], pulseCount: document.querySelectorAll('.aco-flow-pulse').length, nodeCount: document.querySelectorAll('.react-flow__node').length }) } }; requestAnimationFrame(step)
  }))
  const moving = await sampleMotion(); check('Motion remains bounded to selected/running relations', moving.pulseCount > 0 && moving.pulseCount <= 12, JSON.stringify(moving))
  await shot('graph-directional-pulse');
  await page.locator('[aria-label="暂停流向脉冲"]').evaluate((el) => el.click())
  const paused = await sampleMotion(); check('Pause removes moving elements', paused.pulseCount === 0, JSON.stringify(paused))
  await page.locator('[aria-label="开启流向脉冲"]').evaluate((el) => el.click()); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForTimeout(200)
  check('Reduced motion is honored immediately', await page.locator('.aco-flow-pulse').count() === 0)
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.keyboard.press('Escape'); await page.waitForTimeout(300)
  await page.getByRole('button', { name: '版本与迭代', exact: true }).click(); await page.locator('.lc-relationship').waitFor()
  check('Iterations and environment ownership are explicit', (await page.locator('.lc-relationship').innerText()).includes('项目共用'))
  await shot('version-iteration-relationship')
  await page.getByRole('button', { name: /部署环境$/ }).first().click(); await page.locator('.dc-start').waitFor()
  check('Environment entry lands in deployment setup', page.url().includes('/deployments'))
  await shot('deployment-guided-start')
  check('No Renderer exceptions', !errors.length, errors.join(' | '))
} catch (error) { check('Native usability journey', false, String(error)); await shot('failure') }
finally {
  await app.close().catch(() => {})
  writeFileSync(join(out, 'checks.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixture: 'isolated persisted demo, real API, 4x renderer CPU throttling for navigation', checks, errors }, null, 2))
  if (checks.some((item) => item.status === 'FAIL')) process.exitCode = 1
}
