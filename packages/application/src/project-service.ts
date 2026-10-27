import {
  AppError,
  STAGE_KEYS,
  STAGE_LABELS,
  type CreateDecisionInput,
  type CreateMilestoneInput,
  type CreateProjectInput,
  type CreateRequirementInput,
  type Decision,
  type Milestone,
  type Project,
  type ProjectOverview,
  type ProjectStage,
  type ProjectSummary,
  type Requirement,
  type StageKey,
  type UpdateProjectInput,
  type Artifact,
  newId,
  now,
} from '@projectos/contracts'
import {
  PROJECT_EVENT_TYPES,
  assertStageAdvanceAllowed,
  nextStageKey,
  stageIndex,
} from '@projectos/domain'
import type { ActionActor, CoreStore, WorkspacePort } from './ports.js'
import { USER_ACTOR } from './ports.js'

const STARTER_README = (name: string, description: string): string => `# ${name}

${description || '由 ProjectOS 创建的本地项目。'}

## 开始

\`\`\`bash
# 在这里记录项目的启动方式
\`\`\`

## 项目规则

- 变更前先阅读仓库内的 \`AGENTS.md\`。
- 任务、决策与交付物都通过 ProjectOS 持久化，不以聊天记录作为唯一事实来源。
`

const STARTER_AGENTS = `# ProjectOS 项目规则

- 只处理当前任务及必要依赖，不擅自扩大范围。
- 先阅读相关代码，再修改；写入与命令需要人工授权。
- 不虚构 API、测试结果或文件内容。
- 关键架构取舍记录为 Decision（ADR），交付物记录为 Artifact。
- 完成前运行真实验证；未运行的检查必须明确说明。
`

export class ProjectService {
  constructor(
    private readonly store: CoreStore,
    private readonly workspace: WorkspacePort,
  ) {}

  list(includeArchived = false): ProjectSummary[] {
    return this.store.read.listProjectSummaries(includeArchived)
  }

  listAgents(projectId: string) {
    this.getProjectOrThrow(projectId)
    return this.store.read.getAgentViews(projectId)
  }

