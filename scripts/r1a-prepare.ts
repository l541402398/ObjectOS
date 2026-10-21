/**
 * R1-A prepare step: builds two independent projects/plans (same Agent) in an
 * isolated SQLite database so two OS processes can race for the Agent slot.
 *
 * Usage: tsx scripts/r1a-prepare.ts <dataDir> <dbPath> <contextPath>
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

async function createProject(services: CoreServices, dataDir: string, name: string) {
  const rootPath = join(dataDir, name)
  mkdirSync(rootPath, { recursive: true })
  writeFileSync(join(rootPath, 'package.json'), JSON.stringify({ name, private: true }, null, 2))
  const project = await services.projects.create({
    name,
    description: 'R1-A cross-process',
    rootPath,
    createDirectory: false,
    initGit: true,
  })
  execFileSync('git', ['add', '.'], { cwd: rootPath })
  execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', 'commit', '-qm', 'initial'], { cwd: rootPath })
  return project
}

async function main(): Promise<void> {
  const [dataDir, dbPath, contextPath] = process.argv.slice(2)
  if (!dataDir || !dbPath || !contextPath) throw new Error('missing arguments')
  const store = new SqliteStore({ filePath: dbPath })
  const services = new CoreServices(store, workspace)
  const orchestration = new OrchestrationService(store, services)
  const roles: Record<string, { planId: string; projectId: string }> = {}
  for (const [role, name] of [
    ['alpha', 'r1a-proc-alpha'],
    ['beta', 'r1a-proc-beta'],
  ] as const) {
    const project = await createProject(services, dataDir, name)
    const draft = orchestration.generatePlan(project.id, `R1-A cross process ${role}`)
    const updated = orchestration.updatePlan({
      planId: draft.id,
      tasks: [
        {
          key: 'impl',
          title: `跨进程任务 ${role}`,
          description: '两个进程同时竞争同一个 Agent',
          role: 'custom',
          agentId: 'agt_engineer',
          assignmentReasons: ['用户手动指定'],
          assignmentBlocked: false,
          dependsOn: [],
          acceptanceCriteria: ['完成'],
          expectedArtifacts: [],
          requiresApproval: false,
        },
      ] as never,
    })
    const approved = orchestration.approvePlan(updated.id)
    roles[role] = { planId: approved.plan.id, projectId: project.id }
  }
  writeFileSync(
    contextPath,
    JSON.stringify({ dataDir, dbPath, agentId: 'agt_engineer', roles }, null, 2),
  )
  store.close()
  console.log(
    `[r1a-prepare] db=${dbPath} plans=${Object.values(roles).map((role) => role.planId).join(',')}`,
  )
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
