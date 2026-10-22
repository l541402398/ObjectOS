import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { cn } from '../cn'
import { useOverlayLayer } from './overlay-context'

const DismissContext = createContext<() => void>(() => undefined)

export function useOverlayDismiss(): () => void {
  return useContext(DismissContext)
}

function usePresence(open: boolean, duration = 220): boolean {
  const [present, setPresent] = useState(open)
  useEffect(() => {
    if (open) { setPresent(true); return undefined }
    const timer = window.setTimeout(() => setPresent(false), duration)
    return () => window.clearTimeout(timer)
  }, [duration, open])
  return present
}

function useDismissGuard(open: boolean, onOpenChange: (open: boolean) => void, dirty: boolean, onDiscard?: () => void) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => { if (open) setConfirm(false) }, [open])
  const requestClose = useCallback(() => {
    if (dirty) setConfirm(true)
    else onOpenChange(false)
  }, [dirty, onOpenChange])
  const discard = useCallback(() => {
    setConfirm(false)
    onDiscard?.()
    onOpenChange(false)
  }, [onDiscard, onOpenChange])
  return { confirm, setConfirm, requestClose, discard }
}

function OverlayHeader({
  eyebrow,
  title,
  meta,
  actions,
  onClose,
  className,
  closeLabel = '关闭',
}: {
  eyebrow?: ReactNode
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  onClose?: () => void
  className?: string
  closeLabel?: string
}): ReactElement {
  const dismiss = useOverlayDismiss()
  return (
    <header className={cn('pui-overlay-header', className)}>
      <div className="pui-overlay-heading">
        {eyebrow ? <div className="pui-overlay-eyebrow">{eyebrow}</div> : null}
        <h2 className="pui-overlay-title">{title}</h2>
        {meta ? <div className="pui-overlay-meta">{meta}</div> : null}
      </div>
      <div className="pui-overlay-header-actions">
        {actions}
        <button type="button" className="pui-overlay-close" aria-label={closeLabel} onClick={onClose ?? dismiss}><X size={17} /></button>
      </div>
    </header>
  )
}

function OverlayFooter({ children, meta, className }: { children: ReactNode; meta?: ReactNode; className?: string }): ReactElement {
  return <footer className={cn('pui-overlay-footer', className)}>{meta ? <span className="pui-overlay-footer-meta">{meta}</span> : null}<div className="pui-overlay-footer-actions">{children}</div></footer>
}

