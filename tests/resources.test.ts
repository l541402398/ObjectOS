import { describe, expect, it } from 'vitest'
import { newId } from '@projectos/contracts'
import { LifecycleService } from '../apps/runtime/src/lifecycle.js'
import { ReleaseService } from '../apps/runtime/src/release-service.js'
import { ResourceService } from '../apps/runtime/src/resource-service.js'
import { createGitProject, setup } from './helpers/r1-fixture.js'

describe('Phase 2.3 resources and credentials', () => {
  it('stores resource/profile metadata without secrets and links deployment targets', async () => {
    const harness = setup()
    try {
      const project = await createGitProject(harness.services, harness.dataDir, 'resources')
      const lifecycle = new LifecycleService(harness.store)
      const release = new ReleaseService(harness.store)
      const resources = new ResourceService(harness.store)
      const environment = lifecycle.createEnvironment({ projectId: project.id, key: 'test', name: 'Test', kind: 'staging', protected: false })
      const resource = resources.create({
        projectId: project.id, type: 'host', name: 'Contabo', endpoint: '169.58.112.111', purpose: 'test', labels: ['vps'], metadata: {},
      })
      const credential = resources.registerCredential({
        id: newId('crd'), projectId: project.id, kind: 'ssh_private_key', label: 'Contabo key', vaultKey: 'opaque-key',
      })
      const profile = resources.createProfile({
        resourceId: resource.id, name: 'Contabo SSH', protocol: 'ssh', host: '169.58.112.111', port: 22,
        username: 'root', authType: 'private_key', credentialRef: credential.id,
        hostKeyFingerprint: 'SHA256:test', trustPolicy: 'pinned', connectTimeoutMs: 15000,
      })
      const target = release.createTarget({
        projectId: project.id, environmentId: environment.id, name: 'Contabo target', kind: 'ssh',
        controlMode: 'ssh_managed', adapterType: 'ssh-artifact', targetRef: '/opt/projectos-delivery-test',
        resourceId: resource.id, connectionProfileId: profile.id, protected: false,
      })
      expect(target.resourceId).toBe(resource.id)
      expect(target.connectionProfileId).toBe(profile.id)
      expect(resources.overview(project.id).resources[0]?.name).toBe('Contabo')
      expect(resources.overview(project.id).credentials[0]?.label).toBe('Contabo key')
      expect(() => resources.deleteProfile(profile.id)).toThrow(/已被部署目标引用/)

      const run = resources.recordTest({
        profileId: profile.id, status: 'connected', stage: 'probe', message: 'ok', latencyMs: 30, details: { output: 'Linux' },
      })
      expect(run.status).toBe('connected')
      expect(resources.overview(project.id).profiles[0]?.lastTestStatus).toBe('connected')

      resources.disableCredential(credential.id)
      expect(() => resources.createProfile({
        resourceId: resource.id, name: 'disabled', protocol: 'ssh', host: '169.58.112.111', port: 22,
        username: 'root', authType: 'private_key', credentialRef: credential.id,
        hostKeyFingerprint: null, trustPolicy: 'pinned', connectTimeoutMs: 15000,
      })).toThrow(/凭据已停用/)

      const columns = harness.store.db.prepare('PRAGMA table_info(credential_metadata)').all() as Array<{ name: string }>
      expect(columns.map((column) => column.name)).not.toContain('secret')
      expect(columns.map((column) => column.name)).not.toContain('password')
      const raw = harness.store.db.prepare('SELECT * FROM credential_metadata WHERE id=?').get(credential.id) as Record<string, unknown>
      expect(JSON.stringify(raw)).not.toContain('PRIVATE KEY')
    } finally {
      harness.close()
    }
  }, 30_000)
})
