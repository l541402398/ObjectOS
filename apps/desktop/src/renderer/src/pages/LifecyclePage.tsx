import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Input, Modal, Select } from 'antd'
import { PlusOutlined, RocketOutlined, SwapOutlined } from '@ant-design/icons'
import type { ProductVersion, VersionPhase } from '@projectos/contracts'
import { EmptyState, ErrorState, LoadingBlock, PageHeader, SectionCard, StatusPill } from '@projectos/ui'
import { qk, useLifecycle } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'
import { stageLabel } from '../lib/labels'
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

export default function LifecyclePage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const lifecycle = useLifecycle(projectId)
  const [versionOpen, setVersionOpen] = useState(false)
  const [iterationOpen, setIterationOpen] = useState(false)
  const [environmentOpen, setEnvironmentOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [makeDefault, setMakeDefault] = useState(false)
  const [iterationName, setIterationName] = useState('')
  const [iterationGoal, setIterationGoal] = useState('')
  const [environmentKey, setEnvironmentKey] = useState('')
  const [environmentName, setEnvironmentName] = useState('')

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

  const invalidate = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.lifecycle(projectId) }),
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
      await invalidate()
      message.success(`版本进入 ${PHASE_LABELS[updated.phase]}`)
    },
    onError: (error) => message.error(errorMessage(error)),
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

  const createEnvironment = useMutation({
    mutationFn: () =>
      window.projectos.lifecycle.createEnvironment({
        projectId,
        key: environmentKey.trim(),
        name: environmentName.trim(),
        kind: 'custom',
        protected: false,
      }),
    onSuccess: async () => {
      setEnvironmentOpen(false)
      setEnvironmentKey('')
      setEnvironmentName('')
      await invalidate()
      message.success('环境已登记')
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
        description="一个项目可以同时维护多个版本；currentStage 仅保留 legacy 语义，不再阻断并行工作。"
        actions={
          <>
            <Button icon={<PlusOutlined />} onClick={() => setVersionOpen(true)} disabled={!productId}>
              新建版本
            </Button>
            <Button icon={<SwapOutlined />} onClick={() => setEnvironmentOpen(true)}>
              登记环境
            </Button>
          </>
        }
        meta={
          <span>
            当前关注：{selectedVersion ? `v${selectedVersion.version}` : '未选择'} · legacy stage：{stageLabel(data.posture.legacyStage)}
          </span>
        }
      />

      <div className="lc-metrics">
        <div className="lc-metric"><span>产品</span><strong>{data.posture.productCount}</strong></div>
        <div className="lc-metric"><span>版本</span><strong>{data.posture.versionCount}</strong><small>{data.posture.activeVersionCount} 活跃</small></div>
        <div className="lc-metric"><span>迭代</span><strong>{data.posture.iterationCount}</strong></div>
        <div className="lc-metric"><span>环境</span><strong>{data.posture.environmentCount}</strong></div>
        <div className="lc-metric"><span>待审批/待验收</span><strong>{data.posture.pendingApprovals + data.posture.reviewTasks}</strong></div>
      </div>

      <div className="lc-grid">
        <main className="lc-main">
          <SectionCard title="版本" subtitle="并行版本；每个版本有独立阶段与迭代">
            {versions.length === 0 ? (
              <EmptyState compact title="还没有版本" description="新建一个版本后即可规划迭代与任务。" />
            ) : (
              <div className="lc-versions">
                {versions.map((item) => {
                  const next = NEXT_PHASES[item.phase]
                  const isFocus = item.id === selectedVersion?.id
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
                            <span>更新 {formatRelative(item.updatedAt)}</span>
                          </div>
                        </div>
                        <div className="lc-version-actions">
                          {!isFocus ? (
                            <Button size="small" onClick={() => focusVersion.mutate(item)}>
                              设为当前
                            </Button>
                          ) : null}
                          {next.length > 0 ? (
                            <Select
                              size="small"
                              value={null}
                              placeholder="推进阶段"
                              options={next.map((phase) => ({ value: phase, label: PHASE_LABELS[phase] }))}
                              onChange={(to: VersionPhase) => transition.mutate({ version: item, to })}
                              popupMatchSelectWidth={false}
                            />
                          ) : (
                            <span className="lc-retired">已结束</span>
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

          <SectionCard
            title={selectedVersion ? `迭代 · v${selectedVersion.version}` : '迭代'}
            subtitle="迭代归属版本；不同版本可并行"
            extra={
              <Button size="small" icon={<PlusOutlined />} disabled={!selectedVersion} onClick={() => setIterationOpen(true)}>
                新建迭代
              </Button>
            }
          >
            {iterations.length === 0 ? (
              <div className="lc-empty">该版本还没有迭代。创建迭代后，任务与计划可以归属其中。</div>
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
        </main>

        <aside className="lc-side">
          <SectionCard title="环境" subtitle="登记上下文；发布/部署留到 Phase 2">
            <div className="lc-environments">
              {data.environments.map((environment) => (
                <div className="lc-environment" key={environment.id}>
                  <span className="lc-env-dot" />
                  <div>
                    <strong>{environment.name}</strong>
                    <small>{environment.key} · {environment.kind}{environment.protected ? ' · 受保护' : ''}</small>
                  </div>
                </div>
              ))}
            </div>
            <Button block icon={<PlusOutlined />} onClick={() => setEnvironmentOpen(true)}>
              登记环境
            </Button>
          </SectionCard>

          <SectionCard title="项目姿态" subtitle="从 durable facts 派生，不手改显示">
            <div className="lc-posture">
              <div><span>Legacy stage</span><strong>{stageLabel(data.posture.legacyStage)}</strong></div>
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

      <Modal
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
      </Modal>

      <Modal
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
      </Modal>

      <Modal
        open={environmentOpen}
        title="登记环境"
        okText="登记"
        cancelText="取消"
        confirmLoading={createEnvironment.isPending}
        okButtonProps={{ disabled: !environmentKey.trim() || !environmentName.trim() }}
        onOk={() => createEnvironment.mutate()}
        onCancel={() => setEnvironmentOpen(false)}
      >
        <div className="lc-form">
          <label><span>Key</span><Input value={environmentKey} onChange={(event) => setEnvironmentKey(event.target.value)} placeholder="staging" /></label>
          <label><span>名称</span><Input value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} placeholder="Staging" /></label>
          <div className="lc-hint">只登记环境；不会连接部署系统或创建虚假部署记录。</div>
        </div>
      </Modal>
    </div>
  )
}