function OverlayScrollArea({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <div className={cn('pui-overlay-scroll', className)}>{children}</div>
}

function InspectorSection({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }): ReactElement {
  return (
    <section className={cn('pui-inspector-section', className)}>
      {title || actions ? <div className="pui-inspector-section-head"><span>{title}</span>{actions}</div> : null}
      {children}
    </section>
  )
}

function DiscardChangesDialog({ open, onCancel, onConfirm, theme }: { open: boolean; onCancel: () => void; onConfirm: () => void; theme?: 'light' | 'dark' }): ReactElement {
  const { zIndex } = useOverlayLayer('modal')
  const reduce = useReducedMotion()
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onCancel() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="pui-overlay-backdrop" style={{ zIndex: zIndex + 300 }} />
        <DialogPrimitive.Content asChild onEscapeKeyDown={(event) => { event.preventDefault(); onCancel() }}>
          <motion.div className="pui-overlay-surface pui-overlay-dialog pui-overlay-dialog-sm" data-theme={theme} style={{ zIndex: zIndex + 301 }} initial={reduce ? false : { opacity: 0, y: 8, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: .2 }}>
            <OverlayHeader eyebrow="未保存修改" title="放弃这次编辑？" onClose={onCancel} />
            <div className="pui-overlay-body"><p className="pui-overlay-copy">关闭后当前未保存的内容会丢失。</p></div>
            <OverlayFooter>
              <button type="button" className="pui-overlay-button pui-overlay-button-quiet" onClick={onCancel}>继续编辑</button>
              <button type="button" className="pui-overlay-button pui-overlay-button-danger" onClick={onConfirm}>放弃修改</button>
            </OverlayFooter>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ModalShell({
  open,
  onOpenChange,
  children,
  dirty = false,
  onDiscard,
  ariaLabel,
  variant = 'dialog',
  width = 640,
  side = 'right',
  theme,
  skin,
  testId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  dirty?: boolean
  onDiscard?: () => void
  ariaLabel: string
  variant?: 'dialog' | 'sheet'
  width?: number
  side?: 'left' | 'right'
  theme?: 'light' | 'dark'
  skin?: 'projectos'
  testId?: string
}): ReactElement | null {
  const present = usePresence(open)
  const reduce = useReducedMotion()
  const { zIndex } = useOverlayLayer('modal')
  const guard = useDismissGuard(open, onOpenChange, dirty, onDiscard)
  if (!present) return null
  return (
    <DialogPrimitive.Root open={present} onOpenChange={(next) => { if (!next) guard.requestClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="pui-overlay-backdrop" style={{ zIndex }} />
        <DialogPrimitive.Content
          asChild
          aria-label={ariaLabel}
          onEscapeKeyDown={(event) => { event.preventDefault(); guard.requestClose() }}
          onPointerDownOutside={(event) => { event.preventDefault(); guard.requestClose() }}
        >
          <motion.div
            data-testid={testId}
            data-theme={theme}
            className={cn('pui-overlay-surface', variant === 'sheet' ? 'pui-overlay-sheet' : 'pui-overlay-dialog', skin === 'projectos' && 'pdl-root', !open && 'is-closing')}
            data-side={side}
            style={{ zIndex: zIndex + 1, width: variant === 'dialog' ? `min(${width}px, calc(100vw - 32px))` : undefined }}
            initial={reduce ? false : { opacity: 0, x: variant === 'sheet' ? (side === 'right' ? 34 : -34) : 0, y: variant === 'dialog' ? 8 : 0, scale: variant === 'dialog' ? .985 : 1 }}
            animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
            transition={{ duration: reduce ? 0 : .24, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="pui-overlay-opaque" aria-hidden />
            <div className="pui-overlay-content"><DismissContext.Provider value={guard.requestClose}>{children}</DismissContext.Provider></div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
      <DiscardChangesDialog open={guard.confirm} onCancel={() => guard.setConfirm(false)} onConfirm={guard.discard} theme={theme} />
    </DialogPrimitive.Root>
  )
}

export function DialogShell(props: Omit<Parameters<typeof ModalShell>[0], 'variant'>): ReactElement | null {
  return <ModalShell {...props} variant="dialog" />
}

export function SheetShell(props: Omit<Parameters<typeof ModalShell>[0], 'variant'>): ReactElement | null {
  return <ModalShell {...props} variant="sheet" />
}

export function InspectorShell({
  open,
  onOpenChange,
  children,
  dirty = false,
  onDiscard,
  ariaLabel,
  width = 480,
  theme,
  skin,
  testId,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
  dirty?: boolean
  onDiscard?: () => void
  ariaLabel: string
  width?: number
  theme?: 'light' | 'dark'
  skin?: 'projectos'
  testId?: string
  className?: string
}): ReactElement | null {
  const present = usePresence(open)
  const reduce = useReducedMotion()
  const { zIndex } = useOverlayLayer('inspector')
  const guard = useDismissGuard(open, onOpenChange, dirty, onDiscard)
  const requestClose = guard.requestClose
  const panelRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!present) return undefined
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>('button, input, textarea, [tabindex]:not([tabindex="-1"])')
    first?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); requestClose(); return }
      if (event.key !== 'Tab' || !panel) return
      const focusable = [...panel.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.hasAttribute('disabled'))
      if (focusable.length === 0) return
      const head = focusable[0]!
      const tail = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === head) { event.preventDefault(); tail.focus() }
      else if (!event.shiftKey && document.activeElement === tail) { event.preventDefault(); head.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [present, requestClose])
  if (!present) return null
  return (
    <DialogPrimitive.Root open={present} modal={false} onOpenChange={(next) => { if (!next) guard.requestClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          asChild
          aria-label={ariaLabel}
          onEscapeKeyDown={(event) => { event.preventDefault(); guard.requestClose() }}
          onInteractOutside={(event) => { event.preventDefault() }}
        >
          <aside
            ref={panelRef}
            data-testid={testId}
            data-theme={theme}
            className={cn('pui-overlay-surface pui-overlay-inspector', skin === 'projectos' && 'pdl-root', !open && 'is-closing', className)}
            style={{ zIndex, width: `min(${width}px, calc(100vw - 24px))` }}
          >
            <span className="pui-overlay-opaque" aria-hidden />
            <motion.div
              className="pui-overlay-content"
              initial={reduce ? false : { opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reduce ? 0 : .24, ease: [0.22, 1, 0.36, 1] }}
            >
              <DismissContext.Provider value={guard.requestClose}>{children}</DismissContext.Provider>
            </motion.div>
          </aside>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
      <DiscardChangesDialog open={guard.confirm} onCancel={() => guard.setConfirm(false)} onConfirm={guard.discard} theme={theme} />
    </DialogPrimitive.Root>
  )
}

export function PopoverShell({
  trigger,
  children,
  side = 'bottom',
  align = 'start',
  className,
}: {
  trigger: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
}): ReactElement {
  const { zIndex } = useOverlayLayer('popover')
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className={cn('pui-overlay-popover', className)} side={side} align={align} sideOffset={8} style={{ zIndex: zIndex + 100 }} collisionPadding={10}>
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { OverlayHeader, OverlayFooter, OverlayScrollArea, InspectorSection }





