import { useQuery } from '@tanstack/react-query'

export const qk = {
  bootstrap: ['bootstrap'] as const,
  overview: (projectId: string) => ['overview', projectId] as const,
  board: (projectId: string) => ['board', projectId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  sessions: (projectId: string) => ['sessions', projectId] as const,
  session: (sessionId: string) => ['session', sessionId] as const,
  runs: (projectId: string) => ['runs', projectId] as const,
  run: (runId: string) => ['run', runId] as const,
  collaboration: (projectId: string) => ['collaboration', projectId] as const,
  approvals: (projectId: string | null) => ['approvals', projectId ?? 'all'] as const,
  events: (projectId: string) => ['events', projectId] as const,
  workspace: (projectId: string) => ['workspace', projectId] as const,
  file: (projectId: string, path: string) => ['file', projectId, path] as const,
  diff: (projectId: string, path: string | null) => ['diff', projectId, path ?? 'all'] as const,
  knowledge: (projectId: string) => ['knowledge', projectId] as const,
  artifacts: (projectId: string) => ['artifacts', projectId] as const,
  requirements: (projectId: string) => ['requirements', projectId] as const,
  milestones: (projectId: string) => ['milestones', projectId] as const,
  decisions: (projectId: string) => ['decisions', projectId] as const,
  providerSettings: ['providerSettings'] as const,
  aiConnections: ['aiConnections'] as const,
  aiModels: (connectionId: string) => ['aiModels', connectionId] as const,
  externalAgents: ['externalAgents'] as const,
  snapshot: (projectId: string) => ['snapshot', projectId] as const,
  plans: (projectId: string) => ['plans', projectId] as const,
  planGrant: (planId: string) => ['plan-grant', planId] as const,
  replanProposals: (projectId: string, planId: string) => ['replan-proposals', projectId, planId] as const,
  graph: (projectId: string) => ['graph', projectId] as const,
}

export function useBootstrap() {
  return useQuery({
    queryKey: qk.bootstrap,
    queryFn: () => window.projectos.app.bootstrap(),
    staleTime: 5_000,
    retry: 1,
  })
}

export function useProjectOverview(projectId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.overview(projectId ?? ''),
    queryFn: () => window.projectos.projects.overview(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 4_000,
  })
}

export function useProjectMetrics(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['project-metrics', projectId ?? ''] as const,
    queryFn: () => window.projectos.projectAnalysis.metrics(projectId!),
    enabled: Boolean(projectId),
    staleTime: 10_000,
  })
}

export function useAgentDefinitions() {
  return useQuery({ queryKey: ['agent-definitions'], queryFn: () => window.projectos.agentDefinitions.list() })
}

export function useSkills() {
  return useQuery({ queryKey: ['skills'], queryFn: () => window.projectos.skills.list() })
}

export function useRuntimeProfiles() {
  return useQuery({ queryKey: ['runtime-profiles'], queryFn: () => window.projectos.runtimeProfiles.list() })
}

export function useOperations(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['operations', projectId ?? ''] as const,
    queryFn: () => window.projectos.operations.snapshot(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: 15_000,
  })
}

export function useProjectBudget(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['project-budget', projectId ?? ''] as const,
    queryFn: () => window.projectos.projectAnalysis.budget(projectId!),
    enabled: Boolean(projectId),
    staleTime: 10_000,
  })
}

export function useTaskBoard(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.board(projectId ?? ''),
    queryFn: () => window.projectos.tasks.board(projectId!),
    enabled: Boolean(projectId),
  })
}

export function useTaskDetail(taskId: string | null | undefined) {
  return useQuery({
    queryKey: qk.task(taskId ?? ''),
    queryFn: () => window.projectos.tasks.detail(taskId!),
    enabled: Boolean(taskId),
  })
}

export function useSessions(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.sessions(projectId ?? ''),
    queryFn: () => window.projectos.sessions.list(projectId!),
    enabled: Boolean(projectId),
  })
}

export function useSessionDetail(sessionId: string | null | undefined, messageLimit = 200) {
  return useQuery({
    queryKey: [...qk.session(sessionId ?? ''), messageLimit] as const,
    queryFn: () => window.projectos.sessions.get(sessionId!, messageLimit),
    enabled: Boolean(sessionId),
  })
}

export function useRuns(projectId: string | null | undefined, limit = 50) {
  return useQuery({
    queryKey: [...qk.runs(projectId ?? ''), limit] as const,
    queryFn: () => window.projectos.runs.list(projectId!, limit),
    enabled: Boolean(projectId),
  })
}

export function useRunDetail(runId: string | null | undefined) {
  return useQuery({
    queryKey: qk.run(runId ?? ''),
    queryFn: () => window.projectos.runs.get(runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status
      return status && !['completed', 'failed', 'cancelled'].includes(status) ? 2_500 : false
    },
  })
}

export function useCollaboration(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.collaboration(projectId ?? ''),
    queryFn: () => window.projectos.collaboration.snapshot(projectId!),
    enabled: Boolean(projectId),
  })
}

