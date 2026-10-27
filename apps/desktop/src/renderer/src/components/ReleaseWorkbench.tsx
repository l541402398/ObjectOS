import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Empty, Input, Modal, Select, Tag } from 'antd'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'
import { useArtifacts, useTaskBoard } from '../lib/queries'
import './release-workbench.css'

const CR_STATUS: Record<string, string> = {
  draft: '草稿', awaiting_approval: '待审批', approved: '已批准', rejected: '已拒绝', changes_requested: '需修改', cancelled: '已取消',
}
const CANDIDATE_STATUS: Record<string, string> = {
  draft: '草稿', blocked: '证据不足', ready: '可冻结', submitted: '已提交', approved: '已批准', rejected: '已拒绝', released: '已冻结', superseded: '已替代',
}

type Selection = { type: 'candidate' | 'release' | 'change'; id: string } | null

export function ReleaseWorkbench({ projectId, versionId, versionLabel, versionControl }: { projectId: string; versionId: string; versionLabel: string; versionControl?: ReactNode }) {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const artifacts = useArtifacts(projectId)
  const board = useTaskBoard(projectId)
  const overview = useQuery({
    queryKey: ['release-overview', projectId, versionId],
    queryFn: () => window.projectos.release.overview(projectId, versionId),
  })
  const data = overview.data
  const [tab, setTab] = useState<'candidates' | 'changes' | 'releases'>('candidates')
  const [selection, setSelection] = useState<Selection>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [risk, setRisk] = useState<'low' | 'medium' | 'high' | 'critical'>('medium')
  const [environmentId, setEnvironmentId] = useState<string | null>(null)

  const versionArtifacts = useMemo(() => {
    const taskIds = new Set((board.data?.tasks ?? []).filter((task) => task.versionId === versionId).map((task) => task.id))
    return (artifacts.data?.artifacts ?? []).filter((artifact) => artifact.taskId && taskIds.has(artifact.taskId))
  }, [artifacts.data, board.data, versionId])
  const approvedRequest = useMemo(() => (data?.changeRequests ?? []).find((item) => item.status === 'approved') ?? null, [data])
  const pendingApprovals = (data?.approvals ?? []).filter((item) => item.status === 'pending')
  const latestCandidate = data?.candidates[0] ?? null
  const latestRelease = data?.releases[0] ?? null

  useEffect(() => {
    if (selection) return
    if (tab === 'candidates' && latestCandidate) setSelection({ type: 'candidate', id: latestCandidate.id })
    if (tab === 'releases' && latestRelease) setSelection({ type: 'release', id: latestRelease.id })
    if (tab === 'changes' && data?.changeRequests[0]) setSelection({ type: 'change', id: data.changeRequests[0].id })
  }, [data, latestCandidate, latestRelease, selection, tab])

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['release-overview', projectId, versionId] })
  }
  const createChange = useMutation({
    mutationFn: () =>
      window.projectos.release.createChangeRequest({
        projectId, versionId, title: title.trim(), description: description.trim(), sourceType: 'manual', sourceId: null,
        riskLevel: risk, impactScope: '', targetEnvironmentId: environmentId,
        linkedArtifactIds: versionArtifacts.map((artifact) => artifact.id), linkedTaskIds: [],
      }),
    onSuccess: async () => {
      setCreateOpen(false); setTitle(''); setDescription('')
      await invalidate(); message.success('变更已创建')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const submitChange = useMutation({
    mutationFn: (id: string) => window.projectos.release.submitChangeRequest(id),
    onSuccess: async () => { await invalidate(); message.success('已提交审批') },
    onError: (error) => message.error(errorMessage(error)),
  })
  const createCandidate = useMutation({
    mutationFn: () =>
      window.projectos.release.createCandidate({
        projectId, versionId, changeRequestId: approvedRequest?.id ?? null,
        artifactIds: versionArtifacts.slice(0, 8).map((artifact) => artifact.id), notes: '',
      }),
    onSuccess: async (candidate) => {
      await invalidate()
      setTab('candidates'); setSelection({ type: 'candidate', id: candidate.id })
      message.success(candidate.status === 'ready' ? '候选已冻结' : '候选已保存，证据不足')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const createRelease = useMutation({
    mutationFn: (candidateId: string) =>
      window.projectos.release.createRelease({ candidateId, idempotencyKey: `release:${candidateId}`, notes: '' }),
    onSuccess: async (release) => {
      await invalidate(); setTab('releases'); setSelection({ type: 'release', id: release.id })
      message.success('Release 已登记，尚未外部分发')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  if (overview.isLoading) return <div className="rw-shell"><div className="rw-loading">正在载入发布工作台…</div></div>
  if (overview.isError || !data) {
    return <div className="rw-shell"><Empty description="发布数据不可用" /><Button onClick={() => void overview.refetch()}>重试</Button></div>
  }

  const selectedCandidate = selection?.type === 'candidate' ? data.candidates.find((item) => item.id === selection.id) : null
  const selectedRelease = selection?.type === 'release' ? data.releases.find((item) => item.id === selection.id) : null
  const selectedChange = selection?.type === 'change' ? data.changeRequests.find((item) => item.id === selection.id) : null
  const rows = tab === 'candidates' ? data.candidates : tab === 'releases' ? data.releases : data.changeRequests
  const ready = Boolean(approvedRequest && latestCandidate?.status === 'ready' && versionArtifacts.length > 0)
  const releaseRecorded = Boolean(latestRelease)

  return (
    <div className="rw-shell">
      <header className="rw-head">
        <div>
          <div className="rw-eyebrow">RELEASE WORKBENCH</div>
          <h1>发布工作台</h1>
          <p>{versionLabel} · {ready ? '候选可冻结' : releaseRecorded ? 'Release 已登记' : '准备发布证据'}</p>
        </div>
        <div className="rw-head-right">
          {versionControl ? <div className="rw-version-control">{versionControl}</div> : null}
          <div className="rw-metrics">
            <span><strong>{data.candidates.length}</strong>候选</span>
            <span><strong>{data.releases.length}</strong>Release</span>
            <span><strong>{pendingApprovals.length}</strong>待审批</span>
            <span><strong>{versionArtifacts.length}</strong>制品</span>
          </div>
          <div className="rw-actions">
            <Button onClick={() => { setTitle(''); setDescription(''); setCreateOpen(true) }}>新建变更</Button>
            <Button type="primary" disabled={!approvedRequest || !versionArtifacts.length} loading={createCandidate.isPending} onClick={() => createCandidate.mutate()}>
              生成候选
            </Button>
          </div>
        </div>
      </header>

      <div className="rw-stepper" aria-label="发布流程">
        <div className={approvedRequest ? 'is-done' : 'is-current'}><i />变更审批</div>
        <div className={latestCandidate ? 'is-done' : approvedRequest ? 'is-current' : ''}><i />门禁/证据</div>
        <div className={latestCandidate ? 'is-done' : ''}><i />候选冻结</div>
        <div className={latestRelease ? 'is-done' : ''}><i />Release 登记</div>
      </div>

      <div className="rw-body">
        <aside className="rw-list">
          <div className="rw-tabs">
            <button className={tab === 'candidates' ? 'is-active' : ''} onClick={() => { setTab('candidates'); setSelection(null) }}>候选 <span>{data.candidates.length}</span></button>
            <button className={tab === 'changes' ? 'is-active' : ''} onClick={() => { setTab('changes'); setSelection(null) }}>变更 <span>{data.changeRequests.length}</span></button>
            <button className={tab === 'releases' ? 'is-active' : ''} onClick={() => { setTab('releases'); setSelection(null) }}>历史 <span>{data.releases.length}</span></button>
          </div>
          <div className="rw-rows" role="list">
            {rows.length === 0 ? <div className="rw-list-empty">暂无记录</div> : null}
            {tab === 'candidates' && data.candidates.map((candidate) => (
              <button key={candidate.id} className={`rw-row ${selection?.id === candidate.id ? 'is-selected' : ''}`} onClick={() => setSelection({ type: 'candidate', id: candidate.id })}>
                <span className="rw-row-main"><strong>{candidate.gitCommit?.slice(0, 8) ?? '无 commit'}</strong><em>{CANDIDATE_STATUS[candidate.status] ?? candidate.status}</em></span>
                <span className="rw-row-meta">门禁 {candidate.gateStatus} · {candidate.artifacts.length} 制品 · {formatRelative(candidate.createdAt)}</span>
              </button>
            ))}
            {tab === 'releases' && data.releases.map((release) => (
              <button key={release.id} className={`rw-row ${selection?.id === release.id ? 'is-selected' : ''}`} onClick={() => setSelection({ type: 'release', id: release.id })}>
                <span className="rw-row-main"><strong>v{release.version}</strong><em>{release.distributionStatus === 'externally_confirmed' ? '外部分发确认' : '未外部分发'}</em></span>
                <span className="rw-row-meta">{release.artifactManifest.length} 制品 · {formatRelative(release.createdAt)}</span>
              </button>
            ))}
            {tab === 'changes' && data.changeRequests.map((request) => (
              <button key={request.id} className={`rw-row ${selection?.id === request.id ? 'is-selected' : ''}`} onClick={() => setSelection({ type: 'change', id: request.id })}>
                <span className="rw-row-main"><strong>{request.title}</strong><em>{CR_STATUS[request.status] ?? request.status}</em></span>
                <span className="rw-row-meta">r{request.revision} · {request.riskLevel.toUpperCase()} · {formatRelative(request.updatedAt)}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="rw-detail">
          {!selection ? <div className="rw-detail-empty">从左侧选择一条记录，查看证据与可执行操作</div> : null}
          {selectedCandidate ? (
            <>
              <div className="rw-detail-head">
                <div><span className="rw-kicker">RELEASE CANDIDATE</span><h2>{selectedCandidate.gitCommit?.slice(0, 12) ?? '无 Git revision'}</h2></div>
                <Tag>{CANDIDATE_STATUS[selectedCandidate.status] ?? selectedCandidate.status}</Tag>
              </div>
              <div className="rw-facts">
                <span><b>门禁</b>{selectedCandidate.gateStatus}</span>
                <span><b>制品</b>{selectedCandidate.artifacts.length}</span>
                <span><b>创建</b>{formatRelative(selectedCandidate.createdAt)}</span>
              </div>
              <h3 className="rw-section-title">冻结制品</h3>
              <div className="rw-table">
                {selectedCandidate.artifacts.map((artifact) => (
                  <div className="rw-table-row" key={artifact.id}><span>{artifact.name}</span><code>{artifact.contentHash.slice(0, 18)}…</code></div>
                ))}
                {selectedCandidate.artifacts.length === 0 ? <div className="rw-table-empty">没有关联制品</div> : null}
              </div>
              {selectedCandidate.status === 'ready' ? (
                <Button type="primary" loading={createRelease.isPending} onClick={() => createRelease.mutate(selectedCandidate.id)}>登记 Release</Button>
              ) : <p className="rw-hint">候选未就绪：需要已批准变更、通过门禁和至少一个真实制品。</p>}
            </>
          ) : null}
          {selectedRelease ? (
            <>
              <div className="rw-detail-head">
                <div><span className="rw-kicker">IMMUTABLE RELEASE</span><h2>v{selectedRelease.version}</h2></div>
                <Tag>{selectedRelease.distributionStatus === 'externally_confirmed' ? '外部确认' : '未外部分发'}</Tag>
              </div>
              <div className="rw-facts">
                <span><b>Git</b>{selectedRelease.gitCommit?.slice(0, 12) ?? '无'}</span>
                <span><b>制品</b>{selectedRelease.artifactManifest.length}</span>
                <span><b>登记</b>{formatRelative(selectedRelease.createdAt)}</span>
              </div>
              <h3 className="rw-section-title">不可变 manifest</h3>
              <div className="rw-table">
                {selectedRelease.artifactManifest.map((artifact) => (
                  <div className="rw-table-row" key={artifact.id}><span>{artifact.name}</span><code>{artifact.contentHash.slice(0, 18)}…</code></div>
                ))}
              </div>
              <div className="rw-note">Release 已登记不等于已分发或已部署。部署记录在部署中心单独追溯。</div>
            </>
          ) : null}
          {selectedChange ? (
            <>
              <div className="rw-detail-head">
                <div><span className="rw-kicker">CHANGE REQUEST</span><h2>{selectedChange.title}</h2></div>
                <Tag>{CR_STATUS[selectedChange.status] ?? selectedChange.status}</Tag>
              </div>
              <div className="rw-facts">
                <span><b>revision</b>r{selectedChange.revision}</span>
                <span><b>风险</b>{selectedChange.riskLevel.toUpperCase()}</span>
                <span><b>更新</b>{formatRelative(selectedChange.updatedAt)}</span>
              </div>
              <p className="rw-description">{selectedChange.description || '没有填写变更说明'}</p>
              {selectedChange.status === 'draft' || selectedChange.status === 'changes_requested' ? (
                <Button type="primary" loading={submitChange.isPending} onClick={() => submitChange.mutate(selectedChange.id)}>提交审批</Button>
              ) : null}
              {selectedChange.status === 'approved' ? <div className="rw-note">已批准；内容变更会使原审批失效。</div> : null}
            </>
          ) : null}
        </section>

        <aside className="rw-rail">
          <h3>发布就绪</h3>
          <div className="rw-check"><span className={approvedRequest ? 'ok' : 'wait'} />变更批准<strong>{approvedRequest ? '已批准' : '未完成'}</strong></div>
          <div className="rw-check"><span className={versionArtifacts.length ? 'ok' : 'wait'} />真实制品<strong>{versionArtifacts.length}</strong></div>
          <div className="rw-check"><span className={latestCandidate?.gateStatus === 'passed' ? 'ok' : 'wait'} />质量门禁<strong>{latestCandidate?.gateStatus ?? '未评估'}</strong></div>
          <div className="rw-check"><span className={latestCandidate ? 'ok' : 'wait'} />候选冻结<strong>{latestCandidate ? (CANDIDATE_STATUS[latestCandidate.status] ?? latestCandidate.status) : '无'}</strong></div>
          <div className="rw-check"><span className={latestRelease ? 'ok' : 'wait'} />Release 登记<strong>{latestRelease ? '已登记' : '未登记'}</strong></div>
          <div className="rw-rail-divider" />
          <h3>待处理审批</h3>
          {pendingApprovals.length === 0 ? <div className="rw-rail-empty">没有待处理审批</div> : null}
          {pendingApprovals.slice(0, 4).map((approval) => (
            <div className="rw-approval" key={approval.id}><span>{approval.subjectType === 'change_request' ? '变更审批' : '部署审批'}</span><em>r{approval.subjectRevision}</em></div>
          ))}
          <div className="rw-rail-divider" />
          <h3>发布口径</h3>
          <p className="rw-rail-copy">候选冻结与 Release 登记是本地可追溯事实；只有外部回执才能称为已分发。</p>
        </aside>
      </div>

      <Modal open={createOpen} title="新建变更" okText="创建" cancelText="取消" confirmLoading={createChange.isPending} okButtonProps={{ disabled: !title.trim() }} onOk={() => createChange.mutate()} onCancel={() => setCreateOpen(false)}>
        <div className="rw-form">
          <label><span>标题</span><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：v0.2.0 发布" /></label>
          <label><span>说明</span><Input.TextArea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="变更范围与验证方式" /></label>
          <label><span>风险</span><Select value={risk} onChange={setRisk} options={['low', 'medium', 'high', 'critical'].map((value) => ({ value, label: value }))} /></label>
          <label><span>目标环境</span><Select allowClear value={environmentId} onChange={(value) => setEnvironmentId(value ?? null)} options={data.environments.map((environment) => ({ value: environment.id, label: environment.name }))} /></label>
        </div>
      </Modal>
    </div>
  )
}
