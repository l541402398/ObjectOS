/** 临时探针：查看 Plan Review（编排工作台）真实结构与按钮。 */
import { _electron as electron } from 'playwright-core'
import { join, resolve } from 'node:path'

const dataDir = process.argv[2]
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: resolve('node_modules/electron/dist/electron.exe'),
  args: ['.', `--user-data-dir=${join(dataDir, 'userdata')}`],
  cwd: resolve('apps/desktop'),
  env,
  timeout: 60_000,
})
const page = await app.firstWindow()
await page.waitForSelector('.po-empty-title, .v16-project-visual', { timeout: 60_000 })
await page.locator('.v16-project-visual').first().click()
await page.waitForSelector('.wc-grid', { timeout: 30_000 })
await page.waitForTimeout(1200)
const buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean))
console.log('workcenter buttons:', JSON.stringify(buttons, null, 1))
const workText = await page.evaluate(() => document.querySelector('.wc-plan')?.innerText ?? '(no wc-plan)')
console.log('wc-plan:', workText.slice(0, 1200))
const link = page.getByRole('button', { name: /打开 Plan Review/ })
if (await link.count()) {
  await link.first().click()
} else {
  await page.evaluate(() => {
    const hash = location.hash
    location.hash = hash.replace(/\/?$/, '').replace(/work$/, 'orchestration')
  })
}
await page.waitForTimeout(3000)
const reviewButtons = await page.evaluate(() =>
  [...document.querySelectorAll('button')].map((b) => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean),
)
console.log('review hash:', await page.evaluate(() => location.hash))
console.log('review buttons:', JSON.stringify(reviewButtons, null, 1))
const body = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '))
console.log('review body:', body.slice(0, 1800))
await app.close()
