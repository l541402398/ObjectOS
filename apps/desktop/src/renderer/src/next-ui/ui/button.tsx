import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../cn'

const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-[9px] border text-[12.5px] font-medium outline-none transition-[background,border-color,color,box-shadow,transform] duration-150 focus-visible:ring-2 focus-visible:ring-[var(--pui-accent-soft)] disabled:pointer-events-none disabled:opacity-45 active:translate-y-px',
  {
    variants: {
      variant: {
        primary: 'border-transparent bg-[var(--pui-accent)] text-white shadow-[0_6px_14px_-10px_rgba(24,70,150,.8)] hover:brightness-110',
        secondary: 'border-[var(--pui-border)] bg-[var(--pui-surface-strong)] text-[var(--pui-ink)] hover:border-[var(--pui-border-strong)] hover:bg-[var(--pui-surface)]',
        ghost: 'border-transparent bg-transparent text-[var(--pui-ink-secondary)] hover:bg-[var(--pui-accent-soft)] hover:text-[var(--pui-ink)]',
        danger: 'border-transparent bg-[var(--pui-danger-soft)] text-[var(--pui-danger)] hover:bg-[color-mix(in_srgb,var(--pui-danger)_16%,transparent)]',
      },
      size: {
        sm: 'h-7 px-2.5',
        md: 'h-8 px-3',
        icon: 'size-8 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  },
)
Button.displayName = 'PuiButton'
