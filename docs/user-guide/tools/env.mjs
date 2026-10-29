/**
 * 手册环境的统一准备逻辑（供探针、扫描、截图脚本复用）。
 *
 * 关键点：
 * 1. 业务数据放在临时目录，绝不触碰 %APPDATA%\\ProjectOS\\data 里的真实项目。
 * 2. 打包版/开发版同时存在时，Electron 的单实例锁会让新进程静默退出，
 *    所以必须传入独立的 --user-data-dir。
 * 3. safeStorage 的解密密钥保存在 userData/Local State 中；换 userData 后
 *    原密钥不可解密，因此只复制 Local State / Preferences（不含缓存与数据库）。
 * 4. 复制 provider.json 后删除 connectionsMigrated，让应用把旧配置迁移成
 *    一条真实连接（这与首次配置后的状态一致，且密钥始终留在本机密钥库）。
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function prepareUserData(dataDir) {
  const userData = join(dataDir, 'userdata')
  mkdirSync(userData, { recursive: true })
  const real = join(process.env.APPDATA ?? '', 'ProjectOS')
  for (const file of ['Local State', 'Preferences']) {
    const source = join(real, file)
    if (existsSync(source)) copyFileSync(source, join(userData, file))
  }
  return userData
}

export function seedProvider(dataDir, { migrate = true } = {}) {
  const real = join(process.env.APPDATA ?? '', 'ProjectOS', 'data')
  for (const file of ['provider.json', 'ai-secrets.vault.json']) {
    const source = join(real, file)
    if (existsSync(source)) copyFileSync(source, join(dataDir, file))
  }
  const providerPath = join(dataDir, 'provider.json')
  if (migrate && existsSync(providerPath)) {
    const parsed = JSON.parse(readFileSync(providerPath, 'utf8'))
    delete parsed.connectionsMigrated
    writeFileSync(providerPath, JSON.stringify(parsed, null, 2), 'utf8')
  }
}

export function prepareWorkspace(fixtureDir, workspaceDir) {
  cpSync(fixtureDir, workspaceDir, { recursive: true })
  return workspaceDir
}
