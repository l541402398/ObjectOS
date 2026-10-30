import { useState, type FormEvent } from 'react'
import { ArrowRight, Building2, ExternalLink, Plus, ShieldCheck } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { OrganizationError, OrganizationField } from './OrganizationPrimitives'

export function ConnectOrganizationForm({ onConnect, pending, error }: {
  onConnect: (serverUrl: string) => void; pending: boolean; error: unknown
}) {
  const [url, setUrl] = useState('')
  return <section className="org-connect-surface" aria-labelledby="org-connect-title">
    <div className="org-connect-copy">
      <span className="org-surface-icon"><Building2 size={25} strokeWidth={1.5} aria-hidden /></span>
      <h3 id="org-connect-title">连接团队工作区</h3>
      <p>通过组织服务共享项目与成员权限。</p>
      <span className="org-security-note"><ShieldCheck size={16} aria-hidden />账号登录在系统浏览器中完成</span>
    </div>
    <form className="org-connect-form" onSubmit={(event) => { event.preventDefault(); onConnect(url.trim()) }}>
      <OrganizationField label="组织服务地址" hint="使用团队提供的 HTTPS 地址；本机测试支持回环地址。">{(id) => <input id={id} data-testid="org-server-url" name="serverUrl" type="url" autoComplete="url" placeholder="https://team.example.com" required value={url} onChange={(event) => setUrl(event.target.value)} disabled={pending} />}</OrganizationField>
      <OrganizationError error={error} />
      {pending ? <div className="org-awaiting" role="status"><span className="org-status-dot" />等待浏览器登录<button className="org-link" type="button" data-testid="org-cancel" onClick={() => void window.projectos.organization.cancel()}>取消登录</button></div> : null}
      <button type="submit" className="org-button is-primary" data-testid="org-connect" disabled={pending}><ExternalLink size={15} aria-hidden />{pending ? '登录进行中' : '在浏览器中登录'}<ArrowRight size={15} aria-hidden /></button>
      <p className="org-field-hint">本机项目和文件不会因登录而上传。</p>
    </form>
  </section>
}

export function CreateOrganizationForm({ onCreate, onCancel, pending, error }: {
  onCreate: (input: { name: string; slug: string }) => void; onCancel: () => void; pending: boolean; error: unknown
}) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  return <form className="org-inline-form" aria-label="创建组织" onSubmit={(event) => { event.preventDefault(); onCreate({ name: name.trim(), slug }) }}>
    <div className="org-form-heading"><h4>创建组织</h4><button type="button" className="org-link" onClick={onCancel}>取消</button></div>
    <div className="org-form-grid">
      <OrganizationField label="组织名称">{(id) => <input id={id} data-testid="org-name" value={name} maxLength={100} required autoFocus onChange={(event) => setName(event.target.value)} />}</OrganizationField>
      <OrganizationField label="组织标识" hint="小写字母、数字和连字符。">{(id) => <input id={id} data-testid="org-slug" value={slug} minLength={2} maxLength={60} pattern="[a-z0-9]+(-[a-z0-9]+)*" required onChange={(event) => setSlug(event.target.value.toLowerCase())} />}</OrganizationField>
    </div>
    <OrganizationError error={error} />
    <div className="org-form-actions"><button className="org-button is-primary" type="submit" disabled={pending} data-testid="org-create-submit"><Plus size={15} aria-hidden />{pending ? '正在创建…' : '创建组织'}</button></div>
  </form>
}

export function CreateSharedProjectForm({ onSaved, onCancel }: { onSaved: () => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const save = useMutation({ mutationFn: async () => { await window.projectos.organization.createProject({ name: name.trim(), key, description }); await onSaved(); onCancel() } })
  const submit = (event: FormEvent) => { event.preventDefault(); save.mutate() }
  return <form className="org-inline-form" onSubmit={submit} aria-label="创建共享项目">
    <div className="org-form-heading"><h4>创建共享项目</h4><button type="button" className="org-link" onClick={onCancel}>取消</button></div>
    <div className="org-form-grid">
      <OrganizationField label="项目名称">{(id) => <input id={id} data-testid="org-project-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} autoFocus />}</OrganizationField>
      <OrganizationField label="项目标识" hint="例如 APP、WEB-SDK；组织内唯一。">{(id) => <input id={id} data-testid="org-project-key" required pattern="[A-Z][A-Z0-9-]*" minLength={2} maxLength={16} value={key} onChange={(event) => setKey(event.target.value.toUpperCase())} />}</OrganizationField>
    </div>
    <OrganizationField label="项目说明（选填）">{(id) => <textarea id={id} rows={2} maxLength={600} value={description} onChange={(event) => setDescription(event.target.value)} />}</OrganizationField>
    <OrganizationError error={save.error} />
    <div className="org-form-actions"><button type="submit" className="org-button is-primary" data-testid="org-project-submit" disabled={save.isPending}>{save.isPending ? '正在创建…' : '创建共享项目'}</button></div>
  </form>
}
