import { z } from 'zod'

export const PROJECT_STATUSES = ['active', 'paused', 'completed', 'archived'] as const
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES)
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>

export const STAGE_KEYS = [
  'ideation',
  'requirements',
  'architecture',
  'planning',
  'implementation',
  'testing',
  'release',
  'maintenance',
] as const
export const StageKeySchema = z.enum(STAGE_KEYS)
export type StageKey = z.infer<typeof StageKeySchema>

export const STAGE_LABELS: Record<StageKey, string> = {
  ideation: '构思',
  requirements: '需求',
  architecture: '架构',
  planning: '规划',
  implementation: '实现',
  testing: '测试',
  release: '发布',
  maintenance: '维护',
}

export const STAGE_STATUSES = ['pending', 'active', 'completed', 'skipped'] as const
export const StageStatusSchema = z.enum(STAGE_STATUSES)
export type StageStatus = z.infer<typeof StageStatusSchema>

export const TASK_STATUSES = [
  'backlog',
  'ready',
  'running',
  'review',
  'done',
  'blocked',
  'cancelled',
] as const
export const TaskStatusSchema = z.enum(TASK_STATUSES)
export type TaskStatus = z.infer<typeof TaskStatusSchema>

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: '待规划',
  ready: '就绪',
  running: '进行中',
  review: '待审查',
  done: '已完成',
  blocked: '受阻',
  cancelled: '已取消',
}

export const TASK_COLUMNS = ['backlog', 'ready', 'running', 'review', 'done'] as const
export const PrioritySchema = z.number().int().min(1).max(4)
export type Priority = z.infer<typeof PrioritySchema>

export const PRIORITY_LABELS: Record<Priority, string> = {
  1: '紧急',
  2: '高',
  3: '中',
  4: '低',
}

export const RUN_STATUSES = [
  'created',
  'queued',
  'running',
  'waiting_tool',
  'waiting_approval',
  'verifying',
  'completed',
  'failed',
  'cancelled',
  'suspended',
  'needs_reconciliation',
] as const
export const RunStatusSchema = z.enum(RUN_STATUSES)
export type RunStatus = z.infer<typeof RunStatusSchema>

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'failed',
  'cancelled',
]

export const SESSION_STATUSES = ['active', 'idle', 'archived'] as const
export const SessionStatusSchema = z.enum(SESSION_STATUSES)
export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const MESSAGE_ROLES = ['system', 'user', 'assistant', 'tool'] as const
export const MessageRoleSchema = z.enum(MESSAGE_ROLES)
export type MessageRole = z.infer<typeof MessageRoleSchema>

export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'expired',
  'cancelled',
] as const
export const ApprovalStatusSchema = z.enum(APPROVAL_STATUSES)
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>

export const HANDOFF_STATUSES = [
  'requested',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const
export const HandoffStatusSchema = z.enum(HANDOFF_STATUSES)
export type HandoffStatus = z.infer<typeof HandoffStatusSchema>

export const REQUIREMENT_STATUSES = [
  'draft',
  'review',
  'approved',
  'implemented',
  'cancelled',
] as const
export const RequirementStatusSchema = z.enum(REQUIREMENT_STATUSES)
export type RequirementStatus = z.infer<typeof RequirementStatusSchema>

export const MILESTONE_STATUSES = ['planned', 'active', 'completed', 'cancelled'] as const
export const MilestoneStatusSchema = z.enum(MILESTONE_STATUSES)
export type MilestoneStatus = z.infer<typeof MilestoneStatusSchema>

export const DECISION_STATUSES = ['proposed', 'accepted', 'superseded', 'rejected'] as const
export const DecisionStatusSchema = z.enum(DECISION_STATUSES)
export type DecisionStatus = z.infer<typeof DecisionStatusSchema>

export const ARTIFACT_KINDS = [
  'document',
  'code',
  'test-report',
  'diff',
  'design',
  'release-note',
  'other',
] as const
export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS)
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>

export const AGENT_CAPABILITIES = [
  'plan',
  'analyze',
  'architect',
  'implement',
  'review',
  'test',
  'research',
  'coordinate',
] as const
export const AgentCapabilitySchema = z.enum(AGENT_CAPABILITIES)
export type AgentCapability = z.infer<typeof AgentCapabilitySchema>

export const TOOL_CALL_STATUSES = [
  'proposed',
  'waiting_approval',
  'approved',
  'running',
  'completed',
  'failed',
  'denied',
  'needs_reconciliation',
] as const
export const ToolCallStatusSchema = z.enum(TOOL_CALL_STATUSES)
export type ToolCallStatus = z.infer<typeof ToolCallStatusSchema>

export const RUN_STEP_KINDS = [
  'status',
  'context',
  'text',
  'tool_request',
  'tool_result',
  'approval',
  'checkpoint',
  'usage',
  'error',
] as const
export const RunStepKindSchema = z.enum(RUN_STEP_KINDS)
export type RunStepKind = z.infer<typeof RunStepKindSchema>

export const DELIVERY_STATUSES = [
  'stored',
  'delivered',
  'accepted',
  'completed',
  'failed',
  'unknown',
] as const
export const DeliveryStatusSchema = z.enum(DELIVERY_STATUSES)
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>

export const CROSS_SESSION_TYPES = [
  'agent.message',
  'task.delegate',
  'task.accept',
  'task.result',
  'task.reject',
  'handoff.request',
  'handoff.accept',
  'agent.wake',
  'approval.request',
] as const
export const CrossSessionTypeSchema = z.enum(CROSS_SESSION_TYPES)
export type CrossSessionType = z.infer<typeof CrossSessionTypeSchema>

export const WORKFLOW_STAGE_GUARDS: Record<StageKey, { requires: StageKey[]; label: string }> = {
  ideation: { requires: [], label: '问题陈述与目标' },
  requirements: { requires: ['ideation'], label: '至少一条已批准需求' },
  architecture: { requires: ['requirements'], label: '至少一条已接受 ADR' },
  planning: { requires: ['architecture'], label: '至少一个里程碑' },
  implementation: { requires: ['planning'], label: '存在就绪任务' },
  testing: { requires: ['implementation'], label: '存在待审查或已完成任务' },
  release: { requires: ['testing'], label: '存在已验证交付物' },
  maintenance: { requires: ['release'], label: '项目已发布' },
}
