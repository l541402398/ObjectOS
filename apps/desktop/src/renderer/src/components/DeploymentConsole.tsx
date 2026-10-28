import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Empty, Input, Modal, Select, Tag } from 'antd'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'
import './deployment-console.css'

const STATUS_LABEL: Record<string, string> = {
  awaiting_approval: '待审批', pending: '待执行', running: '执行中', verifying: '验证中', succeeded: '已登记',
  failed: '失败', cancelled: '已取消', unknown: '未知', needs_reconciliation: '待核对', rolled_back: '已回滚',
}
const ASSURANCE_LABEL: Record<string, string> = {
  self_declared: '自我声明', source_observed: '来源观察', independently_reproduced: '独立复现', externally_confirmed: '外部确认',
}

function deploymentStatusLabel(deployment: { status: string; assurance: string }): string {
  if (deployment.status === 'succeeded' && deployment.assurance === 'self_declared') return '制品已交付 · 未验证'
  if (deployment.status === 'succeeded' && deployment.assurance === 'externally_confirmed') return '服务已确认'
  return STATUS_LABEL[deployment.status] ?? deployment.status
}

export function DeploymentConsole({ projectId, versionId, versionControl }: { projectId: string; versionId: string; versionControl?: ReactNode }) {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const overview = useQuery({
    queryKey: ['release-overview', projectId, versionId],
    queryFn: () => window.projectos.release.overview(projectId, versionId),
  })
  const adapters = useQuery({ queryKey: ['delivery-adapters', projectId], queryFn: () => window.projectos.release.adapters(projectId) })
  const resourceOverview = useQuery({ queryKey: ['resource-overview', projectId], queryFn: () => window.projectos.resources.overview(projectId) })
  const data = overview.data
  const [environmentId, setEnvironmentId] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null)
  const [deployOpen, setDeployOpen] = useState(false)
  const [deployReleaseId, setDeployReleaseId] = useState<string | null>(null)
  const [deploySource, setDeploySource] = useState<'manual' | 'imported' | 'unknown'>('manual')
  const [targetOpen, setTargetOpen] = useState(false)
  const [targetName, setTargetName] = useState('')
  const [targetRef, setTargetRef] = useState('')
  const [targetKind, setTargetKind] = useState<'local' | 'ssh'>('ssh')
  const [targetResourceId, setTargetResourceId] = useState<string | null>(null)
  const [targetProfileId, setTargetProfileId] = useState<string | null>(null)
  const [targetPath, setTargetPath] = useState('/opt/projectos-delivery-test')
  const [executeError, setExecuteError] = useState<string | null>(null)
  const poller = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => () => { if (poller.current) clearInterval(poller.current) }, [])

  useEffect(() => {
    if (!data) return
    setEnvironmentId((current) => current ?? data.environments[0]?.id ?? null)
    setTargetId((current) => current ?? data.targets[0]?.id ?? null)
    setSelectedDeploymentId((current) => current ?? data.deployments[0]?.id ?? null)
  }, [data])

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['release-overview', projectId, versionId] })
  }
  const createDeployment = useMutation({
    mutationFn: () =>
      window.projectos.release.createDeployment({
        projectId, releaseId: deployReleaseId!, environmentId: environmentId!, targetId,
        strategyId: null, source: deploySource,
        idempotencyKey: `deploy:${deployReleaseId}:${environmentId}:${deploySource}:${Date.now()}`,
        status: 'succeeded', externalId: null, artifactHash: null, receipt: {}, notes: '', rollbackOfDeploymentId: null,
      }),
    onSuccess: async () => { setDeployOpen(false); await invalidate(); message.success('部署已创建，等待独立审批') },
    onError: (error) => message.error(errorMessage(error)),
  })
  const [executing, setExecuting] = useState(false)
  const runExecute = async (deploymentId: string): Promise<void> => {
    setExecuting(true)
    setExecuteError(null)
    if (poller.current) clearInterval(poller.current)
    poller.current = setInterval(() => { void queryClient.refetchQueries({ queryKey: ['release-overview', projectId, versionId] }) }, 2500)
    try {
      const result = await window.projectos.release.executeDeployment(deploymentId)
      queryClient.setQueryData(['release-overview', projectId, versionId], (current: any) => current ? {
        ...current,
        deployments: current.deployments.map((item: any) => item.id === result.id ? result : item),
      } : current)
      const healthOk = (result.receipt?.health as { ok?: boolean } | undefined)?.ok === true
      await invalidate()
      await queryClient.refetchQueries({ queryKey: ['release-overview', projectId, versionId] })
      message.success(healthOk ? '服务健康验证通过，已记录回执' : '制品已交付并校验；服务未启动，未验证健康')
    } catch (error) {
      void invalidate()
      setExecuteError(errorMessage(error))
      message.error(errorMessage(error))
    } finally {
      if (poller.current) clearInterval(poller.current)
      poller.current = null
      setExecuting(false)
    }
  }
  const record = useMutation({
    mutationFn: (deploymentId: string) =>
      window.projectos.release.recordDeployment({
        deploymentId, status: 'succeeded', externalId: null, artifactHash: null,
        receipt: { recordedBy: 'local-user' }, notes: '人工记录，未验证',
      }),
    onSuccess: async () => { await invalidate(); message.success('已记录为人工结果，可信度见 Inspector') },
    onError: (error) => message.error(errorMessage(error)),
  })
  const createTarget = useMutation({
    mutationFn: () =>
      window.projectos.release.createTarget({
        projectId, environmentId: environmentId!, name: targetName.trim(), kind: targetKind,
        controlMode: targetKind === 'ssh' ? 'ssh_managed' : 'external_observed',
        adapterType: targetKind === 'ssh' ? 'ssh-artifact' : 'local-artifact',
        targetRef: targetRef.trim() || targetPath.trim(),
        resourceId: targetResourceId,
        connectionProfileId: targetProfileId,
        protected: false,
      }),
    onSuccess: async () => { setTargetOpen(false); setTargetName(''); setTargetRef(''); setTargetProfileId(null); setTargetResourceId(null); await invalidate(); message.success('目标已登记') },
    onError: (error) => message.error(errorMessage(error)),
  })

  const deployments = data?.deployments ?? []
  const selected = deployments.find((item) => item.id === selectedDeploymentId) ?? deployments[0] ?? null
  const target = data?.targets.find((item) => item.id === selected?.targetId) ?? data?.targets.find((item) => item.id === targetId) ?? null
  const environment = data?.environments.find((item) => item.id === (selected?.environmentId ?? environmentId)) ?? null
  const currentFact = data?.environmentVersions.find((item) => item.environmentId === environment?.id) ?? null
  const currentRelease = data?.releases.find((item) => item.id === currentFact?.releaseId) ?? null
  const release = data?.releases.find((item) => item.id === selected?.releaseId) ?? null
  const health = selected?.receipt?.health as { ok?: boolean; detail?: string } | undefined
  const canExecute = selected?.status === 'pending' && target && ['local-artifact', 'ssh-artifact'].includes(target.adapterType ?? '')

  if (overview.isLoading) return <div className="dc-shell"><div className="rw-loading">正在载入部署控制台…</div></div>
  if (!data) return <div className="dc-shell"><Empty description="部署数据不可用" /></div>

  return (
    <div className="dc-shell">
      <header className="dc-head">
        <div>
          <div className="rw-eyebrow">DELIVERY CONTROL</div>
          <h1>部署控制台</h1>
          <p>{environment?.name ?? '未选择环境'} · {target?.name ?? '未选择目标'} · {currentRelease ? `当前可信版本 v${currentRelease.version}` : '没有已验证运行版本'}</p>
        </div>
        <div className="dc-head-right">
          {versionControl}
          <Select value={environmentId ?? undefined} style={{ width: 130 }} options={data.environments.map((item) => ({ value: item.id, label: item.name }))} onChange={setEnvironmentId} />
          <Select value={targetId ?? undefined} style={{ width: 190 }} placeholder="选择目标" options={data.targets.map((item) => ({ value: item.id, label: `${item.name} · ${item.adapterType ?? '未配置'}` }))} onChange={setTargetId} />
          <Button onClick={() => setTargetOpen(true)}>连接目标</Button>
        </div>
      </header>

      <div className="dc-body">
        <aside className="dc-targets">
          <div className="dc-panel-title">环境与目标 <span>{data.targets.length}</span></div>
          {data.targets.length === 0 ? (
            <div className="dc-empty-block">
              <strong>还没有部署目标</strong>
              <p>连接 SSH/VPS 或本地目录后，才可执行和验证。</p>
              <Button size="small" type="primary" onClick={() => setTargetOpen(true)}>配置目标</Button>
            </div>
          ) : null}
          {data.targets.map((item) => {
            const capability = adapters.data?.find((adapter) => adapter.type === item.adapterType)
            return (
              <button key={item.id} className={`dc-target ${targetId === item.id ? 'is-selected' : ''}`} onClick={() => setTargetId(item.id)}>
                <span className="dc-target-main"><strong>{item.name}</strong><em>{item.kind.toUpperCase()}</em></span>
                <span className="dc-target-meta">{capability?.capabilities.execute ? '可执行' : '只读/未连接'} · {item.targetRef || '未填写地址'}</span>
              </button>
            )
          })}
          <div className="dc-adapters">
            {(adapters.data ?? []).map((adapter) => (
              <div key={adapter.type} className="dc-adapter"><i className={adapter.capabilities.execute ? 'ok' : ''} />{adapter.label}<em>{adapter.capabilities.execute ? '可执行' : '未连接'}</em></div>
            ))}
          </div>
        </aside>

        <section className="dc-center">
          <div className="dc-actions">
            <Button type="primary" disabled={!data.releases.length} onClick={() => { setDeployReleaseId(data.releases[0]?.id ?? null); setDeployOpen(true) }}>登记部署</Button>
            {canExecute ? <Button type="primary" loading={executing} onClick={() => void runExecute(selected!.id)}>执行部署</Button> : null}
            {selected?.status === 'pending' ? <Button onClick={() => record.mutate(selected.id)} loading={record.isPending}>人工记录结果</Button> : null}
            <Button disabled={!data.releases.length} onClick={() => setDeployOpen(true)}>从 Release 开始</Button>
            <Button onClick={() => { void queryClient.refetchQueries({ queryKey: ['release-overview', projectId, versionId] }) }}>刷新状态</Button>
          </div>
          {executeError ? <div className="dc-execute-error">{executeError}</div> : null}
          {!selected ? (
            <div className="dc-empty-center">
              <strong>选择一个 Release 开始部署</strong>
              <p>审批 → 执行 → 健康验证 → 回执；未执行时不会伪造阶段。</p>
              <div className="dc-release-options">
                {data.releases.map((item) => (
                  <button key={item.id} onClick={() => { setDeployReleaseId(item.id); setDeployOpen(true) }}>v{item.version} · {item.manifestHash.slice(0, 8)}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <div className="dc-deploy-head">
                <div><span className="rw-kicker">DEPLOYMENT</span><h2>{target?.name ?? '未命名目标'} · {environment?.name ?? '环境'}</h2></div>
                <Tag>{deploymentStatusLabel(selected)}</Tag>
              </div>
              <div className="dc-steps">
                {[
                  ['审批', !['awaiting_approval'].includes(selected.status)],
                  ['制品交付', ['running', 'succeeded', 'failed', 'needs_reconciliation'].includes(selected.status)],
                  ['服务验证', Boolean(health?.ok)],
                  ['回执', Boolean(selected.externalId)],
                ].map(([label, done]) => (
                  <div key={String(label)} className={done ? 'is-done' : ''}><i />{label}</div>
                ))}
              </div>
              <div className="dc-facts">
                <span><b>Release</b>{release ? `v${release.version}` : '—'}</span>
                <span><b>制品</b>{selected.artifactHash?.slice(0, 12) ?? '—'}</span>
                <span><b>来源</b>{selected.source}</span>
                <span><b>可信度</b>{ASSURANCE_LABEL[selected.assurance] ?? selected.assurance}</span>
              </div>
              <div className="dc-evidence">
                <h3>执行证据</h3>
                {health ? (
                  <div className={`dc-health ${health.ok ? 'ok' : 'warn'}`}>
                    <strong>{health.ok ? '服务健康通过' : '未验证服务健康'}</strong>
                    <span>{health.detail}</span>
                  </div>
                ) : <div className="dc-muted">尚未执行；批准后由 Adapter 产生真实证据。</div>}
                {selected.notes ? <p className="dc-note">{selected.notes}</p> : null}
                <div className="dc-receipt">
                  <span>外部 ID</span><code>{selected.externalId ?? '—'}</code>
                  <span>开始</span><code>{selected.startedAt ? formatRelative(selected.startedAt) : '—'}</code>
                  <span>完成</span><code>{selected.finishedAt ? formatRelative(selected.finishedAt) : '—'}</code>
                </div>
              </div>
              <div className="dc-history">
                <h3>部署历史 <span>{deployments.length}</span></h3>
                {deployments.map((item) => (
                  <button key={item.id} className={`dc-history-row ${selected.id === item.id ? 'is-selected' : ''}`} onClick={() => setSelectedDeploymentId(item.id)}>
                    <span>{data.releases.find((r) => r.id === item.releaseId)?.version ?? item.releaseId.slice(0, 8)}</span>
                    <em>{deploymentStatusLabel(item)}</em>
                    <small>{item.source} · {formatRelative(item.createdAt)}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <aside className="dc-inspector">
          <h3>目标与权限</h3>
          <div className="dc-kv"><span>环境</span><strong>{environment?.name ?? '—'}</strong></div>
          <div className="dc-kv"><span>目标</span><strong>{target?.name ?? '—'}</strong></div>
          <div className="dc-kv"><span>控制方式</span><strong>{target?.controlMode ?? '—'}</strong></div>
          <div className="dc-kv"><span>Adapter</span><strong>{target?.adapterType ?? '未配置'}</strong></div>
          <div className="dc-kv"><span>地址</span><strong className="dc-ellipsis">{target?.targetRef ?? '—'}</strong></div>
          <div className="dc-rail-divider" />
          <h3>当前可信运行版本</h3>
          <div className="dc-current">{currentRelease ? `v${currentRelease.version}` : '无'}</div>
          <p className="dc-rail-copy">仅外部确认或独立观察的部署会成为环境运行版本。人工记录和文件交付不会。</p>
          <div className="dc-rail-divider" />
          <h3>操作</h3>
          {selected?.status === 'failed' ? <Button block onClick={() => { setDeployReleaseId(selected.releaseId); setDeployOpen(true) }}>重新登记</Button> : null}
          <p className="dc-rail-copy">执行前必须完成独立审批；未知结果进入待核对，不自动重放。</p>
        </aside>
      </div>

      <Modal open={deployOpen} title="登记部署" okText="创建" cancelText="取消" confirmLoading={createDeployment.isPending} okButtonProps={{ disabled: !deployReleaseId || !environmentId }} onOk={() => createDeployment.mutate()} onCancel={() => setDeployOpen(false)}>
        <div className="rw-form">
          <label><span>Release</span><Select value={deployReleaseId} onChange={setDeployReleaseId} options={data.releases.map((item) => ({ value: item.id, label: `v${item.version} · ${item.manifestHash.slice(0, 8)}` }))} /></label>
          <label><span>环境</span><Select value={environmentId} onChange={setEnvironmentId} options={data.environments.map((item) => ({ value: item.id, label: item.name }))} /></label>
          <label><span>目标</span><Select allowClear value={targetId} onChange={(value) => setTargetId(value ?? null)} options={data.targets.map((item) => ({ value: item.id, label: item.name }))} /></label>
          <label><span>来源</span><Select value={deploySource} onChange={setDeploySource} options={[
            { value: 'manual', label: '手工记录（未验证）' },
            { value: 'imported', label: '导入外部记录' },
            { value: 'unknown', label: '来源未知（待核对）' },
          ]} /></label>
          <p className="dc-note">创建后等待独立审批；不会自动执行。</p>
        </div>
      </Modal>

      <Modal open={targetOpen} title="连接部署目标" okText="登记" cancelText="取消" confirmLoading={createTarget.isPending} okButtonProps={{ disabled: !targetName.trim() || !targetRef.trim() }} onOk={() => createTarget.mutate()} onCancel={() => setTargetOpen(false)}>
        <div className="rw-form">
          <label><span>已登记资源</span><Select allowClear value={targetResourceId} onChange={(value) => { setTargetResourceId(value ?? null); setTargetProfileId(null) }} options={(resourceOverview.data?.resources ?? []).map((item) => ({ value: item.id, label: `${item.name} · ${item.endpoint}` }))} /></label>
          <label><span>连接 Profile</span><Select allowClear value={targetProfileId} onChange={(value) => {
            setTargetProfileId(value ?? null)
            const profile = (resourceOverview.data?.profiles ?? []).find((item) => item.id === value)
            if (!profile) return
            setTargetResourceId(profile.resourceId)
            setTargetKind('ssh')
            setTargetName((resourceOverview.data?.resources ?? []).find((item) => item.id === profile.resourceId)?.name ?? profile.name)
            setTargetRef(`ssh://${profile.username}@${profile.host}:${profile.port}${targetPath.startsWith('/') ? targetPath : `/${targetPath}`}`)
          }} options={(resourceOverview.data?.profiles ?? []).filter((item) => !targetResourceId || item.resourceId === targetResourceId).map((item) => ({ value: item.id, label: `${item.name} · ${item.username}@${item.host}:${item.port}` }))} /></label>
          <label><span>名称</span><Input value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="例如：Contabo 隔离测试" /></label>
          <label><span>类型</span><Select value={targetKind} onChange={setTargetKind} options={[{ value: 'ssh', label: 'SSH / VPS' }, { value: 'local', label: '本地目录' }]} /></label>
          <label><span>远程目录 / 本地路径</span><Input value={targetPath} onChange={(event) => {
            setTargetPath(event.target.value)
            const profile = (resourceOverview.data?.profiles ?? []).find((item) => item.id === targetProfileId)
            if (profile) setTargetRef(`ssh://${profile.username}@${profile.host}:${profile.port}${event.target.value.startsWith('/') ? event.target.value : `/${event.target.value}`}`)
          }} placeholder="/opt/projectos-delivery-test" /></label>
          <label><span>目标地址（自动填充，可修正）</span><Input value={targetRef} onChange={(event) => setTargetRef(event.target.value)} placeholder="ssh://root@host:22/opt/projectos-... 或本地目录" /></label>
          <p className="dc-note">SSH 密钥由 OS 安全存储引用，不写入数据库。连接检测成功后才显示可执行。</p>
        </div>
      </Modal>
    </div>
  )
}
