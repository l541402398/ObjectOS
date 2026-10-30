import { useNavigate } from 'react-router-dom'
import { DeploymentStart } from './DeploymentStart'
import { FormDialog } from '../next-ui/overlay/FormDialog'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Empty, Input, Select, Tag } from 'antd'
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
const OPERATION_LABEL: Record<string, string> = {
  prepared: '已登记意图', executing: '执行中', confirmed: '已确认', failed: '失败', unknown: '结果未知',
}

function deploymentStatusLabel(deployment: { status: string; assurance: string }): string {
  if (deployment.status === 'succeeded' && deployment.assurance === 'self_declared') return '制品已交付 · 未验证'
  if (deployment.status === 'succeeded' && deployment.assurance === 'externally_confirmed') return '服务已确认'
  return STATUS_LABEL[deployment.status] ?? deployment.status
}

export function DeploymentConsole({ projectId, versionId, versionControl }: { projectId: string; versionId: string; versionControl?: ReactNode }) {
  const navigate = useNavigate()
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
  const [environmentOpen, setEnvironmentOpen] = useState(false)
  const [environmentKey, setEnvironmentKey] = useState('')
  const [environmentName, setEnvironmentName] = useState('')
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

  const availableTargets = useMemo(() => (data?.targets ?? []).filter((item) => item.environmentId === environmentId), [data?.targets, environmentId])
  useEffect(() => {
    setTargetId((current) => availableTargets.some((item) => item.id === current) ? current : availableTargets[0]?.id ?? null)
  }, [availableTargets])

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
  const operations = useQuery({
    queryKey: ['deployment-operations', selectedDeploymentId],
    queryFn: () => window.projectos.release.deploymentOperations(selectedDeploymentId!),
    enabled: Boolean(selectedDeploymentId),
    refetchInterval: (query) => (query.state.data?.operations.some((item) => item.state === 'prepared' || item.state === 'executing') ? 2000 : false),
  })
  const reconcile = useMutation({
    mutationFn: (deploymentId: string) => window.projectos.release.reconcileDeployment(deploymentId, '用户在部署控制台发起远程对账'),
    onSuccess: async () => {
      await invalidate()
      await operations.refetch()
      message.success('已按远程事实对账')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const rollback = useMutation({
    mutationFn: (deploymentId: string) =>
      window.projectos.release.createRollback({
        sourceDeploymentId: deploymentId,
        idempotencyKey: `rollback:${deploymentId}:${Date.now()}`,
        notes: '从部署控制台创建回滚',
      }),
    onSuccess: async (created) => {
      await invalidate()
      message.success(`已创建回滚部署，等待独立审批（${created.releaseId.slice(-6)}）`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const createEnvironment = useMutation({
    mutationFn: () => window.projectos.lifecycle.createEnvironment({ projectId, key: environmentKey.trim(), name: environmentName.trim(), kind: 'custom', protected: false }),
    onSuccess: async (created) => { setEnvironmentId(created.id); setEnvironmentOpen(false); setEnvironmentKey(''); setEnvironmentName(''); await Promise.all([invalidate(), queryClient.invalidateQueries({ queryKey: ['lifecycle', projectId] })]); message.success('环境已登记') },
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
  // Prefer the label carried by the fact itself: the trusted running version can belong

  // to a different version than the one currently being viewed.
  const currentVersionLabel = currentFact?.releaseVersion
    ?? data?.releases.find((item) => item.id === currentFact?.releaseId)?.version
    ?? null
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
          <h1>部署中心</h1>
          <p>{selected ? `${environment?.name ?? '当前环境'} · ${target?.name ?? '部署记录'} · ${currentVersionLabel ? `已验证 v${currentVersionLabel}` : '尚未验证运行版本'}` : '将经过审核的发布包交付到目标环境'}</p>
        </div>
        <div className="dc-head-right">
          {versionControl}
          {data.environments.length ? <Select aria-label="部署环境" value={environmentId ?? undefined} style={{ width: 130 }} options={data.environments.map((item) => ({ value: item.id, label: item.name }))} onChange={setEnvironmentId} /> : null}
          {selected ? <>
          <Select value={targetId ?? undefined} style={{ width: 190 }} aria-label="部署目标" placeholder="选择目标" options={availableTargets.map((item) => ({ value: item.id, label: `${item.name} · ${item.adapterType ?? '未配置'}` }))} onChange={setTargetId} />
          <Button onClick={() => setTargetOpen(true)}>连接目标</Button>
          <Button onClick={() => setEnvironmentOpen(true)}>登记环境</Button>
          </> : null}
        </div>
      </header>

      {!selected ? <DeploymentStart releaseCount={data.releases.length} releaseVersion={data.releases[0]?.version}
        environmentName={environment?.name} environmentCount={data.environments.length} targetCount={availableTargets.length}
        onRelease={() => navigate(`/projects/${projectId}/releases?version=${versionId}`)}
        onEnvironment={() => setEnvironmentOpen(true)} onTarget={() => environmentId ? setTargetOpen(true) : setEnvironmentOpen(true)}
        onDeploy={() => { setDeployReleaseId(data.releases[0]?.id ?? null); setDeployOpen(true) }} /> : <div className="dc-body">
        <aside className="dc-targets" aria-label="环境与目标">
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
                <h2>执行证据</h2>
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
              {operations.data && operations.data.operations.length > 0 ? (
                <div className="dc-timeline">
                  <h2>执行时间线 <span>{operations.data.operations.length} 次尝试 · {operations.data.steps.length} 步</span></h2>
                  {operations.data.operations.map((operation) => (
                    <div key={operation.id} className={`dc-op is-${operation.state}`}>
                      <div className="dc-op-head">
                        <strong>第 {operation.attempt} 次 · {operation.adapterType}</strong>
                        <Tag>{OPERATION_LABEL[operation.state] ?? operation.state}</Tag>
                        <small>{formatRelative(operation.createdAt)}</small>
                      </div>
                      {operations.data!.steps
                        .filter((step) => step.operationId === operation.id)
                        .map((step) => (
                          <div key={step.id} className={`dc-op-step is-${step.status}`}>
                            <i />
                            <span className="dc-op-phase">{step.phase}</span>
                            <span className="dc-op-detail">{step.detail || '—'}</span>
                            {step.remoteRef ? <code className="dc-op-ref">{step.remoteRef}</code> : null}
                          </div>
                        ))}
                      {operation.lastError ? <p className="dc-op-error">{operation.lastError}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="dc-history">
                <h2>部署历史 <span>{deployments.length}</span></h2>
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

        <aside className="dc-inspector" aria-label="部署权限与状态">
          <h2>目标与权限</h2>
          <div className="dc-kv"><span>环境</span><strong>{environment?.name ?? '—'}</strong></div>
          <div className="dc-kv"><span>目标</span><strong>{target?.name ?? '—'}</strong></div>
          <div className="dc-kv"><span>控制方式</span><strong>{target?.controlMode ?? '—'}</strong></div>
          <div className="dc-kv"><span>Adapter</span><strong>{target?.adapterType ?? '未配置'}</strong></div>
          <div className="dc-kv"><span>地址</span><strong className="dc-ellipsis">{target?.targetRef ?? '—'}</strong></div>
          <div className="dc-rail-divider" />
          <h2>当前可信运行版本</h2>
          <div className="dc-current">{currentVersionLabel ? `v${currentVersionLabel}` : '无'}</div>
          <p className="dc-rail-copy">仅外部确认或独立观察的部署会成为环境运行版本。人工记录和文件交付不会。</p>
          <div className="dc-rail-divider" />
          <h2>操作</h2>
          {selected && target?.adapterType === 'ssh-artifact' && ['needs_reconciliation', 'unknown', 'running', 'failed', 'pending'].includes(selected.status) ? (
            <Button block onClick={() => reconcile.mutate(selected.id)} loading={reconcile.isPending}>对账远程事实</Button>
          ) : null}
          {selected?.status === 'succeeded' ? (
            <Button block onClick={() => rollback.mutate(selected.id)} loading={rollback.isPending}>基于此版本创建回滚</Button>
          ) : null}
          {selected?.status === 'failed' ? <Button block onClick={() => { setDeployReleaseId(selected.releaseId); setDeployOpen(true) }}>重新登记</Button> : null}
          <p className="dc-rail-copy">执行前必须完成独立审批；未知结果进入待核对，不自动重放。</p>
        </aside>
      </div>}

      <FormDialog open={environmentOpen} title="登记环境" okText="登记" onCancel={() => setEnvironmentOpen(false)} onOk={() => createEnvironment.mutate()} confirmLoading={createEnvironment.isPending} okButtonProps={{ disabled: !environmentKey.trim() || !environmentName.trim() }}>
        <div className="rw-form">
          <label><span>环境名称</span><Input value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="例如：测试环境" /></label>
          <label><span>环境标识</span><Input value={environmentKey} onChange={(event) => setEnvironmentKey(event.target.value)} placeholder="例如：staging" /></label>
          <p className="dc-note">环境用于区分部署用途，创建后再连接服务器或目录。</p>
        </div>
      </FormDialog>
      <FormDialog open={deployOpen} title="登记部署" okText="创建" cancelText="取消" confirmLoading={createDeployment.isPending} okButtonProps={{ disabled: !deployReleaseId || !environmentId }} onOk={() => createDeployment.mutate()} onCancel={() => setDeployOpen(false)}>
        <div className="rw-form">
          <label><span>发布包</span><Select aria-label="部署发布包" value={deployReleaseId} onChange={setDeployReleaseId} options={data.releases.map((item) => ({ value: item.id, label: `v${item.version} · ${item.manifestHash.slice(0, 8)}` }))} /></label>
          <label><span>环境</span><Select aria-label="登记部署的环境" value={environmentId} onChange={setEnvironmentId} options={data.environments.map((item) => ({ value: item.id, label: item.name }))} /></label>
          <label><span>目标</span><Select aria-label="登记部署的目标" allowClear value={targetId} onChange={(value) => setTargetId(value ?? null)} options={availableTargets.map((item) => ({ value: item.id, label: item.name }))} /></label>
          <label><span>来源</span><Select aria-label="部署记录来源" value={deploySource} onChange={setDeploySource} options={[
            { value: 'manual', label: '手工记录（未验证）' },
            { value: 'imported', label: '导入外部记录' },
            { value: 'unknown', label: '来源未知（待核对）' },
          ]} /></label>
          <p className="dc-note">创建后等待独立审批；不会自动执行。</p>
        </div>
      </FormDialog>

      <FormDialog open={targetOpen} title="连接部署目标" okText="登记" cancelText="取消" confirmLoading={createTarget.isPending} okButtonProps={{ disabled: !environmentId || !targetName.trim() || !targetRef.trim() }} onOk={() => createTarget.mutate()} onCancel={() => setTargetOpen(false)}>
        <div className="rw-form">
          <label><span>所属环境</span><Select aria-label="部署目标所属环境" value={environmentId ?? undefined} onChange={setEnvironmentId} options={data.environments.map((item) => ({ value: item.id, label: item.name }))} /></label>
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
      </FormDialog>
    </div>
  )
}
