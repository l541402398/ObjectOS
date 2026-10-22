import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../cn'

const badgeVariants = cva(
  'inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[12px] font-medium leading-none',
  {
    variants: {
      tone: {
        neutral: 'border-[var(--pui-border)] bg-[var(--pui-surface-muted)] text-[var(--pui-ink-secondary)]',
        accent: 'border-transparent bg-[var(--pui-accent-soft)] text-[var(--pui-accent)]',
        danger: 'border-transparent bg-[var(--pui-danger-soft)] text-[var(--pui-danger)]',
        success: 'border-transparent bg-[color-mix(in_srgb,var(--pui-success)_10%,transparent)] text-[var(--pui-success)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
)

export function Badge({
  className,
  tone,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>): React.ReactElement {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}
