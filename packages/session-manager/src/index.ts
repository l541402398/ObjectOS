import { AppError, type Message } from '@projectos/contracts'

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

const MAX_HISTORY_MESSAGE_CHARS = 6_000

export function formatSessionHistory(messages: Message[], limit = 24): HistoryMessage[] {
  const relevant = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => message.content.trim().length > 0)
    .slice(-limit)
  return relevant.map((message) => ({
    role: message.role as 'user' | 'assistant',
    content:
      message.content.length > MAX_HISTORY_MESSAGE_CHARS
        ? `${message.content.slice(0, MAX_HISTORY_MESSAGE_CHARS)}\n…（历史消息已截断）`
        : message.content,
  }))
}

export function assertSessionActive(status: string): void {
  if (status === 'archived') {
    throw new AppError('CONFLICT', '会话已归档，不能继续发送消息')
  }
}

export function sessionTitleForTask(taskTitle: string, agentName: string): string {
  const normalized = taskTitle.replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? `${agentName} · ${normalized.slice(0, 80)}` : `${agentName} 的工作会话`
}

export function normalizeUserMessage(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) throw new AppError('BAD_REQUEST', '消息不能为空')
  if (trimmed.length > 100_000) throw new AppError('BAD_REQUEST', '消息过长（上限 100,000 字符）')
  return trimmed
}
