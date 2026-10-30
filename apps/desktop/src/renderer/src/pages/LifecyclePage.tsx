import { FormDialog } from '../next-ui/overlay/FormDialog'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Input, Select, Tag } from 'antd'
import { PlusOutlined, RocketOutlined, SwapOutlined } from '@ant-design/icons'
import type { ProductVersion, VersionPhase } from '@projectos/contracts'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, SectionCard, StatusPill } from '@projectos/ui'
import { qk, useArtifacts, useLifecycle, usePlans, useTaskBoard } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'
import { stageLabel } from '../lib/labels'
import { VersionDeliverySummary } from '../components/VersionDeliverySummary'
import './lifecycle.css'

const PHASE_LABELS: Record<VersionPhase, string> = {
  planned: '已计划',
  discovery: '需求/发现',
  build: '开发中',
  verify: '验证中',
  release_candidate: '候选发布',
  released: '已发布',
  maintenance: '维护中',
  retired: '已退役',
}

const PHASE_TONES: Record<VersionPhase, 'neutral' | 'info' | 'accent' | 'warning' | 'success'> = {
  planned: 'neutral',
  discovery: 'info',
  build: 'accent',
  verify: 'warning',
  release_candidate: 'warning',
  released: 'success',
  maintenance: 'success',
  retired: 'neutral',
}

const NEXT_PHASES: Record<VersionPhase, VersionPhase[]> = {
  planned: ['discovery', 'build', 'retired'],
  discovery: ['build', 'retired'],
  build: ['verify', 'retired'],
  verify: ['build', 'release_candidate', 'retired'],
  release_candidate: ['released', 'verify', 'retired'],
  released: ['maintenance', 'retired'],
  maintenance: ['released', 'retired'],
  retired: [],
}

const EVIDENCE_LABELS: Record<string, string> = {
  review_record: '评审记录',
  test_report: '测试报告',
  approval_record: '审批记录',
  manual_attestation: '人工声明',
  other: '其他证据',
}

const ASSURANCE_LABELS: Record<string, string> = {
  self_declared: '自我声明',
  source_observed: '来源观察',
  independently_reproduced: '独立复现',
  externally_confirmed: '外部确认',
}

const GATE_LABELS: Record<string, string> = {
  'version-discovery': '进入需求发现',
  'version-build': '进入开发',
  'version-verify': '进入验证',
  'version-release': '进入候选发布',
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待验证',
  passed: '通过',
  failed: '失败',
  unknown: '未知',
  waived: '豁免',
}

