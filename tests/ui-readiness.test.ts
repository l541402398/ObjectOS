import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryClient } from '../apps/desktop/src/renderer/src/lib/query-client'
import { prepareProjectPage, prepareSettingsSection, projectPageLoader } from '../apps/desktop/src/renderer/src/lib/route-readiness'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

let ui: typeof import('../apps/desktop/src/renderer/src/stores/ui').useUiStore
const flush = async () => { await new Promise((done) => setTimeout(done, 0)) }
const preferences = () => Promise.resolve({})

beforeAll(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
  ui = (await import('../apps/desktop/src/renderer/src/stores/ui')).useUiStore
})
beforeEach(() => {
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false, staleTime: 3000 } })
  ui.getState().closeSettings()
  ui.setState({ settingsSection: 'about', settingsConnectionId: null })
})
afterAll(() => { queryClient.clear(); vi.unstubAllGlobals() })

describe('destination readiness with delayed real-query contracts', () => {
  it('holds the project center until the most recent project agent summary is ready', async () => {
    const overview = deferred<object>()
    const loadOverview = vi.fn(() => overview.promise)
    vi.stubGlobal('window', { projectos: { app: { bootstrap: () => Promise.resolve({ projects: [{ id: 'older', lastActivityAt: 1 }, { id: 'recent', lastActivityAt: 2 }] }) }, projects: { overview: loadOverview } } })
    let ready = false
    const work = prepareProjectPage('project-center', '').then(() => { ready = true })
    await flush(); expect(ready).toBe(false); expect(loadOverview).toHaveBeenCalledWith('recent')
    overview.resolve({ agents: [{ id: 'agent', status: 'working' }] }); await work
    expect(queryClient.getQueryData(['overview', 'recent'])).toEqual({ agents: [{ id: 'agent', status: 'working' }] })
  })

  it('holds a cold settings opening until its content is available', async () => {
    const slow = deferred<object>()
    vi.stubGlobal('window', { projectos: { app: { preferences }, runtime: { health: () => slow.promise }, runtimeProfiles: { list: () => Promise.resolve({ profiles: [] }) } } })
    ui.getState().openSettings('runtime')
    await flush()
    expect(ui.getState().settingsOpen).toBe(false)
    expect(ui.getState().settingsPendingSection).toBe('runtime')
    slow.resolve({ status: 'ready' }); await flush()
    expect(ui.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'runtime', settingsPendingSection: null })
    expect(queryClient.getQueryData(['runtimeHealth'])).toEqual({ status: 'ready' })
  })

  it('keeps the current panel while switching and does not reopen after close', async () => {
    const slow = deferred<object>()
    vi.stubGlobal('window', { projectos: { app: { preferences: () => slow.promise } } })
    ui.setState({ settingsOpen: true, settingsSection: 'about' })
    ui.getState().setSettingsSection('preferences'); await flush()
    expect(ui.getState().settingsSection).toBe('about')
    ui.getState().closeSettings(); slow.resolve({}); await flush()
    expect(ui.getState()).toMatchObject({ settingsOpen: false, settingsSection: 'about', settingsPendingSection: null })
  })

  it('ignores a slow earlier tab when a later choice completes first', async () => {
    const slow = deferred<object>()
    vi.stubGlobal('window', { projectos: { app: { preferences: () => slow.promise } } })
    ui.getState().openSettings('preferences')
    ui.getState().openSettings('about'); await flush()
    slow.resolve({}); await flush()
    expect(ui.getState()).toMatchObject({ settingsOpen: true, settingsSection: 'about', settingsPendingSection: null })
  })

  it('waits for a selected connection and its dependent model catalog', async () => {
    const connections = deferred<object>(), models = deferred<object>()
    const listModels = vi.fn(() => models.promise)
    vi.stubGlobal('window', { projectos: { aiConnections: { list: () => connections.promise }, aiModels: { list: listModels } } })
    let ready = false
    const work = prepareSettingsSection('models', 'chosen').then(() => { ready = true })
    connections.resolve({ connections: [{ id: 'default', isDefault: true }, { id: 'chosen' }] }); await flush()
    expect(listModels).toHaveBeenCalledWith('chosen'); expect(ready).toBe(false)
    models.resolve({ models: [{ id: 'model' }] }); await work
    expect(queryClient.getQueryData(['aiModels', 'chosen'])).toEqual({ models: [{ id: 'model' }] })
  })

  it('prepares a cold run page with the mounted 100-record key and deep-linked detail', async () => {
    const events = deferred<object>(), detail = deferred<object>()
    const list = vi.fn(() => Promise.resolve({ runs: [{ id: 'run-a' }] }))
    vi.stubGlobal('window', { projectos: { app: { bootstrap: preferences }, runs: { list, get: () => detail.promise }, approvals: { list: preferences }, events: { list: () => events.promise } } })
    let ready = false
    const work = prepareProjectPage('runs', 'project-a', '?run=run-a').then(() => { ready = true })
    await flush(); expect(ready).toBe(false); expect(list).toHaveBeenCalledWith('project-a', 100)
    events.resolve({ events: [] }); await flush(); expect(ready).toBe(false)
    detail.resolve({ run: { id: 'run-a' } }); await work
    expect(queryClient.getQueryData(['runs', 'project-a', 100])).toEqual({ runs: [{ id: 'run-a' }] })
    expect(queryClient.getQueryData(['run', 'run-a'])).toEqual({ run: { id: 'run-a' } })
  })

  it('unblocks an aborted route without waiting for an old read', async () => {
    const slow = deferred<object>(), abort = new AbortController()
    vi.stubGlobal('window', { projectos: { app: { bootstrap: preferences }, projects: { overview: () => slow.promise } } })
    const url = new URL('https://projectos.local/projects/project-a/overview')
    const work = projectPageLoader('overview')({ params: { projectId: 'project-a' }, request: new Request(url, { signal: abort.signal }), url, pattern: '/projects/:projectId/overview', context: {} })
    abort.abort(); await expect(work).resolves.toBeNull()
    slow.resolve({ project: { id: 'project-a' } }); await flush()
    expect(queryClient.getQueryData(['overview', 'project-a'])).toEqual({ project: { id: 'project-a' } })
  })

  it('retains read errors for recovery instead of caching an empty successful result', async () => {
    vi.stubGlobal('window', { projectos: { app: { preferences: () => Promise.reject(new Error('read unavailable')) } } })
    await prepareSettingsSection('preferences', null)
    const state = queryClient.getQueryState(['app-preferences'])
    expect(state?.status).toBe('error'); expect(state?.data).toBeUndefined()
    expect(state?.error?.message).toBe('read unavailable')
  })
})
