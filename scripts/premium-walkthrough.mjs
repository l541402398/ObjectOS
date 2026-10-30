/** Native interaction recording for visual review; isolated persisted demo, no provider/deploy calls. */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const out = resolve('docs/design/system-premium/walkthrough')
mkdirSync(out, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'projectos-premium-walkthrough-'))
const env = { ...process.env, PROJECTOS_DATA_DIR: join(profile, 'data'), PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('node_modules/electron/dist/electron.exe'), cwd: resolve('apps/desktop'), args: ['.', `--user-data-dir=${join(profile, 'user')}`], env, timeout: 60000, recordVideo: { dir: join(profile, 'video'), size: { width: 1440, height: 900 } } })
const page = await app.firstWindow(), recording = page.video(), steps = [], errors = []
page.on('pageerror', error => errors.push(error.message))
const step = async (name, run) => { await run(); await page.waitForTimeout(1400); steps.push(name); console.log('RECORDED ' + name) }
try {
  await page.waitForSelector('.po-shell', { timeout: 60000 })
  await page.emulateMedia({ colorScheme: 'light' })
  await step('Project home and persisted modes', async () => {
    await page.getByRole('button', { name: /打开工作台/ }).click()
    await page.getByLabel('项目工作模式').click()
    await page.waitForTimeout(1000)
    await page.keyboard.press('Escape')
  })
  await step('Requirement entry', async () => {
    await page.getByRole('button', { name: '提出需求', exact: true }).click()
    await page.getByRole('dialog', { name: /需求/ }).waitFor()
  })
  await page.keyboard.press('Escape')
  await step('Graph details and directional pulses', async () => {
    await page.getByRole('button', { name: 'Agent 协作', exact: true }).click()
    await page.locator('.aco-gnode-task').first().click()
    await page.getByTestId('collaboration-inspector').waitFor()
    await page.locator('.aco-flow-pulse').first().waitFor()
    await page.waitForTimeout(4500)
  })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '暂停流向脉冲', exact: true }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: '开启流向脉冲', exact: true }).click()
  await step('Version and iteration ownership', async () => {
    await page.getByRole('button', { name: '版本与迭代', exact: true }).click()
    await page.locator('.lc-relationship').waitFor()
  })
  await step('Guided deployment preparation', async () => {
    await page.getByRole('button', { name: /部署环境$/ }).first().click()
    await page.locator('.dc-start').waitFor()
  })
  await step('Shared Settings surface', async () => {
    await page.getByRole('button', { name: '设置', exact: true }).first().click()
    await page.getByTestId('settings-dialog').waitFor()
  })
  await step('Dark theme', async () => { await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark') })
  await page.keyboard.press('Escape')
  await page.emulateMedia({ colorScheme: 'light' })
  await step('Protected Lab DAG', async () => { await page.evaluate(() => { location.hash = '#/design-lab' }); await page.getByTestId('design-lab-dag').waitFor() })
  await step('Stage route and keyboard identity', async () => { await page.getByRole('tab', { name: '阶段路线', exact: true }).click(); await page.locator('.pdl-stop').first().focus() })
  await step('Shared editable task inspector', async () => {
    await page.getByRole('tab', { name: '任务依赖', exact: true }).click()
    await page.locator('.pdl-node').first().click()
    await page.getByLabel('任务标题', { exact: true }).pressSequentially(' · 复核')
  })
  if (errors.length) throw new Error(errors.join(' | '))
} catch (error) { errors.push(String(error)); process.exitCode = 1 }
finally {
  await app.close()
  if (!recording) throw new Error('Native video recording was unavailable')
  await recording.saveAs(join(out, 'product-ui.webm'))
  writeFileSync(join(out, 'recording.json'), JSON.stringify({ head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), status: errors.length ? 'FAIL' : 'PASS', fixture: 'isolated persisted demo; native Electron video; no provider or deployment calls; recording is not the FPS benchmark', steps, errors }, null, 2))
}
