import { createHash } from 'node:crypto'
import { AppError, newId, now, type AutonomyMode } from '@projectos/contracts'
import type { CoreServices } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import { getGitStatus } from '@projectos/workspace'
import { QualityGateService } from './quality-gate.js'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function excerpt(value: string, max = 4000): string {
  return value.slice(-max)
}

export class OperationsService {
  constructor(
    private readonly store: SqliteStore,
    private readonly services: CoreServices,
    private readonly qualityGate = new QualityGateService(),
  ) {}

  snapshot(projectId: string) {
    const project = this.store.read.getProject(projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    return {
      projectId,
      mode: this.store.read.getAutonomyMode(projectId),
      checks: this.store.read.listHealthCheckRuns(projectId),
      findings: this.store.read.listFindings(projectId),
      proposals: this.store.read.listProposals(projectId),
    }
  }

  private persistCheck(input: {
    projectId: string
    checkId: string
    status: 'passed' | 'failed' | 'error' | 'skipped'
    startedAt: number
    sourceRevision: string | null
    result: Record<string, unknown>
  }): string {
    const id = newId('hcr')
    this.store.createHealthCheckRun({
      id,
      projectId: input.projectId,
      checkId: input.checkId,
      sourceRevision: input.sourceRevision,
      status: input.status,
      startedAt: input.startedAt,
      finishedAt: now(),
      result: input.result,
    })
    return id
  }

  private recordFinding(input: {
    projectId: string
    checkId: string
    checkRunId: string
    category: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    title: string
    output: string
    sourceUri: string | null
    revision: string | null
  }): void {
    const normalized = input.output.replace(/[A-Za-z]:\\[^\s:]+/g, '<path>').replace(/\d{4}-\d{2}-\d{2}T[^\s]+/g, '<time>')
    const fingerprint = hash(`${input.projectId}:${input.checkId}:${hash(normalized).slice(0, 24)}`)
    this.store.recordFinding({
      id: newId('fnd'),
      projectId: input.projectId,
      fingerprint,
      category: input.category,
      severity: input.severity,
      title: input.title,
      checkRunId: input.checkRunId,
      evidenceId: newId('fev'),
      sourceUri: input.sourceUri,
      sourceRevision: input.revision,
      excerpt: excerpt(input.output),
      contentHash: hash(input.output),
      at: now(),
    })
  }

  async runChecks(projectId: string) {
    const project = this.store.read.getProject(projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    const git = await getGitStatus(project.rootPath)
    const revision = git?.lastCommit?.hash ?? null
    const startedAt = now()

    const gitRun = this.persistCheck({
      projectId,
      checkId: 'git-status',
      status: git ? 'passed' : 'error',
      startedAt,
      sourceRevision: revision,
      result: { branch: git?.branch ?? null, clean: git?.clean ?? null, changedFiles: git?.changes.length ?? 0 },
    })
    if (git && !git.clean) {
      this.recordFinding({
        projectId,
        checkId: 'git-status',
        checkRunId: gitRun,
        category: 'git',
        severity: 'low',
        title: `工作区有 ${git.changes.length} 个未提交改动`,
        output: `branch=${git.branch} changedFiles=${git.changes.length} clean=false`,
        sourceUri: git.branch,
        revision,
      })
    }

    const report = await this.qualityGate.run(project.rootPath)
    for (const check of report.checks) {
      const runId = this.persistCheck({
        projectId,
        checkId: check.name,
        status: check.status === 'passed' ? 'passed' : check.status === 'failed' ? 'failed' : 'skipped',
        startedAt: check.durationMs ? now() - check.durationMs : now(),
        sourceRevision: revision,
        result: { command: check.command, exitCode: check.exitCode, durationMs: check.durationMs },
      })
      if (check.status === 'failed') {
        this.recordFinding({
          projectId,
          checkId: check.name,
          checkRunId: runId,
          category: check.name,
          severity: 'high',
          title: `${check.name} 检查失败（exit ${check.exitCode ?? '—'}）`,
          output: check.output || check.command,
          sourceUri: check.command,
          revision,
        })
      }
    }

    const blocked = this.services.tasks.board(projectId).tasks.filter((task) => task.status === 'blocked')
    const blockedRun = this.persistCheck({
      projectId,
      checkId: 'task-blocked',
      status: blocked.length ? 'failed' : 'passed',
      startedAt: now(),
      sourceRevision: revision,
      result: { blocked: blocked.length, taskIds: blocked.slice(0, 20).map((task) => task.id) },
    })
    for (const task of blocked.slice(0, 20)) {
      this.recordFinding({
        projectId,
        checkId: `task-blocked:${task.id}`,
        checkRunId: blockedRun,
        category: 'task',
        severity: 'medium',
        title: `任务阻塞：${task.title}`,
        output: `taskId=${task.id} status=blocked`,
        sourceUri: task.id,
        revision,
      })
    }

    this.store.appendEvent(projectId, projectId, 'operations.checks.completed', {
      checks: 3 + report.checks.length,
      findings: this.store.read.listFindings(projectId).length,
      revision,
    })
    return this.snapshot(projectId)
  }

  propose(projectId: string, findingIds: string[]) {
    const findings = this.store.read.listFindings(projectId).filter((finding) => findingIds.includes(finding.id))
    if (!findings.length) throw new AppError('BAD_REQUEST', '没有可提案的 Finding')
    const proposal = {
      id: newId('prp'),
      projectId,
      status: 'pending_approval',
      riskLevel: findings.some((finding) => finding.severity === 'critical') ? 'critical' : findings.some((finding) => finding.severity === 'high') ? 'high' : 'medium',
      scope: findings.map((finding) => finding.title),
      acceptanceCriteria: findings.map((finding) => `复现并验证已修复：${finding.title}`),
      findingIds,
      createdAt: now(),
    }
    this.store.createRepairProposal(proposal)
    return this.store.read.getProposal(proposal.id)
  }

  reviewProposal(proposalId: string, decision: 'approved' | 'rejected') {
    const proposal = this.store.read.getProposal(proposalId)
    if (!proposal) throw new AppError('NOT_FOUND', '修复提案不存在')
    if (proposal.status !== 'pending_approval') throw new AppError('CONFLICT', '提案不在待审批状态')
    const status = decision === 'approved' ? 'approved' : 'rejected'
    this.store.updateProposalStatus(proposalId, status)
    return this.store.read.getProposal(proposalId)
  }

  setMode(projectId: string, mode: AutonomyMode) {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    this.store.setAutonomyMode(projectId, mode)
    return this.snapshot(projectId)
  }
}


