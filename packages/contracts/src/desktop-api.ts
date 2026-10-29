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
  lifecycle: {
    overview: (projectId: string) => Promise<Out<'lifecycle.overview'>>
    products: (projectId: string) => Promise<Out<'product.list'>>
    createVersion: (input: In<'version.create'>) => Promise<Out<'version.create'>>
    transitionVersion: (input: In<'version.transition'>) => Promise<Out<'version.transition'>>
    createIteration: (input: In<'iteration.create'>) => Promise<Out<'iteration.create'>>
    setIterationStatus: (input: In<'iteration.setStatus'>) => Promise<Out<'iteration.setStatus'>>
    createEnvironment: (input: In<'environment.create'>) => Promise<Out<'environment.create'>>
    setFocus: (input: In<'project.focus.set'>) => Promise<Out<'project.focus.set'>>
    recordEvidence: (input: In<'evidence.record'>) => Promise<Out<'evidence.record'>>
    gateOverview: (
      projectId: string,
      subjectType: 'version' | 'iteration' | 'task' | 'release' | 'deployment' | 'incident',
      subjectId: string,
    ) => Promise<Out<'gate.overview'>>
  }
  resources: {
    overview: (projectId: string) => Promise<Out<'resource.overview'>>
    create: (input: In<'resource.create'>) => Promise<Out<'resource.create'>>
    update: (input: In<'resource.update'>) => Promise<Out<'resource.update'>>
    createProfile: (input: In<'resource.profile.create'>) => Promise<Out<'resource.profile.create'>>
    updateProfile: (input: In<'resource.profile.update'>) => Promise<Out<'resource.profile.update'>>
    deleteProfile: (profileId: string) => Promise<Out<'resource.profile.delete'>>
    createCredential: (input: In<'resource.credential.create'>) => Promise<Out<'resource.credential.create'>>
    disableCredential: (credentialId: string) => Promise<Out<'resource.credential.disable'>>
    testConnection: (profileId: string) => Promise<Out<'resource.connection.test'>>
  },
  release: {
    overview: (projectId: string, versionId: string) => Promise<Out<'release.overview'>>
    approvals: (projectId: string) => Promise<Out<'release.approvals'>>
    createChangeRequest: (input: In<'changeRequest.create'>) => Promise<Out<'changeRequest.create'>>
    updateChangeRequest: (input: In<'changeRequest.update'>) => Promise<Out<'changeRequest.update'>>
    submitChangeRequest: (changeRequestId: string) => Promise<Out<'changeRequest.submit'>>
    decideApproval: (input: In<'release.approval.decide'>) => Promise<Out<'release.approval.decide'>>
    createCandidate: (input: In<'release.candidate.create'>) => Promise<Out<'release.candidate.create'>>
    createRelease: (input: In<'release.create'>) => Promise<Out<'release.create'>>
    createDeployment: (input: In<'deployment.create'>) => Promise<Out<'deployment.create'>>
    recordDeployment: (input: In<'deployment.record'>) => Promise<Out<'deployment.record'>>
    executeDeployment: (deploymentId: string) => Promise<Out<'deployment.execute'>>
    deploymentOperations: (deploymentId: string) => Promise<Out<'deployment.operations'>>
    reconcileDeployment: (deploymentId: string, note?: string) => Promise<Out<'deployment.reconcile.remote'>>
    adapters: (projectId: string) => Promise<Out<'delivery.adapters'>>
    createRollback: (input: In<'deployment.rollback'>) => Promise<Out<'deployment.rollback'>>
    createTarget: (input: In<'deployment.target.create'>) => Promise<Out<'deployment.target.create'>>
    createStrategy: (input: In<'deployment.strategy.create'>) => Promise<Out<'deployment.strategy.create'>>
  }
  work: {
    goalStatus: (projectId: string) => Promise<Out<'work.goalStatus'>>
  }
  actions: {
    center: (projectId: string) => Promise<Out<'action.center'>>
    autonomy: (projectId: string) => Promise<Out<'action.autonomy.get'>>
    setAutonomy: (input: In<'action.autonomy.set'>) => Promise<Out<'action.autonomy.set'>>
    tick: (projectId: string) => Promise<Out<'action.autonomy.tick'>>
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
    acceptancePolicy: (taskId: string) => Promise<Out<'task.acceptancePolicy'>>
    requestAcceptance: (taskId: string, reason: string) => Promise<Out<'task.requestAcceptance'>>
    decideAcceptance: (
      approvalId: string,
      decision: 'approved' | 'rejected',
      note?: string,
    ) => Promise<Out<'task.decideAcceptance'>>
    confirmAcceptance: (taskId: string, approvalId: string, note?: string) => Promise<Out<'task.confirmAcceptance'>>
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
    reconcile: (input: In<'run.reconcile'>) => Promise<Out<'run.reconcile'>>
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
    cancel: (handoffId: string, reason?: string) => Promise<Out<'handoff.cancel'>>
    getPolicy: (projectId: string) => Promise<Out<'handoff.policy.get'>>
    setPolicy: (projectId: string, mode: In<'handoff.policy.set'>['mode']) => Promise<Out<'handoff.policy.set'>>
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
    qualityPolicy: (projectId: string) => Promise<Out<'project.qualityPolicy.get'>>
    setQualityPolicy: (
      projectId: string,
      policy: { required: string[]; optional: string[] },
    ) => Promise<Out<'project.qualityPolicy.set'>>
  }
  plans: {
    generate: (
      projectId: string,
      goal: string,
      options?: {
        mode?: 'ai' | 'local'
        allowRuleFallback?: boolean
        maxTasks?: number
        allowOverBudget?: boolean
      },
    ) => Promise<Out<'plan.generate'>>
    list: (projectId: string) => Promise<Out<'plan.list'>>
    get: (planId: string) => Promise<Out<'plan.get'>>
    update: (input: In<'plan.update'>) => Promise<Out<'plan.update'>>
    revise: (input: In<'plan.revise'>) => Promise<Out<'plan.revise'>>
    approve: (planId: string) => Promise<Out<'plan.approve'>>
    reject: (planId: string) => Promise<Out<'plan.reject'>>
    discuss: (planId: string, content: string) => Promise<Out<'plan.discuss'>>
    grant: {
      get: (planId: string) => Promise<Out<'plan.grant.get'>>
      issue: (input: In<'plan.grant.issue'>) => Promise<Out<'plan.grant.issue'>>
      revoke: (input: In<'plan.grant.revoke'>) => Promise<Out<'plan.grant.revoke'>>
    }
    replan: {
      propose: (input: In<'plan.replan.propose'>) => Promise<Out<'plan.replan.propose'>>
      list: (projectId: string, planId?: string | null) => Promise<Out<'plan.replan.list'>>
      get: (proposalId: string) => Promise<Out<'plan.replan.get'>>
      apply: (proposalId: string) => Promise<Out<'plan.replan.apply'>>
    evaluate: (proposalId: string) => Promise<Out<'plan.replan.evaluate'>>
    approve: (proposalId: string, reason?: string) => Promise<Out<'plan.replan.approve'>>
      reject: (proposalId: string, reason?: string) => Promise<Out<'plan.replan.reject'>>
    }
  }
  agentDefinitions: {
    list: () => Promise<Out<'agentDefinition.list'>>
    upsert: (input: In<'agentDefinition.upsert'>) => Promise<Out<'agentDefinition.upsert'>>
    setStatus: (id: string, status: 'active' | 'disabled' | 'archived') => Promise<Out<'agentDefinition.setStatus'>>
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
    acpHandshake: (profileId: string, cwd?: string) => Promise<Out<'runtime.acpHandshake'>>
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
    setMode: (projectId: string, mode: 'observe' | 'propose' | 'approved-autofix', repairAgentId?: string | null) => Promise<Out<'operations.setMode'>>
    getTrigger: (projectId: string) => Promise<Out<'operations.getTrigger'>>
    insights: (projectId: string, runAudit?: boolean) => Promise<Out<'operations.insights'>>
    risk: (proposalId: string) => Promise<Out<'operations.risk'>>
    getGrant: (projectId: string) => Promise<Out<'operations.getGrant'>>
    grant: (projectId: string, hours?: number, maxRuns?: number) => Promise<Out<'operations.grant'>>
    revokeGrant: (projectId: string) => Promise<Out<'operations.revokeGrant'>>
    setTrigger: (projectId: string, intervalMinutes: number, enabled: boolean) => Promise<Out<'operations.setTrigger'>>
  }
  orchestration: {
    start: (
      planId: string,
      concurrency?: number,
      maxRetries?: number,
      allowOverBudget?: boolean,
      grantId?: string | null,
      startRequestId?: string | null,
      maxEvidenceRetries?: number,
    ) => Promise<Out<'orchestration.start'>>
    pause: (planId: string) => Promise<Out<'orchestration.pause'>>
    resume: (planId: string) => Promise<Out<'orchestration.resume'>>
    cancel: (planId: string) => Promise<Out<'orchestration.cancel'>>
    reassign: (planId: string, taskId: string, agentId: string) => Promise<Out<'orchestration.reassign'>>
    declineReassign: (planId: string, taskId: string, note?: string) => Promise<Out<'orchestration.declineReassign'>>
  }
  verification: {
    request: (projectId: string, taskId: string) => Promise<Out<'verification.request'>>
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
    settings: {
      get: () => Promise<Out<'runtime.settings.get'>>
      update: (input: In<'runtime.settings.update'>) => Promise<Out<'runtime.settings.update'>>
    }
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



















