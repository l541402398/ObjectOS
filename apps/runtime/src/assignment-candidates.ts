import type { AgentView, TaskCard } from '@projectos/contracts'
import { BUILTIN_SKILLS } from '@projectos/skills'
import type { AssignmentCandidate, AssignmentSkill } from '@projectos/planning'
import type { SqliteStore } from '@projectos/persistence'

/**
 * Shared assignment-candidate snapshot.
 *
 * Used by the Planner (initial assignment) and by the Scheduler when it has to
 * propose a replacement for a Handoff receiver that failed to start. Keeping one
 * implementation means "legit candidate" has exactly one definition:
 * project visibility, active status, skills, Runtime availability and load.
 */
export function buildAssignmentCandidates(input: {
  store: SqliteStore
  projectId: string
  listAgents: (projectId: string) => AgentView[]
  listTasks: (projectId: string) => TaskCard[]
}): AssignmentCandidate[] {
  const { store, projectId } = input
  const views = input.listAgents(projectId)
  const profiles = store.read.listRuntimeProfiles()
  const storedById = new Map(store.read.listSkills().map((skill) => [skill.id, skill]))
  const builtinById = new Map(BUILTIN_SKILLS.map((skill) => [skill.id, skill]))
  const activeByAgent = new Map<string, number>()
  for (const run of store.read.listRunSummaries(projectId, 1000)) {
    if (
      ['created', 'queued', 'running', 'waiting_tool', 'waiting_approval', 'verifying', 'needs_reconciliation'].includes(
        run.status,
      )
    ) {
      activeByAgent.set(run.agentId, (activeByAgent.get(run.agentId) ?? 0) + 1)
    }
  }
  for (const task of input.listTasks(projectId)) {
    if (task.status !== 'running' || !task.assigneeAgentId) continue
    activeByAgent.set(task.assigneeAgentId, (activeByAgent.get(task.assigneeAgentId) ?? 0) + 1)
  }

  return views.map((view) => {
    const agent = view.agent
    const definition = store.read.getAgentDefinition(agent.id)
    const skills: AssignmentSkill[] = []
    const missingSkillIds: string[] = []
    for (const binding of definition?.skills ?? []) {
      if (!binding.enabled) continue
      const stored = storedById.get(binding.skillId)
      if (stored) {
        skills.push({ id: stored.id, name: stored.name, description: stored.description, capabilities: [] })
        continue
      }
      const builtin = builtinById.get(binding.skillId)
      if (builtin) {
        skills.push({
          id: builtin.id,
          name: builtin.name,
          description: builtin.description,
          capabilities: builtin.capabilities,
        })
        continue
      }
      missingSkillIds.push(binding.skillId)
    }
    const profileId = definition?.primaryRuntimeProfileId ?? definition?.runtimeProfileIds[0] ?? null
    const profile = profileId ? profiles.find((item) => item.id === profileId) ?? null : null
    const runtime = profileId
      ? { id: profileId, name: profile?.name ?? profileId, status: profile?.status ?? 'unavailable' }
      : null
    return {
      agentId: agent.id,
      name: agent.name,
      role: agent.role,
      category: definition?.category ?? 'general',
      capabilities: agent.capabilities,
      status: definition?.status ?? 'active',
      visibleToProject: store.read.isAgentVisibleToProject(projectId, agent.id),
      skills,
      missingSkillIds,
      runtime,
      activeTaskCount: activeByAgent.get(agent.id) ?? 0,
    }
  })
}
