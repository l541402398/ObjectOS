import { z } from 'zod'
import { WorkflowGraphSchema } from '@projectos/organization-contracts'
import { IdSchema, TimestampSchema } from './common.js'

export const RequirementStageSchema = z.enum([
  'requirement_analysis', 'requirement_review', 'technical_design', 'design_review',
  'development', 'testing', 'code_review', 'knowledge_update',
])
export type RequirementStage = z.infer<typeof RequirementStageSchema>

export const REQUIREMENT_STAGES = {
  requirement_analysis: { label: '需求分析', kind: 'agent_task', role: 'product', output: '需求文档' },
  requirement_review: { label: '需求审核', kind: 'document_gate', role: 'reviewer', output: '需求审核结论' },
  technical_design: { label: '技术设计', kind: 'agent_task', role: 'architect', output: '技术设计文档' },
  design_review: { label: '技术设计审核', kind: 'document_gate', role: 'reviewer', output: '技术设计审核结论' },
  development: { label: '开发', kind: 'agent_task', role: 'engineer', output: '开发成果说明' },
  testing: { label: '测试', kind: 'test_gate', role: 'qa', output: '实际测试报告' },
  code_review: { label: '代码审查', kind: 'review_gate', role: 'reviewer', output: '代码审查结论' },
  knowledge_update: { label: '知识更新', kind: 'knowledge_publish', role: 'product', output: '知识更新文档' },
} as const

export const RequirementFlowNodeSchema = WorkflowGraphSchema.shape.nodes.element.extend({
  stage: RequirementStageSchema,
  instructions: z.string().max(8000).default(''),
  inputs: z.array(z.string().max(200)).max(32).default([]),
  outputs: z.array(z.string().max(200)).max(32).default([]),
  optional: z.literal(false).default(false),
})
export type RequirementFlowNode = z.infer<typeof RequirementFlowNodeSchema>

export const RequirementFlowGraphSchema = WorkflowGraphSchema.extend({
  nodes: z.array(RequirementFlowNodeSchema).min(1).max(64),
  edges: WorkflowGraphSchema.shape.edges.max(128),
}).superRefine((graph, context) => {
  const ids = new Set(graph.nodes.map(node => node.id))
  if (ids.size !== graph.nodes.length) context.addIssue({ code: 'custom', message: '流程节点标识不能重复' })
  if (new Set(graph.edges.map(edge => edge.id)).size !== graph.edges.length) context.addIssue({ code: 'custom', message: '流程连线标识不能重复' })
  const outgoing = new Map<string, string[]>()
  const degrees = new Map(graph.nodes.map(node => [node.id, 0]))
  const links = new Set<string>()
  for (const node of graph.nodes) if (node.kind !== REQUIREMENT_STAGES[node.stage].kind) context.addIssue({ code: 'custom', message: `节点「${node.title}」的类型与执行阶段不一致` })
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) {
      context.addIssue({ code: 'custom', message: '连线必须连接两个不同的现有节点' }); continue
    }
    const key = JSON.stringify([edge.source, edge.target])
    if (links.has(key)) context.addIssue({ code: 'custom', message: '节点之间不能重复连线' })
    links.add(key)
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target])
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
  }
  const ready = [...degrees].filter(([, degree]) => degree === 0).map(([id]) => id)
  let visited = 0
  while (ready.length) {
    const id = ready.shift()!; visited++
    for (const target of outgoing.get(id) ?? []) {
      const degree = degrees.get(target)! - 1; degrees.set(target, degree)
      if (degree === 0) ready.push(target)
    }
  }
  if (visited !== ids.size) context.addIssue({ code: 'custom', message: '流程不能形成循环依赖' })
})
export type RequirementFlowGraph = z.infer<typeof RequirementFlowGraphSchema>

export const RequirementFlowLayoutSchema = z.record(z.string(), z.object({
  x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000),
})).default({})

export const RequirementFlowTemplateSchema = z.object({
  id: IdSchema, versionId: IdSchema, projectId: IdSchema.nullable(), name: z.string().min(1).max(120),
  description: z.string().max(2000), version: z.number().int().positive(), builtin: z.boolean(),
  graph: RequirementFlowGraphSchema, layout: RequirementFlowLayoutSchema, checksum: z.string(), createdAt: TimestampSchema,
})
export type RequirementFlowTemplate = z.infer<typeof RequirementFlowTemplateSchema>

export const RequirementFlowBindingSchema = z.object({
  requirementId: IdSchema, templateVersionId: IdSchema, templateName: z.string(), graph: RequirementFlowGraphSchema,
  assignmentMode: z.enum(['manual', 'ai']), assignments: z.record(z.string(), IdSchema.nullable()),
  version: z.number().int().nonnegative(), lockedAt: TimestampSchema.nullable(), createdAt: TimestampSchema,
})
export type RequirementFlowBinding = z.infer<typeof RequirementFlowBindingSchema>

