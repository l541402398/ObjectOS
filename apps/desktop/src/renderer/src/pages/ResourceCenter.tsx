import { FormDialog } from '../next-ui/overlay/FormDialog'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { App as AntApp, Input, Select } from 'antd'
import {
  Activity, AlertTriangle, ArrowRight, Boxes, ChevronDown, Fingerprint, GitBranch, KeyRound, Lock, Plus,
  RefreshCw, RotateCw, Search, Server, ShieldCheck, Workflow, type LucideIcon,
} from 'lucide-react'
import type { ConnectionTestRun, Resource } from '@projectos/contracts'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'
import { useResolvedTheme } from '../stores/ui'
import '../features/studio/studio.css'
import './resource-center.css'
import './resource-hub.css'

const TYPE_LABEL: Record<string, string> = { host: '主机 / VPS', kubernetes: 'Kubernetes', pipeline: 'CI/CD Pipeline', gitops: 'GitOps' }
const TEST_LABEL: Record<string, string> = {
  connected: '已连接', auth_failed: '认证失败', timeout: '超时', host_key_mismatch: '主机指纹变化',
  host_key_untrusted: '待确认指纹', permission_denied: '权限不足', network_error: '网络不可达', unsupported: '未实现',
}

type Health = 'ok' | 'warn' | 'bad' | 'idle'
const HEALTH_LABEL: Record<Health, string> = { ok: '正常', warn: '需关注', bad: '异常', idle: '未测试' }
const CRED_LABEL: Record<string, string> = { ssh_private_key: 'SSH 私钥', ssh_password: 'SSH 密码', api_token: 'API Token', kubeconfig: 'kubeconfig', certificate: '证书' }
const TYPE_ICON: Record<string, LucideIcon> = { host: Server, kubernetes: Boxes, pipeline: Workflow, gitops: GitBranch }
const ONBOARD_STEPS = [
  { key: 'register', title: '登记主机', detail: '名称、地址、端口与 SSH 用户' },
  { key: 'credential', title: '绑定凭据', detail: '私钥或密码直接进入系统安全存储' },
  { key: 'test', title: '测试并固定指纹', detail: '只读探测，首次连接需确认主机指纹' },
  { key: 'deploy', title: '用作部署目标', detail: '在部署中心把主机关联到环境' },
] as const

function health(status: string | null, type: string): Health {
  if (!status || type !== 'host') return 'idle'
  if (status === 'connected') return 'ok'
  if (status === 'unsupported') return 'idle'
  if (status === 'host_key_untrusted' || status === 'timeout' || status === 'network_error') return 'warn'
  return 'bad'
}

function groupClusters(list: Resource[]): Array<[string, Resource[]]> {
  const map = new Map<string, Resource[]>()
  for (const item of list) {
    const key = item.labels[0] ?? (item.type === 'host' ? '主机' : '平台')
    map.set(key, [...(map.get(key) ?? []), item])
  }
  return [...map.entries()]
}

/** Real latency of the last connection tests (oldest → newest); failures draw as short red ticks. */
function Latency({ runs }: { runs: ConnectionTestRun[] }) {
  const recent = runs.slice(0, 8).reverse()
  if (recent.length === 0) return <span className="rh-latency is-empty" aria-hidden />
  const max = Math.max(1, ...recent.map((run) => run.latencyMs ?? 0))
  const last = recent[recent.length - 1]
  return (
    <span className="rh-latency" title={`最近 ${recent.length} 次连接测试`}>
      <span className="rh-latency-bars" aria-hidden>
        {recent.map((run) => <i key={run.id} className={run.status === 'connected' ? '' : 'is-fail'} style={{ height: run.status === 'connected' ? `${Math.max(25, ((run.latencyMs ?? 0) / max) * 100)}%` : '22%' }} />)}
      </span>
      <small>{last?.latencyMs ? `${last.latencyMs}ms` : '—'}</small>
    </span>
  )
}

