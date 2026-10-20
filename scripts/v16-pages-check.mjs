import { _electron as electron } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
const root = process.cwd()
const out = join(root, 'docs/v1.6/pages')
mkdirSync(out, { recursive: true })
const env = { ...process.env, PROJECTOS_DATA_DIR: mkdtempSync(join(tmpdir(), 'v16-pages-')), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1586', PROJECTOS_WINDOW_HEIGHT: '992' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'v16-pages-user-'))], cwd: resolve(root, 'apps/desktop'), env, timeout: 60000 })
const page = await app.firstWindow()
await page.waitForSelector('.v16-project-visual', { timeout: 30000 })
await page.click('button[aria-label="主题"]')
await page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: '深色' }).click()
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
await page.waitForTimeout(500)
const projectId = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0].id)
for (const [name, path, selector] of [
  ['overview', '', '.po-overview-page'],
  ['tasks', '/tasks', '.po-task-board-page'],
  ['knowledge', '/knowledge', '.po-knowledge-page'],
  ['operations', '/operations', '.po-operations-page'],
  ['orchestration', '/orchestration', '.po-orchestration-page'],
  ['agents', '/agents', '.po-agent-page'],
  ['runs', '/runs', '.po-runs-page'],
]) {
  await page.evaluate(({ id, path }) => { location.hash = `#/projects/${id}${path}` }, { id: projectId, path })
  await page.waitForTimeout(1300)
  if (selector && (await page.locator(selector).count())) await page.waitForTimeout(400)
  await page.screenshot({ path: join(out, `${name}.png`) })
  console.log('captured', name)
}
await app.close()
