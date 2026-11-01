/** Separate prototype inspection from real Electron baseline; neither is final acceptance. */
import { _electron as electron, chromium } from 'playwright-core'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
const out = resolve('docs/design/soft-studio/baseline')
mkdirSync(out, { recursive: true })
const root = resolve('.tmp/soft-studio-plan-v2/ProjectOS_Soft_Studio_Plan')
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
const prototype = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const inspection = []
try {
  await prototype.goto(pathToFileURL(join(root, 'prototype/index.html')).href)
  inspection.push({ action: 'Open supplied prototype', heading: await prototype.title() })
  await prototype.screenshot({ path: join(out, 'reference-prototype-light.png') })
  await prototype.locator('#theme').click()
  inspection.push({ action: 'Toggle theme', actual: await prototype.locator('html').getAttribute('data-theme') })
  await prototype.locator('[data-page="overview"]').click()
  inspection.push({ action: 'Open overview', actual: await prototype.locator('#main h1').innerText() })
  await prototype.locator('[data-page="tasks"]').click()
  const controls = await prototype.locator('#main button').evaluateAll(nodes => nodes.map(n => ({ text: n.textContent.trim(), attrs: [...n.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value]) })))
  inspection.push({ action: 'Inspect real prototype controls', controls })
  for (const name of ['列表', '看板', '流程']) {
    await prototype.locator('#main button').filter({ hasText: new RegExp(`^${name}$`) }).click()
    inspection.push({ action: `Switch ${name}`, actual: await prototype.locator('#main').innerText().then(t => t.slice(0, 280)) })
  }
  await prototype.locator('[data-select]').first().click()
  inspection.push({ action: 'Open task detail', actual: await prototype.locator('#main').innerText().then(t => t.slice(-650)) })
  await prototype.screenshot({ path: join(out, 'reference-prototype-dark-detail.png') })
} finally { await browser.close(); writeFileSync(join(out, 'prototype-inspection.json'), JSON.stringify({ scope: 'Supplied HTML design reference only; NOT product acceptance', inspection }, null, 2)) }

const profile = mkdtempSync(join(tmpdir(), 'projectos-soft-baseline-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }; delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60000 })
const page = await app.firstWindow(), win = await app.browserWindow(page), records = [], errors = []
page.on('pageerror', e => errors.push(e.message))
try {
  await page.locator('.po-shell').waitFor({ timeout: 60000 })
  const project = (await page.evaluate(() => window.projectos.projects.list())).projects[0]
  for (const [name, path] of [['home', ''], ['flow', '/orchestration'], ['overview', '/overview'], ['agents', '/agents']]) {
    await page.evaluate(route => { location.hash = route }, `#/projects/${project.id}${path}`)
    await page.waitForTimeout(1800)
    for (const [width, height] of [[1440,900],[1024,768]]) for (const mode of ['light','dark']) {
      await win.evaluate((w,v) => w.setSize(v.width,v.height), { width,height })
      await page.emulateMedia({ colorScheme: mode }); await page.waitForFunction(m => document.documentElement.dataset.theme === m, mode); await page.waitForTimeout(350)
      const file = `product-before-${name}-${width}-${mode}.png`
      writeFileSync(join(out,file),Buffer.from(await win.evaluate(async w => (await w.webContents.capturePage()).toPNG().toString('base64')),'base64'))
      records.push({ file, width,height,mode, heading: await page.locator('h1').allTextContents() })
    }
  }
} finally {
  await app.close().catch(() => {})
  writeFileSync(join(out,'product-baseline.json'),JSON.stringify({ head: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), scope:'Current compiled working branch before Soft Studio activation, persisted isolated demo and actual native Electron capture. Earlier source adaptations are preserved.', records, errors },null,2))
}
