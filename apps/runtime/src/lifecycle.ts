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
  type RecordEvidenceInput,
  type Evidence,
  type GateOverview,
  type GateCondition,
  type GateEvaluation,
  type GateDefinition,
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

const GATE_FOR_TARGET: Partial<Record<VersionPhase, string>> = {
  discovery: 'version-discovery',
  build: 'version-build',
  verify: 'version-verify',
  release_candidate: 'version-release',
  released: 'version-release',
}

const DEFAULT_GATE_CONDITIONS: Record<string, GateCondition[]> = {
  'version-discovery': [
    { evidenceType: 'review_record', requiredStatus: 'passed', minAssurance: 'self_declared', allowSelfDeclared: true },
  ],
  'version-build': [
    { evidenceType: 'review_record', requiredStatus: 'passed', minAssurance: 'self_declared', allowSelfDeclared: true },
  ],
  'version-verify': [
    { evidenceType: 'test_report', requiredStatus: 'passed', minAssurance: 'source_observed', allowSelfDeclared: false },
  ],
  'version-release': [
    { evidenceType: 'test_report', requiredStatus: 'passed', minAssurance: 'source_observed', allowSelfDeclared: false },
    { evidenceType: 'approval_record', requiredStatus: 'passed', minAssurance: 'self_declared', allowSelfDeclared: true },
  ],
}

const ASSURANCE_RANK: Record<string, number> = {
  self_declared: 0,
  source_observed: 1,
  independently_reproduced: 2,
  externally_confirmed: 3,
}

export class LifecycleService {
  constructor(private readonly store: SqliteStore) {}

  overview(projectId: string): LifecycleOverview {
    const overview = this.store.read.getLifecycleOverview(projectId)
    if (!overview) throw new AppError('NOT_FOUND', '项目不存在')
    return overview
  }

  /**
   * The next phase that is actually guarded by a gate. Used by the autonomy
   * coordinator and the action center so both agree on what "next" means.
   */
  nextGatedPhase(phase: VersionPhase): VersionPhase | null {
    const candidates = VERSION_TRANSITIONS[phase] ?? []
    return candidates.find((item) => Boolean(GATE_FOR_TARGET[item])) ?? null
  }

  /**
   * Versions whose next gated hop is currently blocked, with the concrete reasons.
   * Read-only: the action center turns these into explicit "what is missing" items.
   */
  blockedGates(projectId: string): Array<{ versionId: string; version: string; phase: VersionPhase; to: VersionPhase; missing: string[] }> {
    const versions = this.store.read.listProductVersions(projectId)
    const blocked: Array<{ versionId: string; version: string; phase: VersionPhase; to: VersionPhase; missing: string[] }> = []
    for (const version of versions) {
      const to = this.nextGatedPhase(version.phase)
      if (!to) continue
      let evaluation: GateEvaluation
      try {
        evaluation = this.computeVersionGate(version, to)
      } catch {
        // A project whose gate definitions are not seeded yet, or a gate removed mid
        // flight, must not break the whole action list.
        continue
      }
      if (evaluation.status === 'passed') continue
      blocked.push({
        versionId: version.id,
        version: version.version,
        phase: version.phase,
        to,
        missing: evaluation.conditionResults.filter((item) => !item.satisfied).map((item) => item.reason),
      })
    }
    return blocked
  }

  products(projectId: string): Product[] {
    return this.store.read.listProducts(projectId)
  }

