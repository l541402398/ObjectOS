import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
mkdirSync('test-results', { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-agent-e2e-'))
const workspaceDir = join(dataDir, 'project')
const electronPath = resolve(root, 'node_modules/electron/dist/electron.exe')
const desktopDir = resolve(root, 'apps/desktop')

let requestCount = 0
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    requestCount += 1
    let payload = {}
    try {
      payload = JSON.parse(body)
    } catch {
      // fall through to a valid response
    }
    if (!payload.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const write = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
    if (requestCount === 1) {
      write({ choices: [{ delta: { role: 'assistant', content: '我将创建交付文件，但写入前需要你的授权。' } }] })
      write({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_write_e2e',
                  type: 'function',
                  function: {
                    name: 'write_file',
                    arguments: JSON.stringify({
                      path: 'agent-output.md',
                      content: '# Agent output\n\nWritten only after human approval.\n',
                    }),
                  },
                },
              ],
            },
          },
        ],
      })
      write({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    } else {
      write({ choices: [{ delta: { content: '已完成文件写入。验收：agent-output.md 已生成，内容可读。' } }] })
      write({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 30 } })
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
const port = server.address().port
const baseUrl = `http://127.0.0.1:${port}/v1`

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
let app
let passed = false
try {
  app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: desktopDir, env, timeout: 30_000 })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.waitForTimeout(3500)
  const project = await page.evaluate(
    async ({ workspaceDir }) =>
      window.projectos.projects.create({
        name: 'Agent Approval E2E',
        description: 'Approval and tool execution flow',
        rootPath: workspaceDir,
        createDirectory: true,
        initGit: true,
      }),
    { workspaceDir },
  )
  const session = await page.evaluate(
    async ({ projectId }) =>
      window.projectos.sessions.create({ projectId, agentId: 'agt_engineer', title: 'E2E Engineer' }),
    { projectId: project.project.id },
  )
  await page.evaluate(
    async ({ baseUrl }) =>
      window.projectos.settings.update({
        baseUrl,
        model: 'fake-agent-model',
        apiKey: 'test-key',
        temperature: 0,
      }),
    { baseUrl },
  )
  // Reload so React Query picks up the API-created project before navigating.
  await page.reload()
  await page.waitForTimeout(2500)
  await page.evaluate(
    ({ projectId, sessionId }) => {
      location.hash = `#/projects/${projectId}/agents?session=${sessionId}`
    },
    { projectId: project.project.id, sessionId: session.session.id },
  )
  await page.waitForSelector('.po-sender textarea', { timeout: 30_000 })
  const composer = page.locator('.po-sender textarea').first()
  await composer.fill('请创建 agent-output.md，先请求授权。')
  await composer.press('Enter')
  await page.getByRole('button', { name: '批准并继续' }).click({ timeout: 20_000 })
  await page.waitForFunction(
    () => document.querySelector('.po-chat-scroll')?.textContent?.includes('已完成文件写入'),
    null,
    { timeout: 25_000 },
  )
  const file = await page.evaluate(
    async ({ projectId }) => window.projectos.workspace.readFile(projectId, 'agent-output.md'),
    { projectId: project.project.id },
  )
  if (!file.content.includes('Written only after human approval')) throw new Error('approved write did not reach disk')
  const runs = await page.evaluate(
    async ({ projectId }) => window.projectos.runs.list(projectId),
    { projectId: project.project.id },
  )
  if (runs.runs[0]?.status !== 'completed') throw new Error('agent run did not complete')
  const approvals = await page.evaluate(
    async ({ projectId }) => window.projectos.approvals.list({ projectId }),
    { projectId: project.project.id },
  )
  if (approvals.approvals[0]?.status !== 'approved') throw new Error('approval was not recorded')
  if (errors.length > 0) throw new Error(`renderer errors: ${errors.join(' | ')}`)
  console.log('AGENT E2E PASS — real approval pause, approved write, resumed loop and completed run.')
  console.log(`  provider requests: ${requestCount}`)
  console.log(`  run: ${runs.runs[0].id} (${runs.runs[0].status})`)
  passed = true
} catch (error) {
  console.error('AGENT E2E FAIL —', error instanceof Error ? error.message : error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: 'test-results/agent-e2e-failure.png' })
    } catch {
      // best effort
    }
    await app.close().catch(() => undefined)
  }
  console.error(`  data kept for inspection: ${dataDir}`)
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
  await new Promise((resolveClose) => server.close(resolveClose))
  if (passed) {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // Windows may release SQLite handles slightly after app exit; temp cleanup is best-effort.
    }
  }
}
