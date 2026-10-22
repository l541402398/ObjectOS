/**
 * Phase 2B-1 real-provider planner validation.
 *
 * Uses the developer's already-authorized default AI connection without ever
 * printing, copying to SQLite/project files, or writing the plaintext key.
 * The encrypted provider config is copied into a throw-away data dir; Electron
 * safeStorage decrypts it in-process and migrates it to the existing AI
 * connection mechanism. Every project/database/log path is isolated.
 *
 * Skips with an explicit blocker message when no authorized provider config
 * exists. Mock output is never substituted for this script.
 */
import { _electron as electron } from 'playwright-core'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'r2b1')
mkdirSync(shots, { recursive: true })

const sourceDataDir = process.env.PROJECTOS_REAL_DATA_DIR ?? join(process.env.APPDATA ?? '', 'ProjectOS', 'data')
const sourceProvider = join(sourceDataDir, 'provider.json')
if (!existsSync(sourceProvider)) {
  console.log(`SKIPPED (blocked): no authorized provider config at ${sourceProvider}`)
  console.log('No mock is substituted. Configure an AI connection in ProjectOS or set PROJECTOS_REAL_DATA_DIR.')
  process.exit(0)
}
const providerConfig = JSON.parse(readFileSync(sourceProvider, 'utf8'))
if (!providerConfig.encryptedApiKey) {
  console.log('SKIPPED (blocked): provider config has no encrypted API key')
  process.exit(0)
}

const dataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b1-real-data-'))
const userDataDir = mkdtempSync(join(tmpdir(), 'projectos-r2b1-real-user-'))
// Force the existing legacy -> AI connection migration in the isolated copy.
writeFileSync(join(dataDir, 'provider.json'), JSON.stringify({ ...providerConfig, connectionsMigrated: false }, null, 2))
// Electron safeStorage (DPAPI-backed) keeps its OS-crypt key in Chromium's
// `Local State`. Copying only that file lets the isolated user-data dir decrypt
// the already-authorized key without touching the real app profile.
const localState = join(process.env.APPDATA ?? '', 'ProjectOS', 'Local State')
if (existsSync(localState)) {
  copyFileSync(localState, join(userDataDir, 'Local State'))
}

const env = {
  ...process.env,
  PROJECTOS_DATA_DIR: dataDir,
  PROJECTOS_WINDOW_WIDTH: '1440',
  PROJECTOS_WINDOW_HEIGHT: '900',
}
delete env.ELECTRON_RUN_AS_NODE

const results = []
const summaries = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) throw new Error(`${name}: ${detail ?? 'assertion failed'}`)
}

function writeProject(dir, kind) {
  mkdirSync(join(dir, 'src', 'components'), { recursive: true })
  mkdirSync(join(dir, 'src', 'styles'), { recursive: true })
  mkdirSync(join(dir, 'src', 'auth'), { recursive: true })
  mkdirSync(join(dir, 'src', 'server'), { recursive: true })
  mkdirSync(join(dir, 'docs'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: `r2b1-real-${kind}`,
    private: true,
    scripts: { test: 'node -e "process.exit(0)"', build: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' },
    dependencies: { react: '^19', express: '^5' },
    devDependencies: { typescript: '^5', vitest: '^3' },
  }, null, 2))
  writeFileSync(join(dir, 'src', 'components', 'PrimaryButton.tsx'), [
    'export function PrimaryButton() {',
    '  // 主按钮样式：从主题 token 读取圆角、颜色和焦点环。',
    '  return <button className="primary-button" style={{ padding: "8px 16px" }}>确定</button>',
    '}',
  ].join('\n'))
  writeFileSync(join(dir, 'src', 'styles', 'tokens.css'), ':root { --button-radius: 10px; --button-accent: #2f6fe4; }\n')
  writeFileSync(join(dir, 'src', 'auth', 'permissions.ts'), [
    'export type Role = "owner" | "member"',
    'export const ROLE_PERMISSIONS = { owner: ["project:read", "project:write"], member: ["project:read"] } as const',
    'export function can(role: Role, permission: string) { return (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission) }',
  ].join('\n'))
  writeFileSync(join(dir, 'src', 'auth', 'guard.ts'), [
    'import { can } from "./permissions"',
    'export function requirePermission(role: "owner" | "member", permission: string) {',
    '  if (!can(role, permission)) throw new Error("权限不足")',
    '}',
  ].join('\n'))
  writeFileSync(join(dir, 'src', 'server', 'metrics.ts'), [
    'export type Metric = { route: string; p50: number; p95: number; samples: number }',
    'export function recordLatency(route: string, ms: number): Metric {',
    '  return { route, p50: ms, p95: ms, samples: 1 }',
    '}',
  ].join('\n'))
  writeFileSync(join(dir, 'src', 'server', 'api.ts'), [
    'import { recordLatency } from "./metrics"',
    'export async function listProjects(rows: Array<{ id: string }>) {',
    '  const started = Date.now()',
    '  const result = rows.map((row) => JSON.parse(JSON.stringify(row)))',
    '  recordLatency("/projects", Date.now() - started)',
    '  return result',
    '}',
  ].join('\n'))
  writeFileSync(join(dir, 'docs', 'security.md'), '# 权限模型\n当前角色：owner、member。权限校验在接口与前端共享。\n')
  writeFileSync(join(dir, 'docs', 'performance.md'), '# 性能\n先记录 p50/p95 与样本量，再做 profiling。慢请求可能来自序列化与重复查询。\n')
  writeFileSync(join(dir, 'README.md'), '# ProjectOS real planner fixture\n用于隔离验证 AI Planner 的真实项目上下文。\n')
}

