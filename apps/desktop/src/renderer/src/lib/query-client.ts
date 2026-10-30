import { QueryClient } from '@tanstack/react-query'

/** Route readiness and mounted views share the same cache; no duplicate data layer. */
export const queryClient = new QueryClient({ defaultOptions: {
  queries: { retry: 1, staleTime: 3000, refetchOnWindowFocus: false },
  mutations: { retry: 0 },
} })
