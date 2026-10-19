import {
  AppError,
  CrossSessionEnvelopeSchema,
  newId,
  type CrossSessionEnvelope,
  type CrossSessionType,
  type DeliveryStatus,
  type HandoffStatus,
  type Task,
} from '@projectos/contracts'

export interface EnvelopeInput {
  projectId: string
  taskId?: string | null
  runId?: string | null
  sender: { agentId: string; sessionId: string }
  recipient: { agentId: string; sessionId?: string | null }
  type: CrossSessionType
  body: string
  payload?: Record<string, unknown>
  correlationId?: string | null
  idempotencyKey?: string
  ttlMs?: number
}

export function buildEnvelope(input: EnvelopeInput): CrossSessionEnvelope {
  const timestamp = new Date()
  const messageId = newId('msg')
  const envelope: CrossSessionEnvelope = {
    protocol: 'projectos.cross-session',
    version: 1,
    messageId,
    idempotencyKey: input.idempotencyKey ?? messageId,
    projectId: input.projectId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    sender: {
      agentId: input.sender.agentId,
      sessionId: input.sender.sessionId,
    },
    recipient: {
      agentId: input.recipient.agentId,
      ...(input.recipient.sessionId ? { sessionId: input.recipient.sessionId } : {}),
    },
    type: input.type,
    createdAt: timestamp.toISOString(),
    ...(input.ttlMs ? { expiresAt: new Date(timestamp.getTime() + input.ttlMs).toISOString() } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    payload: {
      body: input.body,
      ...input.payload,
    },
  }
  return CrossSessionEnvelopeSchema.parse(envelope)
}

export function validateEnvelope(value: unknown): CrossSessionEnvelope {
  const envelope = CrossSessionEnvelopeSchema.parse(value)
  if (envelope.expiresAt && new Date(envelope.expiresAt).getTime() < Date.now()) {
    throw new AppError('CONFLICT', '跨会话消息已过期')
  }
  if (envelope.sender.agentId === envelope.recipient.agentId && envelope.sender.sessionId === envelope.recipient.sessionId) {
    throw new AppError('BAD_REQUEST', '不能向自身发送跨会话消息')
  }
  return envelope
}

export function replyEnvelope(
  original: CrossSessionEnvelope,
  input: {
    sender: { agentId: string; sessionId: string }
    body: string
    type?: CrossSessionType
    idempotencyKey?: string
  },
): CrossSessionEnvelope {
  return buildEnvelope({
    projectId: original.projectId,
    taskId: original.taskId ?? null,
    runId: original.runId ?? null,
    sender: input.sender,
    recipient: { agentId: original.sender.agentId, sessionId: original.sender.sessionId },
    type: input.type ?? 'task.result',
    body: input.body,
    correlationId: original.messageId,
    idempotencyKey: input.idempotencyKey,
  })
}

const HANDOFF_TRANSITIONS: Record<HandoffStatus, readonly HandoffStatus[]> = {
  requested: ['accepted', 'rejected', 'expired', 'cancelled'],
  accepted: [],
  rejected: [],
  expired: [],
  cancelled: [],
}

export function assertHandoffTransition(from: HandoffStatus, to: HandoffStatus): void {
  if (!HANDOFF_TRANSITIONS[from].includes(to)) {
    throw new AppError('CONFLICT', `交接状态不能从 ${from} 变更为 ${to}`)
  }
}

const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  stored: '已持久化',
  delivered: '已投递',
  accepted: '已唤醒',
  completed: '已完成',
  failed: '投递失败',
  unknown: '结果未知',
}

export function deliveryLabel(status: DeliveryStatus): string {
  return DELIVERY_LABELS[status] ?? status
}

export interface CrossSessionTransport {
  send(message: CrossSessionEnvelope): Promise<void>
  subscribe(handler: (message: CrossSessionEnvelope) => Promise<void>): Promise<{ dispose(): void }>
  wake(target: { agentId: string; sessionId?: string }): Promise<{ accepted: boolean }>
}

export function buildTaskHandoffSummary(task: Task, completed: string[], remaining: string[], risks: string[]): string {
  const lines = [`# 任务交接：${task.title}`, '', `状态：${task.status}`, '']
  lines.push('## 已完成', ...(completed.length > 0 ? completed.map((item) => `- ${item}`) : ['- （无）']))
  lines.push('', '## 未完成', ...(remaining.length > 0 ? remaining.map((item) => `- ${item}`) : ['- （无）']))
  lines.push('', '## 风险与待确认', ...(risks.length > 0 ? risks.map((item) => `- ${item}`) : ['- （无）']))
  lines.push('', '## 验收标准', ...task.acceptanceCriteria.map((criterion) => `- ${criterion}`))
  return lines.join('\n')
}
