import type {
  Agent,
  AgentBackendBinding,
  AgentCapability,
  AIConnectionCheck,
  AIConnectionProfile,
  AIErrorCode,
  AIModel,
  AIModelCapabilities,
  AIModelPrice,
  AIModelSource,
  AIProviderId,
  AIProviderProtocol,
  AIBackendKind,
  GraphLayout,
  PlanDraft,
  ProjectSnapshot,
  Approval,
  Artifact,
  ArtifactKind,
  Decision,
  DecisionStatus,
  Handoff,
  HandoffStatus,
  InboxItem,
  KnowledgeEntry,
  Message,
  MessageRole,
  Milestone,
  MilestoneStatus,
  Project,
  ProjectEvent,
  ProjectStage,
  ProjectStatus,
  Requirement,
  RequirementStatus,
  Run,
  RunStatus,
  RunStep,
  RunStepKind,
  Session,
  SessionStatus,
  StageKey,
  StageStatus,
  Task,
  TaskStatus,
  ToolCall,
  ToolCallStatus,
  CrossSessionEnvelope,
} from '@projectos/contracts'

export interface ProjectRow {
  id: string
  name: string
  description: string
  root_path: string
  status: string
  current_stage: string
  version: number
  is_demo: number
  created_at: number
  updated_at: number
}

export interface AIConnectionRow {
  id: string
  name: string
  backend_kind: string
  provider_id: string
  protocol: string
  base_url: string
  default_model_id: string | null
  secret_ref: string | null
  enabled: number
  is_default: number
  timeout_ms: number
  temperature: number
  created_at: number
  updated_at: number
}

export interface AIModelRow {
  connection_id: string
  model_id: string
  display_name: string
  source: string
  capabilities_json: string
  context_window: number | null
  max_output_tokens: number | null
  verified_at: number | null
  created_at: number
  updated_at: number
}

export interface AIConnectionCheckRow {
  id: string
  connection_id: string
  stage: string
  status: string
  error_code: string | null
  message: string
  latency_ms: number
  checked_at: number
}

export interface AgentBackendBindingRow {
  id: string
  scope_type: string
  scope_id: string | null
  agent_role: string | null
  task_type: string | null
  connection_id: string | null
  model_id: string | null
  priority: number
  required_capabilities_json: string
  max_concurrency: number
  budget_limit: number | null
  failure_policy: string
  created_at: number
  updated_at: number
}

export interface AIUsageRow {
  id: string
  run_id: string
  connection_id: string | null
  model_id: string | null
  input_tokens: number | null
  output_tokens: number | null
  usage_source: string
  estimated_cost: number | null
  currency: string | null
  created_at: number
}

export interface AIModelPriceRow {
  id: string
  connection_id: string
  model_id: string
  input_per_million: number
  output_per_million: number
  currency: string
  version: string
  effective_at: number
  created_at: number
  updated_at: number
}

export interface HealthCheckRunRow {
  id: string
  project_id: string
  check_id: string
  source_revision: string | null
  status: string
  started_at: number
  finished_at: number | null
  result_json: string
}

export interface FindingRow {
  id: string
  project_id: string
  fingerprint: string
  category: string
  severity: string
  status: string
  title: string
  first_seen_at: number
  last_seen_at: number
  occurrence_count: number
}

export interface ProposalRow {
  id: string
  project_id: string
  status: string
  risk_level: string
  scope_json: string
  acceptance_json: string
  repair_plan_id: string | null
  created_at: number
  updated_at: number
}

export interface ProjectBudgetRow {
  project_id: string
  soft_limit: number
  currency: string
  updated_at: number
}

export interface ProjectSnapshotRow {
  id: string
  project_id: string
  git_head: string | null
  payload_json: string
  index_version: number
  scanned_at: number
}

export interface PlanRevisionRow {
  id: string
  project_id: string
  revision: number
  status: string
  goal: string
  plan_json: string
  approved_at: number | null
  created_at: number
  updated_at: number
}

export interface GraphLayoutRow {
  project_id: string
  view_id: string
  layout_json: string
  updated_at: number
}

export interface StageRow {
  project_id: string
  stage: string
  status: string
  position: number
  updated_at: number
}

