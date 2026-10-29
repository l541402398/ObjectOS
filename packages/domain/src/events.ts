import type { ProjectEvent, TaskStatus } from '@projectos/contracts'
import { AppError } from '@projectos/contracts'

export const PROJECT_EVENT_TYPES = {
  projectCreated: 'project.created',
  projectUpdated: 'project.updated',
  stageAdvanced: 'project.stage.advanced',
  requirementCreated: 'requirement.created',
  requirementStatusChanged: 'requirement.status.changed',
  milestoneCreated: 'milestone.created',
  milestoneStatusChanged: 'milestone.status.changed',
  decisionCreated: 'decision.created',
  decisionStatusChanged: 'decision.status.changed',
  taskCreated: 'task.created',
  taskUpdated: 'task.updated',
  taskMoved: 'task.moved',
  taskDependencyAdded: 'task.dependency.added',
  taskDependencyRemoved: 'task.dependency.removed',
  taskCompleted: 'task.completed',
  sessionCreated: 'session.created',
  messageSent: 'message.sent',
  runStarted: 'run.started',
  runStatusChanged: 'run.status.changed',
  runCompleted: 'run.completed',
  runFailed: 'run.failed',
  runReconciled: 'run.reconciled',
  toolRequested: 'tool.requested',
  toolCompleted: 'tool.completed',
  toolFailed: 'tool.failed',
  approvalRequested: 'approval.requested',
  approvalDecided: 'approval.decided',
  artifactCreated: 'artifact.created',
  artifactVerified: 'artifact.verified',
  handoffRequested: 'handoff.requested',
  handoffAccepted: 'handoff.accepted',
  handoffRejected: 'handoff.rejected',
  handoffCancelled: 'handoff.cancelled',
  handoffExpired: 'handoff.expired',
  handoffContinued: 'handoff.continued',
  handoffPolicyChanged: 'handoff.policy.changed',
  messageDelivered: 'message.delivered',
  messageAcknowledged: 'message.acknowledged',
  knowledgeCreated: 'knowledge.created',
  planGenerated: 'plan.generated',
  planStatusChanged: 'plan.status.changed',
  planGrantIssued: 'plan.grant.issued',
  planGrantRevoked: 'plan.grant.revoked',
  planGrantStarted: 'plan.grant.started',
  planGrantConsumed: 'plan.grant.consumed',
  planGrantInvalidated: 'plan.grant.invalidated',
  planGrantAmended: 'plan.grant.amended',
  planTaskReused: 'plan.task.reused',
  replanProposed: 'plan.replan.proposed',
  replanApplied: 'plan.replan.applied',
  replanRejected: 'plan.replan.rejected',
  replanFailed: 'plan.replan.failed',
  planExecutionFailureClassified: 'plan.execution.failure_classified',
  handoffReassignmentProposed: 'handoff.reassignment.proposed',
  custom: 'project.event',
} as const

export type ProjectEventType = (typeof PROJECT_EVENT_TYPES)[keyof typeof PROJECT_EVENT_TYPES]

const RUN_STATUS_COPY: Record<string, string> = {
  created: '已创建',
  queued: '排队等待执行',
  running: '开始执行',
  waiting_tool: '等待工具返回',
  waiting_approval: '等待你的审批',
  verifying: '正在验证结果',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  needs_reconciliation: '待人工对账',
  timed_out: '超时终止',
  budget_exhausted: '预算用尽',
}

const PLAN_STATUS_COPY: Record<string, string> = {
  draft: '草案待批准',
  approved: '已批准',
  rejected: '已拒绝',
  superseded: '已被新版本替代',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '执行失败',
  cancelled: '已取消',
}

/** Why a plan changed state, in user language (never the internal reason code). */
const PLAN_REASON_COPY: Record<string, string> = {
  'policy.autoStart': '由授权策略自动开始',
  'approval.waiting': '等待审批期间暂停',
  'approval.settled': '审批完成后自动恢复',
  'policy.within-grant': '授权范围内自动应用修订',
  'user.approvedScopeDelta': '你批准范围差异后应用修订',
}

