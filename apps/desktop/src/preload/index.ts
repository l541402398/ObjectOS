import { contextBridge, ipcRenderer } from 'electron'
import type {
  ProjectOSDesktopApi,
  RuntimeEventEnvelope,
  RuntimeStatus,
  SerializedAppError,
  Unsubscribe,
} from '@projectos/contracts'

interface IpcEnvelope<T> {
  ok: boolean
  result?: T
  error?: SerializedAppError
}

export class DesktopApiError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly retryable: boolean

  constructor(error: SerializedAppError) {
    super(error.message)
    this.name = 'DesktopApiError'
    this.code = error.code
    this.details = error.details
    this.retryable = Boolean(error.retryable)
  }
}

async function call<T>(method: string, input: unknown = {}): Promise<T> {
  const response = (await ipcRenderer.invoke('projectos:request', method, input)) as IpcEnvelope<T> | undefined
  if (!response) throw new DesktopApiError({ code: 'INTERNAL', message: '主进程没有返回响应' })
  if (!response.ok) {
    throw new DesktopApiError(
      response.error ?? { code: 'INTERNAL', message: '未知 IPC 错误' },
    )
  }
  return response.result as T
}

const onEvent = (handler: (payload: RuntimeEventEnvelope) => void): Unsubscribe => {
  const listener = (_event: Electron.IpcRendererEvent, payload: RuntimeEventEnvelope): void => handler(payload)
  ipcRenderer.on('projectos:event', listener)
  return () => ipcRenderer.removeListener('projectos:event', listener)
}

const onStatus = (handler: (status: RuntimeStatus) => void): Unsubscribe => {
  const listener = (_event: Electron.IpcRendererEvent, payload: RuntimeStatus): void => handler(payload)
  ipcRenderer.on('projectos:runtime-status', listener)
  return () => ipcRenderer.removeListener('projectos:runtime-status', listener)
}

