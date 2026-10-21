import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentView, PlanDraft, TaskCard } from '@projectos/contracts'
import { agentForPlannedTask, criticalPathTasks, generateLocalPlan, topologicalPlanTasks, validatePlanDraft } from '@projectos/planning'
import { scanProject } from '@projectos/project-analyzer'
import { buildGraphSnapshot } from '@projectos/graph-projection'
import { QualityGateService } from '../apps/runtime/src/quality-gate.js'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-v13-'))
  dirs.push(dir)
  return dir
}

describe('project analyzer', () => {
  it('detects a TypeScript/Electron workspace', async () => {
    const dir = root()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'demo',
        dependencies: { react: '^19', antd: '^6' },
        devDependencies: { vite: '^8', electron: '^44' },
      }),
    )
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '')
    writeFileSync(join(dir, 'tsconfig.json'), '{}')
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages: []')
    mkdirSync(join(dir, 'src'), { recursive: true })
    mkdirSync(join(dir, 'packages', 'core'), { recursive: true })
    const snapshot = await scanProject({ projectId: 'prj_test', rootPath: dir, gitHead: 'abc' })
    expect(snapshot.languages).toContain('TypeScript')
    expect(snapshot.packageManager).toBe('pnpm')
    expect(snapshot.frameworks.map((item) => item.name)).toEqual(
      expect.arrayContaining(['React', 'Vite', 'Electron', 'Monorepo']),
    )
    expect(snapshot.modules.some((item) => item.path === 'packages/core')).toBe(true)
  })

  it('detects Maven and Spring structure', async () => {
    const dir = root()
    writeFileSync(join(dir, 'pom.xml'), '<project/>')
    writeFileSync(join(dir, 'build.gradle'), '')
    mkdirSync(join(dir, 'src', 'main', 'java', 'demo'), { recursive: true })
    mkdirSync(join(dir, 'src', 'main', 'resources'), { recursive: true })
    writeFileSync(join(dir, 'src', 'main', 'resources', 'application.yml'), 'server: {}')
    const snapshot = await scanProject({ projectId: 'prj_test', rootPath: dir, gitHead: null })
    expect(snapshot.languages).toEqual(expect.arrayContaining(['Java']))
    expect(snapshot.frameworks.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Java / Maven', 'Spring', 'Gradle']),
    )
  })
})

describe('planning', () => {
  it('generates a validated chain and blocks cycles', () => {
    const plan: PlanDraft = generateLocalPlan({ projectId: 'prj_test', goal: '增加 RBAC', revision: 1 })
    expect(plan.tasks.map((task) => task.key)).toEqual([
      'architecture',
      'implementation',
      'review',
      'verification',
    ])
    expect(criticalPathTasks(plan).map((task) => task.key)).toEqual(['architecture', 'implementation', 'review', 'verification'])
    expect(topologicalPlanTasks(plan).map((task) => task.key)).toEqual([
      'architecture',
      'implementation',
      'review',
      'verification',
    ])
    expect(agentForPlannedTask(plan.tasks[0]!)).toBe('agt_architect')
    expect(agentForPlannedTask({ ...plan.tasks[0]!, agentId: 'agt_custom' })).toBe('agt_custom')
    const cyclic: PlanDraft = {
      ...plan,
      tasks: plan.tasks.map((task) =>
        task.key === 'architecture' ? { ...task, dependsOn: ['verification'] } : task,
      ),
    }
    expect(() => validatePlanDraft(cyclic)).toThrow(/环形/)
  })
})

describe('quality gate', () => {
  it('runs project test scripts and reports failures', async () => {
    const dir = root()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'gate', scripts: { test: 'node -e "process.exit(0)"' } }),
    )
    const gate = new QualityGateService()
    const passed = await gate.run(dir)
    expect(passed.passed).toBe(true)
    expect(passed.checks.find((check) => check.status !== 'skipped')?.name).toBe('test')
    expect(passed.checks.find((check) => check.name === 'lint')?.status).toBe('skipped')
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'gate', scripts: { test: 'node -e "process.exit(7)"' } }),
    )
    const failed = await gate.run(dir)
    expect(failed.passed).toBe(false)
    expect(failed.checks.find((check) => check.name === 'test')?.exitCode).not.toBe(0)
  }, 20_000)

  it('kills a hanging check tree on timeout and reports error, not failed', async () => {
    const dir = root()
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'gate', scripts: { test: 'node -e "require(\'child_process\').spawn(process.execPath, [\'-e\', \'setInterval(() => {}, 1000)\'], { stdio: \'inherit\' }); setInterval(() => {}, 1000)"' } }),
    )
    const startedAt = Date.now()
    const report = await new QualityGateService().run(dir, { timeoutMs: 1_500 })
    const test = report.checks.find((check) => check.name === 'test')
    expect(test?.status).toBe('error')
    expect(test?.output).toContain('timeout')
    expect(report.passed).toBe(false)
    expect(Date.now() - startedAt).toBeLessThan(10_000)
  }, 20_000)
})

describe('graph projection', () => {  it('projects real tasks, agents and dependencies with layout positions', () => {
    const agent: AgentView = {
      agent: {
        id: 'agt_engineer',
        name: 'Kai',
        role: '开发工程师',
        description: '',
        kind: 'builtin',
        driverId: 'native',
        capabilities: ['implement'],
        accent: '#22B8A0',
        systemPrompt: '',
        builtin: true,
        createdAt: 1,
      },
      status: 'working',
      sessionCount: 1,
      activeRunId: null,
      activeSessionId: null,
      completedRuns: 0,
    }
    const task = (id: string, status: TaskCard['status'], dependencyIds: string[]): TaskCard => ({
      id,
      projectId: 'prj_test',
      parentId: null,
      milestoneId: null,
      title: id,
      description: '',
      status,
      priority: 2,
      assigneeAgentId: 'agt_engineer',
      assigneeName: 'Kai',
      acceptanceCriteria: ['works'],
      labels: [],
      version: 0,
      dueAt: null,
      dependencyIds,
      blockedBy: [],
      runCount: 0,
      artifactCount: 0,
      latestRunStatus: null,
      createdAt: 1,
      updatedAt: 1,
    })
    const snapshot = buildGraphSnapshot({
      projectId: 'prj_test',
      projectName: 'Demo',
      lastEventSeq: 4,
      agents: [agent],
      tasks: [task('task_a', 'done', []), task('task_b', 'ready', ['task_a'])],
      latestRuns: {},
      layout: null,
    })
    expect(snapshot.nodes.find((node) => node.id === 'agent:agt_engineer')?.status).toBe('running')
    expect(snapshot.nodes.find((node) => node.id === 'task:task_b')?.status).toBe('queued')
    expect(snapshot.edges.some((edge) => edge.id === 'dependency:task_a:task_b')).toBe(true)
    expect(snapshot.positions['task:task_a']).toBeDefined()
    expect(snapshot.lastEventSeq).toBe(4)
  })
})

