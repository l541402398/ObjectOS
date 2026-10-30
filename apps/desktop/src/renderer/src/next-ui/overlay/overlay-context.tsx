import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

type OverlayMode = 'modal' | 'inspector' | 'popover'
type OverlayEntry = { id: string; mode: OverlayMode }

type OverlayApi = {
  layers: OverlayEntry[]
  register: (entry: OverlayEntry) => void
  unregister: (id: string) => void
  zFor: (id: string) => number
}

const OverlayContext = createContext<OverlayApi | null>(null)
export const OVERLAY_BASE_Z = 6000

export function OverlayRoot({ children }: { children: ReactNode }): ReactElement {
  const [layers, setLayers] = useState<OverlayEntry[]>([])
  const register = useCallback((entry: OverlayEntry) => {
    setLayers((current) => (current.some((item) => item.id === entry.id) ? current : [...current, entry]))
  }, [])
  const unregister = useCallback((id: string) => {
    setLayers((current) =>
      current.some((item) => item.id === id) ? current.filter((item) => item.id !== id) : current,
    )
  }, [])
  const api = useMemo<OverlayApi>(
    () => ({
      layers,
      register,
      unregister,
      zFor: (id) => {
        const index = layers.findIndex((item) => item.id === id)
        return OVERLAY_BASE_Z + Math.max(0, index) * 30
      },
    }),
    [layers, register, unregister],
  )
  return <OverlayContext.Provider value={api}>{children}</OverlayContext.Provider>
}

export function useOverlayLayer(
  mode: OverlayMode = 'modal',
  active = true,
): { id: string; zIndex: number; isTop: boolean; hasModalBelow: boolean } {
  const id = useId()
  const api = useContext(OverlayContext)
  const register = api?.register
  const unregister = api?.unregister
  useEffect(() => {
    if (!active) return undefined
    register?.({ id, mode })
    return () => unregister?.(id)
  }, [active, id, mode, register, unregister])
  const index = api?.layers.findIndex((item) => item.id === id) ?? -1
  return {
    id,
    zIndex: api?.zFor(id) ?? OVERLAY_BASE_Z,
    isTop: index >= 0 && index === (api?.layers.length ?? 0) - 1,
    hasModalBelow: index > 0 && Boolean(api?.layers.slice(0, index).some((entry) => entry.mode === 'modal')),
  }
}

export function useOverlayCount(): number {
  return useContext(OverlayContext)?.layers.length ?? 0
}
