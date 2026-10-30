import type { LoaderFunctionArgs } from 'react-router-dom'
import type { QueryKey } from '@tanstack/react-query'
import { queryClient } from './query-client'
import { qk } from './queries'
import type { SettingsSection } from '../stores/ui'

/** Settings tabs use the same read keys as their panels. Keep the previous tab until ready. */
export async function prepareSettingsSection(section: SettingsSection, connectionId: string | null): Promise<void> {
  const api = window.projectos, jobs: Promise<unknown>[] = []
  const read = <T,>(queryKey: QueryKey, queryFn: () => Promise<T>) => {
    const job = queryClient.ensureQueryData({ queryKey, queryFn }); jobs.push(job.catch(() => undefined)); return job
  }
  const connections = () => read(qk.aiConnections, () => api.aiConnections.list())
  const profiles = () => read(['runtime-profiles'], () => api.runtimeProfiles.list())
  const skills = () => read(['skills'], () => api.skills.list())
  if (section === 'overview') { read(qk.bootstrap, () => api.app.bootstrap()); connections(); profiles(); skills() }
  else if (section === 'organization') read(['organization', 'connection'], () => api.organization.status({ refresh: true }))
  else if (section === 'ai-connections') connections()
  else if (section === 'models') {
    const data = await connections().catch(() => null)
    const connection = data?.connections.find((item) => item.id === connectionId) ?? data?.connections.find((item) => item.isDefault) ?? data?.connections[0]
    if (connection) read(qk.aiModels(connection.id), () => api.aiModels.list(connection.id))
  } else if (section === 'runtime') {
    read(['appPreferences'], () => api.app.preferences())
    read(['runtimeHealth'], () => api.runtime.health())
    read(['runtime-profiles', 'settings'], () => api.runtimeProfiles.list())
  } else if (section === 'general') read(['runtime-settings'], () => api.runtime.settings.get())
  else if (section === 'tools') { profiles(); skills() }
  else if (section === 'skills') skills()
  else if (section === 'permissions') read(['agent-definitions'], () => api.agentDefinitions.list())
  else if (section === 'data-security') { read(['app-preferences'], () => api.app.preferences()); connections(); read(qk.bootstrap, () => api.app.bootstrap()) }
  else if (section === 'usage') { connections(); read(['ai-usage'], () => api.aiUsage.summary()); read(['ai-pricing'], () => api.aiPricing.list()) }
  else if (section === 'preferences') read(['app-preferences'], () => api.app.preferences())
  await Promise.allSettled(jobs)
}

