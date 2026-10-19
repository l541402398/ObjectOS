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
    this.reconcile(projectId)
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
    this.autoTriage(projectId)
    return this.snapshot(projectId)
  }

  private reconcile(projectId: string): void {
    for (const proposal of this.store.read.listProposals(projectId)) {
      if (proposal.status !== 'executing' || !proposal.planId) continue
      const plan = this.store.read.getPlanRevision(proposal.planId)
      const status = plan?.execution?.status
      if (!status) continue
      if (status === 'completed') {
        this.store.updateProposalStatus(proposal.id, 'completed')
        this.store.resolveProposalFindings(proposal.id)
      } else if (status === 'failed' || status === 'cancelled') {
        this.store.updateProposalStatus(proposal.id, 'failed')
      }
    }
  }

  getGrant(projectId: string) {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    return this.store.read.getAutomationGrant(projectId)
  }

  grant(projectId: string, hours = 24, maxRuns = 5) {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    this.store.upsertAutomationGrant({
      projectId,
      allowedActions: ['repair'],
      allowedPaths: ['.'],
      expiresAt: now() + hours * 3_600_000,
      maxRuns,
    })
    return this.store.read.getAutomationGrant(projectId)
  }

  revokeGrant(projectId: string) {
    if (!this.store.read.getAutomationGrant(projectId)) throw new AppError('NOT_FOUND', '没有可撤销的授权')
    this.store.revokeAutomationGrant(projectId)
    return this.store.read.getAutomationGrant(projectId)
  }

  assertGrant(projectId: string): void {
    const grant = this.store.read.getAutomationGrant(projectId)
    if (!grant || grant.revokedAt || grant.expiresAt <= now() || grant.usedRuns >= grant.maxRuns) {
      throw new AppError('APPROVAL_REQUIRED', '没有有效的自主修复授权')
    }
  }

  consumeGrant(projectId: string): void {
    this.store.consumeAutomationGrant(projectId)
  }

  risk(proposalId: string) {
    const proposal = this.store.read.getProposal(proposalId)
    if (!proposal) throw new AppError('NOT_FOUND', '修复提案不存在')
    const mode = this.store.read.getAutonomyMode(proposal.projectId)
    const grant = this.store.read.getAutomationGrant(proposal.projectId)
    const grantValid = Boolean(grant && !grant.revokedAt && grant.expiresAt > now() && grant.usedRuns < grant.maxRuns)
    const requiresApproval = proposal.riskLevel === 'high' || proposal.riskLevel === 'critical'
    const reasons = [
      `风险级别：${proposal.riskLevel}`,
      `模式：${mode}`,
      grantValid ? '授权有效' : '无有效授权',
    ]
    if (requiresApproval) reasons.push('高风险必须人工批准')
    return {
      proposalId,
      level: proposal.riskLevel,
      allowed: mode === 'approved-autofix' && !requiresApproval && grantValid,
      requiresApproval,
      reasons,
    }
  }

  private autoTriage(projectId: string): void {
    const mode = this.store.read.getAutonomyMode(projectId)
    if (mode === 'observe') return
    const proposals = this.store.read.listProposals(projectId)
    const covered = new Set(proposals.flatMap((proposal) => proposal.findingIds))
    const open = this.store.read.listFindings(projectId).filter((finding) => finding.status === 'open' && !covered.has(finding.id))
    if (open.length) {
      const created = this.propose(projectId, open.map((finding) => finding.id))
      if (mode === 'approved-autofix' && created) {
        const decision = this.risk(created.id)
        if (decision.allowed) this.store.updateProposalStatus(created.id, 'approved')
      }
    }
  }

  propose(projectId: string, findingIds: string[]) {    const findings = this.store.read.listFindings(projectId).filter((finding) => findingIds.includes(finding.id))
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



