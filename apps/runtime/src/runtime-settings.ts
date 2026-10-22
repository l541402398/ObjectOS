import {
  DEFAULT_RUNTIME_SETTINGS,
  mergeRuntimeSettings,
  normalizeRuntimeSettings,
  type RuntimeSettings,
  type RuntimeSettingsUpdate,
} from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'
import type { RuntimeLimits } from './limits.js'

export const RUNTIME_SETTINGS_KEY = 'runtime.settings'

export function runtimeLimitsFromSettings(
  settings: RuntimeSettings,
  base: RuntimeLimits,
): RuntimeLimits {
  return {
    ...base,
    runWallClockMs: settings.agentRunTimeoutMinutes * 60_000,
    planWallClockMs: settings.planTimeoutMinutes * 60_000,
    maxAgentSteps: settings.agentMaxSteps,
    maxToolCalls: settings.agentMaxToolCalls,
  }
}

export class RuntimeSettingsService {
  constructor(
    private readonly store: SqliteStore,
    private readonly applyLimits?: (limits: Partial<RuntimeLimits>) => void,
  ) {}

  get(): RuntimeSettings {
    try {
      return normalizeRuntimeSettings(this.store.read.getAppSetting(RUNTIME_SETTINGS_KEY))
    } catch {
      return { ...DEFAULT_RUNTIME_SETTINGS }
    }
  }

  update(patch: RuntimeSettingsUpdate): RuntimeSettings {
    const next = mergeRuntimeSettings(this.get(), patch)
    this.store.setAppSetting(RUNTIME_SETTINGS_KEY, next)
    this.applyLimits?.({
      runWallClockMs: next.agentRunTimeoutMinutes * 60_000,
      planWallClockMs: next.planTimeoutMinutes * 60_000,
      maxAgentSteps: next.agentMaxSteps,
      maxToolCalls: next.agentMaxToolCalls,
    })
    return next
  }

  apply(): RuntimeSettings {
    const settings = this.get()
    this.applyLimits?.({
      runWallClockMs: settings.agentRunTimeoutMinutes * 60_000,
      planWallClockMs: settings.planTimeoutMinutes * 60_000,
      maxAgentSteps: settings.agentMaxSteps,
      maxToolCalls: settings.agentMaxToolCalls,
    })
    return settings
  }
}