const FAILURE_CLASS_COPY: Record<string, string> = {
  quality_gate: '质量门禁未通过',
  verification_failed: '真实验证未通过',
  implementation: '实现存在缺陷',
  evidence: '完成证据不足',
  task_design: '任务设计需要调整',
  provider_protocol: '模型服务协议异常',
  provider_auth: '模型服务鉴权失败',
  provider_unavailable: '模型服务暂不可用',
  environment: '执行环境有问题',
  tool_error: '工具执行出错',
  agent_unavailable: 'Agent 不可用',
  unknown: '原因尚未归类',
}

/** Internal kinds written as `project.event` payloads. */
const CUSTOM_KIND_COPY: Record<string, string> = {
  'plan.autoDelivered': '成果已自动合并交付',
  'plan.mergedVerificationFailed': '成果已合并，但合并后验证未通过',
  'plan.delivery.blocked': '交付暂被阻断',
  'plan.delivery.mergeFailed': '合并失败',
  'plan.reviewEvidenceRecorded': '已记录审查通过证据',
  'plan.review.reopened': '已安排复审当前内容',
  'plan.replan.authorization': '已评估修订授权范围',
  'plan.replan.contractRejected': '修订未通过任务契约预检',
  'plan.replan.applyFailed': '应用修订失败',
  'plan.contract.rejected': '计划未通过任务契约预检',
  'project.autonomyPolicyChanged': '项目自主策略已更新',
}

const RUN_TRIGGER_COPY: Record<string, string> = {
  evidence_exhausted: '证据不足',
  retry_exhausted: '重试次数用尽',
  quality_gate_failed: '质量门禁未通过',
  agent_unavailable: 'Agent 不可用',
  artifact_invalid: '交付物不合格',
  user_requested: '你要求调整',
  constraints_changed: '约束发生变化',
}

const TASK_STATUS_COPY: Record<TaskStatus, string> = {
  backlog: '移入待规划',
  ready: '标记为就绪',
  running: '开始执行',
  review: '提交审查',
  done: '完成',
  blocked: '标记为受阻',
  cancelled: '取消',
}

function toolNameOf(payload: Record<string, unknown>): string {
  const name = typeof payload.toolName === 'string' ? payload.toolName : typeof payload.name === 'string' ? payload.name : ''
  return name
}

/**
 * A short, user-facing label for an event badge. The raw type stays available in the payload and
 * as a tooltip; it must never be the visible text (a user does not know what `run.status.changed` is).
 */
export function eventTypeLabel(eventType: string): string {
  if (eventType.startsWith('run.')) return '运行'
  if (eventType.startsWith('tool.')) return '工具'
  if (eventType.startsWith('plan.')) return '计划'
  if (eventType.startsWith('task.')) return '任务'
  if (eventType.startsWith('approval.')) return '审批'
  if (eventType.startsWith('artifact.')) return '交付物'
  if (eventType.startsWith('handoff.')) return '交接'
  if (eventType.startsWith('message.') || eventType.startsWith('inbox.')) return '消息'
  if (eventType.startsWith('requirement.')) return '需求'
  if (eventType.startsWith('milestone.')) return '里程碑'
  if (eventType.startsWith('decision.')) return '决策'
  if (eventType.startsWith('knowledge.')) return '知识'
  if (eventType.startsWith('session.')) return '会话'
  if (eventType.startsWith('project.')) return '项目'
  return '事件'
}

export interface EventPresentation {
  summary: string
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  actorName: string | null
}

