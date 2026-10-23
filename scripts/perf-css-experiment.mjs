import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron } from 'playwright-core'

const pkg = resolve('C:/Users/Administrator/Desktop/workplace/ProjectOS-next-ui-full-migration/release/win-phase5-pages/win-unpacked')
const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'css-exp-')),
  PROJECTOS_SEED_DEMO: '1',
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({ executablePath: join(pkg, 'ProjectOS.exe'), args: [`--user-data-dir=${mkdtempSync(join(tmpdir(), 'css-exp-user-'))}`], cwd: pkg, env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
await page.addInitScript(() => {
  window.__m = {
    frames: 0, tasks: [], running: false,
    start() {
      this.frames = 0; this.tasks = []; this.running = true; const t0 = performance.now()
      this.observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) this.tasks.push(e.duration) })
      try { this.observer.observe({ type: 'longtask', buffered: false }) } catch {}
      const tick = () => { if (!this.running) return; this.frames++; requestAnimationFrame(tick) }
      requestAnimationFrame(tick)
      this.t0 = t0
    },
    stop() { this.running = false; this.observer?.disconnect(); const ms = performance.now() - this.t0; return { fps: Math.round((this.frames * 1000 / ms) * 10) / 10, long: this.tasks.reduce((a, b) => a + b, 0), max: Math.max(0, ...this.tasks) } },
  }
})
await page.reload()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
const id = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, id)
await page.waitForSelector('.po-orch-canvas')

async function run(name, css) {
  const style = css ? await page.addStyleTag({ content: css }) : null
  await page.waitForTimeout(300)
  await page.evaluate(() => window.__m.start())
  const box = await page.locator('.po-orch-canvas').boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -180)
  await page.waitForTimeout(300)
  await page.mouse.wheel(0, 160)
  await page.locator('.react-flow__node').first().click({ force: true })
  await page.waitForTimeout(1600)
  const result = await page.evaluate(() => window.__m.stop())
  if (style) await style.evaluate((element) => element.remove())
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  console.log(name, result)
  return { name, ...result }
}

const results = []
results.push(await run('baseline', ''))
results.push(await run('header off + sidebar 16px', '.po-orch-header { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } .po-sidebar.glass-panel { backdrop-filter: blur(16px) saturate(1.12) !important; -webkit-backdrop-filter: blur(16px) saturate(1.12) !important; }'))
results.push(await run('header off + sidebar 12px', '.po-orch-header { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; } .po-sidebar.glass-panel { backdrop-filter: blur(12px) saturate(1.12) !important; -webkit-backdrop-filter: blur(12px) saturate(1.12) !important; }'))
results.push(await run('all blur off', '*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }'))
console.log(JSON.stringify(results, null, 2))
await app.close()