export function useApprovals(projectId: string | null) {
  return useQuery({
    queryKey: qk.approvals(projectId),
    queryFn: () => window.projectos.approvals.list({ projectId, runId: null }),
  })
}

export function useProjectEvents(projectId: string | null | undefined, limit = 100) {
  return useQuery({
    queryKey: [...qk.events(projectId ?? ''), limit] as const,
    queryFn: () => window.projectos.events.list({ projectId: projectId!, limit, offset: 0 }),
    enabled: Boolean(projectId),
  })
}

export function useWorkspace(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.workspace(projectId ?? ''),
    queryFn: () => window.projectos.workspace.snapshot(projectId!),
    enabled: Boolean(projectId),
    staleTime: 10_000,
  })
}

export function useFileContent(projectId: string | null | undefined, path: string | null | undefined) {
  return useQuery({
    queryKey: qk.file(projectId ?? '', path ?? ''),
    queryFn: () => window.projectos.workspace.readFile(projectId!, path!),
    enabled: Boolean(projectId) && Boolean(path),
    staleTime: 8_000,
  })
}

export function useGitDiff(projectId: string | null | undefined, path: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.diff(projectId ?? '', path),
    queryFn: () => window.projectos.workspace.gitDiff(projectId!, path ?? undefined),
    enabled: Boolean(projectId) && enabled,
    staleTime: 5_000,
  })
}

export function useKnowledge(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.knowledge(projectId ?? ''),
    queryFn: () => window.projectos.knowledge.list(projectId!),
    enabled: Boolean(projectId),
  })
}

export function useKnowledgeSearch(projectId: string | null | undefined, query: string) {
  return useQuery({
    queryKey: ['knowledge-search', projectId ?? '', query] as const,
    queryFn: () => window.projectos.knowledge.search(projectId!, query, 50),
    enabled: Boolean(projectId) && query.trim().length > 0,
  })
}

export function useArtifacts(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.artifacts(projectId ?? ''),
    queryFn: () => window.projectos.artifacts.list(projectId!, null),
    enabled: Boolean(projectId),
  })
}

export function useRequirements(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.requirements(projectId ?? ''),
    queryFn: () => window.projectos.requirements.list(projectId!),
    enabled: Boolean(projectId),
  })
}

export function useMilestones(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.milestones(projectId ?? ''),
    queryFn: () => window.projectos.milestones.list(projectId!),
    enabled: Boolean(projectId),
  })
}

export function useDecisions(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.decisions(projectId ?? ''),
    queryFn: () => window.projectos.decisions.list(projectId!),
    enabled: Boolean(projectId),
  })
}

export function useProviderSettings() {
  return useQuery({
    queryKey: qk.providerSettings,
    queryFn: () => window.projectos.settings.get(),
    staleTime: 5_000,
  })
}

export function useAIConnections() {
  return useQuery({
    queryKey: qk.aiConnections,
    queryFn: () => window.projectos.aiConnections.list(),
    staleTime: 5_000,
  })
}

export function useAIModels(connectionId: string | null | undefined) {
  return useQuery({
    queryKey: qk.aiModels(connectionId ?? ''),
    queryFn: () => window.projectos.aiModels.list(connectionId!),
    enabled: Boolean(connectionId),
    staleTime: 5_000,
  })
}

export function useExternalAgents() {
  return useQuery({
    queryKey: qk.externalAgents,
    queryFn: () => window.projectos.externalAgents.list(),
    staleTime: 30_000,
  })
}

export function useProjectSnapshot(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.snapshot(projectId ?? ''),
    queryFn: () => window.projectos.projectAnalysis.snapshot(projectId!),
    enabled: Boolean(projectId),
  })
}

export function usePlans(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.plans(projectId ?? ''),
    queryFn: () => window.projectos.plans.list(projectId!),
    enabled: Boolean(projectId),
  })
}

export function usePlanGrant(planId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.planGrant(planId ?? ''),
    queryFn: () => window.projectos.plans.grant.get(planId!),
    enabled: Boolean(planId) && enabled,
    refetchInterval: 10_000,
  })
}

export function useReplanProposals(
  projectId: string | null | undefined,
  planId: string | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: qk.replanProposals(projectId ?? '', planId ?? ''),
    queryFn: () => window.projectos.plans.replan.list(projectId!, planId!),
    enabled: Boolean(projectId) && Boolean(planId) && enabled,
    refetchInterval: 10_000,
  })
}

export function useGraph(projectId: string | null | undefined) {
  return useQuery({
    queryKey: qk.graph(projectId ?? ''),
    queryFn: () => window.projectos.graph.snapshot(projectId!),
    enabled: Boolean(projectId),
    refetchInterval: 15_000,
  })
}

export function useAgents(projectId: string | null | undefined) {
  return useQuery({
    queryKey: ['agents', projectId ?? ''] as const,
    queryFn: () => window.projectos.agents.list(projectId!),
    enabled: Boolean(projectId),
  })
}



