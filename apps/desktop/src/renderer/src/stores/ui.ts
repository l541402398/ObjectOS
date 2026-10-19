import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'
export type SettingsSection = 'ai-connections' | 'models' | 'routing' | 'general' | 'runtime' | 'external-agents' | 'about'

interface UiState {
  themeMode: ThemeMode
  reduceTransparency: boolean
  reduceMotion: boolean
  sidebarCollapsed: boolean
  lastProjectId: string | null
  settingsOpen: boolean
  settingsSection: SettingsSection
  settingsConnectionId: string | null
  setThemeMode: (mode: ThemeMode) => void
  setReduceTransparency: (value: boolean) => void
  setReduceMotion: (value: boolean) => void
  toggleSidebar: () => void
  setSidebarCollapsed: (value: boolean) => void
  setLastProjectId: (id: string | null) => void
  openSettings: (section?: SettingsSection, connectionId?: string | null) => void
  closeSettings: () => void
  setSettingsSection: (section: SettingsSection) => void
  setSettingsConnectionId: (id: string | null) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      themeMode: 'system',
      reduceTransparency: false,
      reduceMotion: false,
      sidebarCollapsed: false,
      lastProjectId: null,
      settingsOpen: false,
      settingsSection: 'ai-connections',
      settingsConnectionId: null,
      setThemeMode: (themeMode) => set({ themeMode }),
      setReduceTransparency: (reduceTransparency) => set({ reduceTransparency }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setLastProjectId: (lastProjectId) => set({ lastProjectId }),
      openSettings: (section = 'ai-connections', connectionId) =>
        set((state) => ({
          settingsOpen: true,
          settingsSection: section,
          settingsConnectionId: connectionId === undefined ? state.settingsConnectionId : connectionId,
        })),
      closeSettings: () => set({ settingsOpen: false }),
      setSettingsSection: (settingsSection) => set({ settingsSection }),
      setSettingsConnectionId: (settingsConnectionId) => set({ settingsConnectionId }),
    }),
    {
      name: 'projectos.ui',
      version: 1,
      partialize: (state) => ({
        themeMode: state.themeMode,
        reduceTransparency: state.reduceTransparency,
        reduceMotion: state.reduceMotion,
        sidebarCollapsed: state.sidebarCollapsed,
        lastProjectId: state.lastProjectId,
      }),
    },
  ),
)

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function useResolvedTheme(): 'light' | 'dark' {
  const themeMode = useUiStore((state) => state.themeMode)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!media) return undefined
    const listener = (event: MediaQueryListEvent): void => setSystemDark(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  if (themeMode === 'system') return systemDark ? 'dark' : 'light'
  return themeMode
}

export function useUiEffects(): void {
  const theme = useResolvedTheme()
  const reduceTransparency = useUiStore((state) => state.reduceTransparency)
  const reduceMotion = useUiStore((state) => state.reduceMotion)

  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = theme
    root.style.colorScheme = theme
    root.dataset.reduceTransparency = String(reduceTransparency)
    root.dataset.reduceMotion = String(reduceMotion)
    const contrast = window.matchMedia?.('(prefers-contrast: more)').matches
    root.dataset.highContrast = String(Boolean(contrast))
  }, [theme, reduceTransparency, reduceMotion])
}
