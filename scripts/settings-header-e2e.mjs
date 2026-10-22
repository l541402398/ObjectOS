/**
 * Packaged settings header hit-test regression.
 * Reproduces the reported 1274x747 settings window with one existing AI connection
 * and verifies every header action is the topmost hit target, then real-clicks
 * "新增连接" (no DOM click).
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const exe = resolve(process.env.PROJECTOS_TEST_EXE ?? join(root, 'release/win-x64/win-unpacked/ProjectOS.exe'))
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-settings-e2e-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-settings-e2e-user-'))
const shots = join(root, 'test-results', 'r21')
mkdirSync(shots, { recursive: true })

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE
let app = null
try {
  app = await electron.launch({
    executablePath: exe,
    args: [`--user-data-dir=${userDataDir}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.show()
    win.focus()
    win.moveTop()
    win.setContentSize(1274, 747)
  })
  await page.waitForTimeout(3200)
  await page.waitForSelector('#po-main')
  await page.locator('.po-nav-item').filter({ hasText: '设置' }).last().click()
  await page.waitForSelector('.po-settings-dialog')

  const created = await page.evaluate(async () => {
    try {
      return await window.projectos.aiConnections.create({
        name: '测试连接',
        providerId: 'custom',
        protocol: 'openai-chat',
        baseUrl: 'https://api.example.invalid/v1',
        defaultModelId: 'test-model',
        apiKey: 'sk-test-dummy-000000',
        enabled: true,
        isDefault: true,
      })
    } catch (error) {
      return { error: String(error?.message ?? error) }
    }
  })
  if (created?.error) throw new Error(`create connection failed: ${created.error}`)

  const nav = async (label) => {
    await page.locator('.po-settings-nav-item').filter({ hasText: label }).click()
    await page.waitForTimeout(500)
  }
  const headerButtons = async () =>
    page.evaluate(() => {
      const head = document.querySelector('.po-settings-panel-head')
      if (!head) return []
      return [...head.querySelectorAll('button')].map((button) => {
        const rect = button.getBoundingClientRect()
        const x = rect.left + rect.width / 2
        const y = rect.top + rect.height / 2
        const top = document.elementFromPoint(x, y)
        return {
          text: button.textContent?.trim(),
          inside: Boolean(top && (top === button || button.contains(top))),
          top: top ? `${top.tagName}.${String(top.className).slice(0, 50)}` : null,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        }
      })
    })

  const results = []
  const assertHeader = async (section, expectedText) => {
    await nav(section)
    const buttons = await headerButtons()
    const target = buttons.find((button) => button.text?.includes(expectedText))
    if (!target) throw new Error(`${section}: header button ${expectedText} not found (${JSON.stringify(buttons)})`)
    if (!target.inside) throw new Error(`${section}: ${expectedText} hit-test blocked by ${target.top}`)
    results.push({ section, ...target })
    return buttons
  }

  await nav('AI 连接')
  await assertHeader('AI 连接', '新增连接')
  const add = page.locator('.po-settings-panel-head button').filter({ hasText: '新增连接' }).first()
  await add.click()
  await page.waitForSelector('.po-ai-editor', { timeout: 10_000 })
  await page.screenshot({ path: join(shots, 'settings-header-packaged-1274.png') })
  console.log('PASS packaged settings: one connection, real click 新增连接 opens editor')

  await page.locator('.po-ai-editor').getByRole('button', { name: /取\s*消/ }).click()
  await page.waitForTimeout(400)
  if (!(await page.locator('.po-settings-dialog').count())) {
    await page.locator('.po-nav-item').filter({ hasText: '设置' }).last().click()
    await page.waitForSelector('.po-settings-dialog')
  }
  await assertHeader('运行时', '刷新')
  await page.locator('.po-settings-panel-head button').filter({ hasText: '刷新' }).first().click()
  console.log('PASS packaged settings: runtime header 刷新 is clickable')

  await assertHeader('模型目录', '手动添加')
  console.log('PASS packaged settings: model catalog header refresh is hit-test clean')

  const skills = await assertHeader('Skills 管理', '导入 SKILL.md')
  console.log('PASS packaged settings: skills header import button is hit-test clean', JSON.stringify(skills))

  console.log('PACKAGED SETTINGS HEADER PASS', JSON.stringify(results, null, 2))
  console.log(`screenshot: ${join(shots, 'settings-header-packaged-1274.png')}`)
} finally {
  if (app) await app.close().catch(() => undefined)
}
