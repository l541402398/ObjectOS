import { useMemo } from 'react'
import { Bubble } from '@ant-design/x'
import { AgentAvatar } from '@projectos/ui'
import { RichText } from './RichText.js'

export interface ChatItem {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt?: number
  agentName?: string
}

export interface MessageListProps {
  messages: ChatItem[]
  agentName: string
  agentAccent: string
  streamingText?: string
  streaming?: boolean
  className?: string
}

export function MessageList({
  messages,
  agentName,
  agentAccent,
  streamingText = '',
  streaming = false,
  className = '',
}: MessageListProps) {
  const items = useMemo(() => {
    const list = messages.map((message) => ({
      key: message.id,
      role: message.role === 'assistant' ? 'ai' : message.role,
      content:
        message.role === 'system' ? (
          <div className="po-system-note">{message.content}</div>
        ) : (
          <RichText text={message.content} />
        ),
      ...(message.role === 'user' ? { status: 'success' as const } : {}),
    }))
    if (streaming) {
      list.push({
        key: 'streaming-assistant',
        role: 'ai',
        content: streamingText ? (
          <RichText text={streamingText} />
        ) : (
          <span className="po-typing" aria-label="Agent 正在生成">
            <i />
            <i />
            <i />
          </span>
        ),
      })
    }
    return list
  }, [messages, streaming, streamingText])

  return (
    <div className={`po-message-list ${className}`.trim()}>
      <Bubble.List
        items={items}
        autoScroll
        role={{
          ai: {
            placement: 'start',
            variant: 'borderless',
            shape: 'default',
            className: 'po-bubble-ai',
            avatar: <AgentAvatar name={agentName} accent={agentAccent} size={30} />,
          },
          user: {
            placement: 'end',
            variant: 'filled',
            shape: 'default',
            className: 'po-bubble-user',
          },
          system: {
            placement: 'start',
            variant: 'borderless',
            shape: 'default',
            className: 'po-bubble-system',
          },
        }}
      />
    </div>
  )
}
