import { REQUIREMENT_STAGES, RequirementFlowGraphSchema, type RequirementStage, type RequirementFlowGraph, type RequirementFlowStep } from '@projectos/contracts'

export function createRequirementFlow(stages: RequirementStage[]): RequirementFlowGraph {
  const nodes = stages.map((stage, index) => ({
    id: `stage-${index + 1}`, stage, kind: REQUIREMENT_STAGES[stage].kind,
    title: REQUIREMENT_STAGES[stage].label, role: REQUIREMENT_STAGES[stage].role,
    instructions: '', inputs: [], outputs: [REQUIREMENT_STAGES[stage].output], optional: false as const,
  }))
  return RequirementFlowGraphSchema.parse({ nodes, edges: nodes.slice(1).map((node, index) => ({ id: `edge-${index + 1}`, source: nodes[index]!.id, target: node.id })) })
}

export const BUILTIN_REQUIREMENT_FLOWS = [
  { id: 'wft_standard', versionId: 'wfv_standard1', name: '标准研发流程', description: '需求分析与审核、技术设计与审核、开发和测试。', graph: createRequirementFlow(['requirement_analysis', 'requirement_review', 'technical_design', 'design_review', 'development', 'testing']) },
  { id: 'wft_focused', versionId: 'wfv_focused1', name: '轻量开发流程', description: '适合范围清楚的小需求，分析后直接开发与测试。', graph: createRequirementFlow(['requirement_analysis', 'development', 'testing']) },
  { id: 'wft_document', versionId: 'wfv_document1', name: '需求梳理流程', description: '产出需求文档并完成审核，可作为后续开发的输入。', graph: createRequirementFlow(['requirement_analysis', 'requirement_review']) },
] as const

/** Positions never participate in dependency or readiness decisions. */
export function readyRequirementFlowNodes(graph: RequirementFlowGraph, steps: Pick<RequirementFlowStep, 'nodeId' | 'status'>[]): string[] {
  const state = new Map(steps.map(step => [step.nodeId, step.status]))
  return graph.nodes.filter(node => {
    if (!['pending', 'ready'].includes(state.get(node.id) ?? '')) return false
    return graph.edges.filter(edge => edge.target === node.id).every(edge => state.get(edge.source) === 'completed')
  }).map(node => node.id)
}

export function downstreamRequirementFlowNodes(graph: RequirementFlowGraph, nodeId: string): Set<string> {
  const affected = new Set([nodeId]), pending = [nodeId]
  while (pending.length) {
    const source = pending.shift()!
    for (const edge of graph.edges.filter(edge => edge.source === source)) if (!affected.has(edge.target)) { affected.add(edge.target); pending.push(edge.target) }
  }
  return affected
}
