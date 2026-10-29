/**
 * Precision Workspace primitives.
 *
 * These are the reusable style primitives promised by A0: every screen composes the same Button,
 * Badge, Surface, PageHeader, Tabs, Table and Field instead of inventing local variants. They live in
 * the prototype feature for now; A1 promotes them into `packages/ui` once the design is approved.
 */
import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Check, ChevronDown, Copy, Loader2 } from 'lucide-react'
import type { Tone } from './data'

export type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  trailing?: ReactNode
  loading?: boolean
}

export function Button({
  variant = 'ghost',
  size = 'sm',
  icon,
  trailing,
  loading = false,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={`pw-btn pw-btn--${variant} pw-btn--${size} ${className}`.trim()}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={14} className="pw-spin" aria-hidden="true" /> : icon}
      {children ? <span>{children}</span> : null}
      {trailing}
    </button>
  )
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
  active?: boolean
  badge?: number
}

export function IconButton({ label, children, active = false, badge, className = '', ...rest }: IconButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={`pw-icon-btn${active ? ' is-active' : ''} ${className}`.trim()}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
      {badge && badge > 0 ? <span className="pw-icon-btn-dot" aria-hidden="true" /> : null}
    </button>
  )
}

export function Badge({
  tone = 'neutral',
  children,
  dot = false,
  icon,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  dot?: boolean
  icon?: ReactNode
  className?: string
}): ReactNode {
  return (
    <span className={`pw-badge pw-badge--${tone} ${className}`.trim()}>
      {dot ? <i className="pw-badge-dot" aria-hidden="true" /> : icon}
      {children}
    </span>
  )
}

export function Avatar({
  name,
  initial,
  size = 24,
  tone = 'neutral',
}: {
  name: string
  initial?: string
  size?: number
  tone?: Tone
}): ReactNode {
  return (
    <span
      className={`pw-avatar pw-avatar--${tone}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}
      title={name}
      aria-hidden="true"
    >
      {initial ?? name.slice(0, 1)}
    </span>
  )
}

export function Surface({
  title,
  subtitle,
  toolbar,
  children,
  className = '',
  bodyClassName = '',
  as: Tag = 'section',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  toolbar?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  as?: 'section' | 'div' | 'aside'
}): ReactNode {
  return (
    <Tag className={`pw-surface ${className}`.trim()}>
      {title || toolbar ? (
        <header className="pw-surface-head">
          <div className="pw-surface-heading">
            {title ? <h2 className="pw-surface-title">{title}</h2> : null}
            {subtitle ? <p className="pw-surface-sub">{subtitle}</p> : null}
          </div>
          {toolbar ? <div className="pw-surface-toolbar">{toolbar}</div> : null}
        </header>
      ) : null}
      <div className={`pw-surface-body ${bodyClassName}`.trim()}>{children}</div>
    </Tag>
  )
}

export function PageHeader({
  title,
  description,
  actions,
  meta,
  back,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
  back?: ReactNode
}): ReactNode {
  return (
    <div className="pw-page-head">
      <div className="pw-page-heading">
        {back ? <div className="pw-page-back">{back}</div> : null}
        <div className="pw-page-title-row">
          <h1>{title}</h1>
          {meta}
        </div>
        {description ? <p className="pw-page-desc">{description}</p> : null}
      </div>
      {actions ? <div className="pw-page-actions">{actions}</div> : null}
    </div>
  )
}

export function Dot({ tone = 'neutral' }: { tone?: Tone }): ReactNode {
  return <i className={`pw-dot pw-dot--${tone}`} aria-hidden="true" />
}

export function Meter({ value, tone = 'accent', label }: { value: number; tone?: Tone; label: string }): ReactNode {
  return (
    <div className="pw-meter" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <i className={`pw-meter-fill pw-meter-fill--${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="pw-empty">
      {icon ? <div className="pw-empty-icon">{icon}</div> : null}
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <div className="pw-empty-action">{action}</div> : null}
    </div>
  )
}

export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }): ReactNode {
  return (
    <div className="pw-skeleton" aria-busy="true" aria-label="正在加载演示数据">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div className="pw-skeleton-row" key={rowIndex}>
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <i key={columnIndex} style={{ width: `${[46, 18, 14, 12][columnIndex] ?? 14}%` }} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string; count?: number }[]
  onChange: (value: T) => void
  label: string
}): ReactNode {
  return (
    <div className="pw-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-active' : ''}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {typeof option.count === 'number' ? <span className="pw-segmented-count">{option.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  label,
}: {
  value: T
  tabs: { value: T; label: string; count?: number }[]
  onChange: (value: T) => void
  label: string
}): ReactNode {
  return (
    <div className="pw-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          tabIndex={tab.value === value ? 0 : -1}
          className={tab.value === value ? 'is-active' : ''}
          onClick={() => onChange(tab.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
            event.preventDefault()
            const index = tabs.findIndex((item) => item.value === value)
            const delta = event.key === 'ArrowRight' ? 1 : -1
            const next = tabs[(index + delta + tabs.length) % tabs.length]
            if (next) onChange(next.value)
          }}
        >
          {tab.label}
          {typeof tab.count === 'number' ? <span className="pw-tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  )
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  shortcut,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  shortcut?: string
}): ReactNode {
  const id = useId()
  return (
    <div className="pw-search">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m16 16 5 5" />
      </svg>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
      />
      {shortcut ? <kbd>{shortcut}</kbd> : null}
    </div>
  )
}

export function KeyValue({
  rows,
  dense = false,
}: {
  rows: { label: string; value: ReactNode; mono?: boolean }[]
  dense?: boolean
}): ReactNode {
  return (
    <dl className={`pw-kv${dense ? ' is-dense' : ''}`}>
      {rows.map((row) => (
        <div className="pw-kv-row" key={row.label}>
          <dt>{row.label}</dt>
          <dd className={row.mono ? 'pw-mono' : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Callout({
  tone = 'neutral',
  title,
  children,
  icon,
}: {
  tone?: Tone
  title?: string
  children: ReactNode
  icon?: ReactNode
}): ReactNode {
  return (
    <div className={`pw-callout pw-callout--${tone}`}>
      {icon ? <span className="pw-callout-icon">{icon}</span> : null}
      <div>
        {title ? <strong>{title}</strong> : null}
        <div className="pw-callout-body">{children}</div>
      </div>
    </div>
  )
}

export function CopyButton({ text, onCopied, label = '复制' }: { text: string; onCopied: (text: string) => void; label?: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="pw-copy"
      aria-label={`${label} ${text}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          /* clipboard can be denied; the toast still reports the attempt honestly */
        }
        setCopied(true)
        onCopied(text)
        window.setTimeout(() => setCopied(false), 1400)
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span>{copied ? '已复制' : label}</span>
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
  htmlFor,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
  htmlFor?: string
}): ReactNode {
  return (
    <div className="pw-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="pw-field-hint">{hint}</p> : null}
    </div>
  )
}

export function TextInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>): ReactNode {
  return <input className={`pw-input ${className}`.trim()} {...rest} />
}

export function TextArea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactNode {
  return <textarea className={`pw-textarea ${className}`.trim()} {...rest} />
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>): ReactNode {
  return (
    <span className="pw-select-wrap">
      <select className={`pw-select ${className}`.trim()} {...rest}>
        {children}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </span>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  disabled?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`pw-toggle${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  )
}
