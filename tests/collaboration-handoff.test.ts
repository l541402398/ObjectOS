import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { now } from '@projectos/contracts'
import { CoreServices, type WorkspacePort } from '@projectos/application'
import { SqliteStore } from '@projectos/persistence'
import { ensureProjectRoot, getGitStatus, initGitRepository, readTextFile, readWorkspaceTree, writeTextFile } from '@projectos/workspace'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'
import { collectUpstreamContext } from '../apps/runtime/src/upstream-context.js'

const workspace: WorkspacePort = {
  ensureProjectRoot,
  readWorkspaceTree,
  writeTextFile,
  readTextFile,
  getGitStatus,
  initGitRepository,
}

const cleanup: Array<() => void> = []
afterEach(() => {
  while (cleanup.length > 0) cleanup.pop()?.()
})

function setup() {
  const store = new SqliteStore({ filePath: ':memory:' })
  const dataDir = mkdtempSync(join(tmpdir(), 'projectos-handoff-'))
  const services = new CoreServices(store, workspace)
  cleanup.push(() => {
    store.close()
    rmSync(dataDir, { recursive: true, force: true })
  })
  return { store, services, dataDir }
}

async function createProject(services: CoreServices, dataDir: string, name: string) {
  return services.projects.create({
    name,
    description: '',
    rootPath: join(dataDir, name),
    createDirectory: true,
    initGit: false,
  })
}

function createTask(services: CoreServices, projectId: string, title: string, dependsOn: string[] = []) {
  return services.tasks.create({
    projectId,
    title,
    description: '',
    priority: 2,
    acceptanceCriteria: ['done'],
    labels: [],
    assigneeAgentId: 'agt_engineer',
    milestoneId: null,
    dependsOn,
    dueAt: null,
  })
}

