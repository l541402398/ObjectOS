/**
 * R2.1 UI regression fixture: one project with a needs_reconciliation Run, an
 * approved plan with task nodes, sessions and an accepted Handoff.
 * Usage: tsx scripts/r21-prepare-ui.ts <dataDir>
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { newId, now } from '@projectos/contracts'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import {
  ensureProjectRoot,
  getGitStatus,
  initGitRepository,
  readTextFile,
  readWorkspaceTree,
  writeTextFile,
} from '@projectos/workspace'
import { OrchestrationService } from '../apps/runtime/src/orchestration.js'

const workspace: WorkspacePort = {
  ensureProjectRoot,
  readWorkspaceTree,
  writeTextFile,
  readTextFile,
  getGitStatus,
  initGitRepository,
}
const USER = { kind: 'user' as const, id: 'local-user', name: '你' }

async function main(): Promise<void> {
  const dataDir = process.argv[2]
  if (!dataDir) throw new Error('missing dataDir')
  const store = new SqliteStore({ filePath: join(dataDir, 'projectos.db') })
  const services = new CoreServices(store, workspace)
  const project = await services.projects.create({
    name: 'R2.1 UI 验收项目',
    description: 'UI regression fixture',
    rootPath: join(dataDir, 'workspace'),
    createDirectory: true,
    initGit: false,
  })
  const session = services.sessions.create(
    { projectId: project.id, agentId: 'agt_engineer', title: 'R2.1 运行审计会话' },
    { kind: 'system', id: 'seed', name: 'seed' },
  )
  const task = services.tasks.create(
    {
      projectId: project.id,
      title: 'R2.1 待核对任务',
      description: '用于运行审计与人工核对 UI',
      priority: 2,
      acceptanceCriteria: ['完成'],
      labels: [],
      assigneeAgentId: 'agt_engineer',
      milestoneId: null,
      dependsOn: [],
      dueAt: null,
    },
    USER,
  )
  for (const to of ['ready', 'running', 'review'] as const) {
    const current = store.read.getTask(task.id)!
    services.tasks.move({ taskId: task.id, expectedVersion: current.version, to, note: 'seed' }, USER)
  }
  const runId = newId('run')
  store.createRun({
    id: runId,
    projectId: project.id,
    taskId: task.id,
    sessionId: session.id,
    agentId: 'agt_engineer',
    attempt: 1,
    status: 'needs_reconciliation',
    error: 'R2.1 UI fixture: Runtime exited with unknown side effects',
    summary: null,
    inputTokens: 0,
    outputTokens: 0,
    checkpointId: null,
    startedAt: now(),
    finishedAt: now(),
    createdAt: now(),
  })

  const highTask = services.tasks.create(
    {
      projectId: project.id,
      title: 'R2.1 高风险验收任务',
      description: '用于验证风险分级人工验收 UI',
      priority: 2,
      acceptanceCriteria: ['完成'],
      labels: ['developer'],
      assigneeAgentId: 'agt_engineer',
      milestoneId: null,
      dependsOn: [],
      dueAt: null,
    },
    USER,
  )
  for (const to of ['ready', 'running', 'review'] as const) {
    const current = store.read.getTask(highTask.id)!
    services.tasks.move({ taskId: highTask.id, expectedVersion: current.version, to, note: 'seed' }, USER)
  }
  const highRunId = newId('run')
  store.createRun({
    id: highRunId,
    projectId: project.id,
    taskId: highTask.id,
    sessionId: session.id,
    agentId: 'agt_engineer',
    attempt: 1,
    status: 'completed',
    error: null,
    summary: 'seeded high-risk run',
    inputTokens: 0,
    outputTokens: 0,
    checkpointId: null,
    startedAt: now(),
    finishedAt: now(),
    createdAt: now(),
  })
  const highTool = store.createToolCall({
    runId: highRunId,
    toolName: 'write_file',
    idempotencyKey: `${highRunId}:1`,
    status: 'running',
    argsHash: 'seed',
    args: { path: 'src/ui-acceptance.ts', content: 'export const ok = true' },
  })
  store.updateToolCall(highTool.id, { status: 'completed', result: { bytes: 25 }, finishedAt: now() })
  store.replaceRunFileChanges(highRunId, [
    { path: 'src/ui-acceptance.ts', changeType: 'added', baselineHash: null, afterHash: 'seed' },
  ])

  const orchestration = new OrchestrationService(store, services)
  const draft = orchestration.generatePlan(project.id, 'R2.1 UI 编排计划')
  const updated = orchestration.updatePlan({
    planId: draft.id,
    tasks: [
      {
        key: 'design',
        title: '链路设计',
        description: '设计 UI 验收链路',
        role: 'architect',
        agentId: 'agt_architect',
        assignmentReasons: ['用户手动指定'],
        assignmentBlocked: false,
        dependsOn: [],
        acceptanceCriteria: ['完成'],
        expectedArtifacts: [],
        requiresApproval: false,
      },
      {
        key: 'impl',
        title: '实现与验收',
        description: '实现并留下证据',
        role: 'developer',
        agentId: 'agt_engineer',
        assignmentReasons: ['用户手动指定'],
        assignmentBlocked: false,
        dependsOn: ['design'],
        acceptanceCriteria: ['完成'],
        expectedArtifacts: [],
        requiresApproval: false,
      },
    ] as never,
  })
  orchestration.approvePlan(updated.id)

  const recipientSession = services.sessions.create(
    { projectId: project.id, agentId: 'agt_qa', title: 'R2.1 交接接收方' },
    { kind: 'system', id: 'seed', name: 'seed' },
  )
  await services.collaboration.send({
    projectId: project.id,
    fromSessionId: session.id,
    toSessionId: recipientSession.id,
    type: 'agent.message',
    body: 'R2.1 UI 交接消息',
    taskId: task.id,
    wake: false,
  })

  writeFileSync(
    join(dataDir, 'context.json'),
    JSON.stringify({
      projectId: project.id,
      taskId: task.id,
      runId,
      highRiskTaskId: highTask.id,
      highRiskRunId: highRunId,
      sessionId: session.id,
      recipientSessionId: recipientSession.id,
      planId: updated.id,
    }, null, 2),
  )
  store.close()
  console.log(`[r21-ui] fixture ready project=${project.id} run=${runId} plan=${updated.id}`)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