export const FlowAssignmentSourceSchema = z.enum(['default', 'manual', 'ai'])
export type FlowAssignmentSource = z.infer<typeof FlowAssignmentSourceSchema>

export const RequirementFlowStepSchema = z.object({
  id: IdSchema, taskId: IdSchema, nodeId: RequirementFlowNodeSchema.shape.id, stage: RequirementStageSchema, title: z.string(),
  agentId: IdSchema.nullable(), agentName: z.string().nullable(), assignmentSource: FlowAssignmentSourceSchema.nullable().default(null),
  status: z.enum(['pending', 'ready', 'starting', 'running', 'waiting_approval', 'completed', 'failed', 'needs_reconciliation']),
  stale: z.boolean().default(false), staleReason: z.string().nullable().default(null),
  version: z.number().int().nonnegative(), attempt: z.number().int().nonnegative(), runId: IdSchema.nullable(),
  artifactIds: z.array(IdSchema), error: z.string().nullable(),
})
export type RequirementFlowStep = z.infer<typeof RequirementFlowStepSchema>

export const TaskFlowSchema = z.object({
  taskId: IdSchema, requirementId: IdSchema, templateVersionId: IdSchema,
  status: z.enum(['idle', 'running', 'paused', 'blocked', 'completed']),
  version: z.number().int().nonnegative(), steps: z.array(RequirementFlowStepSchema), error: z.string().nullable(),
  pendingApprovalId: IdSchema.nullable(), workspaceReady: z.boolean(),
})
export type TaskFlow = z.infer<typeof TaskFlowSchema>

export const RequirementMaterialStatusSchema = z.enum(['draft', 'current', 'superseded', 'rejected', 'stale'])
export type RequirementMaterialStatus = z.infer<typeof RequirementMaterialStatusSchema>

export const RequirementMaterialReviewVerdictSchema = z.enum(['approved', 'rejected', 'pending', 'stale'])
export type RequirementMaterialReviewVerdict = z.infer<typeof RequirementMaterialReviewVerdictSchema>

export const RequirementMaterialSchema = z.object({
  artifactId: IdSchema, requirementId: IdSchema, requirementTitle: z.string().default(''),
  taskId: IdSchema.nullable(), taskTitle: z.string().nullable().default(null),
  stepId: IdSchema.nullable(), nodeId: z.string().nullable().default(null), stepTitle: z.string().nullable().default(null),
  stage: RequirementStageSchema.nullable(), title: z.string(),
  agentId: IdSchema.nullable().default(null), agentName: z.string().nullable(), runId: IdSchema.nullable().default(null),
  attempt: z.number().int().nonnegative(), status: RequirementMaterialStatusSchema,
  statusReason: z.string().nullable().default(null),
  reviewVerdict: RequirementMaterialReviewVerdictSchema.nullable().default(null),
  reviewNote: z.string().nullable().default(null),
  reviewedByAgentName: z.string().nullable().default(null),
  reviewedAt: TimestampSchema.nullable().default(null),
  createdAt: TimestampSchema,
})
export type RequirementMaterial = z.infer<typeof RequirementMaterialSchema>

export const FlowStartOutcomeSchema = z.enum([
  'started', 'running', 'waiting_approval', 'waiting_dependency', 'waiting_workspace', 'needs_assignment', 'invalid_agent',
  'needs_attention', 'paused', 'completed', 'finished', 'failed', 'scope_changed', 'revoked', 'queued',
])
export type FlowStartOutcome = z.infer<typeof FlowStartOutcomeSchema>

export const FlowStartItemSchema = z.object({
  taskId: IdSchema, title: z.string(), status: z.enum(['waiting', 'started', 'skipped', 'cancelled']),
  outcome: FlowStartOutcomeSchema, reason: z.string().nullable(),
})
export type FlowStartItem = z.infer<typeof FlowStartItemSchema>

export const FlowStartIntentSchema = z.object({
  id: IdSchema, requirementId: IdSchema, status: z.enum(['active', 'completed', 'revoked']), revokedReason: z.string().nullable(),
  bindingVersion: z.number().int().nonnegative(), createdAt: TimestampSchema, updatedAt: TimestampSchema, items: z.array(FlowStartItemSchema),
})
export type FlowStartIntent = z.infer<typeof FlowStartIntentSchema>

