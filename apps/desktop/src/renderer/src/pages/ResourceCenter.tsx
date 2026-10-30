import { FormDialog } from '../next-ui/overlay/FormDialog'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Empty, Input, Select } from 'antd'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'
import './resource-center.css'

const TYPE_LABEL: Record<string, string> = { host: '主机 / VPS', kubernetes: 'Kubernetes', pipeline: 'CI/CD Pipeline', gitops: 'GitOps' }
const TEST_LABEL: Record<string, string> = {
  connected: '已连接', auth_failed: '认证失败', timeout: '超时', host_key_mismatch: '主机指纹变化',
  host_key_untrusted: '待确认指纹', permission_denied: '权限不足', network_error: '网络不可达', unsupported: '未实现',
}

export function ResourceCenter({ projectId }: { projectId: string }) {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const overview = useQuery({ queryKey: ['resource-overview', projectId], queryFn: () => window.projectos.resources.overview(projectId) })
  const [view, setView] = useState<'resources' | 'credentials'>('resources')
  const [type, setType] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [resourceType, setResourceType] = useState<'host' | 'kubernetes' | 'pipeline' | 'gitops'>('host')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('root')
  const [authType, setAuthType] = useState<'private_key' | 'password'>('private_key')
  const [secret, setSecret] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [purpose, setPurpose] = useState('')
  const [editResourceOpen, setEditResourceOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editEndpoint, setEditEndpoint] = useState('')
  const [editPurpose, setEditPurpose] = useState('')
  const [editProfileId, setEditProfileId] = useState<string | null>(null)
  const [editProfileName, setEditProfileName] = useState('')
  const [editProfileHost, setEditProfileHost] = useState('')
  const [editProfilePort, setEditProfilePort] = useState('22')
  const [editProfileUsername, setEditProfileUsername] = useState('root')
  const [editProfileFingerprint, setEditProfileFingerprint] = useState('')
  const [rotateCredentialId, setRotateCredentialId] = useState<string | null>(null)
  const [rotateSecret, setRotateSecret] = useState('')
  const [rotatePassphrase, setRotatePassphrase] = useState('')

  const data = overview.data
  const resources = useMemo(() => (data?.resources ?? []).filter((item) =>
    (type === 'all' || item.type === type) && (!query || item.name.toLowerCase().includes(query.toLowerCase()) || item.endpoint.toLowerCase().includes(query.toLowerCase())),
  ), [data?.resources, query, type])
  const selected = resources.find((item) => item.id === selectedId) ?? resources[0] ?? null
  const profiles = (data?.profiles ?? []).filter((item) => item.resourceId === selected?.id)
  const testRuns = (data?.testRuns ?? []).filter((item) => item.resourceId === selected?.id)
  const credentials = data?.credentials ?? []

  const create = useMutation({
    mutationFn: async () => {
      const resource = await window.projectos.resources.create({
        projectId, type: resourceType, name: name.trim(), endpoint: host.trim(), purpose: purpose.trim(), labels: [], metadata: {},
      })
      if (resourceType !== 'host') return resource
      const credential = await window.projectos.resources.createCredential({
        projectId,
        kind: authType === 'private_key' ? 'ssh_private_key' : 'ssh_password',
        label: `${name.trim()} ${authType === 'private_key' ? 'SSH Key' : 'SSH Password'}`,
        secret: authType === 'private_key' ? { privateKey: secret, passphrase: passphrase || undefined } : { password: secret },
      })
      await window.projectos.resources.createProfile({
        resourceId: resource.id, name: `${name.trim()} · SSH`, protocol: 'ssh', host: host.trim(), port: Number(port),
        username: username.trim(), authType, credentialRef: credential.id,
        hostKeyFingerprint: fingerprint.trim() || null, trustPolicy: 'pinned', connectTimeoutMs: 15000,
      })
      return resource
    },
    onSuccess: async (resource) => {
      setCreateOpen(false); setName(''); setHost(''); setSecret(''); setPassphrase(''); setFingerprint(''); setPurpose('')
      await queryClient.invalidateQueries({ queryKey: ['resource-overview', projectId] })
      setSelectedId(resource.id)
      message.success('资源已登记；可测试连接')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const test = useMutation({
    mutationFn: (profileId: string) => window.projectos.resources.testConnection(profileId),
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ['resource-overview', projectId] })
      if (run.status === 'connected') message.success('SSH 连接与只读探测通过')
      else if (run.status === 'host_key_untrusted') message.warning('首次连接需要确认主机指纹')
      else message.error(run.message)
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const trust = useMutation({
    mutationFn: async ({ profileId, value }: { profileId: string; value: string }) => {
      await window.projectos.resources.updateProfile({ profileId, hostKeyFingerprint: value })
      return window.projectos.resources.testConnection(profileId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['resource-overview', projectId] })
      message.success('指纹已固定并重新测试')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const archiveResource = useMutation({
    mutationFn: (resourceId: string) => window.projectos.resources.update({ resourceId, status: 'disabled' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['resource-overview', projectId] }); message.success('资源已停用；引用它的部署授权随之失效') },
    onError: (error) => message.error(errorMessage(error)),
  })
  const archiveForever = useMutation({
    mutationFn: (resourceId: string) => window.projectos.resources.update({ resourceId, status: 'archived' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['resource-overview', projectId] }); message.success('资源已归档') },
    onError: (error) => message.error(errorMessage(error)),
  })
  const editResource = useMutation({
    mutationFn: () => window.projectos.resources.update({
      resourceId: selected!.id, name: editName.trim(), endpoint: editEndpoint.trim(), purpose: editPurpose.trim(),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['resource-overview', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['release-overview'] })
      setEditResourceOpen(false)
      message.success('资源已更新；以旧配置批准的部署授权已失效')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const editProfile = useMutation({
    mutationFn: () => window.projectos.resources.updateProfile({
      profileId: editProfileId!,
      name: editProfileName.trim(),
      host: editProfileHost.trim(),
      port: Number(editProfilePort),
      username: editProfileUsername.trim(),
      hostKeyFingerprint: editProfileFingerprint.trim() || null,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['resource-overview', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['release-overview'] })
      setEditProfileId(null)
      message.success('连接配置已更新；原部署授权需要重新审批')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const rotateCredential = useMutation({
    mutationFn: async () => {
      const target = credentials.find((item) => item.id === rotateCredentialId)
      if (!target) throw new Error('凭据不存在')
      const created = await window.projectos.resources.createCredential({
        projectId, kind: target.kind, label: `${target.label}（轮换）`,
        secret: { privateKey: rotateSecret, ...(rotatePassphrase ? { passphrase: rotatePassphrase } : {}) },
      })
      // Rebind every profile that used the old credential, then retire it. Rebinding
      // bumps each profile revision, which invalidates approvals bound to the old one.
      const affected = (data?.profiles ?? []).filter((item) => item.credentialRef === target.id)
      for (const profile of affected) {
        await window.projectos.resources.updateProfile({ profileId: profile.id, credentialRef: created.id })
      }
      await window.projectos.resources.disableCredential(target.id)
      return { created, affected: affected.length }
    },
    onSuccess: async ({ affected }) => {
      await queryClient.invalidateQueries({ queryKey: ['resource-overview', projectId] })
      await queryClient.invalidateQueries({ queryKey: ['release-overview'] })
      setRotateCredentialId(null)
      setRotateSecret('')
      setRotatePassphrase('')
      message.success(`凭据已轮换，${affected} 个连接配置已切换；旧授权失效`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const disable = useMutation({
    mutationFn: (credentialId: string) => window.projectos.resources.disableCredential(credentialId),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['resource-overview', projectId] }); message.success('凭据已停用') },
    onError: (error) => message.error(errorMessage(error)),
  })

  if (overview.isLoading) return <div className="rc-shell"><div className="rw-loading">正在载入资源目录…</div></div>
  if (!data) return <div className="rc-shell"><Empty description="资源数据不可用" /></div>

  return (
    <div className="rc-shell">
      <header className="rc-head">
        <div><div className="rw-eyebrow">DELIVERY ASSETS</div><h1>资源与连接</h1><p>集中登记主机、集群、流水线与凭据引用；连接测试与部署授权分离。</p></div>
        <Button onClick={() => { setResourceType('kubernetes'); setCreateOpen(true) }}>登记平台资源</Button>
        <Button type="primary" onClick={() => { setResourceType('host'); setCreateOpen(true) }}>新建主机</Button>
      </header>

      <div className="rc-body">
        <aside className="rc-left" aria-label="资源列表">
          <div className="rc-tabs">
            <button className={view === 'resources' ? 'is-active' : ''} onClick={() => setView('resources')}>资源 <span>{resources.length}</span></button>
            <button className={view === 'credentials' ? 'is-active' : ''} onClick={() => setView('credentials')}>凭据 <span>{credentials.length}</span></button>
          </div>
          <Input.Search placeholder="搜索名称或端点" value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
          <Select aria-label="资源类型" value={type} onChange={setType} options={[{ value: 'all', label: '全部类型' }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))]} style={{ width: '100%' }} />
          <div className="rc-list">
            {view === 'resources' ? resources.map((resource) => {
              const profile = data.profiles.find((item) => item.resourceId === resource.id)
              return (
                <button key={resource.id} className={`rc-row ${selected?.id === resource.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(resource.id)}>
                  <span className="rc-row-main"><strong>{resource.name}</strong><em>{profile?.lastTestStatus ? TEST_LABEL[profile.lastTestStatus] ?? profile.lastTestStatus : '未测试'}</em></span>
                  <span className="rc-row-meta">{TYPE_LABEL[resource.type]} · {resource.endpoint || '未填写端点'} · {formatRelative(resource.updatedAt)}</span>
                </button>
              )
            }) : credentials.map((credential) => (
              <div key={credential.id} className="rc-row rc-credential-row">
                <span className="rc-row-main"><strong>{credential.label}</strong><em>{credential.status === 'active' ? '可用' : '已停用'}</em></span>
                <span className="rc-row-meta">{credential.kind} · {formatRelative(credential.updatedAt)}</span>
                {credential.status === 'active' ? (
                  <>
                    <Button size="small" onClick={() => { setRotateCredentialId(credential.id); setRotateSecret(''); setRotatePassphrase('') }}>轮换</Button>
                    <Button size="small" onClick={() => disable.mutate(credential.id)}>停用</Button>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        </aside>

        <section className="rc-main">
          {view === 'credentials' ? (
            <div className="rc-empty">凭据只显示元信息。秘密由系统安全存储加密，不能在此读回。</div>
          ) : !selected ? (
            <div className="rc-empty">还没有资源。登记第一台主机后，可创建 Profile 并测试 SSH 连接。</div>
          ) : (
            <>
              <div className="rc-detail-head">
                <div><span className="rw-kicker">{TYPE_LABEL[selected.type]}</span><h2>{selected.name}</h2><p>{selected.endpoint || '未填写端点'} · {selected.purpose || '未填写用途'}</p></div>
                <div className="rc-detail-actions"><span className="rc-status">{profiles[0]?.lastTestStatus ? TEST_LABEL[profiles[0].lastTestStatus] ?? profiles[0].lastTestStatus : '未测试'}</span><Button size="small" onClick={() => {
                  setEditName(selected.name); setEditEndpoint(selected.endpoint); setEditPurpose(selected.purpose); setEditResourceOpen(true)
                }}>编辑资源</Button><Button size="small" onClick={() => archiveResource.mutate(selected.id)}>停用资源</Button><Button size="small" danger onClick={() => archiveForever.mutate(selected.id)}>归档</Button></div>
              </div>
              <div className="rc-section-title">连接配置</div>
              {profiles.length === 0 ? <div className="rc-empty-inline">没有连接 Profile</div> : null}
              {profiles.map((profile) => (
                <div className="rc-profile" key={profile.id}>
                  <div><strong>{profile.name}</strong><span>{profile.protocol} · {profile.username}@{profile.host}:{profile.port} · {profile.authType}</span></div>
                  <div className="rc-profile-actions">
                    <Button size="small" onClick={() => {
                      setEditProfileId(profile.id); setEditProfileName(profile.name); setEditProfileHost(profile.host)
                      setEditProfilePort(String(profile.port)); setEditProfileUsername(profile.username)
                      setEditProfileFingerprint(profile.hostKeyFingerprint ?? '')
                    }}>编辑</Button>
                    <Button size="small" loading={test.isPending} onClick={() => test.mutate(profile.id)}>测试连接</Button>
                  </div>
                  {profile.hostKeyFingerprint ? <code className="rc-fingerprint">HOST KEY {profile.hostKeyFingerprint}</code> : null}
                </div>
              ))}
              {profiles[0]?.lastTestStatus === 'host_key_untrusted' ? (
                <div className="rc-callout">
                  <strong>需要确认主机指纹</strong>
                  <span>首次连接不自动信任。请核对指纹后固定，再重新测试。</span>
                  <Button size="small" onClick={() => {
                    const discovered = testRuns.find((run) => typeof run.details.fingerprint === 'string')?.details.fingerprint
                    if (typeof discovered === 'string' && profiles[0]) trust.mutate({ profileId: profiles[0].id, value: discovered })
                  }}>信任并重试</Button>
                </div>
              ) : null}
              <div className="rc-section-title">最近连接测试</div>
              {testRuns.length === 0 ? <div className="rc-empty-inline">还没有连接测试</div> : null}
              {testRuns.slice(0, 6).map((run) => (
                <div className="rc-test" key={run.id}>
                  <span className={run.status === 'connected' ? 'ok' : 'bad'}>{TEST_LABEL[run.status] ?? run.status}</span>
                  <strong>{run.message}</strong>
                  <em>{formatRelative(run.createdAt)}{run.latencyMs ? ` · ${run.latencyMs}ms` : ''}</em>
                </div>
              ))}
            </>
          )}
        </section>

        <aside className="rc-inspector" aria-label="连接安全与状态">
          <h2>安全边界</h2>
          <p>凭据仅进入 OS 安全存储，Renderer/SQLite/AI 只持有 opaque 引用。</p>
          <div className="rc-rail-divider" />
          <h2>连接结果</h2>
          <p>连接成功只代表网络、主机身份与认证可用；不代表部署权限或服务健康。</p>
          <div className="rc-rail-divider" />
          <h2>凭据引用</h2>
          <p>Profile 可引用 active 凭据；停用后连接测试立即失败，部署授权仍需单独审批。</p>
        </aside>
      </div>

      <FormDialog open={createOpen} title={resourceType === 'host' ? '登记主机' : '登记平台资源'} okText={resourceType === 'host' ? '保存并测试' : '保存'} cancelText="取消" width={560} confirmLoading={create.isPending} okButtonProps={{ disabled: !name.trim() || (resourceType === 'host' && (!host.trim() || !secret)) }} onOk={() => create.mutate()} onCancel={() => setCreateOpen(false)}>
        <div className="rc-form">
          <label><span>资源类型</span><Select value={resourceType} onChange={setResourceType} options={[{ value: 'host', label: '主机 / VPS' }, { value: 'kubernetes', label: 'Kubernetes 集群' }, { value: 'pipeline', label: 'CI/CD 流水线' }, { value: 'gitops', label: 'GitOps 控制器' }]} /></label>
          <div className="rc-form-grid">
            <label><span>名称</span><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Contabo 测试机" /></label>
            <label><span>用途</span><Input value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="隔离部署测试" /></label>
            {resourceType === 'host' ? (
              <>
                <label><span>主机</span><Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="169.58.112.111" /></label>
                <label><span>端口</span><Input value={port} onChange={(event) => setPort(event.target.value)} /></label>
                <label><span>SSH 用户</span><Input value={username} onChange={(event) => setUsername(event.target.value)} /></label>
                <label><span>认证</span><Select value={authType} onChange={setAuthType} options={[{ value: 'private_key', label: '私钥' }, { value: 'password', label: '密码' }]} /></label>
              </>
            ) : (
              <label><span>API Endpoint / URL</span><Input value={host} onChange={(event) => setHost(event.target.value)} placeholder="https://..." /></label>
            )}
          </div>
          {resourceType === 'host' ? (authType === 'private_key' ? (
            <>
              <label><span>私钥（不读回）</span><Input.TextArea rows={4} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></label>
              <label><span>Passphrase（可选）</span><Input.Password value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label>
            </>
          ) : <label><span>密码（不读回）</span><Input.Password value={secret} onChange={(event) => setSecret(event.target.value)} /></label>) : null}
          {resourceType === 'host' ? <label><span>已固定主机指纹（可选）</span><Input value={fingerprint} onChange={(event) => setFingerprint(event.target.value)} placeholder="SHA256:..." /></label> : null}
          <p className="rc-form-note">{resourceType === 'host' ? '首次测试会返回主机指纹；确认后才能固定并重试。凭据保存需要系统安全存储可用。' : '本轮只登记平台连接元数据；Kubernetes/CI/CD 连接器未实现前明确标记未连接，不伪造测试成功。'}</p>
        </div>
      </FormDialog>

      <FormDialog open={editResourceOpen} title="编辑资源" okText="保存" cancelText="取消" confirmLoading={editResource.isPending} okButtonProps={{ disabled: !editName.trim() }} onOk={() => editResource.mutate()} onCancel={() => setEditResourceOpen(false)}>
        <div className="rc-form">
          <label><span>名称</span><Input value={editName} onChange={(event) => setEditName(event.target.value)} /></label>
          <label><span>端点</span><Input value={editEndpoint} onChange={(event) => setEditEndpoint(event.target.value)} /></label>
          <label><span>用途</span><Input value={editPurpose} onChange={(event) => setEditPurpose(event.target.value)} /></label>
          <p className="rc-form-note">修改会提升资源 revision；使用旧快照的部署授权将被拒绝，需要重新审批。</p>
        </div>
      </FormDialog>

      <FormDialog open={Boolean(editProfileId)} title="编辑连接配置" okText="保存" cancelText="取消" confirmLoading={editProfile.isPending} okButtonProps={{ disabled: !editProfileName.trim() || !editProfileHost.trim() }} onOk={() => editProfile.mutate()} onCancel={() => setEditProfileId(null)}>
        <div className="rc-form">
          <label><span>名称</span><Input value={editProfileName} onChange={(event) => setEditProfileName(event.target.value)} /></label>
          <div className="rc-form-grid">
            <label><span>主机</span><Input value={editProfileHost} onChange={(event) => setEditProfileHost(event.target.value)} /></label>
            <label><span>端口</span><Input value={editProfilePort} onChange={(event) => setEditProfilePort(event.target.value)} /></label>
            <label><span>SSH 用户</span><Input value={editProfileUsername} onChange={(event) => setEditProfileUsername(event.target.value)} /></label>
          </div>
          <label><span>已固定主机指纹</span><Input value={editProfileFingerprint} onChange={(event) => setEditProfileFingerprint(event.target.value)} placeholder="SHA256:..." /></label>
          <p className="rc-form-note">修改连接配置会提升 Profile revision；原部署授权立即失效。</p>
        </div>
      </FormDialog>

      <FormDialog open={Boolean(rotateCredentialId)} title="轮换凭据" okText="轮换" cancelText="取消" confirmLoading={rotateCredential.isPending} okButtonProps={{ disabled: !rotateSecret.trim() }} onOk={() => rotateCredential.mutate()} onCancel={() => setRotateCredentialId(null)}>
        <div className="rc-form">
          <label><span>新私钥（不读回）</span><Input.TextArea rows={4} value={rotateSecret} onChange={(event) => setRotateSecret(event.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" /></label>
          <label><span>Passphrase（可选）</span><Input.Password value={rotatePassphrase} onChange={(event) => setRotatePassphrase(event.target.value)} /></label>
          <p className="rc-form-note">轮换会创建新凭据、把引用它的连接配置切换到新凭据，并停用旧凭据；部署授权随之失效。</p>
        </div>
      </FormDialog>
    </div>
  )
}