const api: ProjectOSDesktopApi = {
  app: {
    bootstrap: () => call('app.bootstrap'),
    preferences: () => call('app.preferences.get'),
    pickDirectory: (title) => call('app.pickDirectory', { title: title ?? '选择项目根目录' }),
    revealPath: (path) => call('app.revealPath', { path }),
    openExternal: (url) => call('app.openExternal', { url }),
    minimize: () => call('app.windowMinimize'),
    toggleMaximize: () => call('app.windowToggleMaximize'),
    close: () => call('app.windowClose'),
  },
  lifecycle: {
    overview: (projectId) => call('lifecycle.overview', { projectId }),
    products: (projectId) => call('product.list', { projectId }),
    createVersion: (input) => call('version.create', input),
    transitionVersion: (input) => call('version.transition', input),
    createIteration: (input) => call('iteration.create', input),
    setIterationStatus: (input) => call('iteration.setStatus', input),
    createEnvironment: (input) => call('environment.create', input),
    setFocus: (input) => call('project.focus.set', input),
    recordEvidence: (input) => call('evidence.record', input),
    gateOverview: (projectId, subjectType, subjectId) => call('gate.overview', { projectId, subjectType, subjectId }),
  },
  projects: {
    list: (input) => call('project.list', input ?? {}),
    create: (input) => call('project.create', input),
    overview: (projectId) => call('project.overview', { projectId }),
    update: (input) => call('project.update', input),
    advanceStage: (input) => call('project.advanceStage', input),
    activity: (input) => call('project.activity', input),
    reveal: (projectId) => call('project.reveal', { projectId }),
  },
  tasks: {
    board: (projectId) => call('task.board', { projectId }),
    detail: (taskId) => call('task.detail', { taskId }),
    create: (input) => call('task.create', input),
    update: (input) => call('task.update', input),
    move: (input) => call('task.move', input),
    acceptancePolicy: (taskId) => call('task.acceptancePolicy', { taskId }),
    requestAcceptance: (taskId, reason) => call('task.requestAcceptance', { taskId, reason }),
    decideAcceptance: (approvalId, decision, note = '') =>
      call('task.decideAcceptance', { approvalId, decision, note }),
    confirmAcceptance: (taskId, approvalId, note = '') =>
      call('task.confirmAcceptance', { taskId, approvalId, note }),
    addDependency: (taskId, dependsOnId) => call('task.addDependency', { taskId, dependsOnId }),
    removeDependency: (taskId, dependsOnId) => call('task.removeDependency', { taskId, dependsOnId }),
  },
  requirements: {
    list: (projectId) => call('requirement.list', { projectId }),
    create: (input) => call('requirement.create', input),
    setStatus: (requirementId, status) => call('requirement.setStatus', { requirementId, status }),
  },
  milestones: {
    list: (projectId) => call('milestone.list', { projectId }),
    create: (input) => call('milestone.create', input),
    setStatus: (milestoneId, status) => call('milestone.setStatus', { milestoneId, status }),
  },
  decisions: {
    list: (projectId) => call('decision.list', { projectId }),
    create: (input) => call('decision.create', input),
    setStatus: (decisionId, status) => call('decision.setStatus', { decisionId, status }),
  },
  artifacts: {
    list: (projectId, taskId) => call('artifact.list', { projectId, taskId: taskId ?? null }),
    create: (input) => call('artifact.create', input),
  },
  knowledge: {
    list: (projectId) => call('knowledge.list', { projectId }),
    search: (projectId, query, limit = 30) => call('knowledge.search', { projectId, query, limit }),
  },
  agents: {
    list: (projectId) => call('agent.list', { projectId }),
  },
  sessions: {
    list: (projectId) => call('session.list', { projectId }),
    create: (input) => call('session.create', input),
    get: (sessionId, messageLimit) => call('session.get', { sessionId, messageLimit: messageLimit ?? 200 }),
    sendMessage: (input) => call('session.sendMessage', input),
    update: (input) => call('session.update', input),
  },
  runs: {
    start: (input) => call('run.start', input),
    cancel: (runId) => call('run.cancel', { runId }),
    reconcile: (input) => call('run.reconcile', input),
    list: (projectId, limit) => call('run.list', { projectId, limit: limit ?? 50 }),
    get: (runId) => call('run.get', { runId }),
  },
  approvals: {
    list: (input) => call('approval.list', input ?? {}),
    decide: (input) => call('approval.decide', input),
  },
  collaboration: {
    snapshot: (projectId) => call('collaboration.snapshot', { projectId }),
  },
  inbox: {
    send: (input) => call('inbox.send', input),
    list: (input) => call('inbox.list', input),
    ack: (inboxId) => call('inbox.ack', { inboxId }),
    resume: (inboxId) => call('inbox.resume', { inboxId }),
  },
  handoffs: {
    list: (projectId) => call('handoff.list', { projectId }),
    request: (input) => call('handoff.request', input),
    accept: (handoffId, sessionId) => call('handoff.accept', { handoffId, sessionId: sessionId ?? null }),
    reject: (handoffId, reason) => call('handoff.reject', { handoffId, reason: reason ?? '' }),
    cancel: (handoffId, reason) => call('handoff.cancel', { handoffId, reason: reason ?? '' }),
    getPolicy: (projectId) => call('handoff.policy.get', { projectId }),
    setPolicy: (projectId, mode) => call('handoff.policy.set', { projectId, mode }),
  },
  workspace: {
    snapshot: (projectId) => call('workspace.snapshot', { projectId }),
    readFile: (projectId, path) => call('workspace.readFile', { projectId, path }),
    gitDiff: (projectId, path) => call('workspace.gitDiff', { projectId, path }),
    runReadonly: (projectId, command) => call('workspace.runReadonly', { projectId, command }),
  },
  events: {
    list: (input) => call('event.list', input),
  },
  provider: {
    status: () => call('provider.status'),
    test: () => call('provider.test'),
  },
  aiConnections: {
    list: () => call('aiConnections.list'),
    create: (input) => call('aiConnections.create', input),
    update: (input) => call('aiConnections.update', input),
    delete: (id) => call('aiConnections.delete', { id }),
    setDefault: (id) => call('aiConnections.setDefault', { id }),
    test: (id) => call('aiConnections.test', { id }),
    discoverModels: (id) => call('aiConnections.discoverModels', { id }),
  },
  aiModels: {
    list: (connectionId) => call('aiModels.list', { id: connectionId }),
    create: (input) => call('aiModels.create', input),
    delete: (connectionId, modelId) => call('aiModels.delete', { connectionId, modelId }),
    setDefault: (connectionId, modelId) => call('aiModels.setDefault', { connectionId, modelId }),
  },
  aiRouting: {
    list: (projectId) => call('aiRouting.list', projectId ? { projectId } : {}),
    upsert: (input) => call('aiRouting.upsert', input),
    delete: (id) => call('aiRouting.delete', { id }),
  },
  aiUsage: {
    summary: (projectId) => call('aiUsage.summary', projectId ? { projectId } : {}),
  },
  aiPricing: {
    list: (connectionId) => call('aiPricing.list', connectionId ? { connectionId } : {}),
    upsert: (input) => call('aiPricing.upsert', input),
    delete: (id) => call('aiPricing.delete', { id }),
  },
  externalAgents: {
    list: () => call('externalAgents.list'),
    execute: (input) => call('externalAgents.execute', input),
    cancel: (runId) => call('externalAgents.cancel', { runId }),
  },
  projectAnalysis: {
    scan: (projectId) => call('project.scan', { projectId }),
    snapshot: (projectId) => call('project.snapshot.get', { projectId }),
    metrics: (projectId) => call('project.metrics', { projectId }),
    budget: (projectId) => call('project.budget.get', { projectId }),
    setBudget: (projectId, softLimit, currency = 'USD') => call('project.budget.set', { projectId, softLimit, currency }),
    qualityPolicy: (projectId) => call('project.qualityPolicy.get', { projectId }),
    setQualityPolicy: (projectId, policy) => call('project.qualityPolicy.set', { projectId, ...policy }),
  },
  plans: {
    generate: (projectId, goal, options = {}) => call('plan.generate', { projectId, goal, ...options }),
    list: (projectId) => call('plan.list', { projectId }),
    get: (planId) => call('plan.get', { planId }),
    update: (input) => call('plan.update', input),
    revise: (input) => call('plan.revise', input),
    approve: (planId) => call('plan.approve', { planId }),
    reject: (planId) => call('plan.reject', { planId }),
    discuss: (planId, content) => call('plan.discuss', { planId, content }),
    grant: {
      get: (planId) => call('plan.grant.get', { planId }),
      issue: (input) => call('plan.grant.issue', input),
      revoke: (input) => call('plan.grant.revoke', input),
    },
    replan: {
      propose: (input) => call('plan.replan.propose', input),
      list: (projectId, planId = null) => call('plan.replan.list', { projectId, planId }),
      get: (proposalId) => call('plan.replan.get', { proposalId }),
      apply: (proposalId) => call('plan.replan.apply', { proposalId }),
      reject: (proposalId, reason = '用户拒绝修订提案') => call('plan.replan.reject', { proposalId, reason }),
    },
  },
  agentDefinitions: {
    list: () => call('agentDefinition.list', {}),
    upsert: (input) => call('agentDefinition.upsert', input),
    setStatus: (id, status) => call('agentDefinition.setStatus', { id, status }),
    delete: (id) => call('agentDefinition.delete', { id }),
    export: (id) => call('agentDefinition.export', { id }),
    import: (json) => call('agentDefinition.import', { json }),
    preview: (id) => call('agentDefinition.preview', { id }),
    run: (input) => call('agentDefinition.run', input),
  },
  skills: {
    list: () => call('skill.list', {}),
    import: (input) => call('skill.import', input),
  },
  runtimeProfiles: {
    list: () => call('runtime.list', {}),
    upsert: (input) => call('runtime.upsert', input),
    delete: (id) => call('runtime.delete', { id }),
    detect: (profileId) => call('runtime.detect', profileId ? { profileId } : {}),
    install: (profileId) => call('runtime.install', { profileId }),
    registry: (force = false) => call('runtime.registry', { force }),
    acpHandshake: (profileId, cwd) => call('runtime.acpHandshake', { profileId, ...(cwd ? { cwd } : {}) }),
    acpAuthenticate: (profileId, methodId, cwd) => call('runtime.acpAuthenticate', { profileId, methodId, ...(cwd ? { cwd } : {}) }),
    importRegistry: (input) => call('runtime.importRegistry', input),
    cancel: (executionId) => call('runtime.cancel', { executionId }),
  },
  operations: {
    snapshot: (projectId) => call('operations.snapshot', { projectId }),
    runChecks: (projectId) => call('operations.runChecks', { projectId }),
    propose: (projectId, findingIds) => call('operations.propose', { projectId, findingIds }),
    reviewProposal: (proposalId, decision) => call('operations.reviewProposal', { proposalId, decision }),
    startRepair: (proposalId) => call('operations.startRepair', { proposalId }),
    setMode: (projectId, mode, repairAgentId) => call('operations.setMode', { projectId, mode, ...(repairAgentId === undefined ? {} : { repairAgentId }) }),
    getTrigger: (projectId) => call('operations.getTrigger', { projectId }),
    insights: (projectId, runAudit = false) => call('operations.insights', { projectId, runAudit }),
    risk: (proposalId) => call('operations.risk', { proposalId }),
    getGrant: (projectId) => call('operations.getGrant', { projectId }),
    grant: (projectId, hours = 24, maxRuns = 5) => call('operations.grant', { projectId, hours, maxRuns }),
    revokeGrant: (projectId) => call('operations.revokeGrant', { projectId }),
    setTrigger: (projectId, intervalMinutes, enabled) => call('operations.setTrigger', { projectId, intervalMinutes, enabled }),
  },
  orchestration: {
    start: (planId, concurrency = 2, maxRetries = 2, allowOverBudget = false, grantId = null, startRequestId = null) => call('orchestration.start', { planId, concurrency, maxRetries, allowOverBudget, grantId, startRequestId }),
    pause: (planId) => call('orchestration.pause', { planId }),
    resume: (planId) => call('orchestration.resume', { planId }),
    cancel: (planId) => call('orchestration.cancel', { planId }),
    reassign: (planId, taskId, agentId) => call('orchestration.reassign', { planId, taskId, agentId }),
    declineReassign: (planId, taskId, note = '') => call('orchestration.declineReassign', { planId, taskId, note }),
  },
  verification: {
    request: (projectId, taskId) => call('verification.request', { projectId, taskId }),
  },
  worktrees: {
    info: (planId) => call('worktree.info', { planId }),
    merge: (planId) => call('worktree.merge', { planId }),
    discard: (planId) => call('worktree.discard', { planId }),
  },
  graph: {
    snapshot: (projectId) => call('graph.snapshot.get', { projectId }),
    saveLayout: (projectId, positions) => call('graph.layout.save', { projectId, viewId: 'default', positions }),
  },
  settings: {
    get: () => call('settings.get'),
    update: (input) => call('settings.update', input),
    clearKey: () => call('settings.clearKey'),
    test: () => call('settings.test'),
  },
  runtime: {
    health: () => call('runtime.health'),
    status: () => call('app.runtimeStatus'),
    settings: {
      get: () => call('runtime.settings.get', {}),
      update: (input) => call('runtime.settings.update', input),
    },
    onEvent,
    onStatus,
  },
  system: {
    platform: process.platform,
    versions: {
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node ?? '',
    },
  },
  demo: {
    seed: (force) => call('demo.seed', { force: force ?? false }),
  },
}

contextBridge.exposeInMainWorld('projectos', api)

















