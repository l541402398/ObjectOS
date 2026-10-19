import { useState } from 'react'
import { Prompts, Sender } from '@ant-design/x'
import type { PromptsItemType } from '@ant-design/x'

export interface ComposerPrompt {
  key: string
  label: string
  description?: string
}

export interface AgentComposerProps {
  placeholder?: string
  loading?: boolean
  disabled?: boolean
  showPrompts?: boolean
  prompts?: ComposerPrompt[]
  agentName?: string
  onSubmit: (value: string) => void
  onCancel?: () => void
  onPrompt?: (prompt: ComposerPrompt) => void
}

export function AgentComposer({
  placeholder = '描述目标、补充约束，或要求 Agent 继续执行…',
  loading = false,
  disabled = false,
  showPrompts = false,
  prompts = [],
  agentName,
  onSubmit,
  onCancel,
  onPrompt,
}: AgentComposerProps) {
  const [value, setValue] = useState('')
  const promptItems: PromptsItemType[] = prompts.map((prompt) => ({
    key: prompt.key,
    label: prompt.label,
    description: prompt.description,
  }))
  return (
    <div className="po-composer">
      {showPrompts && promptItems.length > 0 ? (
        <Prompts
          items={promptItems}
          wrap
          fadeIn
          className="po-composer-prompts"
          onItemClick={(info) => {
            const found = prompts.find((prompt) => prompt.key === info.data.key)
            if (found) onPrompt?.(found)
          }}
        />
      ) : null}
      <Sender
        className="po-sender"
        value={value}
        onChange={(next) => setValue(next)}
        placeholder={placeholder}
        loading={loading}
        disabled={disabled}
        autoSize={{ minRows: 1, maxRows: 6 }}
        submitType="enter"
        onSubmit={(text) => {
          const trimmed = text.trim()
          if (!trimmed) return
          setValue('')
          onSubmit(trimmed)
        }}
        onCancel={onCancel}
        prefix={agentName ? <span className="po-sender-prefix">{agentName}</span> : undefined}
        footer={
          <div className="po-composer-hints">
            <span>Enter 发送 · Shift + Enter 换行</span>
            <span className="po-composer-hint-divider" />
            <span>写文件 / 执行命令需人工授权</span>
          </div>
        }
      />
    </div>
  )
}
