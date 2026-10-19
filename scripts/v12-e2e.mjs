import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
mkdirSync('test-results', { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-v12-e2e-'))
const workspaceDir = join(dataDir, 'project')
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')

let streamRequests = 0
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    let parsed = {}
    try {
      parsed = JSON.parse(body)
    } catch {
      // ignore
    }
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'fake-model' }, { id: 'fake-second' }] }))
      return
    }
    if (req.url?.endsWith('/chat/completions') && parsed.stream) {
      streamRequests += 1
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const write = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
      write({ choices: [{ delta: { content: 'V1.2 连接运行正常。' } }] })
      write({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 8 } })
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
    if (req.url?.endsWith('/chat/completions')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
      return
    }
    res.writeHead(404)
    res.end()
  })
})
await new Promise((listenResolve) => server.listen(0, '127.0.0.1', listenResolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app = null
let passed = false
const errors = []

async function launch() {
  const next = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: desktopDir, env, timeout: 60_000 })
  const page = await next.firstWindow()
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return { app: next, page }
}

try {
  let current = await launch()
  app = current.app
  let page = current.page
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  await page.locator('.po-nav-item').filter({ hasText: '设置' }).last().click()
  await page.waitForSelector('.po-settings-dialog', { timeout: 10_000 })
  const routeBefore = await page.evaluate(() => location.hash)

  await page.getByRole('button', { name: '新增连接' }).first().click()
  await page.getByLabel('名称').fill('V1.2 E2E Connection')
  await page.getByLabel('Base URL').fill(baseUrl)
  await page.getByLabel('API Key').fill('test-key')
  await page.getByLabel('默认模型').fill('fake-model')
  await page.getByRole('button', { name: /保\s*存/ }).last().click()
  await page.waitForSelector('.po-ai-connection-card', { timeout: 20_000 })
  await page.locator('.po-ai-connection-card').first().getByRole('button', { name: '测试连接' }).click()
  await page.waitForSelector('.po-ai-test.is-ok', { timeout: 20_000 })
  const testText = await page.locator('.po-ai-test').innerText()
  if (!testText.includes('L1') || !testText.includes('L3')) throw new Error('connection test stages missing')
  await page.getByRole('button', { name: '同步模型' }).click()
  await page.waitForTimeout(1200)
  await page.locator('.po-settings-nav-item').filter({ hasText: '模型目录' }).click()
  await page.waitForSelector('text=fake-second', { timeout: 10_000 })
  const secondRow = page.locator('tr').filter({ hasText: 'fake-second' })
  await secondRow.getByRole('button', { name: '设为默认模型' }).click()
  await page.waitForTimeout(1200)
  await page.locator('.po-settings-modal .ant-modal-close').click()
  await page.waitForTimeout(400)

  const ids = await page.evaluate(
    async ({ workspaceDir }) => {
      const project = (
        await window.projectos.projects.create({
          name: 'V1.2 Native Run',
          description: '',
          rootPath: workspaceDir,
          createDirectory: true,
          initGit: false,
        })
      ).project
      const session = (
        await window.projectos.sessions.create({ projectId: project.id, agentId: 'agt_engineer', title: 'V1.2 Session' })
      ).session
      return { projectId: project.id, sessionId: session.id }
    },
    { workspaceDir },
  )
  await page.reload()
  await page.waitForTimeout(2200)
  await page.evaluate(
    ({ projectId, sessionId }) => {
      location.hash = `#/projects/${projectId}/agents?session=${sessionId}`
    },
    ids,
  )
  await page.waitForSelector('.po-sender textarea', { timeout: 20_000 })
  await page.locator('.po-sender textarea').fill('请回复连接状态')
  await page.locator('.po-sender textarea').press('Enter')
  await page.waitForFunction(
    () => document.querySelector('.po-chat-scroll')?.textContent?.includes('V1.2 连接运行正常'),
    null,
    { timeout: 25_000 },
  )
  const runs = await page.evaluate(async ({ projectId }) => window.projectos.runs.list(projectId), ids)
  if (runs.runs[0]?.status !== 'completed') throw new Error('native run did not complete through the new connection')
  const connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  const connection = connections.connections[0]
  if (!connection || !connection.isDefault || connection.defaultModelId !== 'fake-second') {
    throw new Error(`default connection/model not persisted: ${JSON.stringify(connection)}`)
  }
  if (connection.modelCount !== 2) throw new Error(`expected 2 models, got ${connection.modelCount}`)
  const external = await page.evaluate(async () => window.projectos.externalAgents.list())
  if (external.installations.length !== 2) throw new Error('external agent detection missing')
  if (routeBefore !== '') throw new Error('settings changed the route')

  // Explicit collapse must not leave wrapped labels inside the 76px rail.
  const collapsed = await page.evaluate(() => document.querySelector('.po-shell')?.classList.contains('is-collapsed'))
  if (collapsed) await page.locator('.po-titlebar-left > .po-icon-button').click()
  await page.locator('.po-titlebar-left > .po-icon-button').click()
  await page.waitForTimeout(450)
  const rail = await page.evaluate(() => ({
    collapsed: document.querySelector('.po-shell')?.classList.contains('is-collapsed'),
    width: Math.round(document.querySelector('.po-sidebar')?.getBoundingClientRect().width ?? 0),
    textDisplay: getComputedStyle(document.querySelector('.po-project-button-text')).display,
    overflow:
      (document.querySelector('.po-sidebar')?.scrollWidth ?? 0) >
      (document.querySelector('.po-sidebar')?.clientWidth ?? 0) + 1,
  }))
  if (!rail.collapsed || rail.width > 90 || rail.textDisplay !== 'none' || rail.overflow) {
    throw new Error(`collapsed sidebar layout invalid: ${JSON.stringify(rail)}`)
  }
  await page.screenshot({ path: 'test-results/v12-collapsed.png' })

  await app.close()
  app = null
  current = await launch()
  app = current.app
  page = current.page
  await page.waitForSelector('.po-nav-item', { timeout: 30_000 })
  const restarted = await page.evaluate(async () => window.projectos.aiConnections.list())
  if (!restarted.connections[0]?.hasSecret || restarted.connections[0]?.defaultModelId !== 'fake-second') {
    throw new Error('connection/secret did not survive restart')
  }
  const restartedRuns = await page.evaluate(async ({ projectId }) => window.projectos.runs.list(projectId), ids)
  if (restartedRuns.runs[0]?.status !== 'completed') throw new Error('run history did not survive restart')
  if (errors.length > 0) throw new Error(`renderer errors: ${errors.join(' | ')}`)
  console.log('V1.2 E2E PASS — modal settings, connection CRUD/test/discovery, default sync, native run, restart, external detection and collapsed rail.')
  console.log(`  connection: ${connection.name} (${connection.defaultModelId})`)
  console.log(`  stream requests: ${streamRequests}`)
  passed = true
} catch (error) {
  console.error('V1.2 E2E FAIL —', error instanceof Error ? error.message : error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: 'test-results/v12-e2e-failure.png' })
    } catch {
      // best effort
    }
  }
  console.error(`  data kept for inspection: ${dataDir}`)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  await new Promise((closeResolve) => server.close(closeResolve))
  if (passed) {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // best-effort temp cleanup
    }
  }
}
