/** UI selection only. Persisted sessions/Run facts remain authoritative. */
export function chooseAgentContext<T extends { id: string; projectId: string; agentId: string; updatedAt: number }>(
  sessions: readonly T[], projectId: string, agentId: string, selectedId: string | null, activeId: string | null,
): T | null {
  const scoped = sessions.filter((session) => session.projectId === projectId && session.agentId === agentId)
  return scoped.find((session) => session.id === selectedId)
    ?? scoped.find((session) => session.id === activeId)
    ?? [...scoped].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))[0]
    ?? null
}

export function canonicalAgentSearch(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(search)
  next.delete('workspace')
  next.delete('view')
  return next
}