export interface RequirementRow {
  id: string
  project_id: string
  title: string
  body: string
  status: string
  source: string
  acceptance_json: string
  version: number
  created_at: number
  updated_at: number
}

export interface MilestoneRow {
  id: string
  project_id: string
  title: string
  description: string
  due_at: number | null
  status: string
  created_at: number
  updated_at: number
}

export interface TaskRow {
  id: string
  project_id: string
  parent_id: string | null
  milestone_id: string | null
  title: string
  description: string
  status: string
  priority: number
  assignee_agent_id: string | null
  acceptance_json: string
  labels_json: string
  version: number
  due_at: number | null
  created_at: number
  updated_at: number
}

export interface AgentRow {
  id: string
  name: string
  role: string
  description: string
  kind: string
  driver_id: string
  capabilities_json: string
  accent: string
  system_prompt: string
  builtin: number
  created_at: number
}

export interface SessionRow {
  id: string
  project_id: string
  agent_id: string
  title: string
  status: string
  created_at: number
  updated_at: number
}

export interface MessageRow {
  id: string
  session_id: string
  seq: number
  role: string
  content: string
  run_id: string | null
  metadata_json: string
  created_at: number
}

export interface RunRow {
  id: string
  project_id: string
  task_id: string | null
  session_id: string
  agent_id: string
  attempt: number
  status: string
  error: string | null
  summary: string | null
  input_tokens: number
  output_tokens: number
  checkpoint_id: string | null
  started_at: number | null
  finished_at: number | null
  created_at: number
}

export interface RunStepRow {
  id: string
  run_id: string
  seq: number
  kind: string
  status: string
  title: string
  payload_json: string
  created_at: number
}

export interface ToolCallRow {
  id: string
  run_id: string
  tool_name: string
  idempotency_key: string
  status: string
  args_hash: string
  args_json: string
  result_json: string | null
  error: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
}

export interface ApprovalRow {
  id: string
  project_id: string
  run_id: string
  tool_call_id: string | null
  status: string
  title: string
  detail: string
  request_json: string
  decision: string | null
  requested_at: number
  decided_at: number | null
  expires_at: number | null
}

export interface ArtifactRow {
  id: string
  project_id: string
  task_id: string | null
  run_id: string | null
  kind: string
  title: string
  uri: string | null
  content_hash: string | null
  git_commit: string | null
  verified_at: number | null
  body: string | null
  is_demo: number
  created_at: number
}

export interface DecisionRow {
  id: string
  project_id: string
  title: string
  body: string
  status: string
  supersedes_id: string | null
  created_at: number
  updated_at: number
}

export interface KnowledgeRow {
  id: string
  project_id: string
  title: string
  body: string
  source_uri: string | null
  source_version: string | null
  status: string
  created_at: number
  updated_at: number
}

export interface EventRow {
  id: string
  project_id: string
  seq: number
  aggregate_id: string
  event_type: string
  payload_json: string
  created_at: number
}

export interface InboxRow {
  id: string
  project_id: string
  recipient_agent_id: string
  recipient_session_id: string
  message_id: string
  idempotency_key: string
  envelope_json: string
  status: string
  attempts: number
  error: string | null
  created_at: number
  delivered_at: number | null
  accepted_at: number | null
  completed_at: number | null
}

export interface HandoffRow {
  id: string
  project_id: string
  task_id: string
  from_agent_id: string
  from_session_id: string
  to_agent_id: string
  to_session_id: string | null
  status: string
  summary: string
  payload_json: string
  requested_at: number
  decided_at: number | null
}

export function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

export function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

