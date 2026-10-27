import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Empty, Input, Modal, Select, Tag } from 'antd'
import type { ReleaseOverview } from '@projectos/contracts'
import { SectionCard } from '@projectos/ui'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'
import { useArtifacts, useTaskBoard } from '../lib/queries'
import './release.css'

const CR_STATUS: Record<string, string> = {
  draft: '草稿',
  awaiting_approval: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  changes_requested: '需修改',
  cancelled: '已取消',
}

const CANDIDATE_STATUS: Record<string, string> = {
  draft: '草稿',
  blocked: '证据不足',
  ready: '可发布',
  submitted: '已提交',
  approved: '已批准',
  rejected: '已拒绝',
  released: '已发布',
  superseded: '已替代',
}

const DEPLOYMENT_STATUS: Record<string, string> = {
  awaiting_approval: '待审批',
  pending: '待记录',
  running: '执行中',
  verifying: '验证中',
  succeeded: '记录成功',
  failed: '失败',
  cancelled: '已取消',
  unknown: '未知',
  needs_reconciliation: '待核对',
  rolled_back: '已回滚',
}

const SOURCE_LABEL: Record<string, string> = {
  manual: '手工声明',
  imported: '导入记录',
  adapter: '适配器执行',
  unknown: '来源未知',
}

const ASSURANCE_LABEL: Record<string, string> = {
  self_declared: '自我声明',
  source_observed: '来源观察',
  independently_reproduced: '独立复现',
  externally_confirmed: '外部确认',
}