/** Line illustration in token colours: workstation → pinned path → host stack with health lights. */
function ConnectionArt() {
  return (
    <svg viewBox="0 0 360 220" className="rh-art">
      <defs>
        <linearGradient id="rh-art-glow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--ui-accent)" stopOpacity="0.22" />
          <stop offset="1" stopColor="var(--ui-teal, var(--ui-accent))" stopOpacity="0.06" />
        </linearGradient>
      </defs>
      <ellipse cx="180" cy="190" rx="160" ry="18" fill="url(#rh-art-glow)" />
      <g className="rh-art-laptop">
        <rect x="26" y="78" width="92" height="60" rx="8" />
        <path d="M14 146h116l-8 10H22z" />
        <path d="M44 100h34M44 112h52M44 124h24" className="rh-art-soft" />
      </g>
      <path d="M128 112 C170 112 180 70 226 70" className="rh-art-path" />
      <path d="M128 112 C170 112 180 150 226 150" className="rh-art-path is-faint" />
      <g className="rh-art-key" transform="translate(166 92)">
        <circle cx="10" cy="10" r="13" />
        <path d="M6 10h10M12 10v5M15 10v3" />
      </g>
      <g className="rh-art-host">
        <rect x="226" y="44" width="112" height="44" rx="9" />
        <rect x="226" y="98" width="112" height="44" rx="9" className="is-dim" />
        <rect x="226" y="152" width="112" height="28" rx="8" className="is-ghost" />
        <path d="M244 60h44M244 72h28M244 114h44M244 126h28" className="rh-art-soft" />
        <circle cx="318" cy="66" r="5" className="rh-art-led is-ok" />
        <circle cx="318" cy="120" r="5" className="rh-art-led is-idle" />
      </g>
    </svg>
  )
}