export default function LifecyclePage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const lifecycle = useLifecycle(projectId)
  const board = useTaskBoard(projectId)
  const plans = usePlans(projectId)
  const artifacts = useArtifacts(projectId)
  const [versionOpen, setVersionOpen] = useState(false)
  const [iterationOpen, setIterationOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [iterationName, setIterationName] = useState('')
  const [iterationGoal, setIterationGoal] = useState('')
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidenceType, setEvidenceType] = useState('review_record')
  const [evidenceStatus, setEvidenceStatus] = useState('passed')
  const [evidenceAssurance, setEvidenceAssurance] = useState('self_declared')
  const [evidenceTitle, setEvidenceTitle] = useState('')
  const [evidenceSummary, setEvidenceSummary] = useState('')
  const [gateError, setGateError] = useState<string | null>(null)

  const data = lifecycle.data
  const products = useMemo(() => data?.products ?? [], [data])
  const versions = useMemo(() => data?.versions ?? [], [data])
  const focus = data?.focus ?? null
  const selectedVersion = useMemo(
    () => versions.find((item) => item.id === focus?.subjectId) ?? versions.find((item) => item.isDefault) ?? versions[0] ?? null,
    [focus?.subjectId, versions],
  )
  const iterations = useMemo(
    () => (data?.iterations ?? []).filter((item) => item.versionId === selectedVersion?.id),
    [data?.iterations, selectedVersion?.id],
  )
  const productId = products[0]?.id ?? ''
  const gates = useQuery({
    queryKey: ['gate-overview', projectId, selectedVersion?.id ?? ''],
    queryFn: () => window.projectos.lifecycle.gateOverview(projectId, 'version', selectedVersion!.id),
    enabled: Boolean(selectedVersion?.id),
  })

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.lifecycle(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['gate-overview', projectId] }),
      queryClient.invalidateQueries({ queryKey: qk.overview(projectId) }),
      queryClient.invalidateQueries({ queryKey: qk.bootstrap }),
    ])
  }

  const createVersion = useMutation({
    mutationFn: () =>
      window.projectos.lifecycle.createVersion({
        projectId,
        productId,
        version: version.trim(),
        phase: 'planned',
        isDefault: makeDefault,
      }),
    onSuccess: async (created) => {
      setVersionOpen(false)
      setVersion('')
      setMakeDefault(false)
      await invalidate()
      message.success(`版本 ${created.version} 已创建`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const transition = useMutation({
    mutationFn: ({ version: target, to }: { version: ProductVersion; to: VersionPhase }) =>
      window.projectos.lifecycle.transitionVersion({ versionId: target.id, to }),
    onSuccess: async (updated) => {
      setGateError(null)
      await invalidate()
      message.success(`版本进入 ${PHASE_LABELS[updated.phase]}`)
    },
    onError: (error) => {
      setGateError(errorMessage(error))
      message.error(errorMessage(error))
      // A rejected advance may still have written a gate evaluation; refresh so the
      // status tag never contradicts the error shown underneath it.
      void queryClient.invalidateQueries({ queryKey: ['gate-overview', projectId] })
    },
  })

  const focusVersion = useMutation({
    mutationFn: (target: ProductVersion) =>
      window.projectos.lifecycle.setFocus({ projectId, subjectType: 'version', subjectId: target.id }),
    onSuccess: async (next) => {
      await invalidate()
      message.success(`当前版本：${versions.find((item) => item.id === next.subjectId)?.version ?? ''}`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const createIteration = useMutation({
    mutationFn: () =>
      window.projectos.lifecycle.createIteration({
        projectId,
        versionId: selectedVersion?.id ?? '',
        name: iterationName.trim(),
        goal: iterationGoal.trim(),
      }),
    onSuccess: async () => {
      setIterationOpen(false)
      setIterationName('')
      setIterationGoal('')
      await invalidate()
      message.success('迭代已创建')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const setIterationStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'closed' | 'cancelled' }) =>
      window.projectos.lifecycle.setIterationStatus({ iterationId: id, status }),
    onSuccess: async () => {
      await invalidate()
      message.success('迭代状态已更新')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const recordEvidence = useMutation({
    mutationFn: () =>
      window.projectos.lifecycle.recordEvidence({
        projectId,
        subjectType: 'version',
        subjectId: selectedVersion!.id,
        evidenceType: evidenceType as 'test_report' | 'review_record' | 'approval_record' | 'manual_attestation' | 'other',
        verificationStatus: evidenceStatus as 'passed' | 'failed' | 'pending' | 'unknown' | 'waived',
        assurance: evidenceAssurance as 'self_declared' | 'source_observed' | 'independently_reproduced' | 'externally_confirmed',
        title: evidenceTitle.trim(),
        summary: evidenceSummary.trim(),
        provenance: { sourceSystem: 'manual-ui', actor: 'local-user', capturedAt: Date.now() },
      }),
    onSuccess: async () => {
      setEvidenceOpen(false)
      setEvidenceTitle('')
      setEvidenceSummary('')
      setGateError(null)
      await invalidate()
      message.success('证据已记录')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  if (lifecycle.isLoading) return <LoadingBlock rows={8} label="正在加载版本与迭代" />
  if (lifecycle.isError || !data) {
    return <ErrorState title="无法加载版本与迭代" message={errorMessage(lifecycle.error)} onRetry={() => void lifecycle.refetch()} />
  }

  return (
    <div className="po-page po-lifecycle-page">
      <PageHeader
        eyebrow="LIFECYCLE"
        title="版本与迭代"
        description="选择交付版本，安排本轮工作，再查看发布准备情况。"
        actions={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setVersionOpen(true)} disabled={!productId}>
              新建版本
            </Button>
            <Button icon={<SwapOutlined />} onClick={() => navigate(`/projects/${projectId}/deployments${selectedVersion ? `?version=${selectedVersion.id}` : ''}`)}>
              部署环境
            </Button>
          </>
        }
        meta={
          <span>
            当前关注：{selectedVersion ? `v${selectedVersion.version}` : '未选择'} · 项目阶段：{stageLabel(data.posture.legacyStage)}
          </span>
        }
      />

      <section className="lc-relationship" aria-label="版本、迭代与环境的关系">
        <div className="lc-scope-version"><span className="po-eyebrow">准备交付什么</span><strong>{selectedVersion ? `v${selectedVersion.version}` : '选择一个版本'}</strong><p>版本归集这次交付的需求、任务与成果。</p><div className="lc-scope-iteration"><span>版本内的工作安排</span><strong>{iterations.length} 个迭代</strong><small>简单项目可直接安排任务，无需拆分迭代。</small></div></div>
        <span className="lc-relationship-arrow" aria-hidden>发布后部署 →</span>
        <div className="lc-scope-environment"><span className="po-eyebrow">交付到哪里</span><strong>部署环境</strong><p>{data.environments.length ? data.environments.map((item) => item.name).join(' · ') : '按需配置测试或生产环境'}</p><button type="button" onClick={() => navigate(`/projects/${projectId}/deployments${selectedVersion ? `?version=${selectedVersion.id}` : ''}`)}>查看环境与部署 →</button><small>环境由项目共用，不属于某个迭代。</small></div>
      </section>

      <div className="lc-grid">
        <div className="lc-main">
          <SectionCard title="版本" subtitle="选择当前要推进的交付范围">
            {versions.length === 0 ? (
              <EmptyState compact title="还没有版本" description="新建一个版本后即可规划迭代与任务。" />
            ) : (
              <div className="lc-versions">
                {versions.map((item) => {
                  const next = NEXT_PHASES[item.phase]
                  const isFocus = item.id === selectedVersion?.id
                  const versionTasks = (board.data?.tasks ?? []).filter((task) => task.versionId === item.id)
                  const doneTasks = versionTasks.filter((task) => task.status === 'done').length
                  const versionPlans = (plans.data?.plans ?? []).filter((plan) => plan.versionId === item.id)
                  const taskIds = new Set(versionTasks.map((task) => task.id))
                  const versionArtifacts = (artifacts.data?.artifacts ?? []).filter((artifact) => artifact.taskId && taskIds.has(artifact.taskId))
                  return (
                    <article className={`lc-version ${isFocus ? 'is-focus' : ''}`} key={item.id}>
                      <div className="lc-version-head">
                        <div>
                          <div className="lc-version-title">
                            v{item.version}
                            {item.isDefault ? <span className="lc-badge">默认</span> : null}
                            {isFocus ? <span className="lc-badge is-focus">当前</span> : null}
                          </div>
                          <div className="lc-version-meta">
                            <StatusPill tone={PHASE_TONES[item.phase]}>{PHASE_LABELS[item.phase]}</StatusPill>
                            <span>{data.iterations.filter((iteration) => iteration.versionId === item.id).length} 个迭代</span>
                            <span>{versionTasks.length} 任务 · {doneTasks} 完成</span>
                            <span>{versionPlans.length} 计划 · {versionArtifacts.length} 成果</span>
                            <span>更新 {formatRelative(item.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="lc-version-actions">
                          {!isFocus ? (
                            <Button size="small" onClick={() => focusVersion.mutate(item)}>
                              设为当前
                            </Button>
                          ) : null}
                          {isFocus ? (
                            <Button size="small" onClick={() => navigate(`/projects/${projectId}/releases?version=${item.id}`)}>
                              查看发布
                            </Button>
                          ) : null}
                          {isFocus && next.length > 0 ? (
                            <Select
                              size="small"
                              value={null}
                              aria-label="推进阶段" placeholder="推进阶段"
                              options={next.map((phase) => ({ value: phase, label: PHASE_LABELS[phase] }))}
                              onChange={(to: VersionPhase) => transition.mutate({ version: item, to })}
                              popupMatchSelectWidth={false}
                            />
                          ) : (
                            next.length === 0 ? <span className="lc-retired">已结束</span> : null
                          )}
                        </div>
                      </div>
                      <div className="lc-version-progress">
                        {(['planned', 'discovery', 'build', 'verify', 'release_candidate', 'released'] as VersionPhase[]).map((phase) => (
                          <span key={phase} className={phase === item.phase ? 'is-current' : ''} title={PHASE_LABELS[phase]} />
                        ))}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </SectionCard>

          {selectedVersion ? (
            <details className="lc-disclosure"><summary>v{selectedVersion.version} · 交付进度</summary><VersionDeliverySummary projectId={projectId} versionId={selectedVersion.id} versionLabel={selectedVersion.version} /></details>
          ) : null}

          <SectionCard
            title={selectedVersion ? `迭代 · v${selectedVersion.version}` : '迭代'}
            subtitle="把这个版本的工作分成几轮，也可以直接按任务推进"
            extra={
              <Button size="small" icon={<PlusOutlined />} disabled={!selectedVersion} onClick={() => setIterationOpen(true)}>
                新建迭代
              </Button>
            }
          >
            {iterations.length === 0 ? (
              <div className="lc-empty">还没有拆分迭代。可以按当前任务继续推进；需要分轮交付时再创建迭代。</div>
            ) : (
              <div className="lc-iterations">
                {iterations.map((iteration) => (
                  <div className="lc-iteration" key={iteration.id}>
                    <div>
                      <strong>{iteration.name}</strong>
                      <span>{iteration.goal || '未填写目标'}</span>
                    </div>
                    <StatusPill tone={iteration.status === 'active' ? 'success' : iteration.status === 'closed' ? 'neutral' : 'info'}>
                      {iteration.status === 'planned' ? '已计划' : iteration.status === 'active' ? '进行中' : iteration.status === 'closed' ? '已关闭' : '已取消'}
                    </StatusPill>
                    <div className="lc-iteration-actions">
                      {iteration.status === 'planned' ? (
                        <Button size="small" onClick={() => setIterationStatus.mutate({ id: iteration.id, status: 'active' })}>
                          开始
                        </Button>
                      ) : null}
                      {iteration.status === 'active' ? (
                        <Button size="small" onClick={() => setIterationStatus.mutate({ id: iteration.id, status: 'closed' })}>
                          关闭
                        </Button>
                      ) : null}
                      {iteration.status !== 'closed' && iteration.status !== 'cancelled' ? (
                        <Button size="small" type="text" danger onClick={() => setIterationStatus.mutate({ id: iteration.id, status: 'cancelled' })}>
                          取消
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <aside className="lc-side">
          <SectionCard title="版本门禁" subtitle={selectedVersion ? `v${selectedVersion.version} · 证据驱动` : '选择版本'} extra={<Button size="small" icon={<PlusOutlined />} disabled={!selectedVersion} onClick={() => setEvidenceOpen(true)}>记录证据</Button>}>
            {!selectedVersion ? (
              <div className="lc-empty">创建或选择版本后查看门禁。</div>
            ) : (
              <div className="lc-gate">
                {gates.data?.evaluations[0] ? (
                  <div className={`lc-gate-status ${gates.data.evaluations[0].status === 'passed' ? 'is-passed' : 'is-failed'}`}>
                    <Tag color={gates.data.evaluations[0].status === 'passed' ? 'green' : 'red'}>
                      {gates.data.evaluations[0].status === 'passed' ? '最近门禁通过' : '最近门禁未通过'}
                    </Tag>
                    <span>{formatRelative(gates.data.evaluations[0].evaluatedAt)}</span>
                  </div>
                ) : gateError ? (
                  <div className="lc-gate-status is-failed"><Tag color="red">最近推进被门禁拒绝</Tag><span>见下方原因</span></div>
                ) : (
                  <div className="lc-gate-status"><Tag>暂时没有评估</Tag><span>推进阶段时自动写入评估</span></div>
                )}
                {gateError ? <div className="lc-gate-error">{gateError}</div> : null}
                <details className="lc-gate-conditions"><summary>查看阶段准入条件</summary>
                  {(gates.data?.definitions ?? []).map((definition) => (
                    <div className="lc-gate-def" key={definition.id}>
                      <strong>{GATE_LABELS[definition.key] ?? definition.key}</strong>
                      {definition.conditions.map((condition) => (
                        <span key={`${definition.id}-${condition.evidenceType}`}>
                          {EVIDENCE_LABELS[condition.evidenceType] ?? condition.evidenceType} · {STATUS_LABELS[condition.requiredStatus] ?? condition.requiredStatus} · {ASSURANCE_LABELS[condition.minAssurance] ?? condition.minAssurance}
                          {condition.allowSelfDeclared ? ' · 可人工声明' : ''}
                        </span>
                      ))}
                    </div>
                  ))}
                </details>
                <div className="lc-evidence-count">{gates.data?.evidence.length ?? 0} 条证据关联此版本</div>
              </div>
            )}
          </SectionCard>

          <SectionCard title="项目状态" subtitle="项目当前的阶段、运行与待处理">
            <div className="lc-posture">
              <div><span>项目阶段</span><strong>{stageLabel(data.posture.legacyStage)}</strong></div>
              <div><span>运行中</span><strong>{data.posture.runningRuns}</strong></div>
              <div><span>待验收</span><strong>{data.posture.reviewTasks}</strong></div>
              <div><span>待审批</span><strong>{data.posture.pendingApprovals}</strong></div>
            </div>
            <Button block icon={<RocketOutlined />} onClick={() => navigate(`/projects/${projectId}/work`)}>
              回到研发工作中心
            </Button>
          </SectionCard>
        </aside>
      </div>

      <FormDialog
        open={versionOpen}
        title="新建版本"
        okText="创建"
        cancelText="取消"
        confirmLoading={createVersion.isPending}
        okButtonProps={{ disabled: !version.trim() }}
        onOk={() => createVersion.mutate()}
        onCancel={() => setVersionOpen(false)}
      >
        <div className="lc-form">
          <label><span>版本号</span><Input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="例如 1.1.0" /></label>
          <label className="lc-check"><input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} /> 设为默认版本并切换项目关注</label>
          <div className="lc-hint">新版本从 planned 开始；不会创建发布或部署记录。</div>
        </div>
      </FormDialog>

      <FormDialog
        open={iterationOpen}
        title={`新建迭代${selectedVersion ? ` · v${selectedVersion.version}` : ''}`}
        okText="创建"
        cancelText="取消"
        confirmLoading={createIteration.isPending}
        okButtonProps={{ disabled: !iterationName.trim() || !selectedVersion }}
        onOk={() => createIteration.mutate()}
        onCancel={() => setIterationOpen(false)}
      >
        <div className="lc-form">
          <label><span>迭代名称</span><Input value={iterationName} onChange={(event) => setIterationName(event.target.value)} placeholder="例如 M1 可用切片" /></label>
          <label><span>目标</span><Input.TextArea rows={3} value={iterationGoal} onChange={(event) => setIterationGoal(event.target.value)} placeholder="这一轮要交付什么" /></label>
        </div>
      </FormDialog>

      <FormDialog
        open={evidenceOpen}
        title={`记录证据${selectedVersion ? ` · v${selectedVersion.version}` : ''}`}
        okText="记录"
        cancelText="取消"
        confirmLoading={recordEvidence.isPending}
        okButtonProps={{ disabled: !evidenceTitle.trim() || !selectedVersion }}
        onOk={() => recordEvidence.mutate()}
        onCancel={() => setEvidenceOpen(false)}
      >
        <div className="lc-form">
          <label><span>证据标题</span><Input value={evidenceTitle} onChange={(event) => setEvidenceTitle(event.target.value)} placeholder="例如：v0.1.0 验收评审记录" /></label>
          <label>
            <span>类型</span>
            <Select
              value={evidenceType}
              onChange={setEvidenceType}
              options={[
                { value: 'review_record', label: '评审记录' },
                { value: 'test_report', label: '测试报告' },
                { value: 'approval_record', label: '审批记录' },
                { value: 'manual_attestation', label: '人工声明' },
                { value: 'other', label: '其他' },
              ]}
            />
          </label>
          <label>
            <span>验证状态</span>
            <Select
              value={evidenceStatus}
              onChange={setEvidenceStatus}
              options={[
                { value: 'passed', label: 'passed' },
                { value: 'failed', label: 'failed' },
                { value: 'pending', label: 'pending' },
                { value: 'unknown', label: 'unknown' },
                { value: 'waived', label: 'waived' },
              ]}
            />
          </label>
          <label>
            <span>保证程度</span>
            <Select
              value={evidenceAssurance}
              onChange={setEvidenceAssurance}
              options={[
                { value: 'self_declared', label: '自我声明' },
                { value: 'source_observed', label: '来源观察' },
                { value: 'independently_reproduced', label: '独立复现' },
                { value: 'externally_confirmed', label: '外部确认' },
              ]}
            />
          </label>
          <label><span>摘要</span><Input.TextArea rows={3} value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} placeholder="实际检查了什么、结果如何" /></label>
          <div className="lc-hint">证据必须关联版本；自我声明不会自动等同于外部确认。</div>
        </div>
      </FormDialog>
    </div>
  )
}
