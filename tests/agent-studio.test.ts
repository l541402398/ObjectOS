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

  it('archives an agent without deleting its configuration history', () => {
    const { studio } = setup()
    const profiles = studio.ensureDefaultProfiles()
    const created = studio.upsertAgent({
      name: 'Archivable Agent', role: '审查员', description: '', category: 'quality', avatar: '', visibility: 'project',
      persona, skillIds: [], runtimeProfileIds: [profiles[0]!.id], primaryRuntimeProfileId: profiles[0]!.id,
      modelRef: null, permissions: { tools: [], files: false, shell: false, network: false },
    })
    const archived = studio.setStatus(created.id, 'archived')
    expect(archived.status).toBe('archived')
    expect(archived.currentVersion).toBe(created.currentVersion + 1)
    expect(studio.listAgents().find((agent) => agent.id === created.id)?.status).toBe('archived')
  })

  it('updates and deletes custom runtime profiles', () => {
    const { studio } = setup()
    const created = studio.upsertRuntime({ name: 'Custom', protocol: 'cli', executable: 'node', endpoint: null, args: [], authRef: null, modelRef: null, options: {}, capabilities: {} })
    const updated = studio.upsertRuntime({ id: created.id, name: 'Custom 2', protocol: 'cli', executable: 'node', endpoint: null, args: ['--version'], authRef: null, modelRef: null, options: {}, capabilities: {} })
    expect(updated.name).toBe('Custom 2')
    expect(updated.args).toEqual(['--version'])
    studio.deleteRuntime(created.id)
    expect(studio.listRuntimeProfiles().some((profile) => profile.id === created.id)).toBe(false)
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




