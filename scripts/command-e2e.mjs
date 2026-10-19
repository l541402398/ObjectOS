import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
mkdirSync('test-results', { recursive: true })
const dataDir = mkdtempSync(join(tmpdir(), 'projectos-command-e2e-'))
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
      // fall through
    }
    if (!payload.stream) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
    const write = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
    if (requestCount === 1) {
      write({ choices: [{ delta: { content: '先执行只读命令检查 Node 版本。' } }] })
      write({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_command_e2e',
                  type: 'function',
                  function: { name: 'run_command', arguments: JSON.stringify({ command: 'node --version' }) },
                },
              ],
            },
          },
        ],
      })
      write({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    } else {
      write({ choices: [{ delta: { content: '命令已执行完成。' } }] })
      write({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 10 } })
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
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
  const setup = await page.evaluate(
    async ({ workspaceDir, baseUrl }) => {
      const project = (
        await window.projectos.projects.create({
          name: 'Command Approval E2E',
          description: '',
          rootPath: workspaceDir,
          createDirectory: true,
          initGit: false,
        })
      ).project
      const session = (
        await window.projectos.sessions.create({ projectId: project.id, agentId: 'agt_engineer', title: 'Cmd' })
      ).session
      await window.projectos.settings.update({ baseUrl, model: 'fake', apiKey: 'test', temperature: 0 })
      return { projectId: project.id, sessionId: session.id }
    },
    { workspaceDir, baseUrl },
  )
  await page.reload()
  await page.waitForTimeout(2000)
  await page.evaluate(
    ({ projectId, sessionId }) => {
      location.hash = `#/projects/${projectId}/agents?session=${sessionId}`
    },
    setup,
  )
  await page.waitForSelector('.po-sender textarea', { timeout: 20_000 })
  await page.locator('.po-sender textarea').fill('执行 node --version')
  await page.locator('.po-sender textarea').press('Enter')
  await page.getByRole('button', { name: '批准并继续' }).click({ timeout: 20_000 })
  await page.waitForFunction(
    () => document.querySelector('.po-chat-scroll')?.textContent?.includes('命令已执行完成'),
    null,
    { timeout: 20_000 },
  )
  const run = await page.evaluate(async ({ projectId }) => (await window.projectos.runs.list(projectId)).runs[0], setup)
  const detail = await page.evaluate(async ({ runId }) => window.projectos.runs.get(runId), { runId: run.id })
  const tool = detail.toolCalls.find((call) => call.toolName === 'run_command')
  if (run.status !== 'completed') throw new Error(`run status ${run.status}`)
  if (!tool || tool.status !== 'completed') throw new Error('run_command tool call did not complete')
  const result = tool.result
  if (!result || result.exitCode !== 0 || !/^v\d+/.test(result.stdout)) {
    throw new Error(`unexpected command result: ${JSON.stringify(result)}`)
  }
  if (errors.length > 0) throw new Error(`renderer errors: ${errors.join(' | ')}`)
  console.log('COMMAND E2E PASS — command approval pause, approved execution and completed tool call.')
  console.log(`  provider requests: ${requestCount}`)
  console.log(`  node: ${result.stdout.trim()} (exit ${result.exitCode})`)
  passed = true
} catch (error) {
  console.error('COMMAND E2E FAIL —', error instanceof Error ? error.message : error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: 'test-results/command-e2e-failure.png' })
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
      // best-effort temp cleanup on Windows
    }
  }
}