export function ResourceCenter({ projectId }: { projectId: string }) {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const overview = useQuery({ queryKey: ['resource-overview', projectId], queryFn: () => window.projectos.resources.overview(projectId) })
  const [view, setView] = useState<'resources' | 'credentials'>('resources')
  const [type] = useState<string>('all')
  const [healthFilter, setHealthFilter] = useState<Health | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const navigate = useNavigate()
  const theme = useResolvedTheme()
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

  const openCreate = (kind: 'host' | 'kubernetes' | 'pipeline' | 'gitops'): void => { setResourceType(kind); setCreateOpen(true) }
  const allResources = data?.resources ?? []
  const healthOf = (resourceId: string): Health => health(data?.profiles.find((item) => item.resourceId === resourceId)?.lastTestStatus ?? null, allResources.find((item) => item.id === resourceId)?.type ?? 'host')
  const healthCounts = allResources.reduce<Record<Health, number>>((acc, item) => { acc[healthOf(item.id)] += 1; return acc }, { ok: 0, warn: 0, bad: 0, idle: 0 })
  const visibleResources = resources.filter((item) => healthFilter === 'all' || healthOf(item.id) === healthFilter)
  const clusters = groupClusters(visibleResources)

  if (overview.isLoading) return <div className="studio-theme rh-page" data-theme={theme}><div className="rh-skeleton" aria-busy="true"><i /><i /><i /></div></div>
  if (overview.isError || !data) {
    return (
      <div className="studio-theme rh-page" data-theme={theme}>
        <div className="rh-state is-error"><AlertTriangle size={20} /><strong>资源目录读取失败</strong><span>{overview.isError ? errorMessage(overview.error) : '没有收到数据'}</span><button type="button" className="studio-ghost" onClick={() => void overview.refetch()}><RefreshCw size={13} />重试</button></div>
      </div>
    )
  }

  const principles = (
    <ul className="rh-principles">
      <li><ShieldCheck size={15} /><span><strong>凭据不落地</strong>私钥与密码只进入系统安全存储，界面、数据库和 AI 只持有引用。</span></li>
      <li><Fingerprint size={15} /><span><strong>指纹先确认</strong>首次连接不会自动信任主机，核对指纹后才固定。</span></li>
      <li><Lock size={15} /><span><strong>连接 ≠ 授权</strong>连接成功不代表能部署；每次部署仍走交付审批。</span></li>
    </ul>
  )

  const header = (
    <header className="rh-head">
      <div className="rh-head-copy">
        <h1>资源与连接</h1>
        <p title="连接测试只证明网络、身份与认证可用；部署仍需单独授权。">部署用到的主机、集群与流水线；连接可用不等于已授权部署。</p>
      </div>
      <div className="rh-head-actions">
        {allResources.length > 0 ? (
          <div className="rh-switch" role="tablist" aria-label="资源视图">
            <button type="button" role="tab" aria-selected={view === 'resources'} onClick={() => setView('resources')}><Server size={13} />资源 <b>{allResources.length}</b></button>
            <button type="button" role="tab" aria-selected={view === 'credentials'} onClick={() => setView('credentials')}><KeyRound size={13} />凭据 <b>{credentials.length}</b></button>
          </div>
        ) : null}
        <button type="button" className="studio-ghost" onClick={() => openCreate('kubernetes')}><Boxes size={14} />登记平台资源</button>
        <button type="button" className="studio-cta" onClick={() => openCreate('host')}><Plus size={14} />新建主机</button>
      </div>
    </header>
  )

  return (
    <div className="studio-theme rh-page" data-theme={theme}>
      {header}

      {allResources.length === 0 ? (
        <section className="rh-onboard" aria-label="登记第一台主机">
          <div className="rh-onboard-art" aria-hidden><ConnectionArt /></div>
          <div className="rh-onboard-copy">
            <h2>把第一台主机接进来</h2>
            <p>四步完成：登记、绑定凭据、测试并固定指纹，然后在部署中心把它用作部署目标。</p>
            <ol className="rh-steps">
              {ONBOARD_STEPS.map((step, index) => (
                <li key={step.key} className={index === 0 ? 'is-current' : ''}>
                  <button type="button" onClick={() => (step.key === 'deploy' ? navigate(`/projects/${projectId}/deployments`) : openCreate('host'))} aria-current={index === 0 ? 'step' : undefined}>
                    <span className="rh-step-node">{index + 1}</span>
                    <span className="rh-step-copy"><strong>{step.title}</strong><small>{step.detail}</small></span>
                    <ArrowRight size={14} className="rh-step-go" />
                  </button>
                </li>
              ))}
            </ol>
            <div className="rh-platforms">
              <span>或登记平台资源</span>
              {(['kubernetes', 'pipeline', 'gitops'] as const).map((kind) => (
                <button key={kind} type="button" onClick={() => openCreate(kind)}>{TYPE_LABEL[kind]}</button>
              ))}
            </div>
          </div>
          {principles}
        </section>
      ) : view === 'credentials' ? (
        <section className="rh-creds" aria-label="凭据">
          <p className="rh-note"><Lock size={13} />凭据只显示元信息，秘密由系统安全存储加密，不能在这里读回。</p>
          <ul>
            {credentials.map((credential) => {
              const used = data.profiles.filter((item) => item.credentialRef === credential.id).length
              return (
                <li key={credential.id} className={credential.status === 'active' ? '' : 'is-off'}>
                  <span className={`rh-dot is-${credential.status === 'active' ? 'ok' : 'idle'}`} aria-hidden />
                  <span className="rh-row-main"><strong>{credential.label}</strong><small>{CRED_LABEL[credential.kind] ?? credential.kind} · {used} 个连接引用 · 更新于 {formatRelative(credential.updatedAt)}</small></span>
                  {credential.status === 'active' ? (
                    <span className="rh-row-actions">
                      <button type="button" className="studio-ghost" onClick={() => { setRotateCredentialId(credential.id); setRotateSecret(''); setRotatePassphrase('') }}><RotateCw size={12} />轮换</button>
                      <button type="button" className="studio-ghost" onClick={() => disable.mutate(credential.id)}>停用</button>
                    </span>
                  ) : <em className="rh-tag">已停用</em>}
                </li>
              )
            })}
          </ul>
          <p className="rh-note is-foot"><RotateCw size={13} />轮换会创建新凭据、把引用它的连接切换过去并停用旧凭据；以旧凭据批准的部署授权随之失效。</p>
          {principles}
        </section>
      ) : (
        <section className="rh-fleet" aria-label="资源">
          <div className="rh-toolbar">
            <div className="rh-health" role="group" aria-label="按健康状态筛选">
              <button type="button" aria-pressed={healthFilter === 'all'} onClick={() => setHealthFilter('all')}>全部 <b>{allResources.length}</b></button>
              {(['ok', 'warn', 'bad', 'idle'] as const).map((key) => healthCounts[key] ? (
                <button key={key} type="button" aria-pressed={healthFilter === key} onClick={() => setHealthFilter(key)}><span className={`rh-dot is-${key}`} aria-hidden />{HEALTH_LABEL[key]} <b>{healthCounts[key]}</b></button>
              ) : null)}
            </div>
            <label className="rh-search"><Search size={13} aria-hidden /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称或端点" aria-label="搜索资源" /></label>
          </div>

          {clusters.length === 0 ? <p className="rh-none">没有符合条件的资源</p> : null}
          {clusters.map(([cluster, list]) => (
            <div key={cluster} className="rh-cluster">
              <header>
                <strong>{cluster}</strong>
                <span className="rh-cluster-dots" aria-hidden>{list.map((item) => <i key={item.id} className={`is-${healthOf(item.id)}`} />)}</span>
                <em>{list.length}</em>
              </header>
              <ul>
                {list.map((resource) => {
                  const profile = data.profiles.find((item) => item.resourceId === resource.id) ?? null
                  const runs = data.testRuns.filter((item) => item.resourceId === resource.id)
                  const state = healthOf(resource.id)
                  const open = expandedId === resource.id
                  const Icon = TYPE_ICON[resource.type] ?? Server
                  return (
                    <li key={resource.id} className={`rh-host ${open ? 'is-open' : ''}`}>
                      <button type="button" className="rh-host-row" aria-expanded={open} onClick={() => { setExpandedId(open ? null : resource.id); setSelectedId(resource.id) }}>
                        <span className={`rh-dot is-${state}`} aria-label={HEALTH_LABEL[state]} />
                        <span className="rh-host-icon" aria-hidden><Icon size={15} /></span>
                        <span className="rh-row-main">
                          <strong>{resource.name}</strong>
                          <small><code>{profile ? `${profile.username}@${profile.host}:${profile.port}` : resource.endpoint || '未填写端点'}</code>{resource.purpose ? ` · ${resource.purpose}` : ''}</small>
                        </span>
                        <Latency runs={runs} />
                        <span className="rh-host-state">
                          <strong className={`is-${state}`}>{profile?.lastTestStatus ? TEST_LABEL[profile.lastTestStatus] ?? profile.lastTestStatus : resource.type === 'host' ? '未测试' : '连接器未实现'}</strong>
                          <small>{profile?.lastTestAt ? formatRelative(profile.lastTestAt) : TYPE_LABEL[resource.type]}</small>
                        </span>
                        <ChevronDown size={15} className="rh-chevron" aria-hidden />
                      </button>
                      {open ? (
                        <div className="rh-host-detail">
                          {profile ? (
                            <div className="rh-profile">
                              <dl>
                                <div><dt>连接</dt><dd>{profile.protocol.toUpperCase()} · {profile.authType === 'private_key' ? '私钥' : profile.authType === 'password' ? '密码' : profile.authType}</dd></div>
                                <div><dt>凭据</dt><dd>{credentials.find((item) => item.id === profile.credentialRef)?.label ?? '未绑定'}</dd></div>
                                <div className="is-wide"><dt>主机指纹</dt><dd className="is-mono">{profile.hostKeyFingerprint ?? '尚未固定'}</dd></div>
                              </dl>
                              {profile.lastTestStatus === 'host_key_untrusted' || profile.lastTestStatus === 'host_key_mismatch' ? (
                                <p className={`rh-callout is-${state}`}>
                                  <Fingerprint size={14} />
                                  <span>{profile.lastTestStatus === 'host_key_mismatch' ? '主机指纹与固定值不一致。请先确认服务器是否被重装或替换，再更新指纹。' : '首次连接不会自动信任。核对指纹后固定，再重新测试。'}</span>
                                  {profile.lastTestStatus === 'host_key_untrusted' ? (
                                    <button type="button" className="studio-ghost" onClick={() => {
                                      const discovered = runs.find((run) => typeof run.details.fingerprint === 'string')?.details.fingerprint
                                      if (typeof discovered === 'string') trust.mutate({ profileId: profile.id, value: discovered })
                                    }}>信任并重试</button>
                                  ) : null}
                                </p>
                              ) : null}
                            </div>
                          ) : <p className="rh-note">{resource.type === 'host' ? '还没有连接配置。' : '平台连接器尚未实现，只登记元数据，不伪造测试结果。'}</p>}
                          {runs.length > 0 ? (
                            <ol className="rh-tests" aria-label="最近连接测试">
                              {runs.slice(0, 5).map((run) => (
                                <li key={run.id} className={`is-${health(run.status, resource.type)}`}>
                                  <span className="rh-test-node" aria-hidden />
                                  <strong>{TEST_LABEL[run.status] ?? run.status}</strong>
                                  <span>{run.message}</span>
                                  <time>{formatRelative(run.createdAt)}{run.latencyMs ? ` · ${run.latencyMs}ms` : ''}</time>
                                </li>
                              ))}
                            </ol>
                          ) : null}
                          <div className="rh-detail-actions">
                            {profile ? <button type="button" className="studio-cta" disabled={test.isPending} onClick={() => test.mutate(profile.id)}><Activity size={13} />{test.isPending ? '测试中…' : '测试连接'}</button> : null}
                            {profile ? <button type="button" className="studio-ghost" onClick={() => {
                              setEditProfileId(profile.id); setEditProfileName(profile.name); setEditProfileHost(profile.host)
                              setEditProfilePort(String(profile.port)); setEditProfileUsername(profile.username)
                              setEditProfileFingerprint(profile.hostKeyFingerprint ?? '')
                            }}>编辑连接</button> : null}
                            <button type="button" className="studio-ghost" onClick={() => { setEditName(resource.name); setEditEndpoint(resource.endpoint); setEditPurpose(resource.purpose); setEditResourceOpen(true) }}>编辑资源</button>
                            <span className="rh-grow" />
                            <button type="button" className="studio-ghost" onClick={() => archiveResource.mutate(resource.id)}>停用</button>
                            <button type="button" className="studio-danger" onClick={() => archiveForever.mutate(resource.id)}>归档</button>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

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
