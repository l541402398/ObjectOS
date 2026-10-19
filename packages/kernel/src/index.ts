import {
  PluginManifestSchema,
  type CapabilityKind,
  type Disposable,
  type PluginContext,
  type PluginManifest,
  type PluginState,
  type ProjectOSPlugin,
} from '@projectos/contracts'

export class ServiceContainer {
  private readonly services = new Map<string, unknown>()

  register<T>(name: string, value: T): void {
    if (this.services.has(name)) throw new Error(`Service already registered: ${name}`)
    this.services.set(name, value)
  }

  replace<T>(name: string, value: T): void {
    this.services.set(name, value)
  }

  get<T>(name: string): T {
    if (!this.services.has(name)) throw new Error(`Service not registered: ${name}`)
    return this.services.get(name) as T
  }

  has(name: string): boolean {
    return this.services.has(name)
  }

  entries(): Array<[string, unknown]> {
    return [...this.services.entries()]
  }
}

export interface CapabilityEntry {
  kind: CapabilityKind
  id: string
  value: unknown
  pluginId: string | null
}

export class CapabilityRegistry {
  private readonly entries = new Map<string, CapabilityEntry>()

  private key(kind: CapabilityKind, id: string): string {
    return `${kind}:${id}`
  }

  register(kind: CapabilityKind, id: string, value: unknown, pluginId: string | null = null): void {
    const entry: CapabilityEntry = { kind, id, value, pluginId }
    this.entries.set(this.key(kind, id), entry)
  }

  unregister(kind: CapabilityKind, id: string): void {
    this.entries.delete(this.key(kind, id))
  }

  get(kind: CapabilityKind, id: string): unknown {
    return this.entries.get(this.key(kind, id))?.value
  }

  list(kind?: CapabilityKind): CapabilityEntry[] {
    const all = [...this.entries.values()]
    return kind ? all.filter((entry) => entry.kind === kind) : all
  }
}

export class PluginHost {
  private readonly manifests = new Map<string, PluginManifest>()
  private readonly states = new Map<string, PluginState>()
  private readonly disposables = new Map<string, Disposable[]>()
  private readonly failedReasons = new Map<string, string>()

  constructor(
    private readonly services: ServiceContainer,
    private readonly capabilities: CapabilityRegistry,
  ) {}

  list(): Array<{ manifest: PluginManifest; state: PluginState; error?: string }> {
    return [...this.manifests.values()].map((manifest) => ({
      manifest,
      state: this.states.get(manifest.id) ?? 'discovered',
      error: this.failedReasons.get(manifest.id),
    }))
  }

  validate(manifestInput: unknown): PluginManifest {
    const manifest = PluginManifestSchema.parse(manifestInput)
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (!this.manifests.has(dependency)) {
        throw new Error(`Plugin ${manifest.id} requires missing plugin ${dependency}`)
      }
    }
    this.manifests.set(manifest.id, manifest)
    this.states.set(manifest.id, 'validated')
    return manifest
  }

  async install(plugin: ProjectOSPlugin): Promise<void> {
    const manifest = this.validate(plugin.manifest)
    this.states.set(manifest.id, 'resolved')
    const context: PluginContext = {
      manifest,
      log: (level, message) => {
        // The runtime injects a logger-backed plugin; keep this deterministic and side-effect free.
        if (level === 'error') console.error(`[plugin:${manifest.id}] ${message}`)
      },
      registerCapability: (kind, id, value) => {
        this.capabilities.register(kind, id, value, manifest.id)
      },
      getService: <T>(name: string) => this.services.get<T>(name),
    }
    try {
      const disposable = await plugin.setup(context)
      this.states.set(manifest.id, 'loaded')
      if (disposable) {
        const list = this.disposables.get(manifest.id) ?? []
        list.push(disposable)
        this.disposables.set(manifest.id, list)
      }
      this.states.set(manifest.id, 'active')
    } catch (error) {
      this.states.set(manifest.id, 'failed')
      this.failedReasons.set(manifest.id, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async unload(pluginId: string): Promise<void> {
    const state = this.states.get(pluginId)
    if (!state) throw new Error(`Unknown plugin: ${pluginId}`)
    this.states.set(pluginId, 'stopping')
    for (const disposable of this.disposables.get(pluginId) ?? []) {
      await disposable.dispose()
    }
    this.disposables.delete(pluginId)
    for (const entry of this.capabilities.list()) {
      if (entry.pluginId === pluginId) this.capabilities.unregister(entry.kind, entry.id)
    }
    this.states.set(pluginId, 'unloaded')
  }

  stateOf(pluginId: string): PluginState | undefined {
    return this.states.get(pluginId)
  }
}
