import type { ApiInput, ApiMethod, ApiOutput } from './api.js'
import type { ProviderInfoSchema, RuntimeStatusSchema } from './entities.js'
import type { RuntimeEvent } from './runtime-protocol.js'
import type { z } from 'zod'

type In<M extends ApiMethod> = ApiInput<M>
type Out<M extends ApiMethod> = ApiOutput<M>

export interface RuntimeEventEnvelope {
  seq: number
  event: RuntimeEvent
}

export type Unsubscribe = () => void

type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>
type ProviderInfo = z.infer<typeof ProviderInfoSchema>

/**
 * The only bridge exposed by preload. Every method maps to an allowlisted,
 * schema-validated request; there is no generic channel or filesystem access.
 */
export interface ProjectOSDesktopApi {
  app: {
    bootstrap: (input?: In<'app.bootstrap'>) => Promise<Out<'app.bootstrap'>>
    preferences: (input?: In<'app.preferences.get'>) => Promise<Out<'app.preferences.get'>>
    pickDirectory: (title?: string) => Promise<Out<'app.pickDirectory'>>
    revealPath: (path: string) => Promise<void>
    openExternal: (url: string) => Promise<void>
    minimize: () => Promise<void>
    toggleMaximize: () => Promise<{ maximized: boolean }>
    close: () => Promise<void>
  }
  projects: {
    list: (input?: In<'project.list'>) => Promise<Out<'project.list'>>
    create: (input: In<'project.create'>) => Promise<Out<'project.create'>>
    overview: (projectId: string) => Promise<Out<'project.overview'>>
    update: (input: In<'project.update'>) => Promise<Out<'project.update'>>
    advanceStage: (input: In<'project.advanceStage'>) => Promise<Out<'project.advanceStage'>>
    activity: (input: In<'project.activity'>) => Promise<Out<'project.activity'>>
    reveal: (projectId: string) => Promise<Out<'project.reveal'>>
  }
  tasks: {
    board: (projectId: string) => Promise<Out<'task.board'>>
    detail: (taskId: string) => Promise<Out<'task.detail'>>
    create: (input: In<'task.create'>) => Promise<Out<'task.create'>>
    update: (input: In<'task.update'>) => Promise<Out<'task.update'>>
    move: (input: In<'task.move'>) => Promise<Out<'task.move'>>
    addDependency: (taskId: string, dependsOnId: string) => Promise<Out<'task.addDependency'>>
    removeDependency: (taskId: string, dependsOnId: string) => Promise<Out<'task.removeDependency'>>
  }
  requirements: {
    list: (projectId: string) => Promise<Out<'requirement.list'>>
    create: (input: In<'requirement.create'>) => Promise<Out<'requirement.create'>>
    setStatus: (requirementId: string, status: In<'requirement.setStatus'>['status']) => Promise<Out<'requirement.setStatus'>>
  }
  milestones: {
    list: (projectId: string) => Promise<Out<'milestone.list'>>
    create: (input: In<'milestone.create'>) => Promise<Out<'milestone.create'>>
    setStatus: (milestoneId: string, status: In<'milestone.setStatus'>['status']) => Promise<Out<'milestone.setStatus'>>
  }
  decisions: {
    list: (projectId: string) => Promise<Out<'decision.list'>>
    create: (input: In<'decision.create'>) => Promise<Out<'decision.create'>>
    setStatus: (decisionId: string, status: In<'decision.setStatus'>['status']) => Promise<Out<'decision.setStatus'>>
  }
  artifacts: {
    list: (projectId: string, taskId?: string | null) => Promise<Out<'artifact.list'>>
    create: (input: In<'artifact.create'>) => Promise<Out<'artifact.create'>>
  }
  knowledge: {
    list: (projectId: string) => Promise<Out<'knowledge.list'>>
    search: (projectId: string, query: string, limit?: number) => Promise<Out<'knowledge.search'>>
  }
  agents: {
    list: (projectId: string) => Promise<Out<'agent.list'>>
  }
  sessions: {
    list: (projectId: string) => Promise<Out<'session.list'>>
    create: (input: In<'session.create'>) => Promise<Out<'session.create'>>
    get: (sessionId: string, messageLimit?: number) => Promise<Out<'session.get'>>
    sendMessage: (input: In<'session.sendMessage'>) => Promise<Out<'session.sendMessage'>>
    update: (input: In<'session.update'>) => Promise<Out<'session.update'>>
  }
  runs: {
    start: (input: In<'run.start'>) => Promise<Out<'run.start'>>
    cancel: (runId: string) => Promise<Out<'run.cancel'>>
    list: (projectId: string, limit?: number) => Promise<Out<'run.list'>>
    get: (runId: string) => Promise<Out<'run.get'>>
  }
  approvals: {
    list: (input?: In<'approval.list'>) => Promise<Out<'approval.list'>>
    decide: (input: In<'approval.decide'>) => Promise<Out<'approval.decide'>>
  }
  collaboration: {
    snapshot: (projectId: string) => Promise<Out<'collaboration.snapshot'>>
  }
  inbox: {
    send: (input: In<'inbox.send'>) => Promise<Out<'inbox.send'>>
    list: (input: In<'inbox.list'>) => Promise<Out<'inbox.list'>>
    ack: (inboxId: string) => Promise<Out<'inbox.ack'>>
    resume: (inboxId: string) => Promise<Out<'inbox.resume'>>
  }
  handoffs: {
    list: (projectId: string) => Promise<Out<'handoff.list'>>
    request: (input: In<'handoff.request'>) => Promise<Out<'handoff.request'>>
    accept: (handoffId: string, sessionId?: string | null) => Promise<Out<'handoff.accept'>>
    reject: (handoffId: string, reason?: string) => Promise<Out<'handoff.reject'>>
  }
  workspace: {
    snapshot: (projectId: string) => Promise<Out<'workspace.snapshot'>>
    readFile: (projectId: string, path: string) => Promise<Out<'workspace.readFile'>>
    gitDiff: (projectId: string, path?: string) => Promise<Out<'workspace.gitDiff'>>
    runReadonly: (projectId: string, command: string) => Promise<Out<'workspace.runReadonly'>>
  }
  events: {
    list: (input: In<'event.list'>) => Promise<Out<'event.list'>>
  }
  provider: {
    status: () => Promise<ProviderInfo>
    test: () => Promise<Out<'provider.test'>>
  }
  aiConnections: {
    list: () => Promise<Out<'aiConnections.list'>>
    create: (input: In<'aiConnections.create'>) => Promise<Out<'aiConnections.create'>>
    update: (input: In<'aiConnections.update'>) => Promise<Out<'aiConnections.update'>>
    delete: (id: string) => Promise<Out<'aiConnections.delete'>>
    setDefault: (id: string) => Promise<Out<'aiConnections.setDefault'>>
    test: (id: string) => Promise<Out<'aiConnections.test'>>
    discoverModels: (id: string) => Promise<Out<'aiConnections.discoverModels'>>
  }
  aiModels: {
    list: (connectionId: string) => Promise<Out<'aiModels.list'>>
    create: (input: In<'aiModels.create'>) => Promise<Out<'aiModels.create'>>
    delete: (connectionId: string, modelId: string) => Promise<Out<'aiModels.delete'>>
    setDefault: (connectionId: string, modelId: string) => Promise<Out<'aiModels.setDefault'>>
  }
  aiRouting: {
    list: (projectId?: string) => Promise<Out<'aiRouting.list'>>
    upsert: (input: In<'aiRouting.upsert'>) => Promise<Out<'aiRouting.upsert'>>
    delete: (id: string) => Promise<Out<'aiRouting.delete'>>
  }
  aiUsage: {
    summary: (projectId?: string) => Promise<Out<'aiUsage.summary'>>
  }
  aiPricing: {
    list: (connectionId?: string) => Promise<Out<'aiPricing.list'>>
    upsert: (input: In<'aiPricing.upsert'>) => Promise<Out<'aiPricing.upsert'>>
    delete: (id: string) => Promise<Out<'aiPricing.delete'>>
  }
  externalAgents: {
    list: () => Promise<Out<'externalAgents.list'>>
    execute: (input: In<'externalAgents.execute'>) => Promise<Out<'externalAgents.execute'>>
    cancel: (runId: string) => Promise<Out<'externalAgents.cancel'>>
  }
  projectAnalysis: {
    scan: (projectId: string) => Promise<Out<'project.scan'>>
    snapshot: (projectId: string) => Promise<Out<'project.snapshot.get'>>
    metrics: (projectId: string) => Promise<Out<'project.metrics'>>
    budget: (projectId: string) => Promise<Out<'project.budget.get'>>
    setBudget: (projectId: string, softLimit: number, currency?: string) => Promise<Out<'project.budget.set'>>
  }
  plans: {
    generate: (projectId: string, goal: string) => Promise<Out<'plan.generate'>>
    list: (projectId: string) => Promise<Out<'plan.list'>>
    get: (planId: string) => Promise<Out<'plan.get'>>
    update: (input: In<'plan.update'>) => Promise<Out<'plan.update'>>
    revise: (input: In<'plan.revise'>) => Promise<Out<'plan.revise'>>
    approve: (planId: string) => Promise<Out<'plan.approve'>>
    reject: (planId: string) => Promise<Out<'plan.reject'>>
  }
  agentDefinitions: {
    list: () => Promise<Out<'agentDefinition.list'>>
    upsert: (input: In<'agentDefinition.upsert'>) => Promise<Out<'agentDefinition.upsert'>>
    delete: (id: string) => Promise<Out<'agentDefinition.delete'>>
    export: (id: string) => Promise<Out<'agentDefinition.export'>>
    import: (json: string) => Promise<Out<'agentDefinition.import'>>
    preview: (id: string) => Promise<Out<'agentDefinition.preview'>>
    run: (input: In<'agentDefinition.run'>) => Promise<Out<'agentDefinition.run'>>
  }
  skills: {
    list: () => Promise<Out<'skill.list'>>
    import: (input: In<'skill.import'>) => Promise<Out<'skill.import'>>
  }
  runtimeProfiles: {
    list: () => Promise<Out<'runtime.list'>>
    upsert: (input: In<'runtime.upsert'>) => Promise<Out<'runtime.upsert'>>
    delete: (id: string) => Promise<Out<'runtime.delete'>>
    detect: (profileId?: string) => Promise<Out<'runtime.detect'>>
    install: (profileId: string) => Promise<Out<'runtime.install'>>
    registry: (force?: boolean) => Promise<Out<'runtime.registry'>>
    execute: (profileId: string, prompt: string, cwd?: string) => Promise<Out<'runtime.execute'>>
    acpHandshake: (profileId: string, cwd?: string) => Promise<Out<'runtime.acpHandshake'>>
    acpPrompt: (profileId: string, prompt: string, cwd?: string) => Promise<Out<'runtime.acpPrompt'>>
    acpAuthenticate: (profileId: string, methodId: string, cwd?: string) => Promise<Out<'runtime.acpAuthenticate'>>
    importRegistry: (input: In<'runtime.importRegistry'>) => Promise<Out<'runtime.importRegistry'>>
    cancel: (executionId: string) => Promise<Out<'runtime.cancel'>>
  }
  operations: {
    snapshot: (projectId: string) => Promise<Out<'operations.snapshot'>>
    runChecks: (projectId: string) => Promise<Out<'operations.runChecks'>>
    propose: (projectId: string, findingIds: string[]) => Promise<Out<'operations.propose'>>
    reviewProposal: (proposalId: string, decision: 'approved' | 'rejected') => Promise<Out<'operations.reviewProposal'>>
    startRepair: (proposalId: string) => Promise<Out<'operations.startRepair'>>
    setMode: (projectId: string, mode: 'observe' | 'propose' | 'approved-autofix') => Promise<Out<'operations.setMode'>>
    getTrigger: (projectId: string) => Promise<Out<'operations.getTrigger'>>
    insights: (projectId: string, runAudit?: boolean) => Promise<Out<'operations.insights'>>
    risk: (proposalId: string) => Promise<Out<'operations.risk'>>
    getGrant: (projectId: string) => Promise<Out<'operations.getGrant'>>
    grant: (projectId: string, hours?: number, maxRuns?: number) => Promise<Out<'operations.grant'>>
    revokeGrant: (projectId: string) => Promise<Out<'operations.revokeGrant'>>
    setTrigger: (projectId: string, intervalMinutes: number, enabled: boolean) => Promise<Out<'operations.setTrigger'>>
  }
  orchestration: {
    start: (planId: string, concurrency?: number, maxRetries?: number, allowOverBudget?: boolean) => Promise<Out<'orchestration.start'>>
    pause: (planId: string) => Promise<Out<'orchestration.pause'>>
    resume: (planId: string) => Promise<Out<'orchestration.resume'>>
    cancel: (planId: string) => Promise<Out<'orchestration.cancel'>>
  }
  worktrees: {
    info: (planId: string) => Promise<Out<'worktree.info'>>
    merge: (planId: string) => Promise<Out<'worktree.merge'>>
    discard: (planId: string) => Promise<Out<'worktree.discard'>>
  }
  graph: {
    snapshot: (projectId: string) => Promise<Out<'graph.snapshot.get'>>
    saveLayout: (
      projectId: string,
      positions: Record<string, { x: number; y: number }>,
    ) => Promise<Out<'graph.layout.save'>>
  }
  settings: {
    get: () => Promise<ProviderInfo>
    update: (input: In<'settings.update'>) => Promise<ProviderInfo>
    clearKey: () => Promise<ProviderInfo>
    test: () => Promise<Out<'settings.test'>>
  }
  runtime: {
    health: () => Promise<Out<'runtime.health'>>
    status: () => Promise<RuntimeStatus>
    onEvent: (handler: (event: RuntimeEventEnvelope) => void) => Unsubscribe
    onStatus: (handler: (status: RuntimeStatus) => void) => Unsubscribe
  }
  system: {
    platform: string
    versions: Record<string, string>
  }
  demo: {
    seed: (force?: boolean) => Promise<Out<'demo.seed'>>
  }
}

declare global {
  interface Window {
    projectos: ProjectOSDesktopApi
  }
}


















