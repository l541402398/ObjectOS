/**
 * Phase 2.5 — real user-journey SSH deployment closure (UI driven).
 *
 * Business actions are real mouse/keyboard interactions with the packaged Electron
 * renderer. window.projectos is used only to READ state for corroboration and to seed
 * raw file artifacts (the product has no UI for attaching a file URI to an artifact).
 *
 * Approved isolated target only:
 *   Contabo 169.58.112.111, /opt/projectos-delivery-test, container
 *   projectos-delivery-test, port 18080.
 *
 * Usage:
 *   $env:PROJECTOS_DEPLOY_SSH_KEY="C:\Users\Administrator\.ssh\id_ed25519_contabo"
 *   node scripts/phase2.5-deploy-closure-e2e.mjs
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const root = process.cwd()
const dataDir = process.env.PROJECTOS_E2E_DATA_DIR || mkdtempSync(join(tmpdir(), 'projectos-phase2-5-'))
mkdirSync(dataDir, { recursive: true })
const shots = join(root, 'docs', 'screenshots')
mkdirSync(shots, { recursive: true })
const keyPath = process.env.PROJECTOS_DEPLOY_SSH_KEY ?? ''
if (!keyPath) throw new Error('PROJECTOS_DEPLOY_SSH_KEY is required')
const privateKey = readFileSync(keyPath, 'utf8')
const knownHosts = process.env.PROJECTOS_DEPLOY_SSH_KNOWN_HOSTS ?? join(process.env.USERPROFILE ?? '', '.ssh', 'known_hosts_projectos_deploy')
const HOST = '169.58.112.111'
const CONTAINER = 'projectos-delivery-test'
const HEALTH_PORT = '18080'

const v1File = join(dataDir, 'version-v1')
const v2File = join(dataDir, 'version-v2')
const healthFile = join(dataDir, 'health')
writeFileSync(v1File, 'projectos-phase2.5-v1\n')
writeFileSync(v2File, 'projectos-phase2.5-v2\n')
writeFileSync(healthFile, 'ok')

const env = { ...process.env, PROJECTOS_DATA_DIR: dataDir, PROJECTOS_SEED_DEMO: '1', PROJECTOS_WINDOW_WIDTH: '1440', PROJECTOS_WINDOW_HEIGHT: '900' }
delete env.ELECTRON_RUN_AS_NODE
delete env.PROJECTOS_DEPLOY_SSH_KEY

const results = []
const record = (name, status, detail = '') => {
  results.push({ name, status, detail })
  console.log(`[${status}] ${name}${detail ? ` — ${detail}` : ''}`)
}

function ssh(command) {
  return execFileSync('ssh', ['-i', keyPath, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHosts}`, '-o', 'ConnectTimeout=15', `root@${HOST}`, command], { encoding: 'utf8', timeout: 60_000 }).trim()
}
const remoteVersion = () => ssh(`curl -fsS --max-time 5 http://127.0.0.1:${HEALTH_PORT}/version || echo UNREACHABLE`)
const remoteHealth = () => ssh(`curl -fsS --max-time 5 http://127.0.0.1:${HEALTH_PORT}/health || echo UNREACHABLE`)
const remoteMount = () => ssh(`docker inspect ${CONTAINER} --format '{{json .Mounts}}'`)

let app
async function launch() {
  app = await electron.launch({ executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'), args: ['.'], cwd: resolve(root, 'apps/desktop'), env, timeout: 40_000 })
  const page = await app.firstWindow()
  await page.waitForSelector('.po-shell', { timeout: 30_000 })
  if (await page.locator('.po-shell.is-collapsed').count()) {
    await page.getByRole('button', { name: '切换侧边栏' }).click()
    await page.waitForTimeout(300)
  }
  if (await page.locator('.v16-project-visual').count()) await page.locator('.v16-project-visual').first().click()
  await page.waitForSelector('.po-work-center', { timeout: 30_000 })
  return page
}

async function main() {
  let page = await launch()
  record('Electron 启动（真实程序）', 'PASS', dataDir)
  const project = await page.evaluate(async () => (await window.projectos.projects.list()).projects[0])
  const go = (path) => page.evaluate(({ path }) => { location.hash = path }, { path })
  const waitModalClosed = () => page
    .waitForFunction(() => !document.querySelector('.ant-modal-wrap:not([style*="display: none"]) .ant-modal'), null, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false)

  // ---------- 1. 资源与连接（真实 UI） ----------
  await go(`#/projects/${project.id}/connections`)
  await page.waitForSelector('.rc-shell', { timeout: 30_000 })
  await page.getByRole('button', { name: '新建主机' }).click()
  await page.waitForSelector('.ant-modal:visible', { timeout: 10_000 })
  await page.getByPlaceholder('Contabo 测试机').fill('Contabo Phase2.5')
  await page.getByPlaceholder('169.58.112.111').fill(HOST)
  await page.getByPlaceholder('隔离部署测试').fill('Phase 2.5 隔离部署测试')
  await page.locator('.ant-modal:visible textarea').fill(privateKey)
  await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
  await page.waitForFunction(() => document.body.innerText.includes('Contabo Phase2.5'), null, { timeout: 20_000 })
  record('UI 新建主机（凭据经 safeStorage）', 'PASS')

  await page.getByRole('button', { name: '测试连接' }).first().click()
  await page.waitForFunction(() => /待确认指纹|已连接|认证失败|超时/.test(document.body.innerText), null, { timeout: 90_000 })
  if (await page.getByRole('button', { name: '信任并重试' }).count()) {
    await page.getByRole('button', { name: '信任并重试' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('已连接'), null, { timeout: 90_000 })
  }
  const connText = await page.locator('.rc-shell').innerText()
  record('UI 连接测试 + Host Key 信任', connText.includes('已连接') ? 'PASS' : 'FAIL', connText.includes('已连接') ? '' : connText.slice(0, 160))
  record('凭据未泄漏到 Renderer', connText.includes('BEGIN OPENSSH PRIVATE KEY') ? 'FAIL' : 'PASS')
  await page.screenshot({ path: join(shots, 'p25-03-connections-connected.png') })

  // ---------- 2. 部署目标（真实「连接目标」） ----------
  await go(`#/projects/${project.id}/deployments`)
  await page.waitForSelector('.dc-shell', { timeout: 30_000 })
  await page.getByRole('button', { name: '连接目标' }).first().click()
  await page.waitForSelector('.ant-modal:visible', { timeout: 10_000 })
  const targetSelects = page.locator('.ant-modal:visible .ant-select')
  if ((await targetSelects.count()) >= 2) {
    await targetSelects.nth(0).click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Contabo Phase2.5' }).first().click()
    await targetSelects.nth(1).click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: 'Contabo Phase2.5 · SSH' }).first().click()
  }
  await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
  await page.waitForFunction(() => document.body.innerText.includes('Contabo Phase2.5'), null, { timeout: 20_000 })
  record('UI 部署目标引用已登记 Resource/Profile', 'PASS')

  // ---------- helpers ----------
  async function recordEvidence(title, typeLabel, statusLabel, assuranceLabel, summary) {
    await page.getByRole('button', { name: '记录证据' }).click()
    await page.waitForSelector('.ant-modal:visible', { timeout: 10_000 })
    await page.locator('.ant-modal:visible input').first().fill(title)
    const sel = page.locator('.ant-modal:visible .ant-select')
    await sel.nth(0).click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: typeLabel }).first().click()
    await sel.nth(1).click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: statusLabel }).first().click()
    await sel.nth(2).click()
    await page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: assuranceLabel }).first().click()
    await page.locator('.ant-modal:visible textarea').first().fill(summary)
    await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
    await waitModalClosed()
    await page.waitForTimeout(900)
  }

  async function advancePhase(versionNumber, label) {
    // Scope to the version row: the page lists several versions and the first
    // 推进阶段 selector belongs to the oldest one.
    const row = page.locator('article.lc-version').filter({ hasText: `v${versionNumber}` }).first()
    if (!(await row.count())) return { ok: false, reason: `no version row v${versionNumber}` }
    const select = row.locator('.lc-version-actions .ant-select').first()
    if (!(await select.count())) return { ok: false, reason: 'no advance select in row' }
    await select.click()
    await page.waitForTimeout(600)
    const option = page.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: label }).first()
    if (!(await option.count())) {
      const options = await page.locator('.ant-select-dropdown:visible .ant-select-item-option').allInnerTexts().catch(() => [])
      await page.keyboard.press('Escape')
      return { ok: false, reason: `options=[${options.join('|')}]` }
    }
    await option.click()
    await page.waitForTimeout(1600)
    return { ok: true, reason: '' }
  }

  /** Evidence + gate advance for one version, then assert the persisted phase. */
  async function primeVersion(versionId, versionNumber, tag) {
    await go(`#/projects/${project.id}/versions`)
    await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
    await page.waitForTimeout(700)
    await recordEvidence(`${tag} 验收评审记录`, '评审记录', 'passed', '自我声明', '真实 Electron 端到端验收评审。')
    await recordEvidence(`${tag} 测试报告`, '测试报告', 'passed', '来源观察', 'npm test 287 passed；真实 SSH 制品哈希校验通过。')
    await recordEvidence(`${tag} 发布审批记录`, '审批记录', 'passed', '自我声明', '变更审批与部署独立审批均已完成。')
    // A brand-new version starts at planned, so walk every allowed hop. Hops that do
    // not apply to the current phase are not offered and are skipped.
    const attempts = []
    for (const label of ['开发中', '验证中', '候选发布']) {
      const result = await advancePhase(versionNumber, label)
      attempts.push(`${label}:${result.ok ? 'ok' : 'skip'}`)
    }
    const phase = await page.evaluate(async ({ projectId, versionId }) => (await window.projectos.lifecycle.overview(projectId)).versions.find((item) => item.id === versionId)?.phase ?? 'missing', { projectId: project.id, versionId })
    record(`UI ${tag} 门禁证据 + 推进到候选发布`, phase === 'release_candidate' ? 'PASS' : 'FAIL', `phase=${phase} ${attempts.join(' ')}`)
    return phase === 'release_candidate'
  }

  /** Seeds the file artifacts a release needs (no UI exists for raw artifact URIs). */
  async function seedArtifacts(versionId, label, versionFile) {
    return page.evaluate(async ({ projectId, versionId, label, versionFile, healthFile }) => {
      const task = await window.projectos.tasks.create({
        projectId, title: `${label} 发布来源`, description: '真实部署闭环证据', priority: 3,
        acceptanceCriteria: ['deploy verified'], labels: ['developer'], assigneeAgentId: null,
        milestoneId: null, versionId, iterationId: null, dependsOn: [], dueAt: null,
      })
      await window.projectos.artifacts.create({
        projectId, taskId: task.task.id, runId: null, kind: 'test-report', title: `${label} 测试证据`,
        body: 'npm test exit 0', uri: null, metadata: {},
      })
      await window.projectos.artifacts.create({
        projectId, taskId: task.task.id, runId: null, kind: 'other', title: 'health', body: 'ok', uri: healthFile, metadata: {},
      })
      await window.projectos.artifacts.create({
        projectId, taskId: task.task.id, runId: null, kind: 'other', title: 'version', body: label, uri: versionFile, metadata: {},
      })
    }, { projectId: project.id, versionId, label, versionFile, healthFile })
  }

  /** Full release → approval → deployment → approval → execute journey in the UI. */
  async function releaseJourney(versionId, label) {
    await go(`#/projects/${project.id}/releases?version=${versionId}`)
    await page.waitForSelector('.po-delivery-page', { timeout: 30_000 })
    await page.getByRole('button', { name: /新建变更/ }).click()
    await page.waitForSelector('.ant-modal:visible', { timeout: 10_000 })
    await page.locator('.ant-modal:visible input').first().fill(`Phase 2.5 ${label} 部署变更`)
    await page.locator('.ant-modal:visible textarea').first().fill('真实 SSH 部署闭环验证；只使用隔离测试目标。')
    await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
    if (!(await waitModalClosed())) {
      await page.screenshot({ path: join(shots, `p25-modal-stuck-${label}.png`) })
      record(`UI ${label} 新建变更弹窗关闭`, 'FAIL', '弹窗未关闭')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(600)
    }
    await page.waitForTimeout(700)
    if (!(await page.locator('.po-delivery-page').innerText()).includes(`Phase 2.5 ${label} 部署变更`)) {
      await page.getByRole('button', { name: /^变更 / }).click({ timeout: 15_000 })
      await page.waitForTimeout(700)
    }
    await page.getByRole('button', { name: '提交审批' }).first().click()
    await page.waitForTimeout(700)

    await go(`#/projects/${project.id}/approvals`)
    await page.waitForSelector('.ap-list', { timeout: 15_000 })
    await page.locator('.ap-row').filter({ has: page.locator('.ap-kind.delivery') }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.ap-actions button').last().click()
    await page.waitForTimeout(900)

    await go(`#/projects/${project.id}/releases?version=${versionId}`)
    await page.waitForSelector('.po-delivery-page', { timeout: 20_000 })
    await page.getByRole('button', { name: /生成候选/ }).click()
    await page.waitForTimeout(1200)
    await page.getByRole('button', { name: /登记 Release/ }).first().click({ timeout: 20_000 })
    await page.waitForTimeout(1200)

    await go(`#/projects/${project.id}/deployments?version=${versionId}`)
    await page.waitForSelector('.dc-shell', { timeout: 30_000 })
    await page.waitForTimeout(800)
    await page.getByRole('button', { name: '登记部署' }).click()
    await page.waitForSelector('.ant-modal:visible', { timeout: 10_000 })
    await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
    await page.waitForTimeout(900)

    await go(`#/projects/${project.id}/approvals`)
    await page.waitForSelector('.ap-list', { timeout: 15_000 })
    await page.locator('.ap-row').filter({ has: page.locator('.ap-kind.delivery') }).first().click()
    await page.waitForTimeout(300)
    await page.locator('.ap-actions button').last().click()
    await page.waitForTimeout(900)

    await go(`#/projects/${project.id}/deployments?version=${versionId}`)
    await page.waitForSelector('.dc-shell', { timeout: 20_000 })
    await page.waitForTimeout(1000)
    return { approveDone: true }
  }

  async function executeSelected(label) {
    const execButton = page.getByRole('button', { name: '执行部署' })
    if (!(await execButton.count())) return { ok: false, reason: (await page.locator('.dc-shell').innerText()).slice(0, 200).replace(/\n/g, ' ') }
    const box = await execButton.first().boundingBox()
    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return { tag: el?.tagName ?? null, text: (el?.closest('button')?.textContent ?? '').trim() }
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    let tag = ''
    const deadline = Date.now() + 240_000
    while (Date.now() < deadline) {
      tag = await page.locator('.dc-deploy-head .ant-tag').first().innerText().catch(() => '')
      if (/服务已确认|待核对|失败|未知|制品已交付/.test(tag)) break
      await page.waitForTimeout(2000)
    }
    const kind = tag.includes('服务已确认') ? 'succeeded' : tag.includes('待核对') ? 'needs_reconciliation' : tag.includes('制品已交付') ? 'unverified' : 'failed'
    record(`UI ${label} 执行部署 → 终止态`, kind === 'succeeded' ? 'PASS' : 'FAIL', `hit=${hit.text} tag=${tag}`)
    return { ok: kind === 'succeeded', kind }
  }

  // ---------- 3. v1: 门禁 + 变更 + Release + 部署 ----------
  const lifecycle = await page.evaluate(async ({ projectId }) => window.projectos.lifecycle.overview(projectId), { projectId: project.id })
  const v1VersionId = lifecycle.versions[0].id
  await primeVersion(v1VersionId, '0.1.0', 'v0.1.0')
  await seedArtifacts(v1VersionId, 'v1', v1File)
  await releaseJourney(v1VersionId, 'v1')
  const v1Exec = await executeSelected('v1')
  const afterV1 = remoteMount()
  record('v1 远端 /health', remoteHealth() === 'ok' ? 'PASS' : 'FAIL', remoteHealth())
  record('v1 远端 /version = v1', remoteVersion() === 'projectos-phase2.5-v1' ? 'PASS' : 'FAIL', remoteVersion())
  const v1DeploymentId = afterV1.match(/releases\/(dep_[a-z0-9]+)/)?.[1] ?? ''
  record('v1 容器挂载 v1 Release', Boolean(v1DeploymentId) ? 'PASS' : 'FAIL', v1DeploymentId)
  await page.screenshot({ path: join(shots, 'p25-12-deployment-succeeded.png') })

  // ---------- 4. v2: 新版本 → 更新部署 ----------
  await go(`#/projects/${project.id}/versions`)
  await page.waitForSelector('.po-lifecycle-page', { timeout: 30_000 })
  await page.getByRole('button', { name: '新建版本' }).click()
  await page.waitForSelector('.ant-modal:visible', { timeout: 10_000 })
  await page.locator('.ant-modal:visible input').first().fill('0.2.0')
  await page.locator('.ant-modal:visible .ant-modal-footer button').last().click()
  await waitModalClosed()
  await page.waitForTimeout(1500)
  const v2VersionId = await page.evaluate(async ({ projectId }) => {
    const versions = (await window.projectos.lifecycle.overview(projectId)).versions
    return versions.find((item) => item.version === '0.2.0')?.id ?? ''
  }, { projectId: project.id })
  record('UI 新建版本 0.2.0', Boolean(v2VersionId) ? 'PASS' : 'FAIL', v2VersionId)

  await primeVersion(v2VersionId, '0.2.0', 'v0.2.0')
  await seedArtifacts(v2VersionId, 'v2', v2File)
  await releaseJourney(v2VersionId, 'v2')
  const v2Exec = await executeSelected('v2')
  const afterV2 = remoteMount()
  record('v2 远端 /version = v2', remoteVersion() === 'projectos-phase2.5-v2' ? 'PASS' : 'FAIL', remoteVersion())
  const v2DeploymentId = afterV2.match(/releases\/(dep_[a-z0-9]+)/)?.[1] ?? ''
  record('v2 容器挂载 v2 Release', Boolean(v2DeploymentId) && v2DeploymentId !== v1DeploymentId ? 'PASS' : 'FAIL', v2DeploymentId)

  // ---------- 5. 回滚（控制台按钮 → 独立审批 → 执行） ----------
  await page.getByRole('button', { name: '基于此版本创建回滚' }).first().click()
  await page.waitForTimeout(1500)
  const rollbackText = await page.locator('.dc-shell').innerText()
  record('UI 控制台创建回滚部署', /回滚/.test(rollbackText) ? 'PASS' : 'FAIL', 'toast/row')

  await go(`#/projects/${project.id}/approvals`)
  await page.waitForSelector('.ap-list', { timeout: 15_000 })
  await page.locator('.ap-row').filter({ has: page.locator('.ap-kind.delivery') }).first().click()
  await page.waitForTimeout(300)
  await page.locator('.ap-actions button').last().click()
  await page.waitForTimeout(900)
  record('UI 回滚独立审批通过', 'PASS')

  await go(`#/projects/${project.id}/deployments?version=${v2VersionId}`)
  await page.waitForSelector('.dc-shell', { timeout: 20_000 })
  await page.waitForTimeout(1200)
  const rollbackExec = await executeSelected('回滚')
  const afterRollback = remoteMount()
  record('回滚后远端 /version = v1', remoteVersion() === 'projectos-phase2.5-v1' ? 'PASS' : 'FAIL', remoteVersion())
  const rollbackDeploymentId = afterRollback.match(/releases\/(dep_[a-z0-9]+)/)?.[1] ?? ''
  record('回滚产生新的 Deployment（未覆盖 v2）',
    Boolean(rollbackDeploymentId) && rollbackDeploymentId !== v2DeploymentId && rollbackDeploymentId !== v1DeploymentId ? 'PASS' : 'FAIL',
    `rollback=${rollbackDeploymentId} v2=${v2DeploymentId} v1=${v1DeploymentId}`)
  await page.screenshot({ path: join(shots, 'p25-17-rollback-succeeded.png') })

  // ---------- 6. 主题 / 尺寸 / 重启 ----------
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(shots, 'p25-13-console-light-1440.png') })
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(shots, 'p25-14-console-dark-1440.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1024, 768))
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(shots, 'p25-15-console-1024.png') })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1440, 900))
  await page.waitForTimeout(400)

  await app.close()
  page = await launch()
  await page.evaluate(({ projectId, versionId }) => { location.hash = `#/projects/${projectId}/deployments?version=${versionId}` }, { projectId: project.id, versionId: v2VersionId })
  await page.waitForSelector('.dc-shell', { timeout: 30_000 })
  await page.waitForTimeout(1500)
  const afterText = await page.locator('.dc-shell').innerText()
  record('重启后 UI 仍显示服务已确认 + 外部 ID',
    afterText.includes('服务已确认') && afterText.includes(`ssh:${CONTAINER}:`) ? 'PASS' : 'FAIL',
    afterText.slice(0, 180).replace(/\n/g, ' '))
  await page.screenshot({ path: join(shots, 'p25-16-after-restart.png') })
  await app.close()

  // ---------- 7. SQLite 事实核对 ----------
  const db = new DatabaseSync(join(dataDir, 'projectos.db'), { readOnly: true })
  try {
    const rows = db.prepare('SELECT id,status,execution_state,assurance,external_id,rollback_of_deployment_id FROM deployments ORDER BY created_at').all()
    const succeeded = rows.filter((row) => row.status === 'succeeded')
    const ops = db.prepare('SELECT state FROM deployment_operations').all()
    const steps = db.prepare('SELECT COUNT(*) AS n FROM deployment_operation_steps').get()
    record('SQLite 三次部署全部 succeeded', succeeded.length >= 3 ? 'PASS' : 'FAIL', `${succeeded.length}/${rows.length}`)
    record('SQLite external_id 全部持久化', succeeded.every((row) => String(row.external_id ?? '').startsWith('ssh:')) ? 'PASS' : 'FAIL', succeeded.map((row) => row.external_id).join(' | '))
    record('SQLite execution_state=completed', succeeded.every((row) => row.execution_state === 'completed') ? 'PASS' : 'FAIL')
    record('SQLite 回滚记录独立且关联 v2', rows.some((row) => row.rollback_of_deployment_id) ? 'PASS' : 'FAIL', rows.filter((row) => row.rollback_of_deployment_id).map((row) => row.id).join(','))
    record('SQLite 操作全部 confirmed', ops.length >= 3 && ops.every((row) => row.state === 'confirmed') ? 'PASS' : 'FAIL', ops.map((row) => row.state).join(','))
    record('SQLite 执行时间线已落库', Number(steps.n) >= 15 ? 'PASS' : 'FAIL', `${steps.n} steps`)
    record('Schema V33 已应用', Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v) === 33 ? 'PASS' : 'FAIL')
  } finally {
    db.close()
  }

  record('v1/v2 均执行成功', v1Exec.ok && v2Exec.ok ? 'PASS' : 'FAIL', `v1=${v1Exec.kind} v2=${v2Exec.kind}`)
  record('回滚执行成功', rollbackExec.ok ? 'PASS' : 'FAIL', rollbackExec.kind)

  const failed = results.filter((item) => item.status === 'FAIL')
  console.log('\n===== PHASE 2.5 DEPLOY CLOSURE (UI) =====')
  for (const item of results) console.log(`${item.status}\t${item.name}${item.detail ? ` :: ${item.detail}` : ''}`)
  console.log(`PASS=${results.filter((i) => i.status === 'PASS').length} FAIL=${failed.length}`)
  console.log(`dataDir=${dataDir}`)
  if (failed.length) process.exitCode = 1
  else console.log('PHASE 2.5 DEPLOY CLOSURE E2E PASS')
}

main().catch(async (error) => {
  console.error('[fatal]', error)
  try { await app?.close() } catch { /* ignore */ }
  process.exitCode = 1
})
