import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MacCommandOutlined, SearchOutlined } from '@ant-design/icons'
import { DialogShell } from '../next-ui/overlay/overlay-shell'

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  group: string
  icon?: ReactNode
  shortcut?: string
  run: () => void | Promise<void>
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean
  commands: PaletteCommand[]
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return commands
    return commands.filter((command) =>
      `${command.label} ${command.hint ?? ''} ${command.group}`.toLowerCase().includes(normalized),
    )
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [open])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  const execute = (command: PaletteCommand | undefined): void => {
    if (!command) return
    onClose()
    void command.run()
  }

  return (
    <DialogShell open={open} onOpenChange={(next) => { if (!next) onClose() }} ariaLabel="命令面板" width={640}>
      <div className="po-command">
        <div className="po-command-input">
          <SearchOutlined />
          <input
            ref={inputRef}
            value={query}
            placeholder="搜索页面、操作或设置…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(filtered.length - 1, index + 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(0, index - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                execute(filtered[activeIndex])
              } else if (event.key === 'Escape') {
                onClose()
              }
            }}
          />
          <span className="po-command-esc">Esc</span>
        </div>
        <div className="po-command-results">
          {filtered.length === 0 ? (
            <div className="po-command-empty">没有匹配的命令</div>
          ) : (
            filtered.map((command, index) => {
              const showGroup = index === 0 || filtered[index - 1]?.group !== command.group
              return (
                <div key={command.id}>
                  {showGroup ? <div className="po-command-group">{command.group}</div> : null}
                  <button
                    type="button"
                    className={`po-command-item ${index === activeIndex ? 'is-active' : ''}`.trim()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => execute(command)}
                  >
                    <span className="po-command-icon">{command.icon ?? <MacCommandOutlined />}</span>
                    <span className="po-command-label">
                      {command.label}
                      {command.hint ? <span className="po-command-hint">{command.hint}</span> : null}
                    </span>
                    {command.shortcut ? <kbd>{command.shortcut}</kbd> : null}
                  </button>
                </div>
              )
            })
          )}
        </div>
        <div className="po-command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
          <span><kbd>Enter</kbd> 执行</span>
          <span><kbd>Esc</kbd> 关闭</span>
        </div>
      </div>
    </DialogShell>
  )
}
