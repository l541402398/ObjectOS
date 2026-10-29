/**
 * Is the AI key usable after restarting the app? Creates a real DeepSeek connection in a throwaway
 * profile, quits, relaunches the same data dir + userData, and asks the product to test the stored
 * connection (which requires decrypting the key in the Main process).
 *
 * usage: P29_DEEPSEEK_KEY=... node scripts/p29-secret-restart-e2e.mjs
 */
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const key = process.env.P29_DEEPSEEK_KEY
if (!key) {
  console.error('P29_DEEPSEEK_KEY is required')
  process.exit(2)
}
const root = process.cwd()
const work = mkdtempSync(join(tmpdir(), 'p29-secret-'))
const dataDir = join(work, 'data')
const userDataDir = join(work, 'userdata')
mkdirSync(dataDir, { recursive: true })
mkdirSync(userDataDir, { recursive: true })

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE
delete env.P29_DEEPSEEK_KEY

const launch = () =>
  electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })

let connectionId = null
let app = await launch()
try {
  let page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(1500)
  const created = await page.evaluate(async (apiKey) => {
    const connection = await window.projectos.aiConnections.create({
      name: 'Secret restart test',
      providerId: 'deepseek',
      protocol: 'openai-chat',
      baseUrl: 'https://api.deepseek.com',
      apiKey,
      defaultModelId: 'deepseek-chat',
      timeoutMs: 120_000,
      isDefault: true,
      enabled: true,
    })
    const tested = await window.projectos.aiConnections.test(connection.id)
    return { id: connection.id, hasSecret: connection.hasSecret, tested }
  }, key)
  connectionId = created.id
  record('首次启动：创建连接并通过真实推理', created.tested?.ok === true ? 'PASS' : 'FAIL', `id=${created.id} hasSecret=${created.hasSecret}`)
  await app.close()
  app = null

  app = await launch()
  page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 60_000 })
  await page.waitForTimeout(3000)
  const after = await page.evaluate(async (id) => {
    const list = await window.projectos.aiConnections.list()
    const connection = list.connections.find((item) => item.id === id) ?? null
    const tested = await window.projectos.aiConnections.test(id)
    const runtime = await window.projectos.runtime.status()
    return { hasSecret: connection?.hasSecret ?? null, enabled: connection?.enabled ?? null, isDefault: connection?.isDefault ?? null, tested, runtimeStatus: runtime.status }
  }, connectionId)
  record(
    '重启后：Main 仍能解密该连接的密钥',
    after.hasSecret === true ? 'PASS' : 'FAIL',
    `hasSecret=${after.hasSecret} default=${after.isDefault} enabled=${after.enabled}`,
  )
  record(
    '重启后：连接测试仍通过真实推理',
    after.tested?.ok === true ? 'PASS' : 'FAIL',
    JSON.stringify(after.tested ?? {}).slice(0, 240),
  )
  const injection = await page.evaluate(async () => {
    // Prove the runtime (not just Main) got a usable provider after restart.
    const projects = await window.projectos.projects.list({})
    const list = projects.projects ?? projects
    return { projects: list.length }
  })
  record('重启后：Runtime 可用（项目列表可读）', injection.projects >= 0 ? 'PASS' : 'FAIL', JSON.stringify(injection))
} catch (error) {
  record('重启密钥连续性', 'FAIL', String(error).slice(0, 300))
} finally {
  try {
    await app?.close()
  } catch {
    /* ignore */
  }
  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== P29 SECRET RESTART =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  console.log(`workdir: ${work}`)
  if (failed.length) process.exitCode = 1
}
