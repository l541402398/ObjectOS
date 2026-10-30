import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, type ButtonProps } from 'antd'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from './overlay-shell'
import { errorMessage } from '../../lib/errors'

type Request = {
  title: string
  content?: ReactNode
  width?: number
  okText?: string
  cancelText?: string
  okButtonProps?: ButtonProps
  onOk?: () => unknown
  onCancel?: () => unknown
}
type Entry = Request & { id: number; kind: 'confirm' | 'info' }
type Api = { confirm: (request: Request) => void; info: (request: Request) => void }
const Context = createContext<Api | null>(null)

function DecisionDialog({ request, remove }: { request: Entry; remove: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [open, setOpen] = useState(true)
  const close = () => { setOpen(false); window.setTimeout(remove, 230) }
  const cancel = () => { if (!busy && open) { request.onCancel?.(); close() } }
  const accept = async () => {
    if (busy || !open) return
    setBusy(true); setError('')
    try { await request.onOk?.(); close() }
    catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  return <DialogShell open={open} onOpenChange={(next) => { if (!next) cancel() }} ariaLabel={request.title} width={request.width ?? 520} testId="product-decision-dialog">
    <OverlayHeader title={request.title} onClose={cancel} />
    <OverlayScrollArea><div className="pui-overlay-copy">{request.content}</div>{error ? <p className="pdl-field-error" role="alert">{error}</p> : null}</OverlayScrollArea>
    <OverlayFooter>
      {request.kind === 'confirm' ? <Button disabled={busy} onClick={cancel}>{request.cancelText ?? '取消'}</Button> : null}
      <Button type="primary" {...request.okButtonProps} loading={busy} onClick={() => void accept()}>{request.okText ?? (request.kind === 'info' ? '关闭' : '确定')}</Button>
    </OverlayFooter>
  </DialogShell>
}

export function ProductDialogs({ children }: { children: ReactNode }) {
  const nextId = useRef(0), [requests, setRequests] = useState<Entry[]>([])
  const api = useMemo<Api>(() => ({
    confirm: (request) => setRequests((current) => [...current, { ...request, id: ++nextId.current, kind: 'confirm' }]),
    info: (request) => setRequests((current) => [...current, { ...request, id: ++nextId.current, kind: 'info' }]),
  }), [])
  return <Context.Provider value={api}>{children}{requests.map((request) => <DecisionDialog key={request.id} request={request} remove={() => setRequests((current) => current.filter((item) => item.id !== request.id))} />)}</Context.Provider>
}

export function useProductDialogs(): Api {
  const api = useContext(Context)
  if (!api) throw new Error('ProductDialogs provider is missing')
  return api
}
