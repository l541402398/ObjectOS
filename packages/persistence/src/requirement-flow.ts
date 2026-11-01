import { createHash } from 'node:crypto'
import { AppError, newId, now, RequirementFlowGraphSchema, RequirementFlowTemplateSchema, type Requirement, type Task } from '@projectos/contracts'
import { BUILTIN_REQUIREMENT_FLOWS } from '@projectos/domain'
import type { SqliteStore } from './store.js'

export type FlowSelection = { templateVersionId: string; assignmentMode: 'manual' | 'ai'; assignments: Record<string, string | null> }

export function seedRequirementFlows(store: SqliteStore): void {
  store.transaction(() => {
    for (const flow of BUILTIN_REQUIREMENT_FLOWS) {
      const timestamp = now(), graph = JSON.stringify(flow.graph)
      store.db.prepare('INSERT OR IGNORE INTO requirement_flow_templates(id,project_id,name,description,builtin,created_at) VALUES(?,NULL,?,?,1,?)')
        .run(flow.id, flow.name, flow.description, timestamp)
      store.db.prepare('INSERT OR IGNORE INTO requirement_flow_versions(id,template_id,version,graph_json,layout_json,checksum,created_at) VALUES(?,?,1,?,?,?,?)')
        .run(flow.versionId, flow.id, graph, '{}', createHash('sha256').update(graph).digest('hex'), timestamp)
    }
  })
}

export function readRequirementFlowTemplate(store: SqliteStore, versionId: string) {
  const row = store.db.prepare(`SELECT t.id,v.id AS versionId,t.project_id AS projectId,t.name,t.description,
    v.version,t.builtin,v.graph_json,v.layout_json,v.checksum,v.created_at AS createdAt
    FROM requirement_flow_versions v JOIN requirement_flow_templates t ON t.id=v.template_id WHERE v.id=?`).get(versionId)
  if (!row) throw new AppError('NOT_FOUND', '流程模板版本不存在')
  return RequirementFlowTemplateSchema.parse({ ...row, builtin: Boolean(row.builtin), graph: JSON.parse(String(row.graph_json)), layout: JSON.parse(String(row.layout_json)) })
}

export function initializeRequirementFlow(store: SqliteStore, requirement: Requirement, selection: FlowSelection): void {
  const template = readRequirementFlowTemplate(store, selection.templateVersionId)
  if (template.projectId && template.projectId !== requirement.projectId) throw new AppError('CONFLICT', '不能使用其他项目的流程')
  const nodes = new Set(template.graph.nodes.map(node => node.id))
  for (const [nodeId, agentId] of Object.entries(selection.assignments)) {
    if (!nodes.has(nodeId)) throw new AppError('BAD_REQUEST', '分配包含不存在的流程节点')
    if (agentId && (!store.read.getAgent(agentId) || !store.read.isAgentVisibleToProject(requirement.projectId, agentId)))
      throw new AppError('BAD_REQUEST', '分配的 Agent 在此项目不可用')
  }
  store.db.prepare(`INSERT INTO requirement_flow_bindings(requirement_id,template_version_id,assignment_mode,assignments_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?)`).run(requirement.id, template.versionId, selection.assignmentMode, JSON.stringify(selection.assignments), now(), now())
}

/** Called inside task creation's transaction, including AI/plan-created tasks. */
export function initializeTaskFlow(store: SqliteStore, task: Task): void {
  if (!task.requirementId) return
  const binding = store.db.prepare(`SELECT b.template_version_id,b.assignments_json,v.graph_json FROM requirement_flow_bindings b
    JOIN requirement_flow_versions v ON v.id=b.template_version_id WHERE requirement_id=?`).get(task.requirementId)
  if (!binding) return // Existing requirements are explicitly bound when opened; no silent retroactive workflow.
  const graph = RequirementFlowGraphSchema.parse(JSON.parse(String(binding.graph_json)))
  const assignments = JSON.parse(String(binding.assignments_json)) as Record<string, string | null>
  const timestamp = now()
  store.db.prepare(`INSERT INTO task_flow_instances(task_id,requirement_id,template_version_id,status,created_at,updated_at) VALUES(?,?,?,'idle',?,?)`)
    .run(task.id, task.requirementId, String(binding.template_version_id), timestamp, timestamp)
  const insert = store.db.prepare(`INSERT INTO task_flow_steps(id,task_id,node_id,stage,title,agent_id,assignment_source,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'pending',?,?)`)
  for (const node of graph.nodes) {
    const agentId = assignments[node.id] ?? null
    // A default owner that is no longer usable is left unassigned instead of being silently kept.
    const usable = agentId && store.read.getAgent(agentId) && store.read.isAgentVisibleToProject(task.projectId, agentId) ? agentId : null
    insert.run(newId('wfs'), task.id, node.id, node.stage, node.title, usable, usable ? 'default' : null, timestamp, timestamp)
  }
}
