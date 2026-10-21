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
  custom: 'project.event',
} as const

export type ProjectEventType = (typeof PROJECT_EVENT_TYPES)[keyof typeof PROJECT_EVENT_TYPES]

const TASK_STATUS_COPY: Record<TaskStatus, string> = {
  backlog: '移入待规划',
  ready: '标记为就绪',
  running: '开始执行',
  review: '提交审查',
  done: '完成',
  blocked: '标记为受阻',
  cancelled: '取消',
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
    default:
      return { summary: event.eventType, tone: 'neutral', actorName }
  }
}

export function assertEventVersion(actual: number, expected: number, aggregate: string): void {
  if (actual !== expected) {
    throw new AppError('CONFLICT', `${aggregate} 已被其他操作更新，请刷新后重试`, {
      details: { expected, actual },
    })
  }
}