/** Destination reads share exactly the mounted view's cache keys. No mutations or speculative tools. */
export async function prepareProjectPage(key: string, projectId: string, search = ''): Promise<void> {
  const api = window.projectos, jobs: Promise<unknown>[] = []
  const read = <T,>(queryKey: QueryKey, queryFn: () => Promise<T>) => {
    const job = queryClient.ensureQueryData({ queryKey, queryFn }); jobs.push(job.catch(() => undefined)); return job
  }
  const boot = read(qk.bootstrap, () => api.app.bootstrap())
  if (key === 'project-center') {
    const data = await boot.catch(() => null)
    const recent = data?.projects.slice().sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))[0]
    if (recent) read(qk.overview(recent.id), () => api.projects.overview(recent.id))
    await Promise.allSettled(jobs)
    return
  }
  if (!projectId) { await Promise.allSettled(jobs); return }
  const board = () => read(qk.board(projectId), () => api.tasks.board(projectId))
  const overview = () => read(qk.overview(projectId), () => api.projects.overview(projectId))
  const plans = () => read(qk.plans(projectId), () => api.plans.list(projectId))
  const approvals = () => read(qk.approvals(projectId), () => api.approvals.list({ projectId, runId: null }))
  const runs = (limit: number) => read([...qk.runs(projectId), limit], () => api.runs.list(projectId, limit))
  const agents = () => read(['agents', projectId], () => api.agents.list(projectId))
  const artifacts = () => read(qk.artifacts(projectId), () => api.artifacts.list(projectId, null))
  const lifecycle = () => read(qk.lifecycle(projectId), () => api.lifecycle.overview(projectId))
  if (key === 'home' || key === 'work') {
    const planned = plans(); board(); approvals(); runs(key === 'home' ? 40 : 30); agents()
    read(['work', 'journey', projectId], () => api.work.journey(projectId))
    read(['action-center', projectId], () => api.actions.center(projectId))
    read(['autonomy-settings', projectId], () => api.actions.autonomy(projectId))
    if (key === 'work') {
      overview(); artifacts(); lifecycle(); read(['work', 'goalStatus', projectId], () => api.work.goalStatus(projectId))
      const plan = (await planned.catch(() => null))?.plans[0]
      if (plan) read(qk.planGrant(plan.id), () => api.plans.grant.get(plan.id))
    }
  } else if (key === 'tasks') { board(); agents(); plans(); lifecycle(); overview(); approvals() }
  else if (key === 'agents') read(qk.collaborationOverview(projectId), () => api.collaboration.overview(projectId))
  else if (key === 'approvals') approvals()
  else if (key === 'approval-center') { approvals(); read(['release-approvals', projectId], () => api.release.approvals(projectId)) }
  else if (key === 'runs') {
    runs(100); approvals(); read([...qk.events(projectId), 100], () => api.events.list({ projectId, limit: 100, offset: 0 }))
    const runId = new URLSearchParams(search).get('run')
    if (runId) read(qk.run(runId), () => api.runs.get(runId))
  }
  else if (key === 'versions') {
    board(); plans(); artifacts()
    const data = await lifecycle().catch(() => null)
    const version = data?.versions.find((item) => item.id === data.focus?.subjectId) ?? data?.versions.find((item) => item.isDefault) ?? data?.versions[0]
    if (version) read(['gate-overview', projectId, version.id], () => api.lifecycle.gateOverview(projectId, 'version', version.id))
  }
  else if (key === 'releases' || key === 'deployments') {
    const data = await lifecycle().catch(() => null)
    const requested = new URLSearchParams(search).get('version')
    const version = data?.versions.find((item) => item.id === requested) ?? data?.versions.find((item) => item.id === data.focus?.subjectId) ?? data?.versions.find((item) => item.isDefault) ?? data?.versions[0]
    if (version) read(['release-overview', projectId, version.id], () => api.release.overview(projectId, version.id))
    if (key === 'releases') { board(); artifacts() }
    else { read(['delivery-adapters', projectId], () => api.release.adapters(projectId)); read(['resource-overview', projectId], () => api.resources.overview(projectId)) }
  } else if (key === 'connections') read(['resource-overview', projectId], () => api.resources.overview(projectId))
  else if (key === 'resources') {
    read(qk.workspace(projectId), () => api.workspace.snapshot(projectId))
    read(['runtime-profiles'], () => api.runtimeProfiles.list())
    read(['skills'], () => api.skills.list())
    read(qk.aiConnections, () => api.aiConnections.list())
  }
  else if (key === 'overview' || key === 'project-settings') overview()
  else if (key === 'knowledge') { read(qk.knowledge(projectId), () => api.knowledge.list(projectId)); artifacts() }
  else if (key === 'workspace') {
    jobs.push(import('../pages/WorkspacePage'))
    read(qk.diff(projectId, null), () => api.workspace.gitDiff(projectId))
    const data = await read(qk.workspace(projectId), () => api.workspace.snapshot(projectId)).catch(() => null)
    const file = data?.entries.find((item) => item.path === 'README.md') ?? data?.entries.find((item) => item.type === 'file')
    if (file) read(qk.file(projectId, file.path), () => api.workspace.readFile(projectId, file.path))
  }
  else if (key === 'orchestration') { jobs.push(import('../features/orchestration/pages/OrchestrationWorkspace')); plans(); board(); agents(); read(qk.graph(projectId), () => api.graph.snapshot(projectId)); read(qk.snapshot(projectId), () => api.projectAnalysis.snapshot(projectId)) }
  else if (key === 'collaboration') read(qk.collaboration(projectId), () => api.collaboration.snapshot(projectId))
  else if (key === 'operations') {
    read(['operations', projectId], () => api.operations.snapshot(projectId)); agents()
    read(['operations-insights', projectId], () => api.operations.insights(projectId))
    read(['operations-trigger', projectId], () => api.operations.getTrigger(projectId))
    read(['operations-grant', projectId], () => api.operations.getGrant(projectId))
  }
  else if (key === 'health') read(['project-metrics', projectId], () => api.projectAnalysis.metrics(projectId))
  await Promise.allSettled(jobs)
}

export const projectPageLoader = (key: string) => async ({ params, request }: LoaderFunctionArgs) => {
  const prepared = prepareProjectPage(key, params.projectId ?? '', new URL(request.url).search)
  // Abandon navigation immediately when the user chooses a different destination. Read results
  // may still populate their project-specific cache; no stale page is committed by this loader.
  await new Promise<void>((resolve) => {
    const done = () => { request.signal.removeEventListener('abort', done); resolve() }
    if (request.signal.aborted) done()
    else { request.signal.addEventListener('abort', done, { once: true }); void prepared.then(done, done) }
  })
  return null
}
