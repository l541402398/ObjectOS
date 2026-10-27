import {
  AppError,
  newId,
  now,
  type CreateEnvironmentInput,
  type CreateIterationInput,
  type CreateVersionInput,
  type Environment,
  type Iteration,
  type LifecycleOverview,
  type Product,
  type ProductVersion,
  type ProjectFocus,
  type SetProjectFocusInput,
  type TransitionVersionInput,
  type VersionPhase,
} from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

const VERSION_TRANSITIONS: Record<VersionPhase, VersionPhase[]> = {
  planned: ['discovery', 'build', 'retired'],
  discovery: ['build', 'retired'],
  build: ['verify', 'retired'],
  verify: ['build', 'release_candidate', 'retired'],
  release_candidate: ['released', 'verify', 'retired'],
  released: ['maintenance', 'retired'],
  maintenance: ['released', 'retired'],
  retired: [],
}

export class LifecycleService {
  constructor(private readonly store: SqliteStore) {}

  overview(projectId: string): LifecycleOverview {
    const overview = this.store.read.getLifecycleOverview(projectId)
    if (!overview) throw new AppError('NOT_FOUND', '项目不存在')
    return overview
  }

  products(projectId: string): Product[] {
    return this.store.read.listProducts(projectId)
  }

  createVersion(input: CreateVersionInput): ProductVersion {
    return this.store.transaction(() => {
      const project = this.store.read.getProject(input.projectId)
      if (!project) throw new AppError('NOT_FOUND', '项目不存在')
      const product = this.store.read.listProducts(input.projectId).find((item) => item.id === input.productId)
      if (!product) throw new AppError('NOT_FOUND', '产品不存在')
      const duplicate = this.store.read
        .listProductVersions(input.projectId)
        .some((item) => item.productId === input.productId && item.version === input.version)
      if (duplicate) throw new AppError('CONFLICT', `版本 ${input.version} 已存在`)
      const timestamp = now()
      if (input.isDefault) {
        this.store.db
          .prepare('UPDATE product_versions SET is_default = 0, updated_at = ? WHERE project_id = ?')
          .run(timestamp, input.projectId)
      }
      const id = newId('ver')
      this.store.db
        .prepare(
          `INSERT INTO product_versions (id, project_id, product_id, version, phase, support_level, is_default, planned_at, released_at, retired_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'normal', ?, ?, NULL, NULL, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.productId,
          input.version,
          input.phase,
          input.isDefault ? 1 : 0,
          input.phase === 'planned' || input.phase === 'discovery' ? timestamp : null,
          timestamp,
          timestamp,
        )
      if (input.isDefault) {
        this.store.db
          .prepare(
            `INSERT INTO project_focus (project_id, subject_type, subject_id, updated_at)
             VALUES (?, 'version', ?, ?)
             ON CONFLICT(project_id) DO UPDATE SET subject_type = 'version', subject_id = excluded.subject_id, updated_at = excluded.updated_at`,
          )
          .run(input.projectId, id, timestamp)
      }
      return this.getVersion(id)
    })
  }

  transitionVersion(input: TransitionVersionInput): ProductVersion {
    return this.store.transaction(() => {
      const version = this.getVersion(input.versionId)
      if (!VERSION_TRANSITIONS[version.phase]?.includes(input.to)) {
        throw new AppError('CONFLICT', `版本不能从 ${version.phase} 直接进入 ${input.to}`)
      }
      const timestamp = now()
      this.store.db
        .prepare(
          `UPDATE product_versions
           SET phase = ?, released_at = CASE WHEN ? = 'released' THEN COALESCE(released_at, ?) ELSE released_at END,
               retired_at = CASE WHEN ? = 'retired' THEN ? ELSE retired_at END, updated_at = ?
           WHERE id = ?`,
        )
        .run(input.to, input.to, timestamp, input.to, timestamp, timestamp, version.id)
      return this.getVersion(version.id)
    })
  }

  createIteration(input: CreateIterationInput): Iteration {
    return this.store.transaction(() => {
      const version = this.getVersion(input.versionId)
      if (version.projectId !== input.projectId) throw new AppError('NOT_FOUND', '版本不属于该项目')
      const timestamp = now()
      const id = newId('itr')
      this.store.db
        .prepare(
          `INSERT INTO iterations (id, project_id, version_id, name, goal, status, starts_at, ends_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.versionId,
          input.name,
          input.goal,
          input.startsAt ?? null,
          input.endsAt ?? null,
          timestamp,
          timestamp,
        )
      return this.getIteration(id)
    })
  }

  setIterationStatus(iterationId: string, status: Iteration['status']): Iteration {
    return this.store.transaction(() => {
      const iteration = this.getIteration(iterationId)
      if (iteration.status === 'cancelled' || iteration.status === 'closed') {
        throw new AppError('CONFLICT', '已结束的迭代不能改状态')
      }
      this.store.db
        .prepare('UPDATE iterations SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, now(), iteration.id)
      return this.getIteration(iteration.id)
    })
  }

  createEnvironment(input: CreateEnvironmentInput): Environment {
    return this.store.transaction(() => {
      const project = this.store.read.getProject(input.projectId)
      if (!project) throw new AppError('NOT_FOUND', '项目不存在')
      const duplicate = this.store.read.listEnvironments(input.projectId).some((item) => item.key === input.key)
      if (duplicate) throw new AppError('CONFLICT', `环境 ${input.key} 已存在`)
      const timestamp = now()
      const id = newId('env')
      const nextOrder =
        Math.max(0, ...this.store.read.listEnvironments(input.projectId).map((item) => item.sortOrder + 1))
      this.store.db
        .prepare(
          `INSERT INTO environments (id, project_id, key, name, kind, protected, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, input.projectId, input.key, input.name, input.kind, input.protected ? 1 : 0, nextOrder, timestamp, timestamp)
      const environment = this.store.read.listEnvironments(input.projectId).find((item) => item.id === id)
      if (!environment) throw new AppError('INTERNAL', '环境创建失败')
      return environment
    })
  }

  setFocus(input: SetProjectFocusInput): ProjectFocus {
    return this.store.transaction(() => {
      const project = this.store.read.getProject(input.projectId)
      if (!project) throw new AppError('NOT_FOUND', '项目不存在')
      if (input.subjectId) {
        const exists =
          input.subjectType === 'version'
            ? this.store.read.listProductVersions(input.projectId).some((item) => item.id === input.subjectId)
            : input.subjectType === 'iteration'
              ? this.store.read.listIterations(input.projectId).some((item) => item.id === input.subjectId)
              : true
        if (!exists) throw new AppError('NOT_FOUND', '关注对象不存在')
      }
      const timestamp = now()
      this.store.db
        .prepare(
          `INSERT INTO project_focus (project_id, subject_type, subject_id, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(project_id) DO UPDATE SET subject_type = excluded.subject_type, subject_id = excluded.subject_id, updated_at = excluded.updated_at`,
        )
        .run(input.projectId, input.subjectType, input.subjectId ?? null, timestamp)
      return {
        projectId: input.projectId,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        updatedAt: timestamp,
      }
    })
  }

  private getVersion(id: string): ProductVersion {
    const row = this.store.db.prepare('SELECT project_id FROM product_versions WHERE id = ?').get(id) as
      | { project_id?: string }
      | undefined
    if (!row?.project_id) throw new AppError('NOT_FOUND', '版本不存在')
    const version = this.store.read.listProductVersions(row.project_id).find((item) => item.id === id)
    if (!version) throw new AppError('NOT_FOUND', '版本不存在')
    return version
  }

  private getIteration(id: string): Iteration {
    const row = this.store.db.prepare('SELECT project_id FROM iterations WHERE id = ?').get(id) as
      | { project_id?: string }
      | undefined
    if (!row?.project_id) throw new AppError('NOT_FOUND', '迭代不存在')
    const iteration = this.store.read.listIterations(row.project_id).find((item) => item.id === id)
    if (!iteration) throw new AppError('NOT_FOUND', '迭代不存在')
    return iteration
  }
}
