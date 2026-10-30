import type { ReactNode } from 'react'
import { Button, type ButtonProps } from 'antd'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from './overlay-shell'

/** Existing form callbacks stay owned by the page; only the presentation is shared. */
export function FormDialog({ open, title, children, onOk, onCancel, confirmLoading, okText = '确定', cancelText = '取消', okButtonProps, width = 520 }: {
  open: boolean
  title: string
  children: ReactNode
  onOk: () => void
  onCancel: () => void
  confirmLoading?: boolean
  okText?: string
  cancelText?: string
  okButtonProps?: ButtonProps
  width?: number
}) {
  return <DialogShell open={open} onOpenChange={(next) => { if (!next) onCancel() }} ariaLabel={title} width={width}>
    <OverlayHeader title={title} closeLabel={`关闭${title}`} onClose={onCancel} />
    <OverlayScrollArea className="po-dialog-form-scroll">{children}</OverlayScrollArea>
    <OverlayFooter>
      <Button onClick={onCancel}>{cancelText}</Button>
      <Button type="primary" {...okButtonProps} loading={confirmLoading} onClick={onOk}>{okText}</Button>
    </OverlayFooter>
  </DialogShell>
}