export function ReleasePanel({ projectId, versionId, versionLabel, mode = 'all' }: { projectId: string; versionId: string; versionLabel: string; mode?: 'release' | 'deployment' | 'all' }) {
  const showRelease = mode === 'release' || mode === 'all'
  const showDeployment = mode === 'deployment' || mode === 'all'
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const artifacts = useArtifacts(projectId)
  const board = useTaskBoard(projectId)
  const overview = useQuery({
    queryKey: ['release-overview', projectId, versionId],
    queryFn: () => window.projectos.release.overview(projectId, versionId),
  })
  const [crOpen, setCrOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [risk, setRisk] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [environmentId, setEnvironmentId] = useState<string | null>(null)
  const [artifactIds, setArtifactIds] = useState<string[]>([])
  const [deployOpen, setDeployOpen] = useState(false)
  const [deployReleaseId, setDeployReleaseId] = useState<string | null>(null)
  const [deployEnvironmentId, setDeployEnvironmentId] = useState<string | null>(null)
  const [deploySource, setDeploySource] = useState<'manual' | 'imported' | 'unknown'>('manual')
  const [targetOpen, setTargetOpen] = useState(false)
  const [targetName, setTargetName] = useState('')
  const [targetKind, setTargetKind] = useState<'local' | 'ssh' | 'kubernetes' | 'pipeline' | 'gitops' | 'external'>('ssh')
  const [targetControl, setTargetControl] = useState<'pipeline_managed' | 'gitops_managed' | 'direct_kubernetes' | 'ssh_managed' | 'external_observed'>('ssh_managed')
  const [strategyOpen, setStrategyOpen] = useState(false)
  const [strategyName, setStrategyName] = useState('')
  const [strategyTargetId, setStrategyTargetId] = useState<string | null>(null)
  const [strategyAdapter, setStrategyAdapter] = useState('manual')
  const data = overview.data
  const pendingApprovals = useMemo(
    () =>
      (data?.approvals ?? []).filter(
        (approval) =>
          approval.status === 'pending' &&
          (mode === 'release'
            ? approval.subjectType === 'change_request'
            : mode === 'deployment'
              ? approval.subjectType === 'deployment'
              : true),
      ),
    [data, mode],
  )
  const approvedRequest = useMemo(
    () => (data?.changeRequests ?? []).find((request) => request.status === 'approved') ?? null,
    [data],
  )
  const versionArtifacts = useMemo(() => {
    const taskIds = new Set(
      (board.data?.tasks ?? []).filter((task) => task.versionId === versionId).map((task) => task.id),
    )
    return (artifacts.data?.artifacts ?? []).filter((artifact) => artifact.taskId && taskIds.has(artifact.taskId))
  }, [artifacts.data, board.data, versionId])
  const candidateArtifactIds = useMemo(
    () => versionArtifacts.slice(0, 8).map((artifact) => artifact.id),
    [versionArtifacts],
  )
  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['release-overview', projectId, versionId] })
  }
  const createChange = useMutation({
    mutationFn: () =>
      window.projectos.release.createChangeRequest({
        projectId,
        versionId,
        title: title.trim(),
        description: description.trim(),
        sourceType: 'manual',
        sourceId: null,
        riskLevel: risk,
        impactScope: '',
        targetEnvironmentId: environmentId,
        linkedArtifactIds: artifactIds,
        linkedTaskIds: [],
      }),
    onSuccess: async () => {
      setCrOpen(false)
      setTitle('')
      setDescription('')
      await invalidate()
      message.success('变更申请已创建')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const submitChange = useMutation({
    mutationFn: (id: string) => window.projectos.release.submitChangeRequest(id),
    onSuccess: async () => {
      await invalidate()
      message.success('变更已提交审批')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const decide = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: 'approved' | 'rejected' }) =>
      window.projectos.release.decideApproval({ approvalId, decision, note: '版本页审批', rationale: '版本页审批' }),
    onSuccess: async () => {
      await invalidate()
      message.success('审批已处理')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const createCandidate = useMutation({
    mutationFn: () =>
      window.projectos.release.createCandidate({
        projectId,
        versionId,
        changeRequestId: approvedRequest?.id ?? null,
        artifactIds: candidateArtifactIds,
        notes: '从版本页创建',
      }),
    onSuccess: async (candidate) => {
      await invalidate()
      message.success(candidate.status === 'ready' ? '发布候选已就绪' : '候选已保存；证据不足，不能发布')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const createRelease = useMutation({
    mutationFn: (candidateId: string) =>
      window.projectos.release.createRelease({
        candidateId,
        idempotencyKey: `release:${candidateId}`,
        notes: '版本页登记发布',
      }),
    onSuccess: async () => {
      await invalidate()
      message.success('Release 记录已创建；未执行外部分发')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const createDeployment = useMutation({
    mutationFn: () =>
      window.projectos.release.createDeployment({
        projectId,
        releaseId: deployReleaseId!,
        environmentId: deployEnvironmentId!,
        targetId: null,
        strategyId: null,
        source: deploySource,
        idempotencyKey: `deploy:${deployReleaseId}:${deployEnvironmentId}:${deploySource}`,
        status: 'succeeded',
        externalId: null,
        artifactHash: null,
        receipt: {},
        notes: '',
        rollbackOfDeploymentId: null,
      }),
    onSuccess: async () => {
      setDeployOpen(false)
      await invalidate()
      message.success('部署记录已建立，等待独立审批')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const recordResult = useMutation({
    mutationFn: (deploymentId: string) =>
      window.projectos.release.recordDeployment({
        deploymentId,
        status: 'succeeded',
        externalId: `manual-${deploymentId}`,
        artifactHash: null,
        receipt: { recordedBy: 'local-user' },
        notes: '本地登记部署结果',
      }),
    onSuccess: async () => {
      await invalidate()
      message.success('部署结果已登记（来源可信度见记录）')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const createTarget = useMutation({
    mutationFn: () =>
      window.projectos.release.createTarget({
        projectId,
        environmentId: data?.environments[0]?.id ?? '',
        name: targetName.trim(),
        kind: targetKind,
        controlMode: targetControl,
        adapterType: null,
        targetRef: '',
        protected: false,
      }),
    onSuccess: async () => {
      setTargetOpen(false)
      setTargetName('')
      await invalidate()
      message.success('部署目标已登记；尚未连接外部系统')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const createStrategy = useMutation({
    mutationFn: () =>
      window.projectos.release.createStrategy({
        projectId,
        environmentId: data?.environments[0]?.id ?? '',
        targetId: strategyTargetId!,
        name: strategyName.trim(),
        adapterType: strategyAdapter,
        source: 'manual',
        requiresApproval: true,
      }),
    onSuccess: async () => {
      setStrategyOpen(false)
      setStrategyName('')
      await invalidate()
      message.success('部署策略已登记')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  if (overview.isLoading) return <SectionCard title="发布与部署" subtitle="加载真实研发证据"><div className="rel-skeleton">加载中…</div></SectionCard>
  if (overview.isError || !data) {
    return <SectionCard title="发布与部署"><div className="rel-error">{errorMessage(overview.error)}</div></SectionCard>
  }

  return (
    <SectionCard
      title={showRelease ? `v${versionLabel} · 发布工作区` : `v${versionLabel} · 部署工作区`}
      subtitle={showRelease ? '候选、变更审批、质量门禁、制品与 Release 历史' : '环境、目标、策略、部署来源与历史'}
      extra={
        showRelease ? (
          <div className="rel-head-actions">
            <Button size="small" onClick={() => setCrOpen(true)}>新建变更</Button>
            <Button size="small" disabled={!approvedRequest} onClick={() => createCandidate.mutate()} loading={createCandidate.isPending}>
              生成发布候选
            </Button>
          </div>
        ) : (
          <div className="rel-head-actions">
            <Button size="small" onClick={() => setTargetOpen(true)}>新建目标</Button>
            <Button size="small" disabled={!data.targets.length} onClick={() => {
              setStrategyTargetId(data.targets[0]?.id ?? null)
              setStrategyOpen(true)
            }}>新建策略</Button>
          </div>
        )
      }
    >
      <div className="rel-capabilities">
        <Tag color={data.capabilities.canBuild ? 'green' : 'default'}>{data.capabilities.canBuild ? '构建可用' : '构建未配置'}</Tag>
        <Tag color={data.capabilities.canExecuteDeployment ? 'green' : 'orange'}>
          {data.capabilities.canExecuteDeployment ? '部署执行可用' : '未配置部署适配器'}
        </Tag>
        <span>{data.capabilities.reason}</span>
      </div>
      {showDeployment ? (
        <div className="rel-env-facts">
          {data.environmentVersions.map((fact) => {
            const environment = data.environments.find((item) => item.id === fact.environmentId)
            const release = data.releases.find((item) => item.id === fact.releaseId)
            return (
              <div className="rel-env-fact" key={fact.environmentId}>
                <span>{environment?.name ?? fact.environmentId}</span>
                <strong>{release ? `v${release.version}` : '无已确认版本'}</strong>
                <small>{fact.assurance ? ASSURANCE_LABEL[fact.assurance] ?? fact.assurance : '没有导入/适配器确认'}</small>
              </div>
            )
          })}
        </div>
      ) : null}

      {showDeployment ? (
        <div className="rel-deploy-releases">
          <span>选择 Release</span>
          {data.releases.length === 0 ? <small>还没有 Release 记录</small> : null}
          {data.releases.map((release) => (
            <Button
              key={release.id}
              size="small"
              onClick={() => {
                setDeployReleaseId(release.id)
                setDeployEnvironmentId(data.environments[0]?.id ?? null)
                setDeployOpen(true)
              }}
            >
              v{release.version} · {release.manifestHash.slice(0, 8)}
            </Button>
          ))}
        </div>
      ) : null}

      {showRelease ? (
      <div className="rel-grid">
        <section className="rel-column">
          <div className="rel-column-title">变更申请 <span>{data.changeRequests.length}</span></div>
          {data.changeRequests.length === 0 ? <div className="rel-empty">还没有变更申请；从当前版本创建第一条发布变更。</div> : null}
          {data.changeRequests.map((request) => (
            <article className="rel-item" key={request.id}>
              <div className="rel-item-head">
                <strong>{request.title}</strong>
                <Tag color={request.status === 'approved' ? 'green' : request.status === 'rejected' ? 'red' : 'gold'}>
                  {CR_STATUS[request.status] ?? request.status}
                </Tag>
              </div>
              <div className="rel-meta">r{request.revision} · {request.riskLevel.toUpperCase()} · {formatRelative(request.updatedAt)}</div>
              {request.description ? <p>{request.description}</p> : null}
              {request.status === 'draft' || request.status === 'changes_requested' ? (
                <Button size="small" onClick={() => submitChange.mutate(request.id)} loading={submitChange.isPending}>提交审批</Button>
              ) : null}
            </article>
          ))}
        </section>

        <section className="rel-column">
          <div className="rel-column-title">发布候选 <span>{data.candidates.length}</span></div>
          <div className="rel-meta">本版本关联 {versionArtifacts.length} 个 Artifact；候选只快照这些成果。</div>
          {data.candidates.length === 0 ? <div className="rel-empty">批准变更并生成候选；缺少门禁或制品时只能保持未就绪。</div> : null}
          {data.candidates.map((candidate) => (
            <article className="rel-item" key={candidate.id}>
              <div className="rel-item-head">
                <strong>{candidate.gitCommit?.slice(0, 10) ?? '无 Git commit'}</strong>
                <Tag color={candidate.status === 'ready' ? 'green' : candidate.status === 'blocked' ? 'red' : 'default'}>
                  {CANDIDATE_STATUS[candidate.status] ?? candidate.status}
                </Tag>
              </div>
              <div className="rel-meta">门禁 {candidate.gateStatus} · {candidate.artifacts.length} 个制品 · {formatRelative(candidate.createdAt)}</div>
              {candidate.artifacts.map((artifact) => (
                <div className="rel-artifact" key={artifact.id}>
                  <span>{artifact.name}</span>
                  <code>{artifact.contentHash.slice(0, 12)}…</code>
                </div>
              ))}
              {candidate.status === 'ready' ? (
                <Button size="small" type="primary" onClick={() => createRelease.mutate(candidate.id)} loading={createRelease.isPending}>
                  登记为 Release
                </Button>
              ) : null}
            </article>
          ))}
        </section>

        <section className="rel-column">
          <div className="rel-column-title">发布记录 <span>{data.releases.length}</span></div>
          {data.releases.length === 0 ? <div className="rel-empty">Release 记录需要候选就绪、门禁通过与独立审批。</div> : null}
          {data.releases.map((release) => (
            <article className="rel-item" key={release.id}>
              <div className="rel-item-head">
                <strong>v{release.version}</strong>
                <Tag color={release.distributionStatus === 'externally_confirmed' ? 'green' : 'blue'}>
                  {release.distributionStatus === 'externally_confirmed' ? '外部确认' : '未外部分发'}
                </Tag>
              </div>
              <div className="rel-meta">{release.artifactManifest.length} 个冻结制品 · {formatRelative(release.createdAt)}</div>
              <div className="rel-hash">manifest {release.manifestHash.slice(0, 16)}…</div>
              {showDeployment ? (
                <Button size="small" onClick={() => {
                  setDeployReleaseId(release.id)
                  setDeployEnvironmentId(data.environments[0]?.id ?? null)
                  setDeployOpen(true)
                }}>
                  登记部署
                </Button>
              ) : null}
            </article>
          ))}
        </section>
      </div>
      ) : null}

      <div className={`rel-grid rel-bottom ${showDeployment ? '' : 'rel-single'}`}>
        <section className="rel-column">
          <div className="rel-column-title">待处理审批 <span>{pendingApprovals.length}</span></div>
          {pendingApprovals.length === 0 ? <div className="rel-empty">没有待处理审批。</div> : null}
          {pendingApprovals.map((approval) => (
            <article className="rel-item" key={approval.id}>
              <div className="rel-item-head">
                <strong>{approval.subjectType === 'change_request' ? '变更审批' : '部署审批'}</strong>
                <Tag color="gold">待处理</Tag>
              </div>
              <div className="rel-meta">r{approval.subjectRevision} · {formatRelative(approval.requestedAt)}</div>
              <div className="rel-approval-actions">
                <Button size="small" type="primary" onClick={() => decide.mutate({ approvalId: approval.id, decision: 'approved' })}>批准</Button>
                <Button size="small" danger onClick={() => decide.mutate({ approvalId: approval.id, decision: 'rejected' })}>拒绝</Button>
              </div>
            </article>
          ))}
        </section>

        {showDeployment ? (
          <section className="rel-column">
            <div className="rel-column-title">环境与目标 <span>{data.targets.length}</span></div>
            {data.targets.length === 0 ? <div className="rel-empty">还没有部署目标；环境可登记，但登记不等于已连接服务器。</div> : null}
            {data.targets.map((target) => {
              const environment = data.environments.find((item) => item.id === target.environmentId)
              const strategies = data.strategies.filter((strategy) => strategy.targetId === target.id)
              return (
                <article className="rel-item" key={target.id}>
                  <div className="rel-item-head">
                    <strong>{target.name}</strong>
                    <Tag>{target.controlMode}</Tag>
                  </div>
                  <div className="rel-meta">{environment?.name ?? target.environmentId} · {target.kind} · {target.adapterType ?? '未配置 adapter'}</div>
                  {strategies.length ? <div className="rel-meta">{strategies.map((strategy) => strategy.name).join(' · ')}</div> : <div className="rel-meta">没有部署策略</div>}
                </article>
              )
            })}
          </section>
        ) : null}
      </div>

      {showDeployment ? (
        <section className="rel-column rel-history">
          <div className="rel-column-title">部署历史 <span>{data.deployments.length}</span></div>
          {data.deployments.length === 0 ? <div className="rel-empty">部署记录区分手工声明、导入观察与适配器确认；不会把登记冒充真实执行。</div> : null}
          {data.deployments.map((deployment) => {
            const environment = data.environments.find((item) => item.id === deployment.environmentId)
            return (
              <article className="rel-item" key={deployment.id}>
                <div className="rel-item-head">
                  <strong>{environment?.name ?? deployment.environmentId}</strong>
                  <Tag color={deployment.status === 'succeeded' ? 'gold' : deployment.status === 'needs_reconciliation' ? 'red' : 'default'}>
                    {DEPLOYMENT_STATUS[deployment.status] ?? deployment.status}
                  </Tag>
                </div>
                <div className="rel-meta">
                  {SOURCE_LABEL[deployment.source] ?? deployment.source} · {ASSURANCE_LABEL[deployment.assurance] ?? deployment.assurance} · {formatRelative(deployment.createdAt)}
                </div>
                {deployment.externalId ? <div className="rel-hash">外部 ID {deployment.externalId}</div> : null}
                {deployment.approvalId && ['pending', 'awaiting_approval'].includes(deployment.status) ? (
                  <Button size="small" onClick={() => recordResult.mutate(deployment.id)} loading={recordResult.isPending}>
                    记录成功结果
                  </Button>
                ) : null}
              </article>
            )
          })}
        </section>
      ) : null}

      {showRelease ? (
        <div className="rel-grid rel-bottom">
          <section className="rel-column">
            <div className="rel-column-title">发布证据链 <span>{data.releases[0]?.artifactManifest.length ?? 0}</span></div>
            {data.releases[0] ? (
              <>
                <div className="rel-meta">Git {data.releases[0].gitCommit?.slice(0, 12) ?? '无'} · manifest {data.releases[0].manifestHash.slice(0, 12)}…</div>
                {data.releases[0].artifactManifest.map((artifact) => (
                  <div className="rel-artifact" key={artifact.id}>
                    <span>{artifact.name}</span>
                    <code>{artifact.contentHash.slice(0, 12)}…</code>
                  </div>
                ))}
              </>
            ) : <div className="rel-empty">创建 Release 后展示冻结制品与内容哈希。</div>}
          </section>
          <section className="rel-column">
            <div className="rel-column-title">Release 历史 <span>{data.releases.length}</span></div>
            {data.releases.length === 0 ? <div className="rel-empty">还没有 Release 历史。</div> : null}
            {data.releases.map((release) => (
              <article className="rel-item" key={release.id}>
                <div className="rel-item-head">
                  <strong>v{release.version}</strong>
                  <Tag color={release.distributionStatus === 'externally_confirmed' ? 'green' : 'blue'}>
                    {release.distributionStatus === 'externally_confirmed' ? '外部确认' : '未外部分发'}
                  </Tag>
                </div>
                <div className="rel-meta">{release.artifactManifest.length} 个制品 · {formatRelative(release.publishedAt)}</div>
              </article>
            ))}
          </section>
        </div>
      ) : null}

      <Modal
        open={crOpen}
        title="新建变更申请"
        okText="创建"
        cancelText="取消"
        confirmLoading={createChange.isPending}
        okButtonProps={{ disabled: !title.trim() }}
        onOk={() => createChange.mutate()}
        onCancel={() => setCrOpen(false)}
      >
        <div className="rel-form">
          <label><span>标题</span><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：v1.1.0 发布" /></label>
          <label><span>说明</span><Input.TextArea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="变更范围、风险与验证方式" /></label>
          <label><span>风险</span><Select value={risk} onChange={setRisk} options={['low', 'medium', 'high', 'critical'].map((value) => ({ value, label: value }))} /></label>
          <label><span>目标环境</span><Select allowClear value={environmentId} onChange={(value) => setEnvironmentId(value ?? null)} options={data.environments.map((environment) => ({ value: environment.id, label: environment.name }))} /></label>
          <label><span>关联 Artifact</span><Select mode="multiple" value={artifactIds} onChange={setArtifactIds} options={versionArtifacts.map((artifact) => ({ value: artifact.id, label: artifact.title }))} /></label>
        </div>
      </Modal>

      <Modal
        open={deployOpen}
        title="登记部署记录"
        okText="创建待审批部署"
        cancelText="取消"
        confirmLoading={createDeployment.isPending}
        okButtonProps={{ disabled: !deployReleaseId || !deployEnvironmentId }}
        onOk={() => createDeployment.mutate()}
        onCancel={() => setDeployOpen(false)}
      >
        <div className="rel-form">
          <label><span>Release</span><Select value={deployReleaseId} onChange={setDeployReleaseId} options={data.releases.map((release) => ({ value: release.id, label: `v${release.version} · ${release.manifestHash.slice(0, 8)}` }))} /></label>
          <label><span>环境</span><Select value={deployEnvironmentId} onChange={setDeployEnvironmentId} options={data.environments.map((environment) => ({ value: environment.id, label: environment.name }))} /></label>
          <label><span>来源</span><Select value={deploySource} onChange={setDeploySource} options={[
            { value: 'manual', label: '手工声明（仅用户声明）' },
            { value: 'imported', label: '导入记录（来源观察）' },
            { value: 'unknown', label: '来源未知（待核对）' },
          ]} /></label>
          <div className="rel-hint">当前没有可执行部署适配器；登记不会把环境标记为外部确认成功。</div>
        </div>
      </Modal>

      <Modal
        open={targetOpen}
        title="登记部署目标"
        okText="登记"
        cancelText="取消"
        confirmLoading={createTarget.isPending}
        okButtonProps={{ disabled: !targetName.trim() }}
        onOk={() => createTarget.mutate()}
        onCancel={() => setTargetOpen(false)}
      >
        <div className="rel-form">
          <label><span>名称</span><Input value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="例如：staging-vps" /></label>
          <label><span>类型</span><Select value={targetKind} onChange={setTargetKind} options={[
            { value: 'ssh', label: 'SSH / VPS' },
            { value: 'kubernetes', label: 'Kubernetes' },
            { value: 'pipeline', label: 'CI/CD Pipeline' },
            { value: 'gitops', label: 'GitOps' },
            { value: 'local', label: 'Local' },
            { value: 'external', label: '外部观察' },
          ]} /></label>
          <label><span>控制方式</span><Select value={targetControl} onChange={setTargetControl} options={[
            { value: 'ssh_managed', label: 'SSH 管理' },
            { value: 'direct_kubernetes', label: 'Kubernetes 直连' },
            { value: 'pipeline_managed', label: 'Pipeline 管理' },
            { value: 'gitops_managed', label: 'GitOps 管理' },
            { value: 'external_observed', label: '只读观察' },
          ]} /></label>
          <div className="rel-hint">登记目标不代表已连接服务器；没有 Adapter 时不显示执行按钮。</div>
        </div>
      </Modal>

      <Modal
        open={strategyOpen}
        title="登记部署策略"
        okText="登记"
        cancelText="取消"
        confirmLoading={createStrategy.isPending}
        okButtonProps={{ disabled: !strategyName.trim() || !strategyTargetId }}
        onOk={() => createStrategy.mutate()}
        onCancel={() => setStrategyOpen(false)}
      >
        <div className="rel-form">
          <label><span>名称</span><Input value={strategyName} onChange={(event) => setStrategyName(event.target.value)} placeholder="例如：staging 手工导入" /></label>
          <label><span>目标</span><Select value={strategyTargetId} onChange={setStrategyTargetId} options={data.targets.map((target) => ({ value: target.id, label: target.name }))} /></label>
          <label><span>Adapter</span><Select value={strategyAdapter} onChange={setStrategyAdapter} options={[
            { value: 'manual', label: '手工登记（无执行）' },
            { value: 'imported', label: '导入观察（无执行）' },
          ]} /></label>
        </div>
      </Modal>
    </SectionCard>
  )
}
