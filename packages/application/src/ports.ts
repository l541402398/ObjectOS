import type {
  Agent,
  AgentDefinition,
  AgentView,
  ApprovalView,
  Artifact,
  CollaborationSnapshot,
  CrossSessionEnvelope,
  Decision,
  FileContent,
  GitStatus,
  Handoff,
  HandoffView,
  InboxItem,
  InboxItemView,
  KnowledgeEntry,
  LifecycleGate,
  Message,
  Milestone,
  Project,
  ProjectEvent,
  ProjectOverview,
  ProjectStage,
  ProjectStats,
  ProjectSummary,
  Requirement,
  RunDetail,
  RunSummary,
  RuntimeProfile,
  Session,
  SessionDetail,
  SessionSummary,
  Skill,
  StageKey,
  Task,
  TaskBoard,
  TaskCard,
  TaskDetail,
  WorkspaceEntry,
} from '@projectos/contracts'

export type OverviewBase = Omit<ProjectOverview, 'git'>

export interface ReadPort {
  getProject(id: string): Project | null
  getProjectSummary(project: Project): ProjectSummary
  listProjectSummaries(includeArchived?: boolean): ProjectSummary[]
  getProjectStats(projectId: string): ProjectStats
  getStages(projectId: string): ProjectStage[]
  getOverviewBase(projectId: string): OverviewBase | null
  getLifecycleGates(projectId: string): LifecycleGate[]
  getProjectActivity(projectId: string, limit?: number): ProjectOverview['activity']
  listRequirements(projectId: string): Requirement[]
  getRequirement(id: string): Requirement | null
  listMilestones(projectId: string): Milestone[]
  getMilestone(id: string): Milestone | null
  listDecisions(projectId: string): Decision[]
  getDecision(id: string): Decision | null
  listArtifacts(projectId: string, taskId?: string | null): Artifact[]
  listKnowledge(projectId: string): KnowledgeEntry[]
  listAgents(): Agent[]
  getAgent(id: string): Agent | null
  getAgentDefinition(id: string): AgentDefinition | null
  listSkills(): Skill[]
  listRuntimeProfiles(): RuntimeProfile[]
  getAgentViews(projectId: string): AgentView[]
  getTask(id: string): Task | null
  listTasks(projectId: string): Task[]
  listDependencies(projectId: string): Array<{ taskId: string; dependsOnId: string }>
  getTaskCard(taskId: string): TaskCard | null
  getTaskBoard(projectId: string): TaskBoard
  getTaskDetail(taskId: string): TaskDetail | null
  getSession(id: string): Session | null
  getSessionSummary(session: Session): SessionSummary
  listSessionSummaries(projectId: string): SessionSummary[]
  getSessionDetail(sessionId: string, messageLimit?: number): SessionDetail | null
  getMessages(sessionId: string, limit?: number, afterSeq?: number): Message[]
  listRunSummaries(projectId: string, limit?: number): RunSummary[]
  getRunDetail(runId: string): RunDetail | null
  listApprovalViews(projectId?: string | null, runId?: string | null): ApprovalView[]
  getCollaborationSnapshot(projectId: string): CollaborationSnapshot
  getInbox(id: string): InboxItem | null
  listInbox(projectId: string, sessionId?: string | null, limit?: number): InboxItem[]
  listInboxViews(projectId: string, sessionId?: string | null, limit?: number): InboxItemView[]
  getInboxItemView(item: InboxItem): InboxItemView
  getHandoff(id: string): Handoff | null
  getHandoffView(id: string): HandoffView | null
  listHandoffViews(projectId: string): HandoffView[]
  getHandoffMode(projectId: string): 'manual' | 'auto'
  isAgentVisibleToProject(projectId: string, agentId: string): boolean
}

export interface CoreStore {
  readonly read: ReadPort
  transaction<T>(fn: () => T): T
  findProjectByRootPath(rootPath: string): Project | null
  getProjectByName(name: string): Project | null
  createProject(project: Project, stages: ProjectStage[]): Project
  updateProject(
    id: string,
    expectedVersion: number,
    patch: { name?: string; description?: string; status?: Project['status']; currentStage?: StageKey },
  ): Project
  setStageStatus(projectId: string, stage: string, status: string): void
  createRequirement(requirement: Requirement): Requirement
  setRequirementStatus(id: string, status: Requirement['status']): Requirement
  createMilestone(milestone: Milestone): Milestone
  setMilestoneStatus(id: string, status: Milestone['status']): Milestone
  createDecision(decision: Decision): Decision
  setDecisionStatus(id: string, status: Decision['status']): Decision
  createArtifact(artifact: Artifact): Artifact
  createKnowledge(entry: {
    id: string
    projectId: string
    title: string
    body: string
    sourceUri: string | null
    sourceVersion: string | null
  }): KnowledgeEntry
  createTask(task: Task, dependencies?: string[]): Task
  updateTask(taskId: string, expectedVersion: number, patch: Partial<Pick<Task, 'title' | 'description' | 'priority' | 'assigneeAgentId' | 'acceptanceCriteria' | 'labels' | 'milestoneId' | 'dueAt'>>): Task
  moveTask(taskId: string, expectedVersion: number, to: Task['status']): Task
  addDependency(taskId: string, dependsOnId: string): void
  removeDependency(taskId: string, dependsOnId: string): void
  createSession(session: Session): Session
  updateSession(id: string, patch: { title?: string; status?: Session['status'] }): Session
  appendMessage(input: {
    sessionId: string
    role: Message['role']
    content: string
    runId?: string | null
    metadata?: Record<string, unknown>
  }): Message
  insertInboxWithMessage(input: {
    projectId: string
    envelope: CrossSessionEnvelope
    recipientAgentId: string
    recipientSessionId: string
  }): { item: InboxItem; duplicate: boolean }
  updateInboxStatus(id: string, status: InboxItem['status'], patch?: { error?: string | null }): InboxItem
  createHandoff(handoff: Handoff): Handoff
  updateHandoff(
    id: string,
    patch: { status: Handoff['status']; toSessionId?: string | null; decidedAt?: number | null },
  ): Handoff
  updateHandoffPayload(id: string, patch: Record<string, unknown>): Handoff
  setHandoffMode(projectId: string, mode: 'manual' | 'auto'): void
  appendEvent(projectId: string, aggregateId: string, eventType: string, payload: Record<string, unknown>): ProjectEvent
}

export interface WorkspacePort {
  ensureProjectRoot(rootPath: string, createDirectory: boolean): string
  readWorkspaceTree(rootPath: string, options?: { maxDepth?: number; maxEntries?: number }): WorkspaceEntry[]
  writeTextFile(rootPath: string, relativePath: string, content: string): { path: string; bytes: number }
  readTextFile(rootPath: string, relativePath: string): FileContent
  getGitStatus(rootPath: string): Promise<GitStatus | null>
  initGitRepository(rootPath: string): Promise<boolean>
}

export interface ActionActor {
  kind: 'user' | 'agent' | 'system'
  id: string
  name: string
}

export const USER_ACTOR: ActionActor = { kind: 'user', id: 'local-user', name: '你' }
