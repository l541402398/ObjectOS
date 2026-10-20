import { describe, expect, it } from 'vitest'
import { SqliteStore } from '@projectos/persistence'
import { AgentStudioService } from '../apps/runtime/src/agent-studio.js'

function setup() {
  const store = new SqliteStore({ filePath: ':memory:' })
  return { store, studio: new AgentStudioService(store) }
}

const persona = { role: '审查员', background: '', responsibilities: '', principles: '', style: '', constraints: '', systemPrompt: 'Be precise.' }

describe('agent studio', () => {
  it('creates versioned custom agents and composes their prompt', () => {
    const { studio } = setup()
    const profiles = studio.ensureDefaultProfiles()
    expect(profiles.length).toBeGreaterThan(2)
    const created = studio.upsertAgent({
      name: 'Security Reviewer', role: '审查员', description: '', category: 'quality', avatar: '', visibility: 'project',
      persona, skillIds: [], runtimeProfileIds: [profiles[0]!.id], primaryRuntimeProfileId: profiles[0]!.id,
      modelRef: null, permissions: { tools: [], files: false, shell: false, network: false },
    })
    expect(created.currentVersion).toBe(1)
    expect(studio.listAgents().map((agent) => agent.name)).toContain('Security Reviewer')
    const preview = studio.preview(created.id)
    expect(preview.prompt).toContain('Security Reviewer')
    expect(preview.prompt).toContain('Be precise.')
    const updated = studio.upsertAgent({
      id: created.id, name: 'Security Reviewer', role: '审查员', description: '', category: 'quality', avatar: '', visibility: 'project',
      persona, skillIds: [], runtimeProfileIds: [profiles[0]!.id], primaryRuntimeProfileId: profiles[0]!.id,
      modelRef: null, permissions: { tools: [], files: false, shell: false, network: false },
    })
    expect(updated.currentVersion).toBe(2)
    const exported = studio.exportAgent(updated.id)
    const imported = studio.importAgent(exported.json)
    expect(imported.id).not.toBe(updated.id)
    expect(imported.name).toBe(updated.name)
    expect(imported.currentVersion).toBe(1)
  })

  it('imports ACP registry entries without claiming availability', () => {
    const { studio } = setup()
    const profile = studio.importRegistry({ registryId: 'acp.example', name: 'Example ACP', version: '1.0.0', description: 'test' })
    expect(profile.source).toBe('registry')
    expect(profile.status).toBe('unavailable')
    expect(profile.protocol).toBe('acp')
    expect(studio.importRegistry({ registryId: 'acp.example', name: 'Example ACP', version: '1.0.0', description: 'test' }).id).toBe(profile.id)
  })

  it('detects installed runtimes without claiming missing ones', async () => {
    const { studio } = setup()
    const detections = await studio.detect()
    expect(detections.some((item) => item.protocol === 'native' && item.installed)).toBe(true)
    expect(detections.every((item) => typeof item.message === 'string')).toBe(true)
  })
})



