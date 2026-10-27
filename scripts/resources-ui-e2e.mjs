import { _electron as electron } from 'playwright-core'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-resources-ui-'))
const keyPath = process.env.PROJECTOS_DEPLOY_SSH_KEY ?? ''
if (!keyPath) throw new Error('PROJECTOS_DEPLOY_SSH_KEY is required for this E2E')
const privateKey = readFileSync(keyPath, 'utf8')
const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')

async function launch() {
  const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: desktopDir, env, timeout: 30_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.po-shell.is-collapsed').count()) await page.getByRole('button', { name: '切换侧边栏' }).click()
  if (await page.locator('.v16-project-visual').count()) await page.locator('.v16-project-visual').first().click()
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  return { app, page }
}

try {
  let session = await launch()
  const { page } = session
  const project = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0])
  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/connections` }, { projectId: project.id })
  await page.waitForSelector('.rc-shell', { timeout: 30_000 })
  console.log('[resources-ui] resource center loaded')

  await page.getByRole('button', { name: '新建主机' }).click()
  await page.getByPlaceholder('Contabo 测试机').fill('Contabo E2E')
  await page.getByPlaceholder('169.58.112.111').fill('169.58.112.111')
  await page.getByPlaceholder('隔离部署测试').fill('只读连接测试')
  await page.locator('.ant-modal:visible textarea').fill(privateKey)
  await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
  await page.waitForFunction(() => document.body.innerText.includes('Contabo E2E'), null, { timeout: 20_000 })

  await page.getByRole('button', { name: '测试连接' }).first().click()
  await page.waitForFunction(() => /待确认指纹|已连接|认证失败|超时/.test(document.body.innerText), null, { timeout: 60_000 })
  if (await page.getByRole('button', { name: '信任并重试' }).count()) {
    await page.getByRole('button', { name: '信任并重试' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('已连接'), null, { timeout: 60_000 })
  }
  const body = await page.locator('body').innerText()
  if (!body.includes('已连接')) throw new Error(`SSH test did not connect: ${body.slice(-1200)}`)
  if (body.includes('BEGIN OPENSSH PRIVATE KEY')) throw new Error('private key leaked into renderer')
  console.log('[resources-ui] SSH host key trust + read-only connection PASS')

  const profileInfo = await page.evaluate(async ({ projectId }) => {
    const overview = await window.projectos.resources.overview(projectId)
    return { profileId: overview.profiles[0].id, fingerprint: overview.profiles[0].hostKeyFingerprint }
  }, { projectId: project.id })
  await page.evaluate(async ({ profileId }) => {
    await window.projectos.resources.updateProfile({ profileId, hostKeyFingerprint: 'SHA256:WRONG-FINGERPRINT' })
  }, profileInfo)
  await page.getByRole('button', { name: '测试连接' }).first().click()
  await page.waitForFunction(() => /主机指纹变化|主机指纹与已固定指纹不一致/.test(document.body.innerText), null, { timeout: 30_000 })
  await page.evaluate(async ({ profileId, fingerprint }) => {
    await window.projectos.resources.updateProfile({ profileId, hostKeyFingerprint: fingerprint })
  }, profileInfo)
  await page.getByRole('button', { name: '测试连接' }).first().click()
  await page.waitForFunction(() => document.body.innerText.includes('已连接') && !document.body.innerText.includes('WRONG-FINGERPRINT'), null, { timeout: 30_000 })
  console.log('[resources-ui] host key mismatch rejected, restored fingerprint reconnects PASS')

  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1440x900-light-resources.png') })
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1024, 768))
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1024x768-light-resources.png') })
  await session.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
  await page.waitForTimeout(300)

  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/deployments` }, { projectId: project.id })
  await page.waitForSelector('.dc-shell', { timeout: 30_000 })
  await page.getByRole('button', { name: '连接目标' }).click()
  const modalSelects = page.locator('.ant-modal:visible .ant-select')
  await modalSelects.nth(0).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Contabo E2E' }).first().click()
  await modalSelects.nth(1).click()
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Contabo E2E · SSH' }).first().click()
  await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
  await page.waitForFunction(() => document.body.innerText.includes('Contabo E2E'), null, { timeout: 15_000 })
  console.log('[resources-ui] deployment target selected registered resource/profile PASS')
  await page.screenshot({ path: join(root, 'docs', 'screenshots', '1440x900-light-deployment-resource-target.png') })

  await page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/connections` }, { projectId: project.id })
  await page.waitForSelector('.rc-shell', { timeout: 15_000 })
  await page.locator('.rc-tabs button').nth(1).click()
  await page.waitForTimeout(300)
  await page.locator('.rc-credential-row button').first().click()
  await page.waitForTimeout(500)
  await page.locator('.rc-tabs button').nth(0).click()
  await page.getByRole('button', { name: '测试连接' }).first().click()
  await page.waitForFunction(() => /认证失败|凭据不可用|凭据已停用/.test(document.body.innerText), null, { timeout: 30_000 })
  console.log('[resources-ui] disabled credential invalidates connection test PASS')

  await session.app.close()
  session = await launch()
  await session.page.evaluate(({ projectId }) => { location.hash = `#/projects/${projectId}/connections` }, { projectId: project.id })
  await session.page.waitForSelector('.rc-shell', { timeout: 30_000 })
  if (!(await session.page.locator('body').innerText()).includes('Contabo E2E')) throw new Error('resource not recovered after restart')
  const body2 = await session.page.locator('body').innerText()
  if (body2.includes('BEGIN OPENSSH PRIVATE KEY')) throw new Error('private key leaked after restart')
  console.log('[resources-ui] restart recovery PASS (metadata only, secret vault outside UI)')
  await session.app.close()

  const db = new DatabaseSync(join(dataDir, 'projectos.db'), { readOnly: true })
  try {
    const dump = JSON.stringify(db.prepare('SELECT * FROM credential_metadata').all())
    if (dump.includes('BEGIN OPENSSH PRIVATE KEY')) throw new Error('private key leaked into SQLite')
    console.log('[resources-ui] SQLite credential metadata contains no private key PASS')
    const vault = readFileSync(join(dataDir, 'resource-credentials.vault.json'), 'utf8')
    if (vault.includes('BEGIN OPENSSH PRIVATE KEY') || vault.includes(privateKey.slice(0, 40))) throw new Error('vault stores plaintext private key')
    console.log('[resources-ui] OS-encrypted vault contains ciphertext only PASS')
  } finally {
    db.close()
    rmSync(dataDir, { recursive: true, force: true })
  }
  console.log('RESOURCES UI E2E PASS')
} finally {
  // Cleanup is handled above on success; failed runs retain the temp dir for diagnosis.
}
