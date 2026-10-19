import { Fragment, createElement, useMemo, useState, type ReactNode } from 'react'
import { Button } from 'antd'
import { CheckOutlined, CopyOutlined } from '@ant-design/icons'

interface InlineToken {
  type: 'text' | 'code' | 'bold' | 'link'
  value: string
  href?: string
}

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) tokens.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    if (match[1]) tokens.push({ type: 'code', value: match[1].slice(1, -1) })
    else if (match[2]) tokens.push({ type: 'bold', value: match[2].slice(2, -2) })
    else if (match[3] && match[4]) {
      tokens.push({ type: 'link', value: match[3].slice(1, match[3].indexOf(']')), href: match[4] })
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) tokens.push({ type: 'text', value: text.slice(lastIndex) })
  return tokens
}

function renderInline(text: string): ReactNode[] {
  return parseInline(text).map((token, index) => {
    if (token.type === 'code') return <code key={index}>{token.value}</code>
    if (token.type === 'bold') return <strong key={index}>{token.value}</strong>
    if (token.type === 'link') {
      return (
        <a
          key={index}
          href={token.href}
          onClick={(event) => {
            event.preventDefault()
            if (token.href) void window.projectos.app.openExternal(token.href).catch(() => undefined)
          }}
        >
          {token.value}
        </a>
      )
    }
    return <Fragment key={index}>{token.value}</Fragment>
  })
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="po-codeblock">
      <div className="po-codeblock-header">
        <span>{language || 'code'}</span>
        <Button
          type="text"
          size="small"
          icon={copied ? <CheckOutlined /> : <CopyOutlined />}
          onClick={() => void copy()}
        >
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split(/\r?\n/)
  const blocks: ReactNode[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      const level = Math.min(6, heading[1]!.length + 2)
      const content = heading[2] ?? ''
      blocks.push(createElement(`h${level}`, { key: `h-${index}` }, renderInline(content)))
      index += 1
      continue
    }
    if (line.startsWith('> ')) {
      const quote: string[] = []
      while (index < lines.length && (lines[index] ?? '').startsWith('> ')) {
        quote.push((lines[index] ?? '').slice(2))
        index += 1
      }
      blocks.push(<blockquote key={`q-${index}`}>{quote.map((entry) => renderInline(entry))}</blockquote>)
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*[-*]\s+/, ''))
        index += 1
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item)}</li>
          ))}
        </ol>,
      )
      continue
    }
    if (/^---+$/.test(line.trim())) {
      blocks.push(<hr key={`hr-${index}`} />)
      index += 1
      continue
    }
    const paragraph: string[] = [line]
    index += 1
    while (
      index < lines.length &&
      lines[index]?.trim() &&
      !/^(#{1,4})\s+/.test(lines[index] ?? '') &&
      !/^\s*[-*]\s+/.test(lines[index] ?? '') &&
      !/^\s*\d+\.\s+/.test(lines[index] ?? '') &&
      !(lines[index] ?? '').startsWith('> ')
    ) {
      paragraph.push(lines[index] ?? '')
      index += 1
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(' '))}</p>)
  }
  return <>{blocks}</>
}

export function RichText({ text, className = '' }: { text: string; className?: string }) {
  const segments = useMemo(() => {
    const result: Array<{ type: 'text' | 'code'; value: string; language: string }> = []
    const pattern = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g
    let lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', value: text.slice(lastIndex, match.index), language: '' })
      }
      result.push({ type: 'code', value: match[2] ?? '', language: match[1] ?? '' })
      lastIndex = pattern.lastIndex
    }
    if (lastIndex < text.length) result.push({ type: 'text', value: text.slice(lastIndex), language: '' })
    return result
  }, [text])

  return (
    <div className={`po-richtext ${className}`.trim()}>
      {segments.map((segment, index) =>
        segment.type === 'code' ? (
          <CodeBlock key={index} code={segment.value} language={segment.language} />
        ) : (
          <TextBlock key={index} text={segment.value} />
        ),
      )}
    </div>
  )
}
