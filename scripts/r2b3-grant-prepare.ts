import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PlanGrantService } from '../apps/runtime/src/plan-grant.js'
import { createGitProject, logger, planWithTasks, setup } from '../tests/helpers/r1-fixture.js'

async function main(): Promise<void> {
  const [dataDir, dbPath, contextPath] = process.argv.slice(2)
  if (!dataDir || !dbPath || !contextPath) throw new Error('usage: prepare <dataDir> <dbPath> <contextPath>')
  mkdirSync(dataDir, { recursive: true })
  const harness = setup(undefined, { dataDir, filePath: dbPath })
  try {
    const project = await createGitProject(harness.services, dataDir, 'r2b3-xproc-grant')
    const approved = planWithTasks(harness.orchestration, project.id, [{
      key: 'write-shared',
      title: '写入共享文件',
      description: '使用 write_file 写入 src/shared.txt。',
      role: 'developer',
      capabilities: ['implement'],
      dependsOn: [],
      acceptanceCriteria: ['文件内容为 xproc'],
      expectedArtifacts: ['代码 diff'],
      rationale: '跨进程授权竞争测试。',
      requiresApproval: true,
    }])
    const plan = harness.store.read.getPlanRevision(approved.plan.id)!
    const grants = new PlanGrantService(harness.store, logger)
    const grant = grants.issue({
      planId: plan.id,
      actions: ['plan.start', 'workspace-write'],
      allowedPaths: ['src'],
      maxRuns: 1,
      maxToolCalls: 1,
      ttlHours: 2,
      allowOverBudget: false,
      note: 'cross-process start and tool quota',
      confirm: true,
    })
    const card = harness.store.read.getTaskCard(approved.taskIds[0]!)!
    writeFileSync(contextPath, JSON.stringify({
      dbPath,
      projectId: project.id,
      planId: plan.id,
      taskId: card.id,
      agentId: card.assigneeAgentId,
      workspaceRoot: project.rootPath,
      grantStartId: grant.id,
      grantToolId: grant.id,
      goPath: join(dataDir, 'go.flag'),
    }, null, 2))
    console.log(JSON.stringify({ projectId: project.id, planId: plan.id, grantId: grant.id }))
  } finally {
    harness.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
