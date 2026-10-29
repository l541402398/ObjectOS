import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AppError,
  PlanDraftSchema,
  newId,
  now,
  type PlanDraft,
} from '@projectos/contracts'
import { generateLocalPlan } from '@projectos/planning'
import type { LlmProvider, ProviderStreamEvent } from '@projectos/provider-interfaces'
import { OrchestrationService } from '../apps/runtime/src/orchestration.js'
import { PlannerService } from '../apps/runtime/src/planner.js'
import { buildPlannerContext } from '../apps/runtime/src/planner-context.js'
import type { PlannerModelSource } from '../apps/runtime/src/planner-provider.js'
import { FakeProvider, createGitProject, logger, setup } from './helpers/r1-fixture.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function modelSource(provider: LlmProvider, overrides: Partial<ReturnType<PlannerModelSource['resolve']>> = {}): PlannerModelSource {
  return {
    resolve: () => ({
      provider,
      connectionId: 'aic_planner_test',
      connectionName: '测试 AI 连接',
      model: 'fake-planner-model',
      protocol: 'openai-chat',
      ...overrides,
    }),
  }
}

function makeHarness(
  fake: LlmProvider,
  options: { timeoutMs?: number; maxRepairAttempts?: number; modelSource?: PlannerModelSource } = {},
) {
  const harness = setup(fake)
  const planner = new PlannerService({
    store: harness.store,
    modelSource: options.modelSource ?? modelSource(fake),
    logger,
    timeoutMs: options.timeoutMs,
    maxRepairAttempts: options.maxRepairAttempts,
  })
  const orchestration = new OrchestrationService(harness.store, harness.services, planner)
  cleanups.push(harness.close)
  return { ...harness, planner, orchestration }
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
}

function disableAllAgents(harness: ReturnType<typeof setup>): void {
  // Builtin Agents have no editable AgentDefinition (getAgentDefinition filters
  // builtin rows), so simulate a deployment with no eligible candidate at the
  // storage level. This is a test-only fixture, not a production code path.
  const raw = harness.store as unknown as { run: (sql: string) => void }
  raw.run("UPDATE agents SET builtin = 0, status = 'disabled' WHERE builtin = 1")
}

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'task-a',
    title: '执行任务',
    description: '按需求完成一项可验证的工作。',
    role: 'developer',
    capabilities: ['implement'],
    dependsOn: [],
    acceptanceCriteria: ['命令退出码为 0'],
    expectedArtifacts: ['代码 diff'],
    rationale: '这是完成用户需求的必要步骤。',
    requiresApproval: true,
    ...overrides,
  }
}

function planText(tasks: unknown[], assumptions: string[] = [], risks: string[] = []): string {
  return JSON.stringify({ assumptions, risks, tasks })
}

const BUTTON_TASKS = [
  task({
    key: 'locate-button',
    title: '定位按钮样式与使用位置',
    description: '读取按钮组件与主题 token，确认影响范围。',
    role: 'developer',
    capabilities: ['analyze', 'implement'],
    acceptanceCriteria: ['列出按钮组件与样式 token 文件', '记录受影响页面'],
    expectedArtifacts: ['样式分析说明'],
    rationale: '先定位真实组件与 token，避免全局样式回归。',
  }),
  task({
    key: 'apply-style',
    title: '修改主按钮样式',
    description: '在按钮组件或主题层实现新样式，并保持可访问性。',
    capabilities: ['implement'],
    dependsOn: ['locate-button'],
    acceptanceCriteria: ['构建命令退出码为 0', '按钮对比度满足 WCAG AA'],
    expectedArtifacts: ['代码 diff'],
    rationale: '这是用户需求的核心改动，依赖定位结果。',
  }),
  task({
    key: 'verify-style',
    title: '验证按钮视觉与回归',
    description: '运行现有测试，并在 Electron 中检查按钮状态。',
    role: 'tester',
    capabilities: ['test'],
    dependsOn: ['apply-style'],
    acceptanceCriteria: ['测试命令退出码为 0', '记录浅色与深色截图'],
    expectedArtifacts: ['测试报告'],
    rationale: '验证核心改动没有破坏现有界面。',
  }),
]

