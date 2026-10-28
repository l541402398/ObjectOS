import type { PlanDraft, PlannedTask } from '@projectos/contracts'
import {
  detectContractDowngrade,
  preflightTaskContract,
  type TaskContractAgent,
  type TaskContractGap,
} from '@projectos/application'
import { toolCatalogForAgent } from '@projectos/tools'
import type { SqliteStore } from '@projectos/persistence'

/**
 * ADR-0026 — real facts for the task-contract preflight.
 *
 * The pure rule lives in `@projectos/application`; this adapter supplies what the system really
 * knows: project-visible Agents, their enabled state, the AgentDefinition permissions that
 * decide the tool list, and the remaining grant budget. It is used by the scheduler before it
 * starts a Run, and by the autonomous replan path before it applies a revision.
 */

export interface TaskContractReport {
  planId: string
  ok: boolean
  tasks: Array<{ key: string; title: string; agentId: string | null; gaps: TaskContractGap[] }>
  /** Plan-level gaps that are not attributable to a single task. */
  planGaps: TaskContractGap[]
}

export interface GrantBudgetView {
  maxRuns: number
  usedRuns: number
  maxToolCalls: number
  usedToolCalls: number
  allowedAgentIds: string[]
}

export class TaskContractPreflightService {
  constructor(private readonly store: SqliteStore) {}

  /** Tools a real Run of this Agent would get, mirroring the runner's own filter. */
  availableTools(agentId: string, capabilities: TaskContractAgent['capabilities']): string[] {
    const definition = this.store.read.getAgentDefinition(agentId)
    const permissions = definition?.permissions ?? { tools: [], files: true, shell: true, network: true }
    return toolCatalogForAgent(capabilities)
      .map((tool) => tool.name)
      .filter((name) => {
        if (name === 'write_file') return permissions.files
        if (name === 'run_command' || name === 'run_tests') return permissions.shell
        return true
      })
  }

  agentsFor(projectId: string): TaskContractAgent[] {
    return this.store.read
      .listAgents()
      .filter((agent) => this.store.read.isAgentVisibleToProject(projectId, agent.id))
      .map((agent) => {
        const definition = this.store.read.getAgentDefinition(agent.id)
        return {
          id: agent.id,
          name: agent.name,
          capabilities: agent.capabilities,
          enabled: definition ? definition.status === 'active' : true,
          visibleInProject: true,
        }
      })
  }

  /** Preflights a whole plan revision: every planned task plus the dependency graph. */
  preflightPlan(plan: PlanDraft, tasks: PlannedTask[] = plan.tasks, grant: GrantBudgetView | null = null): TaskContractReport {
    const agents = this.agentsFor(plan.projectId)
    const knownKeys = tasks.map((task) => task.key)
    const graph = tasks.map((task) => ({ key: task.key, dependsOn: task.dependsOn }))
    const reports = tasks.map((task) => {
      const available = task.agentId ? this.availableTools(task.agentId, agents.find((a) => a.id === task.agentId)?.capabilities ?? []) : null
      const result = preflightTaskContract({
        task: {
          key: task.key,
          title: task.title,
          role: task.role,
          agentId: task.agentId ?? null,
          workType: (task as { workType?: string | null }).workType ?? null,
          expectedArtifacts: task.expectedArtifacts,
          acceptanceCriteria: task.acceptanceCriteria,
          requiredCapabilities: task.requiredCapabilities,
          hardCapabilities: task.hardCapabilities,
          dependsOn: task.dependsOn,
        },
        agents,
        availableTools: available,
        knownKeys,
        graph,
        grant,
      })
      return { key: task.key, title: task.title, agentId: task.agentId ?? null, gaps: result.gaps }
    })
    return {
      planId: plan.id,
      ok: reports.every((report) => report.gaps.length === 0),
      tasks: reports,
      planGaps: [],
    }
  }

  /** Preflights one already-created task card (scheduler path). */
  preflightTaskCard(input: {
    projectId: string
    taskId: string
    title: string
    role: string
    agentId: string | null
    workType?: string | null
    expectedArtifacts: string[]
    acceptanceCriteria: string[]
    dependsOnKeys?: string[]
    grant: GrantBudgetView | null
  }): TaskContractGap[] {
    const agents = this.agentsFor(input.projectId)
    const capabilities = agents.find((agent) => agent.id === input.agentId)?.capabilities ?? []
    return preflightTaskContract({
      task: {
        title: input.title,
        role: input.role,
        agentId: input.agentId,
        workType: input.workType ?? null,
        expectedArtifacts: input.expectedArtifacts,
        acceptanceCriteria: input.acceptanceCriteria,
        dependsOn: input.dependsOnKeys ?? [],
      },
      agents,
      availableTools: input.agentId ? this.availableTools(input.agentId, capabilities) : null,
      knownKeys: null,
      graph: null,
      grant: input.grant,
    }).gaps
  }

  /** Escalation notes when a replan removes the verification work of the previous revision. */
  downgradeNotes(plan: PlanDraft, nextTasks: PlannedTask[]): string[] {
    return detectContractDowngrade({
      before: plan.tasks.map((task) => ({
        key: task.key,
        title: task.title,
        role: task.role,
        expectedArtifacts: task.expectedArtifacts,
        workType: (task as { workType?: string | null }).workType ?? null,
      })),
      after: nextTasks.map((task) => ({
        key: task.key,
        title: task.title,
        role: task.role,
        expectedArtifacts: task.expectedArtifacts,
        workType: (task as { workType?: string | null }).workType ?? null,
      })),
    })
  }
}

/** Human-readable one-liner for events/logs. */
export function describeGaps(gaps: TaskContractGap[]): string {
  return gaps.map((gap) => `${gap.field}: ${gap.message}`).join('；')
}

