import { describe, expect, it } from 'vitest'
import { SqliteStore } from '@projectos/persistence'

describe('knowledge full text search', () => {
  it('indexes and searches knowledge entries', () => {
    const store = new SqliteStore({ filePath: ':memory:' })
    try {
      const projects = store.read.listProjects?.() ?? []
      void projects
      // createKnowledge requires a project FK
      const now = Date.now()
      store.createProject({
        id: 'prj_01knowledge0000000000000000',
        name: 'Knowledge test',
        description: '',
        rootPath: 'C:/tmp/knowledge',
        status: 'active',
        currentStage: 'ideation',
        version: 0,
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      }, [])
      store.createKnowledge({
        id: 'knw_01knowledge0000000000000001',
        projectId: 'prj_01knowledge0000000000000000',
        title: 'RBAC architecture',
        body: 'Permission checks use roles and policies.',
        sourceUri: 'projectos://test',
        sourceVersion: '1',
      })
      expect(store.read.searchKnowledge('prj_01knowledge0000000000000000', 'RBAC')).toHaveLength(1)
      expect(store.read.searchKnowledge('prj_01knowledge0000000000000000', 'policies')).toHaveLength(1)
      expect(store.read.searchKnowledge('prj_01knowledge0000000000000000', 'missing')).toHaveLength(0)
    } finally {
      store.close()
    }
  })
})


