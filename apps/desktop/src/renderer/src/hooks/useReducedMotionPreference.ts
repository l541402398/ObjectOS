import { useSyncExternalStore } from 'react'
import { useUiStore } from '../stores/ui'

const query = '(prefers-reduced-motion: reduce)'
const systemPreference = () => window.matchMedia(query).matches
const subscribe = (changed: () => void) => {
  const media = window.matchMedia(query)
  media.addEventListener('change', changed)
  return () => media.removeEventListener('change', changed)
}

/** Motion's installed hook latches its first value; product preferences must also update live. */
export function useReducedMotionPreference(): boolean {
  const system = useSyncExternalStore(subscribe, systemPreference, () => true)
  const preferred = useUiStore((state) => state.reduceMotion)
  return system || preferred
}
