import { _electron as electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const results = []
for (const scale of ['1.25', '1.5']) {
  const dataDir = mkdtempSync(join(tmpdir(), `projectos-dpi-${scale}-`))
  const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--force-device-scale-factor=${scale}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  try {
    const page = await app.firstWindow()
    await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
    await page.waitForTimeout(2500)
    const projectId = await page.evaluate(async () => (await window.projectos.app.bootstrap()).projects[0].id)
    await page.evaluate((id) => { window.location.hash = `#/projects/${id}` }, projectId)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: 'docs/screenshots/dpi-' + scale + '-overview.png' })
    const overview = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, dpr: window.devicePixelRatio }))
    await page.evaluate((id) => { window.location.hash = `#/projects/${id}/agents` }, projectId)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: 'docs/screenshots/dpi-' + scale + '-agents.png' })
    const agents = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, dpr: window.devicePixelRatio }))
    if (overview.overflow > 2 || agents.overflow > 2) throw new Error(`horizontal overflow at ${scale}: ${JSON.stringify({ overview, agents })}`)
    results.push({ scale, dpr: overview.dpr, overviewOverflow: overview.overflow, agentsOverflow: agents.overflow })
  } finally {
    await app.close().catch(() => {})
    rmSync(dataDir, { recursive: true, force: true })
  }
}
console.log('V1.5 DPI CHECK PASS — no horizontal overflow at 125% / 150%.')
for (const result of results) console.log(`  scale=${result.scale} dpr=${result.dpr} overflow=${result.overviewOverflow}/${result.agentsOverflow}`)