function isAncestor(tasks, fromKey, targetKey) {
  const byKey = new Map(tasks.map((task) => [task.key, task]))
  const seen = new Set()
  const visit = (key) => {
    if (seen.has(key)) return false
    seen.add(key)
    const task = byKey.get(key)
    if (!task) return false
    if (task.dependsOn.includes(targetKey)) return true
    return task.dependsOn.some(visit)
  }
  return visit(fromKey)
}

let app = null
try {
  app = await electron.launch({
    executablePath: resolve(root, 'node_modules/electron/dist/electron.exe'),
    args: ['.', `--user-data-dir=${userDataDir}`],
    cwd: resolve(root, 'apps/desktop'),
    env,
    timeout: 60_000,
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.show()
    win.focus()
    win.moveTop()
  })
  await page.waitForTimeout(3600)

  let connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  for (let attempt = 0; attempt < 20 && connections.connections.length === 0; attempt += 1) {
    await page.waitForTimeout(500)
    connections = await page.evaluate(async () => window.projectos.aiConnections.list())
  }
  if (!connections.connections.length) {
    throw new Error('authorized provider config did not migrate into an AI connection; provider cannot be used')
  }
  const connection = connections.connections.find((item) => item.id === connections.defaultId) ?? connections.connections[0]
  check('real provider: default AI connection migrated with secret', Boolean(connection?.hasSecret), `${connection?.name ?? 'none'} / ${connection?.protocol ?? 'none'} / ${connection?.defaultModelId ?? 'none'}`)
  check('real provider: connection is a native model connection', connection.backendKind === 'native-llm' && connection.protocol !== 'external-cli', `${connection.backendKind}/${connection.protocol}`)

  const projects = [
    {
      key: 'button',
      name: 'R2B1 Real Button',
      goal: '修改主按钮的样式，只做必要的小改动',
      assert: (plan) => {
        check('real button plan: small dynamic draft', plan.tasks.length >= 1 && plan.tasks.length <= 5, `tasks=${plan.tasks.length}`)
        check('real button plan: real provider source', plan.generatedBy === 'provider' && plan.generation?.model, `${plan.generation?.connectionName} / ${plan.generation?.model}`)
      },
    },
    {
      key: 'rbac',
      name: 'R2B1 Real RBAC',
      goal: '增加角色分级的用户权限管理，覆盖数据、接口、前端与测试',
      assert: (plan) => {
        check('real RBAC plan: at least three tasks', plan.tasks.length >= 3, `tasks=${plan.tasks.length}`)
        const edges = plan.tasks.reduce((sum, task) => sum + task.dependsOn.length, 0)
        check('real RBAC plan: real dependencies exist', edges >= 2, `edges=${edges}`)
        const roles = [...new Set(plan.tasks.map((task) => task.role))]
        check('real RBAC plan: role diversity', roles.length >= 2, roles.join(','))
      },
    },
    {
      key: 'performance',
      name: 'R2B1 Real Perf',
      goal: '排查服务性能问题，以测量和定位为先，后续优化与回归',
      assert: (plan) => {
        const measure = plan.tasks.find((task) => task.dependsOn.length === 0 && /测量|基线|定位|复现|指标|profile|profil/i.test(`${task.title} ${task.description}`))
        check('real performance plan: measurement/baseline task exists first', Boolean(measure), measure ? `${measure.key} ${measure.title}` : 'none')
        const optimize = plan.tasks.find((task) => /优化|修复|改进|optimize|improve/i.test(`${task.title} ${task.description}`))
        check('real performance plan: optimization follows measurement', Boolean(measure && optimize && (optimize.dependsOn.includes(measure.key) || isAncestor(plan.tasks, optimize.key, measure.key))), optimize ? `${optimize.key} ${optimize.title}` : 'none')
      },
    },
  ]

  for (const entry of projects) {
    const workspaceDir = join(dataDir, `project-${entry.key}`)
    mkdirSync(workspaceDir, { recursive: true })
    writeProject(workspaceDir, entry.key)
    const project = await page.evaluate(async ({ workspaceDir, name, goal }) => {
      const created = await window.projectos.projects.create({
        name,
        description: `Phase 2B-1 real-provider fixture: ${goal}`,
        rootPath: workspaceDir,
        createDirectory: false,
        initGit: false,
      })
      await window.projectos.projectAnalysis.scan(created.project.id)
      return created.project
    }, { workspaceDir, name: entry.name, goal: entry.goal })
    const plan = await page.evaluate(async ({ projectId, goal }) => window.projectos.plans.generate(projectId, goal, {
      mode: 'ai',
      allowRuleFallback: false,
      maxTasks: 12,
    }), { projectId: project.id, goal: entry.goal })

    const board = await page.evaluate(async (projectId) => window.projectos.tasks.board(projectId), project.id)
    check(`real ${entry.key}: no task/run before approval`, board.tasks.length === 0, `tasks=${board.tasks.length}`)
    check(`real ${entry.key}: provider draft source is honest`, plan.generatedBy === 'provider' && plan.generation?.mode === 'provider', `${plan.generatedBy}/${plan.generation?.mode}`)
    check(`real ${entry.key}: task has explainable rationale and non-empty acceptance`, plan.tasks.every((task) => Boolean(task.rationale) && task.acceptanceCriteria.length > 0 && task.expectedArtifacts.length > 0), `tasks=${plan.tasks.length}`)
    entry.assert(plan)
    summaries.push({
      kind: entry.key,
      goal: entry.goal,
      revision: plan.revision,
      generatedBy: plan.generatedBy,
      generation: {
        connectionName: plan.generation?.connectionName ?? null,
        model: plan.generation?.model ?? null,
        protocol: plan.generation?.protocol ?? null,
        attempts: plan.generation?.attempts ?? null,
        durationMs: plan.generation?.durationMs ?? null,
        contextChars: plan.generation?.contextChars ?? null,
        inputTokens: plan.generation?.inputTokens ?? null,
        outputTokens: plan.generation?.outputTokens ?? null,
        warnings: plan.generation?.warnings ?? [],
        contextSources: (plan.generation?.contextSources ?? []).map((source) => ({ kind: source.kind, title: source.title, chars: source.chars, truncated: source.truncated })),
      },
      assumptions: plan.assumptions,
      risks: plan.risks,
      tasks: plan.tasks.map((task) => ({
        key: task.key,
        title: task.title,
        role: task.role,
        agentId: task.agentId,
        requiredCapabilities: task.requiredCapabilities ?? [],
        dependsOn: task.dependsOn,
        acceptanceCriteria: task.acceptanceCriteria,
        expectedArtifacts: task.expectedArtifacts,
        rationale: task.rationale,
      })),
    })

    // Real UI screenshot with the actual source strip (real connection/model).
    await page.evaluate((projectId) => { location.hash = `#/projects/${projectId}/orchestration` }, project.id)
    await page.waitForSelector('.po-orchestration-page', { timeout: 20_000 })
    await page.waitForTimeout(800)
    await page.locator('.po-orch-actions').getByRole('button', { name: '生成计划' }).click()
    await page.waitForSelector('[data-testid="plan-source"]', { timeout: 15_000 })
    await page.waitForTimeout(500)
    const shotPath = join(shots, `real-${entry.key}.png`)
    await page.screenshot({ path: shotPath })
    console.log(`SHOT ${shotPath}`)
    await page.locator('.po-plan-modal .ant-modal-close').click()
    await page.waitForTimeout(300)
  }

  const serialized = JSON.stringify(summaries)
  check('real provider: no API key or sk- material in the captured plan summary', !/sk-[A-Za-z0-9_-]{12,}/.test(serialized), 'safe')
  check('no renderer page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  writeFileSync(join(shots, 'real-plans.json'), JSON.stringify({
    capturedAt: new Date().toISOString(),
    connection: { name: connection.name, protocol: connection.protocol, modelId: connection.defaultModelId },
    plans: summaries,
    checks: results,
  }, null, 2))
  console.log(`\nR2B1 REAL PROVIDER PASS — ${results.length} checks, ${summaries.length} plans, evidence in ${shots}`)
} catch (error) {
  console.error('R2B1 REAL PROVIDER FAIL —', error)
  if (app) {
    try {
      const page = await app.firstWindow()
      await page.screenshot({ path: join(shots, 'real-ui-failure.png') })
    } catch {
      // best effort
    }
  }
  process.exitCode = 1
} finally {
  if (app) await app.close().catch(() => undefined)
}
