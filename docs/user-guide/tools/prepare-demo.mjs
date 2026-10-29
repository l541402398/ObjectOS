/**
 * 准备演示环境：在隔离数据目录里把「真实 AI 连接」一次性迁移好，并验证密钥可用。
 *
 * 为什么单独一步：应用只在连接列表为空时迁移 provider.json；若在同一目录反复
 * 删除 connectionsMigrated，会重复创建空密钥连接。准备一次、后续复用最稳。
 *
 * 用法：node docs/user-guide/tools/prepare-demo.mjs --data=<dir>
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { prepareUserData, prepareWorkspace, seedProvider } from './env.mjs'

const root = process.cwd()
const arg = process.argv.find((item) => item.startsWith('--data='))?.slice(7)
if (!arg) throw new Error('缺少 --data=<隔离数据目录>')
const dataDir = arg
mkdirSync(dataDir, { recursive: true })

const workspaceDir = join(dataDir, 'aurora-notes')
if (!existsSync(workspaceDir)) {
  prepareWorkspace(join(root, 'docs', 'user-guide', 'fixtures', 'aurora-notes'), workspaceDir)
  const git = (...args) => execFileSync('git', args, { cwd: workspaceDir, encoding: 'utf8' })
  git('init', '-q')
  git('config', 'user.email', 'demo@example.com')
  git('config', 'user.name', 'Demo User')
  git('add', '.')
  git('commit', '-q', '-m', 'chore: aurora-notes 基线')
}

const providerPath = join(dataDir, 'provider.json')
if (!existsSync(providerPath)) seedProvider(dataDir)
else {
  // 清掉迁移标记，让应用重新尝试迁移（列表中已有连接时会直接跳过，不会重复创建）
  const parsed = JSON.parse(readFileSync(providerPath, 'utf8'))
  if (!parsed.connectionsMigrated) delete parsed.connectionsMigrated
}
const userData = prepareUserData(dataDir)

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE

async function inspect() {
  const app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userData}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-empty-title, .v16-project-visual', { timeout: 90_000 })
  let list = null
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.waitForTimeout(1000)
    list = await page.evaluate(() => window.projectos.aiConnections.list())
    if (list.connections.some((connection) => connection.hasSecret)) break
  }
  return { app, page, list }
}

const first = await inspect()
console.log('first launch:', JSON.stringify(first.list, null, 2))
await first.app.close()
await new Promise((r) => setTimeout(r, 1500))

const second = await inspect()
console.log('second launch:', JSON.stringify(second.list, null, 2))
await second.app.close()

const ok = second.list.connections.filter((connection) => connection.hasSecret).length === 1
if (!ok) {
  console.error('FAIL: 连接密钥未持久化，无法进行真实 AI 运行')
  process.exitCode = 1
} else {
  console.log('OK: 隔离环境已就绪 →', dataDir)
}
