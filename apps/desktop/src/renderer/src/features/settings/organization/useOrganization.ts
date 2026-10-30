import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OrganizationConnectionView } from '@projectos/contracts'

export const organizationConnectionKey = ['organization', 'connection'] as const
export const organizationScopeKey = (connection: OrganizationConnectionView, resource: string) => [
  'organization', 'scope', connection.serverUrl, connection.session?.account.id,
  connection.activeOrganizationId, resource,
] as const

export function useOrganization() {
  const client = useQueryClient()
  const connection = useQuery({
    queryKey: organizationConnectionKey,
    queryFn: () => window.projectos.organization.status({ refresh: true }),
    staleTime: 30_000,
    retry: false,
  })
  const change = useMutation({
    mutationFn: async (action: () => Promise<OrganizationConnectionView>) => {
      // Scoped data is removed before account/organization changes, including slow or failed changes.
      await client.cancelQueries({ queryKey: ['organization', 'scope'] })
      client.removeQueries({ queryKey: ['organization', 'scope'] })
      const next = await action()
      client.setQueryData(organizationConnectionKey, next)
      return next
    },
  })
  const refresh = async () => {
    const next = await window.projectos.organization.status({ refresh: true })
    await client.cancelQueries({ queryKey: ['organization', 'scope'] })
    client.removeQueries({ queryKey: ['organization', 'scope'] })
    client.setQueryData(organizationConnectionKey, next)
  }
  return { connection, change, refresh }
}
