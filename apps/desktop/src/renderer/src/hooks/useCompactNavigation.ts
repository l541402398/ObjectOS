import { useSyncExternalStore } from 'react'

const query = '(max-width: 1179px)'
const subscribe = (listener: () => void) => {
  const media = window.matchMedia(query)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}
const snapshot = () => window.matchMedia(query).matches

/** CSS and keyboard navigation use the same compact mode, including native zoom. */
export function useCompactNavigation() {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