  recordEvidence(input: RecordEvidenceInput): Evidence {
    return this.store.transaction(() => {
      const project = this.store.read.getProject(input.projectId)
      if (!project) throw new AppError('NOT_FOUND', '项目不存在')
      this.assertSubject(input.projectId, input.subjectType, input.subjectId)
      const id = newId('evd')
      const timestamp = now()
      this.store.db
        .prepare(
          `INSERT INTO evidence (id, project_id, evidence_type, verification_status, assurance, title, summary, provenance_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.projectId,
          input.evidenceType,
          input.verificationStatus,
          input.assurance,
          input.title,
          input.summary,
          JSON.stringify(input.provenance),
          timestamp,
          timestamp,
        )
      this.store.db
        .prepare(
          `INSERT INTO evidence_links (evidence_id, link_type, subject_type, subject_id, created_at)
           VALUES (?, 'supports', ?, ?, ?)`,
        )
        .run(id, input.subjectType, input.subjectId, timestamp)
      return {
        id,
        projectId: input.projectId,
        evidenceType: input.evidenceType,
        verificationStatus: input.verificationStatus,
        assurance: input.assurance,
        title: input.title,
        summary: input.summary,
        provenance: input.provenance,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
    })
  }

  gateOverview(projectId: string, subjectType: string, subjectId: string): GateOverview {
    this.assertSubject(projectId, subjectType, subjectId)
    this.ensureDefaultGates(projectId)
    const definitions = this.listGateDefinitions(projectId)
    const evaluations = this.listGateEvaluations(subjectType, subjectId)
    const evidence = this.listEvidence(subjectType, subjectId)
    return { definitions, evaluations, evidence }
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

  transitionVersion(input: TransitionVersionInput, options?: { beforeCommit?: () => void }): ProductVersion {
    const version = this.getVersion(input.versionId)
    if (!VERSION_TRANSITIONS[version.phase]?.includes(input.to)) {
      throw new AppError('CONFLICT', `版本不能从 ${version.phase} 直接进入 ${input.to}`)
    }
    if (input.to !== 'retired') {
      const gate = this.evaluateVersionGate(version, input.to)
      if (gate.status !== 'passed') {
        throw new AppError('CONFLICT', `版本门禁未通过：${gate.conditionResults.filter((item) => !item.satisfied).map((item) => item.reason).join('；')}`, {
          details: gate,
        })
      }
    }
    options?.beforeCommit?.()
    if (input.to !== 'retired') {
      const preCommitVersion = this.getVersion(version.id)
      const preCommitGate = this.computeVersionGate(preCommitVersion, input.to)
      if (preCommitGate.status !== 'passed') {
        this.persistGateEvaluation(preCommitGate)
        throw new AppError('CONFLICT', `版本门禁在提交前失效：${preCommitGate.conditionResults.filter((item) => !item.satisfied).map((item) => item.reason).join('；')}`, {
          details: preCommitGate,
        })
      }
    }
    return this.store.transaction(() => {
      const current = this.getVersion(version.id)
      if (current.phase !== version.phase || current.updatedAt !== version.updatedAt) {
        throw new AppError('CONFLICT', '版本阶段已被其他操作修改，请重新评估门禁后重试')
      }
      // Re-check immediately before the compare-and-swap so evidence removed or
      // downgraded between the first evaluation and this commit cannot advance.
      if (input.to !== 'retired') {
        const recheck = this.computeVersionGate(current, input.to)
        if (recheck.status !== 'passed') {
          throw new AppError('CONFLICT', `版本门禁在提交前失效：${recheck.conditionResults.filter((item) => !item.satisfied).map((item) => item.reason).join('；')}`, {
            details: recheck,
          })
        }
      }
      const timestamp = now()
      const result = this.store.db
        .prepare(
          `UPDATE product_versions
           SET phase = ?, released_at = CASE WHEN ? = 'released' THEN COALESCE(released_at, ?) ELSE released_at END,
               retired_at = CASE WHEN ? = 'retired' THEN ? ELSE retired_at END, updated_at = ?
           WHERE id = ? AND phase = ? AND updated_at = ?`,
        )
        .run(
          input.to,
          input.to,
          timestamp,
          input.to,
          timestamp,
          timestamp,
          version.id,
          version.phase,
          version.updatedAt,
        )
      if (Number(result.changes) !== 1) {
        throw new AppError('CONFLICT', '版本阶段并发更新失败，请重试')
      }
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

  private ensureDefaultGates(projectId: string): void {
    this.store.transaction(() => {
      const timestamp = now()
      for (const [key, conditions] of Object.entries(DEFAULT_GATE_CONDITIONS)) {
        const existing = this.store.db
          .prepare('SELECT id FROM gate_definitions WHERE project_id = ? AND subject_scope = ? AND key = ?')
          .get(projectId, 'version', key)
        if (existing) continue
        this.store.db
          .prepare(
            `INSERT INTO gate_definitions (id, project_id, subject_scope, key, policy_profile, blocking, conditions_json, created_at, updated_at)
             VALUES (?, ?, 'version', ?, 'default', 1, ?, ?, ?)`,
          )
          .run(newId('gat'), projectId, key, JSON.stringify(conditions), timestamp, timestamp)
      }
    })
  }

  private listGateDefinitions(projectId: string): GateDefinition[] {
    return this.store.db
      .prepare("SELECT * FROM gate_definitions WHERE project_id = ? AND subject_scope = 'version' ORDER BY key")
      .all(projectId)
      .map((row) => {
        const item = row as Record<string, unknown>
        return {
          id: String(item.id),
          projectId: String(item.project_id),
          subjectScope: String(item.subject_scope),
          key: String(item.key),
          policyProfile: String(item.policy_profile),
          blocking: Number(item.blocking) === 1,
          conditions: JSON.parse(String(item.conditions_json ?? '[]')) as GateCondition[],
          createdAt: Number(item.created_at),
          updatedAt: Number(item.updated_at),
        }
      })
  }

  private listGateEvaluations(subjectType: string, subjectId: string): GateEvaluation[] {
    return this.store.db
      .prepare(
        'SELECT * FROM gate_evaluations WHERE subject_type = ? AND subject_id = ? ORDER BY evaluated_at DESC, rowid DESC',
      )
      .all(subjectType, subjectId)
      .map((row) => {
        const item = row as Record<string, unknown>
        return {
          id: String(item.id),
          projectId: String(item.project_id),
          gateId: String(item.gate_id),
          subjectType: String(item.subject_type),
          subjectId: String(item.subject_id),
          status: String(item.status) as GateEvaluation['status'],
          conditionResults: JSON.parse(String(item.condition_results_json ?? '[]')) as GateEvaluation['conditionResults'],
          evaluatedBy: String(item.evaluated_by),
          evaluatedAt: Number(item.evaluated_at),
        }
      })
  }

  private listEvidence(subjectType: string, subjectId: string): Evidence[] {
    return this.store.db
      .prepare(
        `SELECT e.* FROM evidence e
         JOIN evidence_links l ON l.evidence_id = e.id
         WHERE l.subject_type = ? AND l.subject_id = ?
         ORDER BY e.created_at DESC`,
      )
      .all(subjectType, subjectId)
      .map((row) => {
        const item = row as Record<string, unknown>
        return {
          id: String(item.id),
          projectId: String(item.project_id),
          evidenceType: String(item.evidence_type) as Evidence['evidenceType'],
          verificationStatus: String(item.verification_status) as Evidence['verificationStatus'],
          assurance: String(item.assurance) as Evidence['assurance'],
          title: String(item.title),
          summary: String(item.summary ?? ''),
          provenance: JSON.parse(String(item.provenance_json ?? '{}')) as Record<string, unknown>,
          createdAt: Number(item.created_at),
          updatedAt: Number(item.updated_at),
        }
      })
  }

  private computeVersionGate(version: ProductVersion, to: VersionPhase): GateEvaluation {
    const key = GATE_FOR_TARGET[to]
    if (!key) throw new AppError('CONFLICT', `没有为 ${to} 定义门禁`)
    const definition = this.listGateDefinitions(version.projectId).find((item) => item.key === key)
    if (!definition) throw new AppError('CONFLICT', `门禁 ${key} 不存在`)
    const evidence = this.listEvidence('version', version.id)
    const conditionResults = definition.conditions.map((condition, conditionIndex) => {
      const candidates = evidence.filter((item) => item.evidenceType === condition.evidenceType)
      const usable = candidates.filter((item) => {
        if (item.verificationStatus !== condition.requiredStatus) return false
        if (!condition.allowSelfDeclared && item.assurance === 'self_declared') return false
        return (ASSURANCE_RANK[item.assurance] ?? -1) >= (ASSURANCE_RANK[condition.minAssurance] ?? 0)
      })
      return {
        conditionIndex,
        satisfied: usable.length > 0,
        evidenceIds: usable.map((item) => item.id),
        reason: usable.length
          ? `${condition.evidenceType} 已满足`
          : candidates.length
            ? `${condition.evidenceType} 存在但状态/保证程度不足（需要 ${condition.requiredStatus}/${condition.minAssurance}）`
            : `缺少 ${condition.evidenceType}（需要 ${condition.requiredStatus}/${condition.minAssurance}）`,
      }
    })
    const status: GateEvaluation['status'] = conditionResults.every((item) => item.satisfied) ? 'passed' : 'failed'
    return {
      id: newId('gev'),
      projectId: version.projectId,
      gateId: definition.id,
      subjectType: 'version',
      subjectId: version.id,
      status,
      conditionResults,
      evaluatedBy: 'system',
      evaluatedAt: now(),
    }
  }

  private persistGateEvaluation(evaluation: GateEvaluation): void {
    this.store.db
      .prepare(
        `INSERT INTO gate_evaluations (id, project_id, gate_id, subject_type, subject_id, status, condition_results_json, evaluated_by, evaluated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        evaluation.id,
        evaluation.projectId,
        evaluation.gateId,
        evaluation.subjectType,
        evaluation.subjectId,
        evaluation.status,
        JSON.stringify(evaluation.conditionResults),
        evaluation.evaluatedBy,
        evaluation.evaluatedAt,
      )
  }

  private evaluateVersionGate(version: ProductVersion, to: VersionPhase): GateEvaluation {
    this.ensureDefaultGates(version.projectId)
    const evaluation = this.computeVersionGate(version, to)
    this.persistGateEvaluation(evaluation)
    return evaluation
  }

  private assertSubject(projectId: string, subjectType: string, subjectId: string): void {
    if (subjectType === 'version') {
      if (!this.store.read.listProductVersions(projectId).some((item) => item.id === subjectId)) {
        throw new AppError('NOT_FOUND', '版本不存在')
      }
      return
    }
    if (subjectType === 'iteration') {
      if (!this.store.read.listIterations(projectId).some((item) => item.id === subjectId)) {
        throw new AppError('NOT_FOUND', '迭代不存在')
      }
      return
    }
    if (subjectType === 'task') {
      const task = this.store.read.getTask(subjectId)
      if (!task || task.projectId !== projectId) throw new AppError('NOT_FOUND', '任务不存在')
      return
    }
    throw new AppError('NOT_FOUND', '该证据主体尚未实现')
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
