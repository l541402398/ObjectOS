import { createHash } from 'node:crypto'
import { exec, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { AppError, newId, now, type AutonomyMode, type ProjectEvent } from '@projectos/contracts'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import type { CoreServices } from '@projectos/application'
import type { SqliteStore } from '@projectos/persistence'
import { getGitStatus } from '@projectos/workspace'
import { redactSecrets } from '@projectos/policy'
import { failureSignature, findingFingerprint } from './finding-fingerprint.js'
import { QualityGateService } from './quality-gate.js'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function excerpt(value: string, max = 4000): string {
  return redactSecrets(value).slice(-max)
}

type AuditResult = { status: 'passed' | 'failed' | 'unavailable'; vulnerabilities: number | null; reason: string | null }

/**
 * Runs the package manager's audit (sends the dependency list to the configured registry).
 * Only a response carrying vulnerability metadata counts as a scan; anything else is unavailable.
 */
async function dependencyAudit(root: string): Promise<AuditResult> {
  const command = existsSync(join(root, 'pnpm-lock.yaml'))
    ? 'pnpm audit --json --prod'
    : existsSync(join(root, 'package-lock.json'))
      ? 'npm audit --json --omit=dev'
      : null
  if (!command) return { status: 'unavailable', vulnerabilities: null, reason: '未找到 pnpm-lock.yaml 或 package-lock.json' }
  let stdout = ''
  try {
    stdout = (await promisify(exec)(command, { cwd: root, timeout: 30_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout
  } catch (error) {
    // Audit tools exit non-zero when vulnerabilities exist; their JSON is still on stdout.
    stdout = (error as { stdout?: string }).stdout ?? ''
    if (!stdout) return { status: 'unavailable', vulnerabilities: null, reason: (error instanceof Error ? error.message : String(error)).slice(0, 500) }
  }
  try {
    const parsed = JSON.parse(stdout) as {
      metadata?: { vulnerabilities?: Record<string, number> }
      error?: { code?: string; message?: string; summary?: string }
    }
    const counts = parsed.metadata?.vulnerabilities
    if (!counts) {
      const reason = parsed.error?.message ?? parsed.error?.summary ?? parsed.error?.code ?? '审计未返回漏洞数据'
      return { status: 'unavailable', vulnerabilities: null, reason: reason.slice(0, 500) }
    }
    const total = typeof counts.total === 'number' ? counts.total : Object.values(counts).reduce((sum, value) => sum + (Number(value) || 0), 0)
    return { status: total > 0 ? 'failed' : 'passed', vulnerabilities: total, reason: null }
  } catch {
    return { status: 'unavailable', vulnerabilities: null, reason: '审计输出无法解析' }
  }
}

const MAX_AUTO_REPAIR_ATTEMPTS = 2
const CIRCUIT_BREAKER_FAILURES = 3

export function repairRunKey(proposalId: string): string {
  return `repair:${proposalId}`
}
const ACTIVE_PROPOSAL_STATUSES = new Set(['draft', 'pending_approval', 'approved', 'executing', 'completed'])

type ProposalLike = { status: string; findingIds: string[] }

function activeProposalFor(proposals: ProposalLike[], findingId: string): boolean {
  return proposals.some((proposal) => ACTIVE_PROPOSAL_STATUSES.has(proposal.status) && proposal.findingIds.includes(findingId))
}

function failedAttempts(proposals: ProposalLike[], findingId: string): number {
  return proposals.filter((proposal) => proposal.status === 'failed' && proposal.findingIds.includes(findingId)).length
}

export class OperationsService {
  private readonly inFlightChecks = new Map<string, Promise<void>>()

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
      repairAgentId: this.store.read.getAutomationRepairAgentId(projectId),
      checks: this.store.read.listHealthCheckRuns(projectId),
      findings: this.store.read.listFindings(projectId),
      proposals: this.store.read.listProposals(projectId),
      runs: this.store.read.listAutomationRuns(projectId),
      circuitOpen: this.circuitOpen(projectId),
    }
  }

  /** Automatic repairs stop after repeated failures until a human issues a new grant. */
  circuitOpen(projectId: string): boolean {
    const since = this.store.read.getAutomationGrant(projectId)?.issuedAt ?? 0
    return this.store.read.countConsecutiveFailedRepairs(projectId, since) >= CIRCUIT_BREAKER_FAILURES
  }

  /**
   * After a Runtime restart: interrupted health checks are idempotent and simply marked failed;
   * a repair whose plan never started cannot be proven safe and needs a human.
   */
  recoverRuns(): void {
    for (const run of this.store.read.listRunningAutomationRuns()) {
      if (run.kind === 'checks') {
        this.store.finishAutomationRun(run.id, run.leaseToken, 'failed', 'Runtime 重启中断，可重新运行')
      } else if (!run.planId) {
        this.store.finishAutomationRun(run.id, run.leaseToken, 'reconciliation_required', '修复启动过程中 Runtime 中断，请核对 Worktree 后再处理')
      }
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
    /** Normalized failure identity; must not contain paths, times or counters. */
    signature: string
    output: string
    sourceUri: string | null
    revision: string | null
  }): void {
    this.store.recordFinding({
      id: newId('fnd'),
      projectId: input.projectId,
      fingerprint: findingFingerprint(input.projectId, input.checkId, input.signature),
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

  /** Concurrent triggers for the same project share one in-flight check run. */
  async runChecks(projectId: string, source = 'manual', idempotencyKey = `checks:${source}:${newId('aur')}`) {
    const inFlight = this.inFlightChecks.get(projectId)
    if (inFlight) {
      await inFlight
      return this.snapshot(projectId)
    }
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    const claim = this.store.claimAutomationRun({ id: newId('aur'), projectId, kind: 'checks', source, proposalId: null, idempotencyKey })
    if (!claim) return this.snapshot(projectId)
    const run = this.executeChecks(projectId, source)
      .then(
        () => void this.store.finishAutomationRun(claim.id, claim.leaseToken, 'completed'),
        (error: unknown) => {
          this.store.finishAutomationRun(claim.id, claim.leaseToken, 'failed', redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 2000))
          throw error
        },
      )
      .finally(() => this.inFlightChecks.delete(projectId))
    this.inFlightChecks.set(projectId, run)
    await run
    return this.snapshot(projectId)
  }

  /** Domain events that should trigger monitoring; failures inside repair plans are ignored to avoid loops. */
  isTriggerEvent(event: ProjectEvent): boolean {
    let taskId: string | null = null
    if (event.eventType === PROJECT_EVENT_TYPES.taskMoved && event.payload.status === 'blocked') {
      taskId = event.aggregateId
    } else if (
      (event.eventType === PROJECT_EVENT_TYPES.runStatusChanged || event.eventType === PROJECT_EVENT_TYPES.runFailed) &&
      event.payload.status === 'failed'
    ) {
      taskId = this.store.read.getRun(event.aggregateId)?.taskId ?? null
    } else {
      return false
    }
    return !taskId || !this.repairTaskIds(event.projectId).has(taskId)
  }

  /** Tasks created by repair plans; their failures are tracked by the proposal, not as new findings. */
  private repairTaskIds(projectId: string): Set<string> {
    return new Set(
      this.store.read
        .listProposals(projectId)
        .flatMap((proposal) => (proposal.planId ? this.store.read.getPlanRevision(proposal.planId)?.createdTaskIds ?? [] : [])),
    )
  }

  private async executeChecks(projectId: string, source: string): Promise<void> {
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
        signature: 'uncommitted-changes',
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
        status: check.status === 'not_applicable' ? 'skipped' : check.status,
        startedAt: now() - check.durationMs,
        sourceRevision: revision,
        result: {
          command: check.command || null,
          exitCode: check.exitCode,
          durationMs: check.durationMs,
          ...(check.status === 'skipped' || check.status === 'not_applicable' || check.status === 'error'
            ? { reason: excerpt(check.output, 500) }
            : {}),
        },
      })
      if (check.status === 'failed' || check.status === 'error') {
        this.recordFinding({
          projectId,
          checkId: check.name,
          checkRunId: runId,
          category: check.name,
          severity: check.status === 'failed' ? 'high' : 'medium',
          title:
            check.status === 'failed'
              ? `${check.name} 检查失败（exit ${check.exitCode ?? '—'}）`
              : `${check.name} 检查无法完成`,
          signature: failureSignature(check.output, project.rootPath, check.exitCode),
          output: `$ ${check.command}\nexit ${check.exitCode ?? '—'}\n\n${check.output}`,
          sourceUri: check.command,
          revision,
        })
      }
    }

    const repairTasks = this.repairTaskIds(projectId)
    const blocked = this.services.tasks
      .board(projectId)
      .tasks.filter((task) => task.status === 'blocked' && !repairTasks.has(task.id))
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
        signature: 'blocked',
        output: `taskId=${task.id} status=blocked`,
        sourceUri: task.id,
        revision,
      })
    }

    this.store.appendEvent(projectId, projectId, 'operations.checks.completed', {
      source,
      checks: 2 + report.checks.length,
      findings: this.store.read.listFindings(projectId).length,
      revision,
    })
    this.autoTriage(projectId)
  }

  private reconcile(projectId: string): void {
    for (const proposal of this.store.read.listProposals(projectId)) {
      if (!proposal.planId || !['executing', 'completed'].includes(proposal.status)) continue
      const execution = this.store.read.getPlanRevision(proposal.planId)?.execution
      if (!execution) continue
      if (proposal.status === 'executing') {
        const run = this.store.read.getAutomationRunByKey(repairRunKey(proposal.id))
        if (execution.status === 'completed') {
          // A passing candidate patch is not a fix until a human merges it.
          this.store.updateProposalStatus(proposal.id, 'completed')
          if (run) this.store.finishAutomationRun(run.id, run.leaseToken, 'completed')
        } else if (execution.status === 'failed' || execution.status === 'cancelled') {
          this.store.updateProposalStatus(proposal.id, 'failed')
          this.store.transitionProposalFindings(proposal.id, ['in_progress'], 'open')
          if (run) this.store.finishAutomationRun(run.id, run.leaseToken, 'failed', execution.error ?? execution.status)
          continue
        }
      }
      if (execution.mergedAt) {
        this.store.transitionProposalFindings(proposal.id, ['in_progress'], 'resolved')
      } else if (execution.status === 'completed' && !execution.branch) {
        // The candidate worktree was discarded without merging.
        this.store.updateProposalStatus(proposal.id, 'failed')
        this.store.transitionProposalFindings(proposal.id, ['in_progress'], 'open')
      }
    }
  }

  async insights(projectId: string, runAudit = false) {
    const project = this.store.read.getProject(projectId)
    if (!project) throw new AppError('NOT_FOUND', '项目不存在')
    let dependencies = 0
    let devDependencies = 0
    try {
      const pkg = JSON.parse(await readFile(join(project.rootPath, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
      dependencies = Object.keys(pkg.dependencies ?? {}).length
      devDependencies = Object.keys(pkg.devDependencies ?? {}).length
    } catch { /* no manifest */ }
    let ciWorkflows: string[] = []
    try {
      ciWorkflows = (await readdir(join(project.rootPath, '.github', 'workflows'))).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    } catch { /* no workflows */ }
    let gitHooks: string[] = []
    try {
      gitHooks = (await readdir(join(project.rootPath, '.git', 'hooks'))).filter((name) => !name.endsWith('.sample'))
    } catch { /* no hooks */ }
    let changelog = ''
    try {
      const { stdout } = await promisify(execFile)('git', ['log', '-12', '--pretty=format:%h %s'], { cwd: project.rootPath })
      const lines = stdout.split(/\r?\n/).filter(Boolean)
      if (lines.length) changelog = ['# Changelog', '', ...lines.map((line) => `- ${line}`), ''].join('\n')
    } catch { /* no git */ }
    const audit = runAudit ? await dependencyAudit(project.rootPath) : { status: 'not_run' as const, vulnerabilities: null, reason: null }
    return { projectId, ciWorkflows, gitHooks, audit, trend: this.store.read.completionTrend(projectId), changelog, dependencies, devDependencies }
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

  /** Checks and consumes one repair run of the project grant in a single transaction. */
  consumeGrant(projectId: string): void {
    if (!this.store.consumeAutomationGrant(projectId, 'repair')) {
      throw new AppError('APPROVAL_REQUIRED', '没有有效的自主修复授权（已过期、撤销或次数用尽）')
    }
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
    const candidates = this.store.read
      .listFindings(projectId)
      .filter((finding) => (finding.status === 'open' || finding.status === 'reopened') && !activeProposalFor(proposals, finding.id))
      // Stop proposing automatically once a finding has used up its repair attempts.
      .filter((finding) => failedAttempts(proposals, finding.id) < MAX_AUTO_REPAIR_ATTEMPTS)
    if (!candidates.length) return
    const created = this.propose(projectId, candidates.map((finding) => finding.id))
    if (mode === 'approved-autofix' && created && this.risk(created.id).allowed) {
      this.store.updateProposalStatus(created.id, 'approved')
    }
  }

  propose(projectId: string, findingIds: string[]) {
    const findings = this.store.read.listFindings(projectId).filter((finding) => findingIds.includes(finding.id))
    if (!findings.length) throw new AppError('BAD_REQUEST', '没有可提案的 Finding')
    const proposals = this.store.read.listProposals(projectId)
    const busy = findings.filter((finding) => activeProposalFor(proposals, finding.id))
    if (busy.length) throw new AppError('CONFLICT', `已有进行中的提案：${busy.map((finding) => finding.title).join('；')}`)
    const proposal = {
      id: newId('prp'),
      projectId,
      status: 'pending_approval',
      riskLevel: findings.some((finding) => finding.severity === 'critical') ? 'critical' : findings.some((finding) => finding.severity === 'high') ? 'high' : 'medium',
      scope: findings.map((finding) => finding.title),
      acceptanceCriteria: findings.map((finding) => `复现并验证已修复：${finding.title}`),
      findingIds: findings.map((finding) => finding.id),
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
    // A rejected fix stays known but is not proposed again automatically.
    if (status === 'rejected') this.store.transitionProposalFindings(proposalId, ['proposed'], 'triaged')
    return this.store.read.getProposal(proposalId)
  }

  setMode(projectId: string, mode: AutonomyMode, repairAgentId?: string | null) {
    if (!this.store.read.getProject(projectId)) throw new AppError('NOT_FOUND', '项目不存在')
    if (repairAgentId) {
      const agent = this.store.read.getAgent(repairAgentId)
      if (!agent) throw new AppError('NOT_FOUND', '指定的修复 Agent 不存在')
      const definition = this.store.read.getAgentDefinition(repairAgentId)
      if (definition && definition.status !== 'active') {
        throw new AppError('CONFLICT', '指定的修复 Agent 当前不可用')
      }
    }
    this.store.setAutonomyMode(projectId, mode, repairAgentId)
    return this.snapshot(projectId)
  }
}