export function parseUnknown(value: string | null): unknown {
  if (value === null) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

export function toProject(row: ProjectRow): Project {  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rootPath: row.root_path,
    status: row.status as ProjectStatus,
    currentStage: row.current_stage as StageKey,
    version: Number(row.version),
    isDemo: Boolean(row.is_demo),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toStage(row: StageRow): ProjectStage {
  return {
    projectId: row.project_id,
    stage: row.stage as StageKey,
    status: row.status as StageStatus,
    position: Number(row.position),
    updatedAt: Number(row.updated_at),
  }
}

export function toRequirement(row: RequirementRow): Requirement {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    status: row.status as RequirementStatus,
    source: row.source,
    acceptanceCriteria: parseStringArray(row.acceptance_json),
    version: Number(row.version),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toMilestone(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    dueAt: row.due_at === null ? null : Number(row.due_at),
    status: row.status as MilestoneStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    parentId: row.parent_id,
    milestoneId: row.milestone_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: Number(row.priority) as Task['priority'],
    assigneeAgentId: row.assignee_agent_id,
    acceptanceCriteria: parseStringArray(row.acceptance_json),
    labels: parseStringArray(row.labels_json),
    version: Number(row.version),
    dueAt: row.due_at === null ? null : Number(row.due_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    description: row.description,
    kind: row.kind as Agent['kind'],
    driverId: row.driver_id,
    capabilities: parseStringArray(row.capabilities_json) as AgentCapability[],
    accent: row.accent,
    systemPrompt: row.system_prompt,
    builtin: Boolean(row.builtin),
    createdAt: Number(row.created_at),
  }
}

export function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    title: row.title,
    status: row.status as SessionStatus,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: Number(row.seq),
    role: row.role as MessageRole,
    content: row.content,
    runId: row.run_id,
    metadata: parseObject(row.metadata_json),
    createdAt: Number(row.created_at),
  }
}

export function toRun(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    attempt: Number(row.attempt),
    status: row.status as RunStatus,
    error: row.error,
    summary: row.summary,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    checkpointId: row.checkpoint_id,
    startedAt: row.started_at === null ? null : Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    createdAt: Number(row.created_at),
  }
}

export function toRunStep(row: RunStepRow): RunStep {
  return {
    id: row.id,
    runId: row.run_id,
    seq: Number(row.seq),
    kind: row.kind as RunStepKind,
    status: row.status,
    title: row.title,
    payload: parseObject(row.payload_json),
    createdAt: Number(row.created_at),
  }
}

export function toToolCall(row: ToolCallRow): ToolCall {
  return {
    id: row.id,
    runId: row.run_id,
    toolName: row.tool_name,
    idempotencyKey: row.idempotency_key,
    status: row.status as ToolCallStatus,
    argsHash: row.args_hash,
    args: parseObject(row.args_json),
    result: parseUnknown(row.result_json),
    error: row.error,
    createdAt: Number(row.created_at),
    startedAt: row.started_at === null ? null : Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
  }
}

export function toApproval(row: ApprovalRow): Approval {
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    toolCallId: row.tool_call_id,
    status: row.status as Approval['status'],
    title: row.title,
    detail: row.detail,
    request: parseObject(row.request_json),
    decision: row.decision,
    requestedAt: Number(row.requested_at),
    decidedAt: row.decided_at === null ? null : Number(row.decided_at),
    expiresAt: row.expires_at === null ? null : Number(row.expires_at),
  }
}

export function toArtifact(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    runId: row.run_id,
    kind: row.kind as ArtifactKind,
    title: row.title,
    uri: row.uri,
    contentHash: row.content_hash,
    gitCommit: row.git_commit,
    verifiedAt: row.verified_at === null ? null : Number(row.verified_at),
    body: row.body,
    isDemo: Boolean(row.is_demo),
    createdAt: Number(row.created_at),
  }
}

export function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    status: row.status as DecisionStatus,
    supersedesId: row.supersedes_id,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toKnowledge(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    sourceUri: row.source_uri,
    sourceVersion: row.source_version,
    status: row.status as KnowledgeEntry['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toEvent(row: EventRow): ProjectEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    seq: Number(row.seq),
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: parseObject(row.payload_json),
    createdAt: Number(row.created_at),
  }
}

export function toInboxItem(row: InboxRow): InboxItem {
  return {
    id: row.id,
    projectId: row.project_id,
    recipientAgentId: row.recipient_agent_id,
    recipientSessionId: row.recipient_session_id,
    messageId: row.message_id,
    envelope: JSON.parse(row.envelope_json) as CrossSessionEnvelope,
    status: row.status as InboxItem['status'],
    attempts: Number(row.attempts),
    error: row.error,
    createdAt: Number(row.created_at),
    deliveredAt: row.delivered_at === null ? null : Number(row.delivered_at),
    acceptedAt: row.accepted_at === null ? null : Number(row.accepted_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at),
  }
}

