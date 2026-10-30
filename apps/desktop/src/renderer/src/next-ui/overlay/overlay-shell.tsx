import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { motion } from 'motion/react'
import { useReducedMotionPreference as useReducedMotion } from '../../hooks/useReducedMotionPreference'
import { useLatestEvent } from '../../hooks/useLatestEvent'
import { X } from 'lucide-react'
import { ConfigProvider } from 'antd'
import { cn } from '../cn'
import { useOverlayLayer } from './overlay-context'
import { useResolvedTheme } from '../../stores/ui'

const DismissContext = createContext<() => void>(() => undefined)

export function useOverlayDismiss(): () => void {
  return useContext(DismissContext)
}

function usePresence(open: boolean, duration = 220): boolean {
  const [present, setPresent] = useState(open)
  useEffect(() => {
    if (open) {
      setPresent(true)
      return undefined
    }
    const timer = window.setTimeout(() => setPresent(false), duration)
    return () => window.clearTimeout(timer)
  }, [duration, open])
  return present
}

function useDismissGuard(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  dirty: boolean,
  onDiscard?: () => void,
) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (open) setConfirm(false)
  }, [open])
  const requestClose = useLatestEvent(() => {
    if (dirty) setConfirm(true)
    else onOpenChange(false)
  })
  const discard = useLatestEvent(() => {
    setConfirm(false)
    onDiscard?.()
    onOpenChange(false)
  })
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
    <div className={cn('pui-overlay-header', className)}>
      <div className="pui-overlay-heading">
        {eyebrow ? <div className="pui-overlay-eyebrow">{eyebrow}</div> : null}
        <h2 className="pui-overlay-title">{title}</h2>
        {meta ? <div className="pui-overlay-meta">{meta}</div> : null}
      </div>
      <div className="pui-overlay-header-actions">
        {actions}
        <button
          type="button"
          className="pui-overlay-close"
          aria-label={closeLabel}
          onClick={onClose ?? dismiss}
        >
          <X size={17} />
        </button>
      </div>
    </div>
  )
}

function OverlayFooter({
  children,
  meta,
  className,
}: {
  children: ReactNode
  meta?: ReactNode
  className?: string
}): ReactElement {
  return (
    <div className={cn('pui-overlay-footer', className)}>
      {meta ? <span className="pui-overlay-footer-meta">{meta}</span> : null}
      <div className="pui-overlay-footer-actions">{children}</div>
    </div>
  )
}