export function summarizeProjectEvent(event: Pick<ProjectEvent, 'eventType' | 'payload'>): EventPresentation {
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const title = typeof payload.title === 'string' ? payload.title : null
  const taskTitle = typeof payload.taskTitle === 'string' ? payload.taskTitle : title
  const actorName =
    typeof payload.actorName === 'string'
      ? payload.actorName
      : payload.actor && typeof payload.actor === 'object'
        ? String((payload.actor as Record<string, unknown>).name ?? '')
        : null
  const status = typeof payload.status === 'string' ? (payload.status as TaskStatus) : null
  switch (event.eventType) {
    case PROJECT_EVENT_TYPES.projectCreated:
      return { summary: `创建项目「${title ?? '未命名'}」`, tone: 'accent', actorName }
    case PROJECT_EVENT_TYPES.projectUpdated:
      return { summary: `更新项目设置`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.stageAdvanced:
      return {
        summary: `生命周期推进到「${String(payload.stageLabel ?? payload.stage ?? '下一阶段')}」`,
        tone: 'success',
        actorName,
      }
    case PROJECT_EVENT_TYPES.requirementCreated:
      return { summary: `新增需求「${title ?? ''}」`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.requirementStatusChanged:
      return { summary: `需求「${title ?? ''}」状态更新为 ${String(payload.status ?? '')}`, tone: 'accent', actorName }
    case PROJECT_EVENT_TYPES.milestoneCreated:
      return { summary: `新增里程碑「${title ?? ''}」`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.decisionCreated:
      return { summary: `记录决策「${title ?? ''}」`, tone: 'accent', actorName }
    case PROJECT_EVENT_TYPES.decisionStatusChanged:
      return { summary: `决策「${title ?? ''}」更新为 ${String(payload.status ?? '')}`, tone: 'success', actorName }
    case PROJECT_EVENT_TYPES.taskCreated:
      return { summary: `创建任务「${taskTitle ?? ''}」`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.taskMoved:
    case PROJECT_EVENT_TYPES.taskUpdated:
      return {
        summary: `任务「${taskTitle ?? ''}」${status ? TASK_STATUS_COPY[status] : '已更新'}`,
        tone: status === 'blocked' ? 'danger' : status === 'done' ? 'success' : 'neutral',
        actorName,
      }
    case PROJECT_EVENT_TYPES.taskDependencyAdded:
      return { summary: `任务「${taskTitle ?? ''}」新增依赖`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.taskDependencyRemoved:
      return { summary: `任务「${taskTitle ?? ''}」移除依赖`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.taskCompleted:
      return { summary: `任务「${taskTitle ?? ''}」验收完成`, tone: 'success', actorName }
    case PROJECT_EVENT_TYPES.sessionCreated:
      return { summary: `开启 Agent 会话「${title ?? ''}」`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.messageSent:
      return { summary: `Agent 消息已发送`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.runStarted:
      return { summary: `Agent 开始执行「${title ?? ''}」`, tone: 'accent', actorName }
    case PROJECT_EVENT_TYPES.runCompleted:
      return { summary: `Agent 运行完成`, tone: 'success', actorName }
    case PROJECT_EVENT_TYPES.runFailed:
      return { summary: `Agent 运行失败：${String(payload.error ?? '未知错误')}`, tone: 'danger', actorName }
    case PROJECT_EVENT_TYPES.runReconciled:
      return {
        summary: `人工核对运行：${payload.decision === 'completed' ? '确认完成' : payload.decision === 'retry' ? '允许重试' : '标记失败'}`,
        tone: payload.decision === 'completed' ? 'success' : 'warning',
        actorName,
      }
    case PROJECT_EVENT_TYPES.approvalRequested:
      return { summary: `请求授权：${String(payload.toolName ?? '工具调用')}`, tone: 'warning', actorName }
    case PROJECT_EVENT_TYPES.approvalDecided:
      return {
        summary: `授权请求已${payload.decision === 'approved' ? '批准' : '拒绝'}`,
        tone: payload.decision === 'approved' ? 'success' : 'danger',
        actorName,
      }
    case PROJECT_EVENT_TYPES.artifactCreated:
      return { summary: `生成交付物「${title ?? ''}」`, tone: 'success', actorName }
    case PROJECT_EVENT_TYPES.artifactVerified:
      return { summary: `交付物「${title ?? ''}」验证通过`, tone: 'success', actorName }
    case PROJECT_EVENT_TYPES.handoffRequested:
      return {
        summary: `发起任务交接${payload.toAgentName ? `给 ${String(payload.toAgentName)}` : ''}`,
        tone: 'warning',
        actorName,
      }
    case PROJECT_EVENT_TYPES.handoffAccepted:
      return { summary: `任务交接已接受`, tone: 'success', actorName }
    case PROJECT_EVENT_TYPES.handoffRejected:
      return { summary: `任务交接被拒绝`, tone: 'danger', actorName }
    case PROJECT_EVENT_TYPES.handoffCancelled:
      return { summary: `任务交接已取消`, tone: 'warning', actorName }
    case PROJECT_EVENT_TYPES.handoffExpired:
      return { summary: `任务交接已过期`, tone: 'warning', actorName }
    case PROJECT_EVENT_TYPES.handoffContinued:
      return { summary: `调度器已接手交接任务`, tone: 'accent', actorName }
    case PROJECT_EVENT_TYPES.handoffPolicyChanged:
      return {
        summary: `交接策略改为${payload.mode === 'auto' ? '自动（低风险）' : '人工接受'}`,
        tone: 'neutral',
        actorName,
      }
    case PROJECT_EVENT_TYPES.messageDelivered:
      return { summary: `跨会话消息已投递`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.messageAcknowledged:
      return { summary: `跨会话消息已确认`, tone: 'success', actorName }
    case PROJECT_EVENT_TYPES.knowledgeCreated:
      return { summary: `新增知识「${title ?? ''}」`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.planGenerated:
      return {
        summary: `生成计划草案 r${String(payload.revision ?? '')}（${payload.generatedBy === 'provider' ? 'AI 模型' : '本地规则'}）`,
        tone: 'accent',
        actorName,
      }
    case PROJECT_EVENT_TYPES.planGrantIssued:
      return {
        summary: `授予计划执行权限（${Array.isArray(payload.actions) ? payload.actions.join(' / ') : 'plan.start'}）`,
        tone: 'warning',
        actorName,
      }
    case PROJECT_EVENT_TYPES.planGrantRevoked:
      return { summary: '撤销计划执行权限', tone: 'danger', actorName }
    case PROJECT_EVENT_TYPES.planGrantStarted:
      return {
        summary: `按计划执行权限启动 r${String(payload.revision ?? '')}`,
        tone: 'accent',
        actorName,
      }
    case PROJECT_EVENT_TYPES.planGrantConsumed:
      return {
        summary: `计划授权写入：${String(payload.path ?? payload.toolName ?? 'workspace-write')}`,
        tone: 'neutral',
        actorName,
      }
    case PROJECT_EVENT_TYPES.planGrantInvalidated:
      return {
        summary: `计划执行权限失效，已暂停：${String(payload.reason ?? '需重新授权')}`,
        tone: 'warning',
        actorName,
      }
    case PROJECT_EVENT_TYPES.planGrantAmended:
      return {
        summary: `用户确认替代 Agent 后扩展计划授权的 Agent 范围（${String(payload.agentId ?? '')}）`,
        tone: 'warning',
        actorName,
      }
    case PROJECT_EVENT_TYPES.planTaskReused:
      return {
        summary: `修订计划复用已完成任务：${String(payload.taskKey ?? '')}`,
        tone: 'success',
        actorName,
      }
    case PROJECT_EVENT_TYPES.replanProposed: {
      const trigger = String(payload.trigger ?? '')
      const triggerLabel = RUN_TRIGGER_COPY[trigger] ?? '需要调整计划'
      return {
        summary: `${triggerLabel}，AI 提出修订方案，等待应用或你的决定`,
        tone: 'warning',
        actorName,
      }
    }
    case PROJECT_EVENT_TYPES.replanApplied:
      return {
        summary: `重规划已应用，新计划 r${String(payload.revision ?? '?')}`,
        tone: 'accent',
        actorName,
      }
    case PROJECT_EVENT_TYPES.replanRejected:
      return { summary: '用户拒绝了动态重规划提案', tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.replanFailed:
      return {
        summary: `动态重规划失败：${String(payload.error ?? '未通过校验')}`.slice(0, 180),
        tone: 'danger',
        actorName,
      }
    case PROJECT_EVENT_TYPES.planExecutionFailureClassified: {
      const failureClass = String(payload.failureClass ?? 'unknown')
      const label = FAILURE_CLASS_COPY[failureClass] ?? '原因尚未归类'
      return {
        summary: `执行受阻：${label}${payload.replan ? '（AI 可以尝试修订计划）' : ''}`,
        tone: payload.replan ? 'warning' : 'neutral',
        actorName,
      }
    }
    case PROJECT_EVENT_TYPES.runStatusChanged: {
      const runStatus = String(payload.status ?? '')
      const label = RUN_STATUS_COPY[runStatus] ?? '状态更新'
      return {
        summary: `Agent 运行${label}${title ? `：${title}` : ''}`,
        tone:
          runStatus === 'failed' || runStatus === 'needs_reconciliation'
            ? 'danger'
            : runStatus === 'completed'
              ? 'success'
              : runStatus === 'waiting_approval'
                ? 'warning'
                : 'neutral',
        actorName,
      }
    }
    case PROJECT_EVENT_TYPES.toolRequested:
      return { summary: `请求使用工具${toolNameOf(payload) ? `：${toolNameOf(payload)}` : ''}`, tone: 'warning', actorName }
    case PROJECT_EVENT_TYPES.toolCompleted:
      return { summary: `工具执行完成${toolNameOf(payload) ? `：${toolNameOf(payload)}` : ''}`, tone: 'neutral', actorName }
    case PROJECT_EVENT_TYPES.toolFailed:
      return {
        summary: `工具执行失败${toolNameOf(payload) ? `：${toolNameOf(payload)}` : ''}`,
        tone: 'danger',
        actorName,
      }
    case PROJECT_EVENT_TYPES.planStatusChanged: {
      const planStatus = String(payload.to ?? payload.status ?? '')
      const label = PLAN_STATUS_COPY[planStatus] ?? '状态更新'
      const reasonCode = String(payload.reason ?? '')
      const reasonLabel = PLAN_REASON_COPY[reasonCode] ?? ''
      const revision = payload.revision ? `第 ${String(payload.revision)} 版` : ''
      return {
        summary: `计划${revision}${label}${reasonLabel ? `（${reasonLabel}）` : ''}`,
        tone:
          planStatus === 'failed' || planStatus === 'rejected'
            ? 'danger'
            : planStatus === 'paused'
              ? 'warning'
              : planStatus === 'completed' || planStatus === 'approved'
                ? 'success'
                : 'neutral',
        actorName,
      }
    }
    case PROJECT_EVENT_TYPES.custom: {
      const kind = typeof payload.kind === 'string' ? payload.kind : ''
      const label = CUSTOM_KIND_COPY[kind]
      if (label) {
        const detail = typeof payload.verification === 'string' ? `：${payload.verification}` : ''
        return { summary: `${label}${detail}`.slice(0, 200), tone: kind.includes('blocked') || kind.includes('Failed') ? 'warning' : 'accent', actorName }
      }
      return { summary: title ?? '项目有一条新的记录', tone: 'neutral', actorName }
    }
    default:
      // Never show a raw dotted event type to a user; the exact type stays available in the
      // event payload for audit and in the events tab's tooltip.
      return { summary: '项目有新的更新', tone: 'neutral', actorName }
  }
}

export function assertEventVersion(actual: number, expected: number, aggregate: string): void {
  if (actual !== expected) {
    throw new AppError('CONFLICT', `${aggregate} 已被其他操作更新，请刷新后重试`, {
      details: { expected, actual },
    })
  }
}
