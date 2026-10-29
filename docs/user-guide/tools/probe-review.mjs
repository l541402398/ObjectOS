/** 探针：尝试从编排工作台打开 Plan Review（草稿计划）。 */
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
await page.getByRole('button', { name: /完整编排工作台/ }).first().click()
await page.waitForTimeout(3000)
// 点一个有任务的节点：先点 Agent 节点
const node = page.locator('.react-flow__node').first()
console.log('nodes:', await page.locator('.react-flow__node').count())
if (await node.count()) await node.click()
await page.waitForTimeout(1500)
const inspector = await page.evaluate(() => document.querySelector('.po-inspector-panel')?.innerText ?? '(none)')
console.log('inspector:', inspector.slice(0, 500))
const planRow = page.locator('.po-plan-row').first()
console.log('plan rows:', await page.locator('.po-plan-row').count())
if (await planRow.count()) {
  await planRow.click()
  await page.waitForTimeout(2000)
  console.log('after click hash:', await page.evaluate(() => location.hash))
  console.log('review visible:', await page.locator('[data-testid="plan-review-workspace"]').count())
  const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '))
  console.log('body:', text.slice(0, 900))
  await page.screenshot({ path: 'docs/user-guide/_evidence/probe-plan-review.png' })
}
await app.close()