function OverlayScrollArea({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactElement {
  return <div className={cn('pui-overlay-scroll', className)}>{children}</div>
}

function InspectorSection({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}): ReactElement {
  return (
    <section className={cn('pui-inspector-section', className)}>
      {title || actions ? (
        <div className="pui-inspector-section-head">
          <span>{title}</span>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  )
}

function DiscardChangesDialog({
  open,
  onCancel,
  onConfirm,
  theme,
}: {
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  theme?: 'light' | 'dark'
}): ReactElement {
  const { zIndex, hasModalBelow } = useOverlayLayer('modal', open)
  const reduce = useReducedMotion()
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogPrimitive.Portal>
        {!hasModalBelow ? <DialogPrimitive.Overlay className="pui-overlay-backdrop" style={{ zIndex: zIndex + 300 }} /> : null}
        <DialogPrimitive.Content
          asChild
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            onCancel()
          }}
        >
          <motion.div
            className="pui-overlay-surface pui-overlay-dialog pui-overlay-dialog-sm"
            data-theme={theme}
            style={{ zIndex: zIndex + 301 }}
            initial={reduce ? false : { y: 8, scale: 0.995 }}
            animate={{ y: 0, scale: 1 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          >
            <OverlayHeader eyebrow="未保存修改" title="放弃这次编辑？" onClose={onCancel} />
            <div className="pui-overlay-body">
              <p className="pui-overlay-copy">关闭后当前未保存的内容会丢失。</p>
            </div>
            <OverlayFooter>
              <button
                type="button"
                className="pui-overlay-button pui-overlay-button-quiet"
                onClick={onCancel}
              >
                继续编辑
              </button>
              <button
                type="button"
                className="pui-overlay-button pui-overlay-button-danger"
                onClick={onConfirm}
              >
                放弃修改
              </button>
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
  modal = true,
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
  modal?: boolean
  width?: number
  side?: 'left' | 'right'
  theme?: 'light' | 'dark'
  skin?: 'projectos'
  testId?: string
}): ReactElement | null {
  const present = usePresence(open)
  const reduce = useReducedMotion()
  // ADR-0044: an overlay must render in the app's theme. Without this the sheet/dialog fell back to
  // light tokens while the content inside used dark-theme text tokens, so the task drawer was
  // light-gray text on a white sheet (unreadable).
  const appTheme = useResolvedTheme()
  const surfaceTheme = theme ?? appTheme
  const { zIndex, isTop, hasModalBelow } = useOverlayLayer(modal ? 'modal' : 'inspector', present)
  const guard = useDismissGuard(open, onOpenChange, dirty, onDiscard)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open || modal || !isTop) return
    const surface = surfaceRef.current
    if (!surface) return
    const selector =
      'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
    const focusFirst = (): void => {
      surface.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true })
    }
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target as HTMLElement | null
      if (!target || surface.contains(target)) return
      if (
        target.closest(
          '.ant-select-dropdown, .ant-dropdown, .ant-popover, .ant-picker-dropdown, .ant-tooltip, [data-radix-popper-content-wrapper]',
        )
      )
        return
      focusFirst()
    }
    const timer = window.setTimeout(() => {
      if (!surface.contains(document.activeElement)) focusFirst()
    }, 0)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open, modal, isTop])

  if (!present) return null
  return (
    <DialogPrimitive.Root
      open={present}
      modal={modal}
      onOpenChange={(next) => {
        if (!next && isTop) guard.requestClose()
      }}
    >
      <DialogPrimitive.Portal>
        {!hasModalBelow ? <DialogPrimitive.Overlay className="pui-overlay-backdrop" style={{ zIndex }} /> : null}
        <DialogPrimitive.Content
          asChild
          aria-label={ariaLabel}
          onOpenAutoFocus={() => { returnFocus.current = document.activeElement as HTMLElement | null }}
          onCloseAutoFocus={(event) => { event.preventDefault(); if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }) }}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            if (isTop) guard.requestClose()
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault()
            if (isTop) guard.requestClose()
          }}
          onInteractOutside={(event) => { event.preventDefault() }}
        >
          <motion.div
            ref={surfaceRef}
            data-testid={testId}
            data-theme={surfaceTheme}
            className={cn(
              'pui-overlay-surface',
              variant === 'sheet' ? 'pui-overlay-sheet' : 'pui-overlay-dialog',
              skin === 'projectos' && 'pdl-root',
              !open && 'is-closing',
            )}
            data-side={side}
            style={{
              zIndex: zIndex + 1,
              width:
                variant === 'dialog'
                  ? `min(${width}px, calc(100vw - 32px))`
                  : `min(${width}px, calc(100vw - 28px))`,
            }}
            initial={
              reduce
                ? false
                : {
                    x: variant === 'sheet' ? (side === 'right' ? 20 : -20) : 0,
                    y: variant === 'dialog' ? 8 : 0,
                    scale: variant === 'dialog' ? 0.995 : 1,
                  }
            }
            animate={{ x: 0, y: 0, scale: 1 }}
            transition={{ duration: reduce ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className="pui-overlay-opaque" aria-hidden />
            <div className="pui-overlay-content">
              <DismissContext.Provider value={guard.requestClose}>
                <ConfigProvider getPopupContainer={(trigger) => trigger?.closest<HTMLElement>('.pui-overlay-content') ?? document.body}>{children}</ConfigProvider>
              </DismissContext.Provider>
            </div>
          </motion.div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
      <DiscardChangesDialog
        open={guard.confirm}
        onCancel={() => guard.setConfirm(false)}
        onConfirm={guard.discard}
        theme={surfaceTheme}
      />
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
  const appTheme = useResolvedTheme()
  const surfaceTheme = theme ?? appTheme
  const { zIndex, isTop } = useOverlayLayer('inspector', present)
  const guard = useDismissGuard(open, onOpenChange, dirty, onDiscard)
  const requestClose = guard.requestClose
  const panelRef = useRef<HTMLDivElement>(null)
  const onKey = useLatestEvent((event: KeyboardEvent) => {
    if (!isTop || event.defaultPrevented || !panelRef.current) return
    if (event.key === 'Escape') {
      event.preventDefault()
      requestClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [
      ...panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button,input,textarea,select,[tabindex]:not([tabindex="-1"])',
      ),
    ].filter((node) => !node.hasAttribute('disabled') && node.getClientRects().length > 0)
    const head = focusable[0],
      tail = focusable.at(-1)
    if (event.shiftKey && document.activeElement === head) {
      event.preventDefault()
      tail?.focus()
    } else if (!event.shiftKey && document.activeElement === tail) {
      event.preventDefault()
      head?.focus()
    }
  })
  useEffect(() => {
    if (!present) return undefined
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(
      'button, input, textarea, [tabindex]:not([tabindex="-1"])',
    )
    first?.focus()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [onKey, present])
  if (!present) return null
  return (
    <DialogPrimitive.Root
      open={present}
      modal={false}
      onOpenChange={(next) => {
        if (!next && isTop) guard.requestClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          asChild
          aria-label={ariaLabel}
          onEscapeKeyDown={(event) => {
            event.preventDefault()
            if (isTop) guard.requestClose()
          }}
          onInteractOutside={(event) => {
            event.preventDefault()
          }}
        >
          <div
            ref={panelRef}
            data-testid={testId}
            data-theme={surfaceTheme}
            className={cn(
              'pui-overlay-surface pui-overlay-inspector',
              skin === 'projectos' && 'pdl-root',
              !open && 'is-closing',
              className,
            )}
            style={{ zIndex, width: `min(${width}px, calc(100vw - 24px))` }}
          >
            <span className="pui-overlay-opaque" aria-hidden />
            <motion.div
              className="pui-overlay-content"
              initial={reduce ? false : { x: 20 }}
              animate={{ x: 0 }}
              transition={{ duration: reduce ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              <DismissContext.Provider value={guard.requestClose}>
                <ConfigProvider getPopupContainer={(trigger) => trigger?.closest<HTMLElement>('.pui-overlay-content') ?? document.body}>{children}</ConfigProvider>
              </DismissContext.Provider>
            </motion.div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
      <DiscardChangesDialog
        open={guard.confirm}
        onCancel={() => guard.setConfirm(false)}
        onConfirm={guard.discard}
        theme={surfaceTheme}
      />
    </DialogPrimitive.Root>
  )
}

export function PopoverShell({
  trigger,
  children,
  ariaLabel,
  side = 'bottom',
  align = 'start',
  className,
  open,
  onOpenChange,
  theme,
}: {
  trigger: ReactNode
  children: ReactNode
  ariaLabel: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  className?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  theme?: 'light' | 'dark'
}): ReactElement {
  const [internalOpen, setInternalOpen] = useState(false)
  const shown = open ?? internalOpen
  const appTheme = useResolvedTheme()
  const { zIndex } = useOverlayLayer('popover', shown)
  return (
    <PopoverPrimitive.Root
      open={shown}
      onOpenChange={(next) => {
        if (open === undefined) setInternalOpen(next)
        onOpenChange?.(next)
      }}
    >
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          aria-label={ariaLabel}
          data-theme={theme ?? appTheme}
          className={cn('pui-overlay-popover', className)}
          side={side}
          align={align}
          sideOffset={8}
          style={{ zIndex: zIndex + 100 }}
          collisionPadding={10}
        >
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { OverlayHeader, OverlayFooter, OverlayScrollArea, InspectorSection }
