import { useCallback, useLayoutEffect, useRef } from 'react'

/** Keep focus/subscription lifetimes independent of the identity of a caller's callback. */
export function useLatestEvent<Args extends unknown[], Result>(callback: (...args: Args) => Result) {
  const latest = useRef(callback)
  useLayoutEffect(() => {
    latest.current = callback
  }, [callback])
  return useCallback((...args: Args) => latest.current(...args), [])
}