export function toHandoff(row: HandoffRow): Handoff {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    fromAgentId: row.from_agent_id,
    fromSessionId: row.from_session_id,
    toAgentId: row.to_agent_id,
    toSessionId: row.to_session_id,
    status: row.status as HandoffStatus,
    summary: row.summary,
    payload: parseObject(row.payload_json),
    requestedAt: Number(row.requested_at),
    decidedAt: row.decided_at === null ? null : Number(row.decided_at),
  }
}

export function toAIConnection(row: AIConnectionRow): AIConnectionProfile {
  return {
    id: row.id,
    name: row.name,
    backendKind: row.backend_kind as AIBackendKind,
    providerId: row.provider_id as AIProviderId,
    protocol: row.protocol as AIProviderProtocol,
    baseUrl: row.base_url,
    defaultModelId: row.default_model_id,
    secretRef: row.secret_ref,
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    timeoutMs: Number(row.timeout_ms),
    temperature: Number(row.temperature),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toAIModel(row: AIModelRow): AIModel {
  const raw = parseObject(row.capabilities_json)
  const capabilities: AIModelCapabilities = {
    streaming: raw.streaming === 'yes' || raw.streaming === 'no' ? raw.streaming : 'unknown',
    toolCalling: raw.toolCalling === 'yes' || raw.toolCalling === 'no' ? raw.toolCalling : 'unknown',
    vision: raw.vision === 'yes' || raw.vision === 'no' ? raw.vision : 'unknown',
    reasoning: raw.reasoning === 'yes' || raw.reasoning === 'no' ? raw.reasoning : 'unknown',
  }
  return {
    connectionId: row.connection_id,
    modelId: row.model_id,
    displayName: row.display_name,
    source: row.source as AIModelSource,
    capabilities,
    contextWindow: row.context_window === null ? null : Number(row.context_window),
    maxOutputTokens: row.max_output_tokens === null ? null : Number(row.max_output_tokens),
    verifiedAt: row.verified_at === null ? null : Number(row.verified_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toAIConnectionCheck(row: AIConnectionCheckRow): AIConnectionCheck {
  return {
    id: row.id,
    connectionId: row.connection_id,
    stage: row.stage as AIConnectionCheck['stage'],
    status: row.status as AIConnectionCheck['status'],
    errorCode: row.error_code as AIErrorCode | null,
    message: row.message,
    latencyMs: Number(row.latency_ms),
    checkedAt: Number(row.checked_at),
  }
}

export function toAIModelPrice(row: AIModelPriceRow): AIModelPrice {
  return {
    id: row.id,
    connectionId: row.connection_id,
    modelId: row.model_id,
    inputPerMillion: Number(row.input_per_million),
    outputPerMillion: Number(row.output_per_million),
    currency: row.currency,
    version: row.version,
    effectiveAt: Number(row.effective_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toAgentBackendBinding(row: AgentBackendBindingRow): AgentBackendBinding {  return {
    id: row.id,
    scopeType: row.scope_type as AgentBackendBinding['scopeType'],
    scopeId: row.scope_id,
    agentRole: row.agent_role,
    taskType: row.task_type,
    connectionId: row.connection_id,
    modelId: row.model_id,
    priority: Number(row.priority),
    requiredCapabilities: (() => {
      try {
        const parsed = JSON.parse(row.required_capabilities_json) as unknown
        return Array.isArray(parsed) ? (parsed as AgentBackendBinding['requiredCapabilities']) : []
      } catch {
        return []
      }
    })(),
    maxConcurrency: Number(row.max_concurrency ?? 0),
    budgetLimit: row.budget_limit === null ? null : Number(row.budget_limit),
    failurePolicy: row.failure_policy === 'fail' ? 'fail' : 'fallback',
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

export function toProjectSnapshot(row: ProjectSnapshotRow): ProjectSnapshot {
  return JSON.parse(row.payload_json) as ProjectSnapshot
}

export function toPlanRevision(row: PlanRevisionRow): PlanDraft {
  return JSON.parse(row.plan_json) as PlanDraft
}

export function toGraphLayout(row: GraphLayoutRow): GraphLayout {
  const parsed = JSON.parse(row.layout_json) as { positions?: GraphLayout['positions'] }
  return {
    projectId: row.project_id,
    viewId: row.view_id,
    positions: parsed.positions ?? {},
    updatedAt: Number(row.updated_at),
  }
}