export const RequirementFlowViewSchema = z.object({
  binding: RequirementFlowBindingSchema.nullable(), tasks: z.array(TaskFlowSchema), materials: z.array(RequirementMaterialSchema),
  startIntent: FlowStartIntentSchema.nullable().default(null),
})
export type RequirementFlowView = z.infer<typeof RequirementFlowViewSchema>

export const FlowAssignmentActionSchema = z.enum(['fill', 'replaceable', 'unchanged', 'locked', 'no_default'])
export type FlowAssignmentAction = z.infer<typeof FlowAssignmentActionSchema>

export const FlowAssignmentPreviewSchema = z.object({
  requirementId: IdSchema, bindingVersion: z.number().int().nonnegative(), token: z.string(),
  items: z.array(z.object({
    stepId: IdSchema, taskId: IdSchema, taskTitle: z.string(), nodeId: z.string(), title: z.string(),
    currentAgentId: IdSchema.nullable(), currentAgentName: z.string().nullable(), source: FlowAssignmentSourceSchema.nullable(),
    defaultAgentId: IdSchema.nullable(), defaultAgentName: z.string().nullable(), action: FlowAssignmentActionSchema,
  })),
})
export type FlowAssignmentPreview = z.infer<typeof FlowAssignmentPreviewSchema>

const AssignmentMapSchema = z.record(z.string().max(200), IdSchema.nullable())

export const RequirementFlowApiSchemas = {
  'workflow.materials': { input: z.object({ projectId: IdSchema, agentId: IdSchema }), output: z.object({ materials: z.array(RequirementMaterialSchema) }) },
  'workflow.templates': { input: z.object({ projectId: IdSchema }), output: z.object({ templates: z.array(RequirementFlowTemplateSchema) }) },
  'workflow.save': { input: z.object({ projectId: IdSchema, templateId: IdSchema.optional(), expectedVersion: z.number().int().positive().optional(), name: z.string().trim().min(1).max(120), description: z.string().max(2000).default(''), graph: RequirementFlowGraphSchema, layout: RequirementFlowLayoutSchema }), output: RequirementFlowTemplateSchema },
  'requirement.flow': { input: z.object({ requirementId: IdSchema }), output: RequirementFlowViewSchema },
  'requirement.flow.bind': { input: z.object({ requirementId: IdSchema, templateVersionId: IdSchema, expectedRequirementVersion: z.number().int().nonnegative(), assignmentMode: z.enum(['manual', 'ai']), assignments: z.record(z.string(), IdSchema.nullable()).default({}) }), output: RequirementFlowViewSchema },
  'requirement.flow.assign': { input: z.object({ stepId: IdSchema, expectedVersion: z.number().int().nonnegative(), agentId: IdSchema }), output: TaskFlowSchema },
  'requirement.flow.assignAI': { input: z.object({ requirementId: IdSchema }), output: RequirementFlowViewSchema },
  'requirement.flow.start': { input: z.object({ taskId: IdSchema }), output: TaskFlowSchema },
  'requirement.flow.pause': { input: z.object({ taskId: IdSchema }), output: TaskFlowSchema },
  'requirement.flow.reconcile': { input: z.object({ stepId: IdSchema, expectedVersion: z.number().int().nonnegative() }), output: TaskFlowSchema },
  'requirement.flow.retry': { input: z.object({ stepId: IdSchema, expectedVersion: z.number().int().nonnegative() }), output: TaskFlowSchema },
  'requirement.flow.defaults': { input: z.object({ requirementId: IdSchema, expectedBindingVersion: z.number().int().nonnegative(), assignments: AssignmentMapSchema }), output: RequirementFlowViewSchema },
  'requirement.flow.assignment.preview': { input: z.object({ requirementId: IdSchema }), output: FlowAssignmentPreviewSchema },
  'requirement.flow.assignment.apply': { input: z.object({ requirementId: IdSchema, expectedBindingVersion: z.number().int().nonnegative(), token: z.string().min(1).max(200), replaceStepIds: z.array(IdSchema).max(2048).default([]) }), output: z.object({ view: RequirementFlowViewSchema, filled: z.number().int().nonnegative(), replaced: z.number().int().nonnegative() }) },
  'requirement.flow.startAll': { input: z.object({ requirementId: IdSchema, expectedBindingVersion: z.number().int().nonnegative(), requestKey: z.string().regex(/^[\w-]{8,80}$/), taskIds: z.array(IdSchema).min(1).max(500).optional() }), output: z.object({ intent: FlowStartIntentSchema, replayed: z.boolean() }) },
  'requirement.flow.stopAll': { input: z.object({ requirementId: IdSchema, reason: z.string().trim().max(500).default('已停止自动推进') }), output: RequirementFlowViewSchema },
} as const