describe('Phase 2B-1 AI Planner', () => {
  it('produces a small, dynamic button-style plan from provider output', async () => {
    const fake = new FakeProvider(() => ({ text: planText(BUTTON_TASKS) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-button')
    writeFiles(project.rootPath, {
      'src/components/PrimaryButton.tsx': [
        'export function PrimaryButton() {',
        '  // 主按钮样式：读取主题 token，保持对比度和焦点可见。',
        "  return <button className=\"primary-button\" style={{ padding: '8px 16px', borderRadius: 10 }}>确定</button>",
        '}',
      ].join('\n'),
      'src/styles/tokens.css': ':root { --button-radius: 10px; --button-accent: #2f6fe4; }',
      'README.md': '# Button demo\n主按钮与次级按钮的样式说明。',
    })
    await harness.orchestration.scan(project.id)

    const draft = await harness.orchestration.generateAIPlan({
      projectId: project.id,
      goal: '修改主按钮的样式',
      mode: 'ai',
      allowRuleFallback: false,
      maxTasks: 12,
      allowOverBudget: false,
    })

    expect(fake.calls).toHaveLength(1)
    expect(draft.status).toBe('draft')
    expect(draft.generatedBy).toBe('provider')
    expect(draft.execution).toBeNull()
    expect(draft.tasks).toHaveLength(4)
    expect(draft.tasks.some((task) => task.role === 'reviewer')).toBe(true)
    expect(draft.tasks.map((item) => item.key)).toEqual(['locate-button', 'apply-style', 'verify-style', 'review'])
    expect(draft.tasks[1]!.dependsOn).toEqual(['locate-button'])
    expect(draft.tasks[0]!.requiredCapabilities).toEqual(['analyze', 'implement'])
    expect(draft.tasks.every((item) => Boolean(item.agentId) && !item.assignmentBlocked)).toBe(true)
    expect(draft.generation?.mode).toBe('provider')
    expect(draft.generation?.model).toBe('fake-planner-model')
    expect(draft.generation?.connectionName).toBe('测试 AI 连接')
    expect(draft.generation?.attempts).toBe(1)
    expect(draft.generation?.contextSources.some((source) => source.kind === 'file')).toBe(true)
    expect(draft.generation?.contextSources.some((source) => source.title.includes('PrimaryButton'))).toBe(true)

    // Only a draft exists: no Task, Run, approval or execution was created.
    expect(harness.store.read.listTaskCards(project.id)).toHaveLength(0)
    expect(harness.store.read.countActiveRuns()).toBe(0)
    expect(harness.store.read.listPlanRevisions(project.id)).toHaveLength(1)
    const persisted = harness.store.read.listPlanRevisions(project.id)[0]!
    expect(persisted.generation?.promptVersion).toBe('planner-v1')
  })

  it('plans a larger permission DAG with parallel work instead of a fixed four-node template', async () => {
    const tasks = [
      task({
        key: 'scope-and-policy',
        title: '梳理角色模型与权限边界',
        description: '阅读现有认证、路由与数据访问代码，定义角色到权限的边界。',
        role: 'architect',
        capabilities: ['architect', 'analyze'],
        acceptanceCriteria: ['列出角色、权限与资源矩阵', '记录需要迁移的数据与接口'],
        expectedArtifacts: ['设计/实施方案'],
        rationale: '权限改动横跨数据、接口和 UI，必须先固定边界。',
      }),
      task({
        key: 'data-model',
        title: '实现角色与权限数据模型',
        description: '补充角色表和权限关联迁移，保持现有用户可用。',
        capabilities: ['implement'],
        dependsOn: ['scope-and-policy'],
        acceptanceCriteria: ['迁移可重复执行', '现有用户数据不丢失'],
        expectedArtifacts: ['代码 diff', '测试报告'],
        rationale: '数据结构是接口和前端的基础，与其他实现任务可并行。',
      }),
      task({
        key: 'api-guard',
        title: '实现接口权限校验',
        description: '在服务端路由加入角色校验，并返回明确错误。',
        capabilities: ['implement'],
        dependsOn: ['scope-and-policy'],
        acceptanceCriteria: ['越权请求返回 403', '有效请求保持成功'],
        expectedArtifacts: ['代码 diff', '测试报告'],
        rationale: '接口校验与数据模型可并行，依赖统一权限边界。',
      }),
      task({
        key: 'frontend-admin',
        title: '实现前端角色管理入口',
        description: '在设置页面加入角色分级管理与权限选择。',
        capabilities: ['implement'],
        dependsOn: ['api-guard'],
        acceptanceCriteria: ['角色列表可加载', '保存后权限生效'],
        expectedArtifacts: ['代码 diff'],
        rationale: '前端依赖接口契约，不能先于接口完成。',
      }),
      task({
        key: 'verify-rbac',
        title: '验证权限矩阵与回归',
        description: '执行授权测试，覆盖允许、拒绝和角色变更场景。',
        role: 'tester',
        capabilities: ['test'],
        dependsOn: ['data-model', 'frontend-admin'],
        acceptanceCriteria: ['越权与授权用例均通过', '记录真实命令与退出码'],
        expectedArtifacts: ['测试报告'],
        rationale: '数据与前端都完成后才能做端到端验证。',
      }),
    ]
    const fake = new FakeProvider(() => ({ text: planText(tasks) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-rbac')
    writeFiles(project.rootPath, {
      'src/auth/permissions.ts': 'export const ROLES = ["owner", "admin", "member"] as const\n',
      'src/auth/guard.ts': 'export function can(role: string, permission: string) { return role === "owner" || permission === "read" }\n',
      'docs/security.md': '# 角色与权限\n当前只有本地项目所有者，新增角色分级需要迁移与接口校验。',
    })
    await harness.orchestration.scan(project.id)

    const draft = await harness.orchestration.generateAIPlan({
      projectId: project.id,
      goal: '增加角色分级的用户权限管理，覆盖数据、接口、前端与测试',
      mode: 'ai',
      allowRuleFallback: false,
      maxTasks: 12,
      allowOverBudget: false,
    })

    expect(draft.tasks).toHaveLength(6)
    expect(draft.tasks.some((task) => task.role === 'reviewer')).toBe(true)
    expect(draft.tasks.map((item) => item.role)).toEqual(['architect', 'developer', 'developer', 'developer', 'tester', 'reviewer'])
    const parallel = draft.tasks.filter((item) => item.dependsOn.includes('scope-and-policy'))
    expect(parallel.map((item) => item.key)).toEqual(['data-model', 'api-guard'])
    expect(draft.tasks.find((item) => item.key === 'verify-rbac')?.dependsOn).toEqual(['data-model', 'frontend-admin'])
    expect(draft.assumptions).toEqual([])
    expect(draft.generation?.warnings.some((warning) => warning.includes('项目扫描'))).toBe(false)
  })

  it('puts measurement and profiling before optimization for a performance request', async () => {
    const tasks = [
      task({
        key: 'baseline',
        title: '建立性能基线并复现慢请求',
        description: '在隔离环境记录关键接口延迟、错误率和资源使用，复现用户反馈的慢场景。',
        role: 'developer',
        capabilities: ['analyze'],
        acceptanceCriteria: ['记录 p50/p95 延迟和样本量', '给出可复现命令'],
        expectedArtifacts: ['性能基线数据'],
        rationale: '没有真实测量就不能确认瓶颈和优化收益。',
      }),
      task({
        key: 'profile',
        title: '定位瓶颈与热点',
        description: '基于基线做 profiling，定位数据库、序列化或网络热点。',
        role: 'developer',
        capabilities: ['analyze'],
        dependsOn: ['baseline'],
        acceptanceCriteria: ['列出至少一个可验证瓶颈', '说明证据与排除项'],
        expectedArtifacts: ['性能分析报告'],
        rationale: '优化必须建立在可验证的定位结果上。',
      }),
      task({
        key: 'optimize',
        title: '实施针对性优化',
        description: '只修改已定位热点，并保留行为兼容性。',
        capabilities: ['implement'],
        dependsOn: ['profile'],
        acceptanceCriteria: ['p95 延迟较基线下降', '现有测试退出码为 0'],
        expectedArtifacts: ['代码 diff', '性能对比报告'],
        rationale: '优化依赖定位结果，避免盲目改动。',
      }),
      task({
        key: 'regression',
        title: '回归性能与正确性',
        description: '在同一环境重复基线测试并执行现有回归套件。',
        role: 'tester',
        capabilities: ['test'],
        dependsOn: ['optimize', 'baseline'],
        acceptanceCriteria: ['重复测量结果稳定', '无新增失败用例'],
        expectedArtifacts: ['测试报告'],
        rationale: '确认优化效果真实且没有引入回归。',
      }),
    ]
    const fake = new FakeProvider(() => ({ text: planText(tasks) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-performance')
    writeFiles(project.rootPath, {
      'src/server/metrics.ts': 'export function recordLatency(ms: number) { /* p95 指标采集 */ return ms }\n',
      'docs/performance.md': '# 性能\n排查慢请求时先测量 p50/p95，再做 profiling 和优化。',
    })
    await harness.orchestration.scan(project.id)

    const draft = await harness.orchestration.generateAIPlan({
      projectId: project.id,
      goal: '排查服务性能问题，以测量和定位为先，后续优化与回归',
      mode: 'ai',
      allowRuleFallback: false,
      maxTasks: 12,
      allowOverBudget: false,
    })

    expect(draft.tasks).toHaveLength(5)
    expect(draft.tasks.some((task) => task.role === 'reviewer')).toBe(true)
    expect(draft.tasks[0]!.key).toBe('baseline')
    expect(draft.tasks[1]!.dependsOn).toContain('baseline')
    expect(draft.tasks[2]!.dependsOn).toContain('profile')
    expect(draft.tasks[3]!.dependsOn).toEqual(expect.arrayContaining(['optimize', 'baseline']))
    expect(draft.tasks[0]!.role).not.toBe('architect')
  })

  it('repairs one invalid model answer within the bounded budget', async () => {
    const fake = new FakeProvider((call) => {
      if (call.index === 0) {
        return {
          text: planText([
            task({
              key: 'draft-only',
              title: '缺字段任务',
              description: '这个任务缺少验收标准。',
              acceptanceCriteria: [],
            }),
          ]),
        }
      }
      return { text: planText([task({ key: 'fixed-task', title: '修复后的任务' })]) }
    })
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-repair')
    await harness.orchestration.scan(project.id)

    const draft = await harness.orchestration.generateAIPlan({
      projectId: project.id,
      goal: '修复一个明确的小问题',
      mode: 'ai',
      allowRuleFallback: false,
      maxTasks: 12,
      allowOverBudget: false,
    })

    expect(fake.calls).toHaveLength(2)
    expect(draft.tasks[0]!.key).toBe('fixed-task')
    expect(draft.generation?.attempts).toBe(2)
    expect(draft.generation?.warnings.some((warning) => warning.includes('有界纠错'))).toBe(true)
    const repairMessage = fake.calls[1]!.messages.map((message) => message.content).join('\n')
    expect(repairMessage).toContain('未通过校验')
    expect(repairMessage).toContain('acceptanceCriteria')
  })

  it('fails clearly after bounded repair and never saves a half-valid DAG', async () => {
    const fake = new FakeProvider(() => ({
      text: planText([task({ key: 'still-bad', title: '仍然缺验收', acceptanceCriteria: [] })]),
    }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-invalid')
    await harness.orchestration.scan(project.id)

    const error = await harness.orchestration
      .generateAIPlan({
        projectId: project.id,
        goal: '生成一个非法计划',
        mode: 'ai',
        allowRuleFallback: false,
        maxTasks: 12,
        allowOverBudget: false,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('PROVIDER_ERROR')
    expect((error as AppError).message).toContain('未通过校验')
    expect((error as AppError).details).toMatchObject({ stage: 'plan-validation', attempts: 2 })
    expect(fake.calls).toHaveLength(2)
    expect(harness.store.read.listPlanRevisions(project.id)).toHaveLength(0)
  })

  it('rejects cyclic or self-referential model DAGs', async () => {
    const fake = new FakeProvider(() => ({
      text: planText([
        task({ key: 'task-a', title: '任务 A', dependsOn: ['task-b'] }),
        task({ key: 'task-b', title: '任务 B', dependsOn: ['task-a'] }),
      ]),
    }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-cycle')
    await harness.orchestration.scan(project.id)

    const error = await harness.orchestration
      .generateAIPlan({
        projectId: project.id,
        goal: '生成环形依赖',
        mode: 'ai',
        allowRuleFallback: false,
        maxTasks: 12,
        allowOverBudget: false,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).message).toMatch(/环形依赖|任务不能依赖自身/)
    expect(harness.store.read.listPlanRevisions(project.id)).toHaveLength(0)
  })

  it('times out a hung model call without saving a plan', async () => {
    const fake = new FakeProvider(() => ({ hang: true }))
    const harness = makeHarness(fake, { timeoutMs: 150 })
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-timeout')
    await harness.orchestration.scan(project.id)

    const error = await harness.orchestration
      .generateAIPlan({
        projectId: project.id,
        goal: '触发模型超时',
        mode: 'ai',
        allowRuleFallback: false,
        maxTasks: 12,
        allowOverBudget: false,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('TIMEOUT')
    expect(fake.calls).toHaveLength(1)
    expect(harness.store.read.listPlanRevisions(project.id)).toHaveLength(0)
  })

  it('refuses a paid planning call when the project soft budget is exhausted', async () => {
    const fake = new FakeProvider(() => ({ text: planText(BUTTON_TASKS) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-budget')
    await harness.orchestration.scan(project.id)
    const session = harness.services.sessions.create(
      { projectId: project.id, agentId: 'agt_engineer', title: 'budget-seed' },
      { kind: 'system', id: 'test', name: 'test' },
    )
    const run = harness.store.createRun({
      id: newId('run'),
      projectId: project.id,
      taskId: null,
      sessionId: session.id,
      agentId: 'agt_engineer',
      attempt: 1,
      status: 'completed',
      error: null,
      summary: 'seed cost',
      inputTokens: 100,
      outputTokens: 100,
      checkpointId: null,
      startedAt: now(),
      finishedAt: now(),
      createdAt: now(),
    })
    harness.store.recordAIUsage({
      id: newId('usg'),
      runId: run.id,
      connectionId: null,
      modelId: 'fake-planner-model',
      inputTokens: 100,
      outputTokens: 100,
      usageSource: 'provider',
      estimatedCost: 1,
      currency: 'USD',
      createdAt: now(),
    })
    harness.store.upsertProjectBudget({ projectId: project.id, softLimit: 0.5, currency: 'USD' })

    const error = await harness.orchestration
      .generateAIPlan({
        projectId: project.id,
        goal: '超预算规划',
        mode: 'ai',
        allowRuleFallback: false,
        maxTasks: 12,
        allowOverBudget: false,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('BUDGET_EXCEEDED')
    expect(fake.calls).toHaveLength(0)
    expect(harness.store.read.listPlanRevisions(project.id)).toHaveLength(0)
  })

  it('adds standard structured artifact labels and ignores model-supplied Agent IDs', async () => {
    const tasks = [
      task({
        key: 'design-scope',
        title: '梳理权限边界',
        description: '分析现有角色与权限边界，并给出实施方案。',
        role: 'architect',
        capabilities: ['architect'],
        acceptanceCriteria: ['输出权限清单'],
        expectedArtifacts: ['权限清单'],
      }),
      task({
        key: 'implement-data',
        title: '实现角色数据模型',
        description: '新增角色与权限关联，提供可执行迁移。',
        capabilities: ['implement'],
        dependsOn: ['design-scope'],
        acceptanceCriteria: ['迁移可重复执行'],
        expectedArtifacts: ['角色数据结构说明'],
        agentId: 'agt_invented_by_model',
      }),
      task({
        key: 'review-change',
        title: '独立审查权限改动',
        description: '检查越权风险、默认拒绝与迁移一致性。',
        role: 'reviewer',
        capabilities: ['review'],
        dependsOn: ['implement-data'],
        acceptanceCriteria: ['逐项列出风险与结论'],
        expectedArtifacts: ['结论说明'],
        runtime: 'runtime-invented-by-model',
      }),
      task({
        key: 'verify-change',
        title: '验证权限变更',
        description: '运行回归场景并记录证据。',
        role: 'tester',
        capabilities: ['test'],
        dependsOn: ['review-change'],
        acceptanceCriteria: ['记录退出码与输出'],
        expectedArtifacts: ['结果说明'],
      }),
    ]
    const fake = new FakeProvider(() => ({ text: planText(tasks) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-normalize')
    await harness.orchestration.scan(project.id)

    const draft = await harness.orchestration.generateAIPlan({
      projectId: project.id,
      goal: '增加角色分级权限并完成审查与验证',
      mode: 'ai',
      allowRuleFallback: false,
      maxTasks: 12,
      allowOverBudget: false,
    })

    const byKey = new Map(draft.tasks.map((item) => [item.key, item]))
    expect(byKey.get('design-scope')?.expectedArtifacts).toContain('设计/实施方案')
    expect(byKey.get('implement-data')?.expectedArtifacts).toContain('代码 diff')
    expect(byKey.get('review-change')?.expectedArtifacts).toContain('审查报告')
    expect(byKey.get('verify-change')?.expectedArtifacts).toContain('测试报告')
    expect(draft.tasks.every((item) => item.agentId !== 'agt_invented_by_model')).toBe(true)
    expect(draft.generation?.warnings.some((warning) => warning.includes('已补充标准交付物标签'))).toBe(true)
    expect(draft.generation?.warnings.some((warning) => warning.includes('已忽略模型'))).toBe(true)
    expect(draft.tasks.every((item) => item.assignmentBlocked === false)).toBe(true)
  })

  it('falls back to local rules only when explicitly allowed and marks the real source', async () => {
    const fake = new FakeProvider(() => {
      throw new Error('provider exploded sk-supersecretvalue123456')
    })
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-fallback')
    await harness.orchestration.scan(project.id)

    const draft = await harness.orchestration.generateAIPlan({
      projectId: project.id,
      goal: '显式回退到本地规则',
      mode: 'ai',
      allowRuleFallback: true,
      maxTasks: 12,
      allowOverBudget: false,
    })

    expect(draft.generatedBy).toBe('local-rules')
    expect(draft.generation?.mode).toBe('local-rules')
    expect(draft.generation?.fallbackReason).toContain('provider exploded')
    expect(draft.generation?.fallbackReason).not.toContain('sk-supersecretvalue123456')
    expect(draft.generation?.warnings.some((warning) => warning.includes('不冒充模型生成'))).toBe(true)
    expect(draft.tasks).toHaveLength(4)
    expect(fake.calls).toHaveLength(1)
    expect(harness.store.read.listTaskCards(project.id)).toHaveLength(0)
  })

  it('reports a missing provider instead of pretending a model generated the plan', async () => {
    const fake = new FakeProvider(() => ({ text: planText(BUTTON_TASKS) }))
    const source: PlannerModelSource = {
      resolve: () => {
        throw new AppError('PROVIDER_NOT_CONFIGURED', '尚未配置可用的 AI 连接')
      },
    }
    const harness = makeHarness(fake, { modelSource: source })
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-no-provider')
    await harness.orchestration.scan(project.id)

    const error = await harness.orchestration
      .generateAIPlan({
        projectId: project.id,
        goal: '没有 Provider 时生成计划',
        mode: 'ai',
        allowRuleFallback: false,
        maxTasks: 12,
        allowOverBudget: false,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe('PROVIDER_NOT_CONFIGURED')
    expect(fake.calls).toHaveLength(0)
    expect(harness.store.read.listPlanRevisions(project.id)).toHaveLength(0)
  })

  it('keeps a draft with blocked assignments when no Agent can be resolved, and blocks approval', async () => {
    const fake = new FakeProvider(() => ({ text: planText(BUTTON_TASKS) }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-no-agent')
    await harness.orchestration.scan(project.id)
    disableAllAgents(harness)

    const draft = await harness.orchestration.generateAIPlan({
      projectId: project.id,
      goal: '没有可用 Agent 的规划',
      mode: 'ai',
      allowRuleFallback: false,
      maxTasks: 12,
      allowOverBudget: false,
    })

    expect(draft.tasks.every((item) => item.assignmentBlocked)).toBe(true)
    expect(draft.tasks.every((item) => item.agentId === null)).toBe(true)
    expect(harness.store.read.listTaskCards(project.id)).toHaveLength(0)
    expect(() => harness.orchestration.approvePlan(draft.id)).toThrow(/暂无可用 Agent/)
  })

  it('builds bounded, secret-safe context from real files', async () => {
    const fake = new FakeProvider(() => ({ text: 'unused' }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-context')
    writeFiles(project.rootPath, {
      'src/auth/permissions.ts': 'export const PERMISSIONS = ["project:read", "project:write"] as const\n// 角色分级权限校验\n',
      'src/auth/guard.ts': 'export function requirePermission() { return "权限不足" }\n',
      'secrets/config.json': '{"token":"sk-supersecretvalue123456","note":"do not send"}',
      '.env': 'API_KEY=sk-supersecretvalue123456\n',
      'README.md': '# Permissions\n角色分级权限说明。',
    })
    await harness.orchestration.scan(project.id)

    const context = buildPlannerContext({
      store: harness.store,
      projectId: project.id,
      goal: '增加角色分级的用户权限管理',
      budgetChars: 8_000,
    })

    expect(context.chars).toBeGreaterThan(0)
    expect(context.chars).toBeLessThanOrEqual(8_000)
    expect(context.text).toContain('permissions.ts')
    expect(context.text).toContain('权限')
    expect(context.text).not.toContain('sk-supersecretvalue123456')
    expect(context.text).not.toContain(project.rootPath)
    expect(context.sources.some((source) => source.id.includes('.env'))).toBe(false)
    expect(context.warnings.some((warning) => warning.includes('敏感/受保护路径'))).toBe(true)
  })

  it('still reads plans written before generation/capability fields existed', async () => {
    const fake = new FakeProvider(() => ({ text: 'unused' }))
    const harness = makeHarness(fake)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-legacy')
    const base = generateLocalPlan({ projectId: project.id, goal: '旧计划兼容', revision: 1 })
    const legacyTasks = base.tasks.map((item) => {
      const { requiredCapabilities: _capabilities, rationale: _rationale, ...rest } = item
      return rest
    })
    const { generation: _generation, ...legacyPlan } = base
    harness.store.createPlanRevision({ ...legacyPlan, tasks: legacyTasks } as PlanDraft)

    const loaded = harness.store.read.getPlanRevision(base.id)
    expect(loaded).not.toBeNull()
    expect(loaded?.generation).toBeUndefined()
    expect(loaded?.tasks[0]?.requiredCapabilities).toBeUndefined()
    expect(loaded?.tasks[0]?.rationale).toBeUndefined()
    expect(PlanDraftSchema.safeParse(loaded).success).toBe(true)
  })

  it('does not let a provider smuggle tool calls into planning', async () => {
    const toolProvider: LlmProvider = {
      id: 'tool-provider',
      model: 'tool-model',
      async *stream(): AsyncIterable<ProviderStreamEvent> {
        yield { type: 'tool.call', call: { id: 'call-1', name: 'write_file', arguments: '{}' } }
        yield { type: 'done', finishReason: 'tool_calls' }
      },
      async test() {
        return { ok: true, latencyMs: 0, message: 'ok' }
      },
    }
    const harness = makeHarness(toolProvider)
    const project = await createGitProject(harness.services, harness.dataDir, 'planner-tool')
    await harness.orchestration.scan(project.id)

    const error = await harness.orchestration
      .generateAIPlan({
        projectId: project.id,
        goal: '尝试让 Planner 执行工具',
        mode: 'ai',
        allowRuleFallback: false,
        maxTasks: 12,
        allowOverBudget: false,
      })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).message).toContain('不会执行工具')
    expect(harness.store.read.listPlanRevisions(project.id)).toHaveLength(0)
  })
})