  getProjectOrThrow(projectId: string): Project {
    const project = this.store.read.getProject(projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    return project
  }

  async create(input: CreateProjectInput, actor: ActionActor = USER_ACTOR): Promise<Project> {
    const rootPath = this.workspace.ensureProjectRoot(input.rootPath, input.createDirectory)
    const existing = this.store.findProjectByRootPath(rootPath)
    if (existing) {
      throw new AppError('CONFLICT', `该目录已被项目「${existing.name}」使用`, {
        details: { projectId: existing.id },
      })
    }
    const tree = this.workspace.readWorkspaceTree(rootPath, { maxDepth: 1, maxEntries: 10 })
    if (tree.length === 0) {
      this.workspace.writeTextFile(rootPath, 'README.md', STARTER_README(input.name, input.description))
      this.workspace.writeTextFile(rootPath, 'AGENTS.md', STARTER_AGENTS)
    }
    if (input.initGit) {
      await this.workspace.initGitRepository(rootPath)
    }
    if (!this.store.read.listAgents().some((agent) => agent.id === 'agt_product')) {
      throw new AppError('INTERNAL', '内置 Agent 尚未初始化')
    }
    const timestamp = now()
    const projectId = newId('prj')
    const stages: ProjectStage[] = STAGE_KEYS.map((stage, index) => ({
      projectId,
      stage,
      status: index === 0 ? 'active' : 'pending',
      position: index,
      updatedAt: timestamp,
    }))
    const project: Project = {
      id: projectId,
      name: input.name,
      description: input.description,
      rootPath,
      status: 'active',
      currentStage: 'ideation',
      version: 0,
      isDemo: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return this.store.transaction(() => {
      this.store.createProject(project, stages)
      this.store.appendEvent(projectId, projectId, PROJECT_EVENT_TYPES.projectCreated, {
        title: project.name,
        actor,
        actorName: actor.name,
      })
      const lead = this.store.read.getAgent('agt_product')
      if (lead) {
        const session = this.store.createSession({
          id: newId('ses'),
          projectId,
          agentId: lead.id,
          title: `${lead.name} · 项目启动`,
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        this.store.appendMessage({
          sessionId: session.id,
          role: 'system',
          content: `项目「${project.name}」已创建。先描述目标与约束，${lead.name} 会协助拆解需求、里程碑与任务。`,
          metadata: { kind: 'project-created' },
        })
        this.store.appendEvent(projectId, session.id, PROJECT_EVENT_TYPES.sessionCreated, {
          title: session.title,
          actor,
          actorName: actor.name,
        })
      }
      const created = this.store.read.getProject(projectId)
      if (!created) throw new AppError('INTERNAL', '项目创建失败')
      return created
    })
  }

  async overview(projectId: string): Promise<ProjectOverview> {
    const base = this.store.read.getOverviewBase(projectId)
    if (!base) throw new AppError('NOT_FOUND', '项目不存在')
    let git: ProjectOverview['git'] = null
    try {
      const status = await this.workspace.getGitStatus(base.project.rootPath)
      git = status ? { branch: status.branch, clean: status.clean, changedFiles: status.changes.length } : null
    } catch {
      git = null
    }
    return { ...base, git }
  }

  update(input: UpdateProjectInput, actor: ActionActor = USER_ACTOR): Project {
    const current = this.getProjectOrThrow(input.projectId)
    return this.store.transaction(() => {
      const updated = this.store.updateProject(input.projectId, input.expectedVersion, {
        name: input.name,
        description: input.description,
        status: input.status,
      })
      this.store.appendEvent(current.id, current.id, PROJECT_EVENT_TYPES.projectUpdated, {
        title: updated.name,
        status: updated.status,
        actor,
        actorName: actor.name,
      })
      return updated
    })
  }

  async advanceStage(
    projectId: string,
    targetStage?: StageKey,
    actor: ActionActor = USER_ACTOR,
  ): Promise<Project> {
    const project = this.getProjectOrThrow(projectId)
    const gates = this.store.read.getLifecycleGates(projectId)
    const target = targetStage ?? nextStageKey(project.currentStage)
    const currentIndex = stageIndex(project.currentStage)
    const targetIndex = stageIndex(target)
    if (targetIndex < currentIndex) {
      throw new AppError('CONFLICT', '生命周期不能回退到更早阶段')
    }
    if (targetIndex === currentIndex) return project
    assertStageAdvanceAllowed(gates, target)
    return this.store.transaction(() => {
      for (const stage of STAGE_KEYS) {
        const index = stageIndex(stage)
        const status = index < targetIndex ? 'completed' : index === targetIndex ? 'active' : 'pending'
        this.store.setStageStatus(projectId, stage, status)
      }
      const updated = this.store.updateProject(projectId, project.version, { currentStage: target })
      this.store.appendEvent(projectId, projectId, PROJECT_EVENT_TYPES.stageAdvanced, {
        stage: target,
        stageLabel: STAGE_LABELS[target],
        actor,
        actorName: actor.name,
      })
      return updated
    })
  }

  activity(projectId: string, limit = 50) {
    this.getProjectOrThrow(projectId)
    return this.store.read.getProjectActivity(projectId, limit)
  }

  requirements(projectId: string): Requirement[] {
    this.getProjectOrThrow(projectId)
    return this.store.read.listRequirements(projectId)
  }

  createRequirement(input: CreateRequirementInput, actor: ActionActor = USER_ACTOR): Requirement {
    const project = this.getProjectOrThrow(input.projectId)
    const timestamp = now()
    const requirement: Requirement = {
      id: newId('req'),
      projectId: input.projectId,
      title: input.title,
      body: input.body,
      status: 'draft',
      source: input.source,
      versionId: input.versionId ?? null,
      iterationId: input.iterationId ?? null,
      acceptanceCriteria: input.acceptanceCriteria,
      version: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return this.store.transaction(() => {
      this.store.createRequirement(requirement)
      this.store.appendEvent(project.id, requirement.id, PROJECT_EVENT_TYPES.requirementCreated, {
        title: requirement.title,
        actor,
        actorName: actor.name,
      })
      return requirement
    })
  }

  setRequirementStatus(
    requirementId: string,
    status: Requirement['status'],
    actor: ActionActor = USER_ACTOR,
  ): Requirement {
    const existing = this.store.read.getRequirement(requirementId)
    if (!existing) throw new AppError('NOT_FOUND', '需求不存在')
    return this.store.transaction(() => {
      const requirement = this.store.setRequirementStatus(requirementId, status)
      this.store.appendEvent(requirement.projectId, requirement.id, PROJECT_EVENT_TYPES.requirementStatusChanged, {
        title: requirement.title,
        status,
        actor,
        actorName: actor.name,
      })
      return requirement
    })
  }

  milestones(projectId: string): Milestone[] {
    this.getProjectOrThrow(projectId)
    return this.store.read.listMilestones(projectId)
  }

  createMilestone(input: CreateMilestoneInput, actor: ActionActor = USER_ACTOR): Milestone {
    const project = this.getProjectOrThrow(input.projectId)
    const timestamp = now()
    const milestone: Milestone = {
      id: newId('mil'),
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      dueAt: input.dueAt,
      status: 'planned',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return this.store.transaction(() => {
      this.store.createMilestone(milestone)
      this.store.appendEvent(project.id, milestone.id, PROJECT_EVENT_TYPES.milestoneCreated, {
        title: milestone.title,
        actor,
        actorName: actor.name,
      })
      return milestone
    })
  }

  setMilestoneStatus(milestoneId: string, status: Milestone['status'], actor: ActionActor = USER_ACTOR): Milestone {
    const existing = this.store.read.getMilestone(milestoneId)
    if (!existing) throw new AppError('NOT_FOUND', '里程碑不存在')
    return this.store.transaction(() => {
      const milestone = this.store.setMilestoneStatus(milestoneId, status)
      this.store.appendEvent(milestone.projectId, milestone.id, PROJECT_EVENT_TYPES.milestoneStatusChanged, {
        title: milestone.title,
        status,
        actor,
        actorName: actor.name,
      })
      return milestone
    })
  }

  decisions(projectId: string): Decision[] {
    this.getProjectOrThrow(projectId)
    return this.store.read.listDecisions(projectId)
  }

  createDecision(input: CreateDecisionInput, actor: ActionActor = USER_ACTOR): Decision {
    const project = this.getProjectOrThrow(input.projectId)
    const timestamp = now()
    const superseded = input.supersedesId ? this.store.read.getDecision(input.supersedesId) : null
    if (input.supersedesId && (!superseded || superseded.projectId !== project.id)) {
      throw new AppError('NOT_FOUND', '被取代的决策不存在')
    }
    const decision: Decision = {
      id: newId('dec'),
      projectId: input.projectId,
      title: input.title,
      body: input.body,
      status: input.status,
      supersedesId: input.supersedesId ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    return this.store.transaction(() => {
      this.store.createDecision(decision)
      if (superseded) {
        this.store.setDecisionStatus(superseded.id, 'superseded')
      }
      this.store.appendEvent(project.id, decision.id, PROJECT_EVENT_TYPES.decisionCreated, {
        title: decision.title,
        status: decision.status,
        supersedesId: decision.supersedesId,
        actor,
        actorName: actor.name,
      })
      return decision
    })
  }

  setDecisionStatus(decisionId: string, status: Decision['status'], actor: ActionActor = USER_ACTOR): Decision {
    const existing = this.store.read.getDecision(decisionId)
    if (!existing) throw new AppError('NOT_FOUND', '决策不存在')
    return this.store.transaction(() => {
      const decision = this.store.setDecisionStatus(decisionId, status)
      this.store.appendEvent(decision.projectId, decision.id, PROJECT_EVENT_TYPES.decisionStatusChanged, {
        title: decision.title,
        status,
        actor,
        actorName: actor.name,
      })
      return decision
    })
  }

  artifacts(projectId: string, taskId: string | null = null): Artifact[] {
    this.getProjectOrThrow(projectId)
    return this.store.read.listArtifacts(projectId, taskId)
  }

  createArtifact(
    input: {
      projectId: string
      taskId?: string | null
      runId?: string | null
      kind?: Artifact['kind']
      title: string
      body?: string
      uri?: string | null
      metadata?: Record<string, unknown>
    },
    actor: ActionActor = USER_ACTOR,
  ): Artifact {
    const project = this.getProjectOrThrow(input.projectId)
    const artifact: Artifact = {
      id: newId('art'),
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      runId: input.runId ?? null,
      kind: input.kind ?? 'document',
      title: input.title,
      uri: input.uri ?? null,
      contentHash: null,
      gitCommit: null,
      metadata: { ...(input.metadata ?? {}), createdBy: actor.kind },
      verifiedAt: null,
      body: input.body ?? null,
      isDemo: false,
      createdAt: now(),
    }
    return this.store.transaction(() => {
      this.store.createArtifact(artifact)
      this.store.appendEvent(project.id, artifact.id, PROJECT_EVENT_TYPES.artifactCreated, {
        title: artifact.title,
        kind: artifact.kind,
        actor,
        actorName: actor.name,
      })
      return artifact
    })
  }

  knowledge(projectId: string) {
    this.getProjectOrThrow(projectId)
    return this.store.read.listKnowledge(projectId)
  }

  createKnowledge(
    input: { projectId: string; title: string; body: string; sourceUri?: string | null; sourceVersion?: string | null },
    actor: ActionActor = USER_ACTOR,
  ) {
    const project = this.getProjectOrThrow(input.projectId)
    return this.store.transaction(() => {
      const entry = this.store.createKnowledge({
        id: newId('knw'),
        projectId: input.projectId,
        title: input.title,
        body: input.body,
        sourceUri: input.sourceUri ?? null,
        sourceVersion: input.sourceVersion ?? null,
      })
      this.store.appendEvent(project.id, entry.id, PROJECT_EVENT_TYPES.knowledgeCreated, {
        title: entry.title,
        actor,
        actorName: actor.name,
      })
      return entry
    })
  }

  agentViews(projectId: string) {
    this.getProjectOrThrow(projectId)
    return this.store.read.getAgentViews(projectId)
  }
}