describe('structured handoff and collaborator discovery', () => {
  it('persists structured fields, deduplicates and keeps the sender session', async () => {
    const { services, dataDir } = setup()
    const project = await createProject(services, dataDir, 'handoff-structured')
    const task = createTask(services, project.id, '实现权限模块')
    const session = services.sessions.create({ projectId: project.id, agentId: 'agt_engineer', title: 'Kai relay' })
    const input = {
      taskId: task.id,
      toAgentId: 'agt_qa',
      summary: '基础实现完成，请补边界测试',
      sessionId: session.id,
      completed: ['实现 RBAC'],
      remaining: ['补充边界测试'],
      risks: ['缓存一致性'],
      nextActions: ['执行测试'],
      riskLevel: 'low' as const,
    }
    const first = services.collaboration.requestHandoff(input)
    const second = services.collaboration.requestHandoff(input)
    expect(second.id).toBe(first.id)
    expect(first.completed).toEqual(['实现 RBAC'])
    expect(first.remaining).toEqual(['补充边界测试'])
    expect(first.risks).toEqual(['缓存一致性'])
    expect(first.nextActions).toEqual(['执行测试'])
    expect(first.sourceTaskId).toBe(task.id)
    expect(first.sourceAgentId).toBe('agt_engineer')
    expect(first.targetAgentId).toBe('agt_qa')
    expect(first.sourceRunId).toBeNull()
    expect(first.expiresAt).toBeGreaterThan(now())
    const handoffs = services.collaboration.listHandoffs(project.id)
    expect(handoffs).toHaveLength(1)
    expect(handoffs[0]?.id).toBe(first.id)
  })

  it('rejects an unavailable target and a target outside project visibility', async () => {
    const { store, services, dataDir } = setup()
    const project = await createProject(services, dataDir, 'handoff-visible-a')
    const otherProject = await createProject(services, dataDir, 'handoff-visible-b')
    const task = createTask(services, project.id, '跨项目守卫')
    const session = services.sessions.create({ projectId: project.id, agentId: 'agt_engineer', title: 'Kai guard' })
    const studio = new AgentStudioService(store)
    const hidden = studio.upsertAgent({
      name: 'Other Project Agent',
      role: '开发工程师',
      description: '',
      category: 'code',
      avatar: '',
      visibility: 'project',
      persona: { role: '开发工程师', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [],
      runtimeProfileIds: [],
      primaryRuntimeProfileId: null,
      modelRef: null,
      permissions: { tools: [], files: false, shell: false, network: false },
      ownerProjectId: otherProject.id,
    })
    expect(() =>
      services.collaboration.requestHandoff({
        taskId: task.id,
        toAgentId: hidden.id,
        summary: 'should be blocked',
        sessionId: session.id,
      }),
    ).toThrow(/可见范围/)
    expect(services.collaboration.listHandoffs(project.id)).toHaveLength(0)

    const runtime = studio.upsertRuntime({
      name: 'Unavailable Handoff Runtime',
      protocol: 'cli',
      executable: process.execPath,
      endpoint: null,
      args: [],
      authRef: null,
      modelRef: null,
      options: {},
      capabilities: {},
    })
    store.upsertRuntimeProfile({ ...runtime, status: 'unavailable' })
    const unavailable = studio.upsertAgent({
      name: 'Unavailable Handoff Agent',
      role: '测试工程师',
      description: '',
      category: 'quality',
      avatar: '',
      visibility: 'project',
      persona: { role: '测试工程师', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [],
      runtimeProfileIds: [runtime.id],
      primaryRuntimeProfileId: runtime.id,
      modelRef: null,
      permissions: { tools: [], files: false, shell: false, network: false },
      ownerProjectId: project.id,
    })
    expect(() =>
      services.collaboration.requestHandoff({
        taskId: task.id,
        toAgentId: unavailable.id,
        summary: 'runtime is unavailable',
        sessionId: session.id,
      }),
    ).toThrow(/Runtime|不可用/)
    expect(services.collaboration.listHandoffs(project.id)).toHaveLength(0)
  })

  it('expires and cancels requested handoffs', async () => {
    const { store, services, dataDir } = setup()
    const project = await createProject(services, dataDir, 'handoff-lifecycle')
    const task = createTask(services, project.id, '交接生命周期')
    const session = services.sessions.create({ projectId: project.id, agentId: 'agt_engineer', title: 'Kai lifecycle' })
    const handoff = services.collaboration.requestHandoff({
      taskId: task.id,
      toAgentId: 'agt_qa',
      summary: 'lifecycle',
      sessionId: session.id,
    })
    store.updateHandoffPayload(handoff.id, { expiresAt: now() - 1 })
    expect(() => services.collaboration.acceptHandoff(handoff.id)).toThrow(/过期/)
    expect(store.read.getHandoff(handoff.id)?.status).toBe('expired')

    const secondTask = createTask(services, project.id, '可取消交接')
    const second = services.collaboration.requestHandoff({
      taskId: secondTask.id,
      toAgentId: 'agt_qa',
      summary: 'cancel me',
      sessionId: session.id,
    })
    const cancelled = services.collaboration.cancelHandoff(second.id, 'user cancelled')
    expect(cancelled.status).toBe('cancelled')
    expect(() => services.collaboration.acceptHandoff(second.id)).toThrow(/不能/)

    const thirdTask = createTask(services, project.id, '任务取消后交接')
    const third = services.collaboration.requestHandoff({
      taskId: thirdTask.id,
      toAgentId: 'agt_qa',
      summary: 'task will be cancelled',
      sessionId: session.id,
    })
    services.tasks.move({ taskId: thirdTask.id, expectedVersion: thirdTask.version, to: 'cancelled' })
    expect(() => services.collaboration.acceptHandoff(third.id)).toThrow(/已完成或已取消/)
  })

  it('rechecks receiver availability when the handoff is accepted', async () => {
    const { store, services, dataDir } = setup()
    const project = await createProject(services, dataDir, 'handoff-accept-recheck')
    const task = createTask(services, project.id, '接收方失效')
    const session = services.sessions.create({ projectId: project.id, agentId: 'agt_engineer', title: 'Kai accept guard' })
    const studio = new AgentStudioService(store)
    const target = studio.upsertAgent({
      name: 'Accept Guard Target',
      role: '测试工程师',
      description: '',
      category: 'quality',
      avatar: '',
      visibility: 'project',
      persona: { role: '测试工程师', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: '' },
      skillIds: [],
      runtimeProfileIds: [],
      primaryRuntimeProfileId: null,
      modelRef: null,
      permissions: { tools: [], files: false, shell: false, network: false },
      ownerProjectId: project.id,
    })
    const handoff = services.collaboration.requestHandoff({
      taskId: task.id,
      toAgentId: target.id,
      summary: 'target will be archived',
      sessionId: session.id,
    })
    studio.setStatus(target.id, 'archived')
    expect(() => services.collaboration.acceptHandoff(handoff.id)).toThrow(/不可用|archived/)
    expect(store.read.getHandoff(handoff.id)?.status).toBe('requested')
  })

  it('lists only visible collaborators and does not expose secrets or chat content', async () => {
    const { store, services, dataDir } = setup()
    const projectA = await createProject(services, dataDir, 'collab-a')
    const projectB = await createProject(services, dataDir, 'collab-b')
    const studio = new AgentStudioService(store)
    const agentB = studio.upsertAgent({
      name: 'Project B Agent',
      role: '开发工程师',
      description: '',
      category: 'code',
      avatar: '',
      visibility: 'project',
      persona: { role: '开发工程师', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: 'SECRET-PROMPT' },
      skillIds: [],
      runtimeProfileIds: [],
      primaryRuntimeProfileId: null,
      modelRef: 'secret-model',
      permissions: { tools: [], files: false, shell: false, network: false },
      ownerProjectId: projectB.id,
    })
    const viewersA = services.collaboration.listCollaborators(projectA.id, 'agt_engineer')
    const viewersB = services.collaboration.listCollaborators(projectB.id, 'agt_engineer')
    expect(viewersA.some((agent) => agent.agentId === agentB.id)).toBe(false)
    expect(viewersB.some((agent) => agent.agentId === agentB.id)).toBe(true)
    const exposed = viewersB.find((agent) => agent.agentId === agentB.id)!
    expect(Object.keys(exposed)).not.toContain('systemPrompt')
    expect(Object.keys(exposed)).not.toContain('modelRef')
    expect(JSON.stringify(exposed)).not.toContain('SECRET-PROMPT')
    expect(JSON.stringify(exposed)).not.toContain('secret-model')
  })

  it('reports missing upstream artifacts and missing files without leaking them', async () => {
    const { store, services, dataDir } = setup()
    const project = await createProject(services, dataDir, 'upstream-missing')
    const dependency = createTask(services, project.id, '上游无产物')
    let version = dependency.version
    version = store.moveTask(dependency.id, version, 'ready').version
    version = store.moveTask(dependency.id, version, 'running').version
    version = store.moveTask(dependency.id, version, 'review').version
    store.moveTask(dependency.id, version, 'done')
    const downstream = createTask(services, project.id, '下游任务', [dependency.id])
    const task = store.read.getTask(downstream.id)!
    const empty = collectUpstreamContext(store, project, task)
    expect(empty.items).toHaveLength(1)
    expect(empty.items[0]?.skipped.join(' ')).toContain('没有可用')
    expect(empty.audit.artifacts).toHaveLength(0)

    const artifact = services.projects.createArtifact({
      projectId: project.id,
      taskId: dependency.id,
      runId: null,
      kind: 'design',
      title: '缺文件的设计',
      body: 'DESIGN-BODY',
      uri: 'missing/design.md',
    })
    const missing = collectUpstreamContext(store, project, task)
    const audited = missing.audit.artifacts.find((item) => item.id === artifact.id)
    expect(audited?.fileExists).toBe(false)
    expect(missing.audit.skipped.join(' ')).toContain('文件不存在')
    expect(missing.items[0]?.artifacts[0]?.body).toContain('DESIGN-BODY')
  })
})
