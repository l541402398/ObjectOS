import { createContext, useContext, useLayoutEffect } from 'react'

export const SettingsDraftContext = createContext<{ dirty: boolean; setDirty: (dirty: boolean) => void }>({ dirty: false, setDirty: () => {} })
export function useSettingsDraft(dirty: boolean) {
  const { setDirty } = useContext(SettingsDraftContext)
  // Publish before the next keyboard event can dismiss the containing Settings surface.
  useLayoutEffect(() => { setDirty(dirty) }, [dirty, setDirty])
  useLayoutEffect(() => () => setDirty(false), [setDirty])
}
