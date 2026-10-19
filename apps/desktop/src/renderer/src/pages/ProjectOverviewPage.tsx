import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, DatePicker, Form, Input, Modal, Select, Tooltip } from 'antd'
import type { Dayjs } from 'dayjs'
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CodeOutlined,
  FlagOutlined,
  FolderOpenOutlined,
  LockOutlined,
  PlusOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { LifecycleGate, ProjectStage } from '@projectos/contracts'
import {
  AgentAvatar,
  EmptyState,
  ErrorState,
  KeyValueList,
  LoadingBlock,
  MetricCard,
  PageHeader,
  SectionCard,
  StatusPill,
  toneForStatus,
} from '@projectos/ui'
import { ApprovalCard } from '@projectos/ai-ui'
import { useApprovals, useProjectOverview } from '../lib/queries'
import { formatDate, formatRelative, parseLines, percent } from '../lib/format'
import {
  DECISION_LABELS,
  MILESTONE_LABELS,
  REQUIREMENT_LABELS,
  stageLabel,
} from '../lib/labels'
import { errorMessage } from '../lib/errors'

function StageRail({ stages, currentStage, gates }: { stages: ProjectStage[]; currentStage: string; gates: LifecycleGate[] }) {  const gateMap = new Map(gates.map((gate) => [gate.stage, gate]))
  return (
    <div className="po-stage-rail">
      {stages.map((stage, index) => {
        const gate = gateMap.get(stage.stage)
        const state = stage.status === 'completed' ? 'done' : stage.stage === currentStage || stage.status === 'active' ? 'active' : 'pending'
        return (
          <Tooltip
            key={stage.stage}
            title={
              <div className="po-stage-tooltip">
                <strong>{stageLabel(stage.stage)}</strong>
                <span>{gate?.requirement}</span>
                {gate && gate.blockers.length > 0 ? <span>待满足：{gate.blockers.join('；')}</span> : <span>门禁已满足</span>}
              </div>
            }
          >
            <div className={`po-stage ${state}`.trim()}>
              <div className="po-stage-dot">
                {state === 'done' ? <CheckCircleOutlined /> : <span>{index + 1}</span>}
              </div>
              <div className="po-stage-label">{stageLabel(stage.stage)}</div>
              <div className="po-stage-state">{state === 'done' ? '已完成' : state === 'active' ? '当前' : '待进入'}</div>
            </div>
          </Tooltip>
        )
      })}
    </div>
  )
}

interface LifecycleFormValues {
  title: string
  body: string
  acceptance?: string
  dueAt?: Dayjs
  status?: 'proposed' | 'accepted'
}

type LifecycleKind = 'requirement' | 'milestone' | 'decision'

const LIFECYCLE_LABELS: Record<LifecycleKind, string> = {
  requirement: '需求',
  milestone: '里程碑',
  decision: '决策',
}

export default function ProjectOverviewPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const overview = useProjectOverview(projectId)
  const approvals = useApprovals(projectId)
  const [advanceOpen, setAdvanceOpen] = useState(false)
  const [createKind, setCreateKind] = useState<LifecycleKind | null>(null)
  const [lifecycleForm] = Form.useForm<LifecycleFormValues>()

  const decide = useMutation({
    mutationFn: ({ approvalId, decision }: { approvalId: string; decision: 'approved' | 'rejected' }) =>
      window.projectos.approvals.decide({ approvalId, decision, note: '' }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['overview', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['approvals', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
        queryClient.invalidateQueries({ queryKey: ['runs', projectId] }),
      ])
      message.success('授权决定已记录')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const advance = useMutation({
    mutationFn: () => window.projectos.projects.advanceStage({ projectId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['overview', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ])
      setAdvanceOpen(false)
      message.success('生命周期阶段已推进')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const reveal = useMutation({
    mutationFn: () => window.projectos.projects.reveal(projectId),
    onError: (error) => message.error(errorMessage(error)),
  })

  const createLifecycle = useMutation<unknown, Error, { kind: LifecycleKind; values: LifecycleFormValues }>({
    mutationFn: async (input: { kind: LifecycleKind; values: LifecycleFormValues }) => {
      const { kind, values } = input
      const title = values.title.trim()
      const body = values.body?.trim() ?? ''
      if (kind === 'requirement') {
        return window.projectos.requirements.create({
          projectId,
          title,
          body,
          acceptanceCriteria: parseLines(values.acceptance ?? ''),
          source: 'local',
        })
      }
      if (kind === 'milestone') {
        return window.projectos.milestones.create({
          projectId,
          title,
          description: body,
          dueAt: values.dueAt ? values.dueAt.valueOf() : null,
        })
      }
      return window.projectos.decisions.create({
        projectId,
        title,
        body,
        status: values.status ?? 'proposed',
      })
    },
    onSuccess: async (_result, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['overview', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ])
      setCreateKind(null)
      lifecycleForm.resetFields()
      message.success(`${LIFECYCLE_LABELS[variables.kind]}已创建`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const setLifecycleStatus = useMutation<unknown, Error, { kind: LifecycleKind; id: string; status: string }>({
    mutationFn: (input: { kind: LifecycleKind; id: string; status: string }) => {
      if (input.kind === 'requirement') {
        return window.projectos.requirements.setStatus(input.id, input.status as 'approved' | 'implemented')
      }
      if (input.kind === 'milestone') {
        return window.projectos.milestones.setStatus(input.id, input.status as 'active' | 'completed')
      }
      return window.projectos.decisions.setStatus(input.id, input.status as 'accepted')
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['overview', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ])
      message.success('状态已更新')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const openCreate = (kind: LifecycleKind): void => {
    setCreateKind(kind)
    lifecycleForm.resetFields()
    lifecycleForm.setFieldsValue({ status: 'proposed' })
  }

  const submitLifecycle = async (): Promise<void> => {
    if (!createKind) return
    const values = await lifecycleForm.validateFields()
    createLifecycle.mutate({ kind: createKind, values })
  }

  const pendingApprovals = useMemo(
    () => (approvals.data?.approvals ?? []).filter((approval) => approval.status === 'pending'),
    [approvals.data],
  )

  if (overview.isLoading) {
    return (
      <div className="po-page">
        <LoadingBlock rows={8} label="正在加载项目总览" />
      </div>
    )
  }
  if (overview.isError || !overview.data) {
    return (
      <div className="po-page">
        <ErrorState
          title="无法加载项目总览"
          message={overview.error ? errorMessage(overview.error) : '项目数据不存在'}
          onRetry={() => void overview.refetch()}
        />
      </div>
    )
  }

  const data = overview.data
  const project = data.project
  const nextStage = data.stages.find((stage) => stage.stage === project.currentStage)
  const currentIndex = data.stages.findIndex((stage) => stage.stage === project.currentStage)
  const next = data.stages[currentIndex + 1] ?? null
  const nextGate = next ? data.gates.find((gate) => gate.stage === next.stage) : null
  const canAdvance = Boolean(next) && (nextGate?.ready ?? false)
  const activeAgents = data.agents.filter((agent) => agent.status === 'working')
  const verifiedArtifacts = data.stats.artifacts

  return (
    <div className="po-page po-overview-page">
      <PageHeader
        eyebrow={
          <>
            <RocketOutlined /> {stageLabel(project.currentStage)} · 项目工作台
          </>
        }
        title={
          <span className="po-title-with-badge">
            {project.name}
            {project.isDemo ? <span className="po-demo-tag">示例数据</span> : null}
          </span>
        }
        description={project.description || '尚未填写项目描述。'}
        actions={
          <>
            <Button icon={<FolderOpenOutlined />} onClick={() => void reveal.mutate()} loading={reveal.isPending}>
              打开目录
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => navigate(`/projects/${projectId}/tasks?new=1`)}>
              新建任务
            </Button>
            <Tooltip title={next ? `${stageLabel(next.stage)}：${nextGate?.requirement ?? ''}` : '已到达最后阶段'}>
              <Button
                type="primary"
                icon={<ArrowRightOutlined />}
                onClick={() => setAdvanceOpen(true)}
                disabled={!next}
              >
                推进阶段
              </Button>
            </Tooltip>
          </>
        }
        meta={
          <>
            <span>
              <CodeOutlined /> {project.rootPath}
            </span>
            {data.git ? (
              <span>
                <span className="po-git-branch">⑂ {data.git.branch}</span>
                {data.git.clean ? ' · 工作区干净' : ` · ${data.git.changedFiles} 个变更`}
              </span>
            ) : (
              <span>未初始化 Git</span>
            )}
            <span>
              <ClockCircleOutlined /> 更新于 {formatRelative(project.updatedAt)}
            </span>
          </>
        }
      />

      <SectionCard title="生命周期" subtitle="阶段门禁由需求、ADR、里程碑、任务与交付物共同决定" className="po-lifecycle-card">
        <StageRail stages={data.stages} currentStage={project.currentStage} gates={data.gates} />
        <div className="po-lifecycle-footer">
          <div>
            <span className="po-caption po-muted">当前阶段</span>
            <strong>{stageLabel(project.currentStage)}</strong>
          </div>
          {next ? (
            <>
              <span className="po-lifecycle-arrow">→</span>
              <div>
                <span className="po-caption po-muted">下一阶段</span>
                <strong>{stageLabel(next.stage)}</strong>
              </div>
              <StatusPill tone={nextGate?.ready ? 'success' : 'warning'}>
                {nextGate?.ready ? '门禁已满足' : `${nextGate?.blockers.length ?? 0} 项待满足`}
              </StatusPill>
            </>
          ) : (
            <StatusPill tone="success">已到达最后阶段</StatusPill>
          )}
          <span className="po-grow" />
          <span className="po-caption po-muted">{nextStage?.status === 'active' ? '阶段进行中' : ''}</span>
        </div>
      </SectionCard>

      <div className="po-metric-grid">
        <MetricCard
          label="任务进度"
          value={percent(data.stats.progress)}
          icon={<ThunderboltOutlined />}
          tone="accent"
          progress={data.stats.progress}
          hint={`${data.stats.tasksDone + data.stats.tasksCancelled}/${data.stats.tasksTotal} 已结束 · ${data.stats.tasksRunning} 执行中`}
          onClick={() => navigate(`/projects/${projectId}/tasks`)}
        />
        <MetricCard
          label="活跃 Agent"
          value={activeAgents.length}
          suffix={`/ ${data.agents.length}`}
          icon={<TeamOutlined />}
          tone="success"
          hint={`${data.stats.sessions} 个持久化会话`}
          onClick={() => navigate(`/projects/${projectId}/agents`)}
        />
        <MetricCard
          label="待授权"
          value={pendingApprovals.length}
          icon={<SafetyCertificateOutlined />}
          tone={pendingApprovals.length > 0 ? 'warning' : 'neutral'}
          hint="写文件与命令执行需人工确认"
          onClick={() => navigate(`/projects/${projectId}/agents`)}
        />
        <MetricCard
          label="交付物"
          value={verifiedArtifacts}
          icon={<FlagOutlined />}
          tone="info"
          hint={`${data.stats.requirementsApproved} 条已批准需求 · ${data.stats.milestonesCompleted}/${data.stats.milestonesTotal} 里程碑`}
        />
      </div>

      <div className="po-workbench-grid">
        <div className="po-workbench-main">
          <SectionCard
            title="里程碑"

            extra={
              <div className="po-row">
                <Button type="link" size="small" onClick={() => navigate(`/projects/${projectId}/tasks`)}>
                  查看任务
                </Button>
                <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => openCreate('milestone')}>
                  新增
                </Button>
              </div>
            }
          >
            {data.milestones.length === 0 ? (
              <EmptyState compact title="还没有里程碑" description="在项目规划阶段创建里程碑，让任务有明确的时间边界。" />
            ) : (
              <div className="po-milestone-list">
                {data.milestones.map((milestone) => (
                  <div className={`po-milestone ${milestone.status}`.trim()} key={milestone.id}>
                    <div className="po-milestone-flag">
                      <FlagOutlined />
                    </div>
                    <div className="po-milestone-body">
                      <div className="po-milestone-head">
                        <strong>{milestone.title}</strong>
                        <StatusPill tone={toneForStatus(milestone.status)}>{MILESTONE_LABELS[milestone.status]}</StatusPill>
                      </div>
                      <div className="po-milestone-description">{milestone.description || '未填写说明'}</div>
                      <div className="po-milestone-meta">
                        <span>截止 {formatDate(milestone.dueAt)}</span>
                        {milestone.status === 'planned' ? (
                          <Button
                            type="link"
                            size="small"
                            onClick={() =>
                              setLifecycleStatus.mutate({ kind: 'milestone', id: milestone.id, status: 'active' })
                            }
                          >
                            开始
                          </Button>
                        ) : milestone.status === 'active' ? (
                          <Button
                            type="link"
                            size="small"
                            onClick={() =>
                              setLifecycleStatus.mutate({ kind: 'milestone', id: milestone.id, status: 'completed' })
                            }
                          >
                            标记完成
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="需求与验收"
            subtitle="已批准需求会进入 Agent 上下文"
            extra={
              <div className="po-row">
                <span className="po-caption po-muted">{data.requirements.length} 条</span>
                <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => openCreate('requirement')}>
                  新增
                </Button>
              </div>
            }
          >
            {data.requirements.length === 0 ? (
              <EmptyState compact title="还没有需求" description="把目标写成带验收标准的需求，任务与交付物才有可追踪的依据。" />
            ) : (
              <div className="po-requirement-list">
                {data.requirements.map((requirement) => (
                  <div className="po-requirement" key={requirement.id}>
                    <div className="po-requirement-head">
                      <strong>{requirement.title}</strong>
                      <StatusPill tone={toneForStatus(requirement.status)}>
                        {REQUIREMENT_LABELS[requirement.status]}
                      </StatusPill>
                    </div>
                    <div className="po-requirement-body">{requirement.body || '未填写正文'}</div>
                    <div className="po-requirement-criteria">
                      {requirement.acceptanceCriteria.slice(0, 3).map((criterion) => (
                        <span key={criterion}>
                          <CheckCircleOutlined /> {criterion}
                        </span>
                      ))}
                      {requirement.acceptanceCriteria.length > 3 ? (
                        <span className="po-muted">+{requirement.acceptanceCriteria.length - 3} 项验收标准</span>
                      ) : null}
                    </div>
                    {requirement.status === 'draft' || requirement.status === 'review' ? (
                      <div className="po-requirement-actions">
                        <Button
                          type="link"
                          size="small"
                          icon={<CheckCircleOutlined />}
                          onClick={() =>
                            setLifecycleStatus.mutate({ kind: 'requirement', id: requirement.id, status: 'approved' })
                          }
                        >
                          批准需求
                        </Button>
                      </div>
                    ) : requirement.status === 'approved' ? (
                      <div className="po-requirement-actions">
                        <Button
                          type="link"
                          size="small"
                          onClick={() =>
                            setLifecycleStatus.mutate({
                              kind: 'requirement',
                              id: requirement.id,
                              status: 'implemented',
                            })
                          }
                        >
                          标记已实现
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="近期活动">
            {data.activity.length === 0 ? (
              <EmptyState compact title="暂无活动" />
            ) : (
              <div className="po-timeline">
                {data.activity.map((item) => (
                  <div className="po-timeline-item" key={item.id}>
                    <span className={`po-timeline-dot is-${item.tone}`} />
                    <div className="po-timeline-body">
                      <div className="po-timeline-text">{item.summary}</div>
                      <div className="po-timeline-meta">
                        {item.actorName ?? '系统'} · seq {item.seq} · {formatRelative(item.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <aside className="po-workbench-side">
          <SectionCard title="Agent 活动" className="po-compact-card">
            {data.agents.length === 0 ? (
              <EmptyState compact title="暂无 Agent" />
            ) : (
              <div className="po-agent-list">
                {data.agents.map((agentView) => (
                  <button
                    type="button"
                    className="po-agent-row"
                    key={agentView.agent.id}
                    onClick={() => navigate(`/projects/${projectId}/agents`)}
                  >
                    <AgentAvatar
                      name={agentView.agent.name}
                      accent={agentView.agent.accent}
                      size={30}
                      status={agentView.status}
                    />
                    <span className="po-agent-info">
                      <strong>{agentView.agent.name}</strong>
                      <span>{agentView.agent.role}</span>
                    </span>
                    <span className="po-agent-meta">
                      <StatusPill tone={toneForStatus(agentView.status)}>
                        {agentView.status === 'working' ? '执行中' : '空闲'}
                      </StatusPill>
                      <span className="po-caption po-muted">{agentView.completedRuns} 次完成</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="待授权"
            subtitle="Agent 被阻塞在这里，等待你的判断"
            className="po-compact-card"
            extra={pendingApprovals.length > 0 ? <StatusPill tone="warning">{pendingApprovals.length}</StatusPill> : null}
          >
            {approvals.isLoading ? (
              <LoadingBlock rows={2} />
            ) : pendingApprovals.length === 0 ? (
              <EmptyState compact icon={<LockOutlined />} title="没有待授权操作" description="写文件与执行命令会在这里请求确认。" />
            ) : (
              <div className="po-approval-list">
                {pendingApprovals.slice(0, 2).map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    compact
                    busy={decide.isPending}
                    onDecide={(decision) => decide.mutate({ approvalId: approval.id, decision })}
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard title="项目上下文" className="po-compact-card">
            <KeyValueList
              items={[
                { label: '状态', value: <StatusPill tone={toneForStatus(project.status)}>{project.status}</StatusPill> },
                { label: '当前阶段', value: stageLabel(project.currentStage) },
                { label: 'Git', value: data.git ? `${data.git.branch} · ${data.git.clean ? '干净' : `${data.git.changedFiles} 个变更`}` : '未初始化' },
                { label: '本地路径', value: project.rootPath, mono: true },
                { label: '版本', value: `v${project.version}` },
              ]}
            />
          </SectionCard>

          <SectionCard
            title="决策记录"
            subtitle="已接受的 ADR 会进入上下文"
            className="po-compact-card"
            extra={
              <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => openCreate('decision')}>
                新增
              </Button>
            }
          >
            {data.decisions.length === 0 ? (
              <EmptyState compact title="暂无决策记录" />
            ) : (
              <div className="po-decision-list">
                {data.decisions.slice(0, 3).map((decision) => (
                  <div className="po-decision" key={decision.id}>
                    <div className="po-decision-head">
                      <strong>{decision.title}</strong>
                      <StatusPill tone={toneForStatus(decision.status)}>{DECISION_LABELS[decision.status]}</StatusPill>
                    </div>
                    <p>{decision.body}</p>
                    {decision.status === 'proposed' ? (
                      <Button
                        type="link"
                        size="small"
                        onClick={() => setLifecycleStatus.mutate({ kind: 'decision', id: decision.id, status: 'accepted' })}
                      >
                        接受决策
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </aside>
      </div>

      <Modal
        title={createKind ? `新增${LIFECYCLE_LABELS[createKind]}` : '新增'}
        open={Boolean(createKind)}
        onCancel={() => setCreateKind(null)}
        onOk={() => void submitLifecycle()}
        okText="创建"
        cancelText="取消"
        confirmLoading={createLifecycle.isPending}
        width={560}
        destroyOnHidden
      >
        <Form form={lifecycleForm} layout="vertical" requiredMark={false} className="po-form">
          <Form.Item
            name="title"
            label={`${createKind ? LIFECYCLE_LABELS[createKind] : '条目'}标题`}
            rules={[{ required: true, message: '请输入标题' }, { max: 240 }]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            name="body"
            label={createKind === 'decision' ? '背景、备选方案与影响' : createKind === 'milestone' ? '说明' : '需求正文'}
          >
            <Input.TextArea rows={4} />
          </Form.Item>
          {createKind === 'requirement' ? (
            <Form.Item name="acceptance" label="验收标准" extra="每行一条；已批准需求会进入 Agent 上下文。">
              <Input.TextArea rows={3} placeholder={'可观察、可测试的验收标准'} />
            </Form.Item>
          ) : null}
          {createKind === 'milestone' ? (
            <Form.Item name="dueAt" label="截止时间">
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          ) : null}
          {createKind === 'decision' ? (
            <Form.Item name="status" label="决策状态">
              <Select
                options={[
                  { value: 'proposed', label: '提议中' },
                  { value: 'accepted', label: '已接受' },
                ]}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title={next ? `推进到「${stageLabel(next.stage)}」` : '已到达最后阶段'}
        open={advanceOpen}
        onCancel={() => setAdvanceOpen(false)}
        onOk={() => advance.mutate()}
        okText="确认推进"
        cancelText="取消"
        confirmLoading={advance.isPending}
        okButtonProps={{ disabled: !canAdvance }}
        width={560}
      >
        {next ? (
          <div className="po-advance-modal">
            <p className="po-muted">阶段门禁会根据当前需求、决策、里程碑、任务与交付物实时计算。</p>
            <div className="po-gate-list">
              {data.gates
                .filter((gate) => gate.stage === next.stage)
                .map((gate) => (
                  <div key={gate.stage} className={`po-gate ${gate.ready ? 'is-ready' : 'is-blocked'}`.trim()}>
                    <div className="po-gate-head">
                      <strong>{gate.requirement}</strong>
                      <StatusPill tone={gate.ready ? 'success' : 'warning'}>{gate.ready ? '已满足' : '未满足'}</StatusPill>
                    </div>
                    {gate.blockers.map((blocker) => (
                      <span key={blocker}>{blocker}</span>
                    ))}
                  </div>
                ))}
            </div>
            {!canAdvance ? (
              <p className="po-warning-text">该阶段仍有门禁未满足。补齐需求、决策或交付物后再推进；不会跳过质量门禁。</p>
            ) : null}
          </div>
        ) : (
          <p className="po-muted">项目已经处于最后维护阶段。</p>
        )}
      </Modal>
    </div>
  )
}


