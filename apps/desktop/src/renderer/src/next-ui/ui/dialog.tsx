import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { motion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '../cn'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close
export const DialogTitle = DialogPrimitive.Title
export const DialogDescription = DialogPrimitive.Description

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: 'center' | 'right' }
>(({ className, children, side = 'center', ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[3000] bg-[rgba(8,15,28,.32)] backdrop-blur-[3px] data-[state=open]:pui-motion-fade" />
    <DialogPrimitive.Content ref={ref} asChild {...props}>
      <motion.div
        initial={{ opacity: 0, x: side === 'right' ? 26 : 0, y: side === 'center' ? 8 : 0, scale: side === 'center' ? 0.985 : 1 }}
        animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
        exit={{ opacity: 0, x: side === 'right' ? 18 : 0, y: side === 'center' ? 5 : 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          'pui-root fixed z-[3001] outline-none',
          side === 'right'
            ? 'inset-y-[54px] right-3 w-[min(560px,calc(100vw-24px))] overflow-hidden rounded-[18px] border border-[var(--pui-border)] bg-[var(--pui-surface-strong)] shadow-[0_26px_70px_-32px_rgba(10,28,55,.62)] backdrop-blur-2xl'
            : 'left-1/2 top-1/2 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-[18px] border border-[var(--pui-border)] bg-[var(--pui-surface-strong)] p-5 shadow-[0_28px_80px_-32px_rgba(10,28,55,.6)] backdrop-blur-2xl',
          className,
        )}
      >
        {children}
        <DialogPrimitive.Close data-testid="task-detail-close" className="absolute right-3 top-3 inline-flex size-7 items-center justify-center rounded-lg text-[var(--pui-ink-muted)] outline-none transition-colors hover:bg-[var(--pui-accent-soft)] hover:text-[var(--pui-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pui-accent-soft)]">
          <X size={15} />
          <span className="sr-only">关闭</span>
        </DialogPrimitive.Close>
      </motion.div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName
