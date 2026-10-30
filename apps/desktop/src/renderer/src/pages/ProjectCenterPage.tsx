import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Form, Input, Switch, Tooltip } from 'antd'
import {
  ArrowRightOutlined,
  AuditOutlined,
  ClockCircleOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  LockOutlined,
  PlusOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { CreateProjectInput, ProjectSummary } from '@projectos/contracts'
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  ProgressBar,
  StatusPill,
  toneForStatus,
} from '@projectos/ui'
import { useBootstrap, useProjectOverview } from '../lib/queries'
import { formatRelative, truncate } from '../lib/format'
import { stageLabel } from '../lib/labels'
import { errorMessage } from '../lib/errors'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from '../next-ui/overlay/overlay-shell'

interface CreateFormValues {
  name: string
  description: string
  rootPath: string
  createDirectory: boolean
  initGit: boolean
}


function ProjectVisualCard({ project, onOpen }: { project: ProjectSummary; index: number; onOpen: () => void }) {
  const taskPercent =
    project.stats.tasksTotal === 0 ? 0 : Math.round((project.stats.tasksDone / project.stats.tasksTotal) * 100)
  return (
    <button type="button" className="v16-project-visual" onClick={onOpen}>
      <div className="v16-project-cover">
        <span className="v16-project-avatar">{project.name.slice(0, 1).toUpperCase()}</span>
        <ArrowRightOutlined aria-hidden className="v16-project-more" />
      </div>
      <div className="v16-project-body">
        <strong title={project.name}>{project.name}</strong>
        <p>{project.description ? truncate(project.description, 58) : '尚未填写项目描述'}</p>
        <div className="v16-project-meta">
          <StatusPill tone={toneForStatus(project.status)}>{stageLabel(project.currentStage)}</StatusPill>
          <span>
            <ClockCircleOutlined /> {project.stats.tasksDone}/{project.stats.tasksTotal}
          </span>
        </div>
        <div className="v16-project-progress" title="按任务完成数计算">
          <ProgressBar value={taskPercent / 100} height={4} />
          <span>{taskPercent}% 任务</span>
        </div>
      </div>
    </button>
  )
}

export default function ProjectCenterPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const bootstrap = useBootstrap()
  const [createOpen, setCreateOpen] = useState(false)
  const [importMode, setImportMode] = useState(false)
  /** "全部" expands the widget in place (global activity has no dedicated page). */
  const [activityExpanded, setActivityExpanded] = useState(false)
  const [form] = Form.useForm<CreateFormValues>()

  const createProject = useMutation({
    mutationFn: (input: CreateProjectInput) => window.projectos.projects.create(input),
    onSuccess: async ({ project }) => {
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      setCreateOpen(false)
      form.resetFields()
      message.success(`项目「${project.name}」已创建`)
      navigate(`/projects/${project.id}`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const seedDemo = useMutation({
    mutationFn: () => window.projectos.demo.seed(false),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      message.success(result.created ? '示例项目已创建' : '示例项目已存在')
      navigate(`/projects/${result.projectId}`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const projects = useMemo(() => bootstrap.data?.projects ?? [], [bootstrap.data])
  const stats = bootstrap.data?.stats
  const recentProject = useMemo(
    () => [...projects].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))[0] ?? null,
    [projects],
  )
  const overview = useProjectOverview(recentProject?.id)
  const activity = bootstrap.data?.recentActivity ?? []
  const approvals = bootstrap.data?.pendingApprovals ?? []
  const workingAgents = overview.data?.agents.filter((agent) => agent.status === 'working') ?? []

  const successRate =
    stats && stats.tasksDone + stats.tasksCancelled > 0
      ? Math.round((stats.tasksDone / (stats.tasksDone + stats.tasksCancelled)) * 100)
      : 0
  const taskTotal = stats?.tasksTotal ?? 0
  const donePct = taskTotal > 0 ? ((stats?.tasksDone ?? 0) / taskTotal) * 100 : 0
  const runningPct = taskTotal > 0 ? ((stats?.tasksRunning ?? 0) / taskTotal) * 100 : 0
  const reviewPct = taskTotal > 0 ? ((stats?.tasksReview ?? 0) / taskTotal) * 100 : 0
  const cancelledPct = taskTotal > 0 ? ((stats?.tasksCancelled ?? 0) / taskTotal) * 100 : 0
  const donut = `conic-gradient(var(--ui-ok) 0 ${donePct}%, var(--ui-accent) ${donePct}% ${donePct + runningPct}%, var(--ui-warn) ${donePct + runningPct}% ${donePct + runningPct + reviewPct}%, var(--ui-danger) ${donePct + runningPct + reviewPct}% ${donePct + runningPct + reviewPct + cancelledPct}%, var(--ui-border) ${donePct + runningPct + reviewPct + cancelledPct}% 100%)`

  const pickDirectory = async (): Promise<void> => {
    try {
      const result = await window.projectos.app.pickDirectory()
      if (!result.canceled && result.path) {
        form.setFieldValue('rootPath', result.path)
      }
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const submit = async (): Promise<void> => {
    const values = await form.validateFields()
    createProject.mutate({
      name: values.name.trim(),
      description: values.description?.trim() ?? '',
      rootPath: values.rootPath.trim(),
      createDirectory: importMode ? false : values.createDirectory,
      initGit: importMode ? false : values.initGit,
    })
  }

  return (
    <div className="po-page po-center-page v16-center-page">
      <PageHeader
        title="项目中心"
        description="项目全生命周期与 Agent 执行工作台"
        actions={
          <>
            <Button icon={<FolderOpenOutlined />} onClick={() => void seedDemo.mutate()} loading={seedDemo.isPending}>
              载入示例项目
            </Button>
            <Button icon={<FolderOpenOutlined />} onClick={() => { setImportMode(true); setCreateOpen(true) }}>
              导入项目
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { setImportMode(false); setCreateOpen(true) }}>
              新建项目
            </Button>
          </>
        }
      />

      {bootstrap.isError ? (
        <ErrorState message={errorMessage(bootstrap.error)} onRetry={() => void bootstrap.refetch()} />
      ) : null}

      {recentProject ? (
        <section className="nx-center-hero">
          <div className="nx-hero-copy">
            <span className="nx-hero-kicker">继续工作</span>
            <h2>{recentProject.name}</h2>
            <p>{recentProject.description ? truncate(recentProject.description, 120) : '尚未填写项目描述'}</p>
            <div className="nx-hero-meta">
              <StatusPill tone={toneForStatus(recentProject.status)}>{stageLabel(recentProject.currentStage)}</StatusPill>
              <span>{workingAgents.length} 个 Agent 运行中</span>
              <span>最近活动 {formatRelative(recentProject.lastActivityAt)}</span>
            </div>
          </div>
          <div className="nx-hero-side">
            <div className="nx-hero-tasks">
              <div className="nx-hero-tasks-head">
                <strong>{recentProject.stats.tasksDone}/{recentProject.stats.tasksTotal}</strong>
                <span>任务完成</span>
              </div>
              <ProgressBar
                value={recentProject.stats.tasksTotal === 0 ? 0 : recentProject.stats.tasksDone / recentProject.stats.tasksTotal}
                height={4}
              />
              <span className="nx-hero-tasks-note">
                {recentProject.stats.tasksTotal === 0
                  ? '还没有任务，先生成计划'
                  : `${recentProject.stats.tasksDone} 个已完成 · ${recentProject.stats.tasksTotal - recentProject.stats.tasksDone} 个未完成`}
              </span>
            </div>
            <Button type="primary" icon={<ArrowRightOutlined />} className="nx-hero-open" onClick={() => navigate(`/projects/${recentProject.id}`)}>打开工作台</Button>
          </div>
        </section>
      ) : null}

      <div className="v16-stat-grid">
        <div className="v16-stat-card is-teal">
          <div className="v16-stat-icon"><FolderAddOutlined /></div>
          <div className="v16-stat-value">{projects.length}</div>
          <div className="v16-stat-label">项目总数</div>
          <span className="v16-stat-hint">{projects.filter((project) => project.status === 'active').length} 个进行中</span>
        </div>
        <div className="v16-stat-card is-blue">
          <div className="v16-stat-icon"><AuditOutlined /></div>
          <div className="v16-stat-value">{stats?.tasksTotal ?? 0}</div>
          <div className="v16-stat-label">任务总数</div>
          <span className="v16-stat-hint">{stats?.tasksDone ?? 0} 个已完成</span>
        </div>
        <div className="v16-stat-card is-violet">
          <div className="v16-stat-icon"><ThunderboltOutlined /></div>
          <div className="v16-stat-value">{stats?.activeRuns ?? 0}</div>
          <div className="v16-stat-label">运行中 Agent</div>
          <span className="v16-stat-hint">{workingAgents.length} 个活动会话</span>
        </div>
        <div className="v16-stat-card is-amber">
          <div className="v16-stat-icon"><SafetyCertificateOutlined /></div>
          <div className="v16-stat-value">{successRate}%</div>
          <div className="v16-stat-label">任务成功率</div>
          <span className="v16-stat-hint">{approvals.length} 个待授权</span>
        </div>
      </div>

      <section className="v16-section">
        <div className="v16-section-head">
          <div>
            <h2>最近项目</h2>
            <span>{projects.length} 个本地项目</span>
          </div>
          <button type="button" className="v16-text-link" onClick={() => navigate('/')}>
            查看全部 <ArrowRightOutlined />
          </button>
        </div>
        {bootstrap.isLoading ? (
          <LoadingBlock rows={3} />
        ) : projects.length === 0 ? (
          <div className="v16-glass-card">
            <EmptyState
              icon={<FolderAddOutlined />}
              title="创建第一个本地项目"
              description="选择一个本地目录，或载入示例项目。"
              action={
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                  新建项目
                </Button>
              }
            />
          </div>
        ) : (
          <div className="v16-project-visual-grid">
            {projects.slice(0, 5).map((project, index) => (
              <ProjectVisualCard
                key={project.id}
                project={project}
                index={index}
                onOpen={() => navigate(`/projects/${project.id}`)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="v16-quick-grid">
        <button type="button" className="v16-quick" onClick={() => setCreateOpen(true)}>
          <span className="v16-quick-icon is-blue"><PlusOutlined /></span>
          <span><strong>新建项目</strong><small>从本地目录开始</small></span>
        </button>
        <button type="button" className="v16-quick" onClick={() => void seedDemo.mutate()}>
          <span className="v16-quick-icon is-teal"><RocketOutlined /></span>
          <span><strong>载入示例</strong><small>查看完整生命周期</small></span>
        </button>
        <button
          type="button"
          className="v16-quick"
          disabled={!recentProject}
          onClick={() => recentProject && navigate(`/projects/${recentProject.id}`)}
        >
          <span className="v16-quick-icon is-violet"><FolderOpenOutlined /></span>
          <span><strong>继续工作</strong><small>{recentProject?.name ?? '暂无项目'}</small></span>
        </button>
      </div>

      <div className="v16-center-layout">
        <div className="v16-center-main">
          <div className="v16-chart-row">
            <section className="v16-glass-card v16-chart-card">
              <div className="v16-card-title"><strong>项目进度概览</strong><span>进度</span></div>
              <div className="v16-bars">
                {projects.slice(0, 6).map((project) => (
                  <div className="v16-bar-column" key={project.id}>
                    <div className="v16-bar-value">{Math.round(project.stats.progress * 100)}%</div>
                    <div className="v16-bar-track">
                      <div className="v16-bar-fill" style={{ height: `${Math.max(10, project.stats.progress * 100)}%` }} />
                    </div>
                    <span title={project.name}>{project.name}</span>
                  </div>
                ))}
                {projects.length === 0 ? <EmptyState compact title="暂无项目" /> : null}
              </div>
            </section>

            <section className="v16-glass-card v16-chart-card">
              <div className="v16-card-title"><strong>任务状态</strong><span>{taskTotal} 个</span></div>
              <div className="v16-donut-wrap">
                <div className="v16-donut" style={{ background: donut }}>
                  <div className="v16-donut-center"><strong>{taskTotal}</strong><span>总任务</span></div>
                </div>
                <div className="v16-legend">
                  <span><i style={{ background: 'var(--ui-ok)' }} />已完成 {stats?.tasksDone ?? 0}</span>
                  <span><i style={{ background: 'var(--ui-accent)' }} />执行中 {stats?.tasksRunning ?? 0}</span>
                  <span><i style={{ background: 'var(--ui-warn)' }} />待评审 {stats?.tasksReview ?? 0}</span>
                  <span><i style={{ background: 'var(--ui-danger)' }} />已取消 {stats?.tasksCancelled ?? 0}</span>
                </div>
              </div>
            </section>

            <section className="v16-glass-card v16-chart-card">
              <div className="v16-card-title">
                <strong>最近动态</strong>
                {activity.length > 6 ? (
                  <button
                    type="button"
                    className="v16-card-link"
                    aria-expanded={activityExpanded}
                    onClick={() => setActivityExpanded((value) => !value)}
                  >
                    {activityExpanded ? '收起' : '全部'}
                  </button>
                ) : (
                  <span>{activity.length} 条</span>
                )}
              </div>
              <div className={`v16-activity-compact${activityExpanded ? ' is-expanded' : ''}`}>
                {activity.slice(0, activityExpanded ? activity.length : 6).map((item) => (
                  <div className="v16-activity-line" key={item.id}>
                    <span className={`po-activity-mark is-${item.tone}`} />
                    <div>
                      <strong title={item.summary}>{item.summary}</strong>
                      <span>{item.actorName ? `${item.actorName} · ` : ''}{formatRelative(item.createdAt)}</span>
                    </div>
                  </div>
                ))}
                {activity.length === 0 ? <EmptyState compact title="暂无活动" /> : null}
              </div>
            </section>
          </div>

          <section className="v16-glass-card v16-table-card">
            <div className="v16-card-title"><strong>项目列表</strong><span>{projects.length} 个</span></div>
            <div className="v16-table">
              <div className="v16-table-head">
                <span>项目名称</span><span>状态</span><span>进度</span><span>任务</span><span>Agent</span><span>更新时间</span><span />
              </div>
              {projects.map((project) => (
                <button type="button" className="v16-table-row" key={project.id} onClick={() => navigate(`/projects/${project.id}`)}>
                  <span className="v16-table-name">
                    <i className="v16-table-avatar">{project.name.slice(0, 1).toUpperCase()}</i>
                    <strong>{project.name}</strong>
                  </span>
                  <span><StatusPill tone={toneForStatus(project.status)}>{stageLabel(project.currentStage)}</StatusPill></span>
                  <span className="v16-table-progress"><ProgressBar value={project.stats.progress} height={5} /><em>{Math.round(project.stats.progress * 100)}%</em></span>
                  <span>{project.stats.tasksDone}/{project.stats.tasksTotal}</span>
                  <span>{project.activeAgents}</span>
                  <span>{formatRelative(project.lastActivityAt)}</span>
                  <span><ArrowRightOutlined /></span>
                </button>
              ))}
              {projects.length === 0 ? <EmptyState compact title="暂无项目" /> : null}
            </div>
          </section>
        </div>

        <aside className="v16-center-side">
          <section className="v16-glass-card">
            <div className="v16-card-title"><strong>待授权</strong><span>{approvals.length}</span></div>
            {approvals.length === 0 ? (
              <div className="v16-rail-empty"><LockOutlined /> 没有待授权操作</div>
            ) : (
              <div className="v16-approval-rail">
                {approvals.slice(0, 4).map((approval) => (
                  <button
                    type="button"
                    key={approval.id}
                    className="v16-approval-item"
                    onClick={() => approval.projectId && navigate(`/projects/${approval.projectId}/approvals?approval=${encodeURIComponent(approval.id)}`)}
                  >
                    <span className="v16-approval-icon"><SafetyCertificateOutlined /></span>
                    <span>
                      <strong>{approval.title}</strong>
                      <small>{approval.agentName} · {formatRelative(approval.requestedAt)}</small>
                    </span>
                    <ArrowRightOutlined />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="v16-glass-card">
            <div className="v16-card-title"><strong>运行中的 Agent</strong><span>{workingAgents.length}</span></div>
            {workingAgents.length === 0 ? (
              <div className="v16-rail-empty"><ThunderboltOutlined /> 当前没有运行中的 Agent</div>
            ) : (
              <div className="v16-agent-rail">
                {workingAgents.slice(0, 5).map((view) => (
                  <button
                    type="button"
                    key={view.agent.id}
                    className="v16-agent-row"
                    onClick={() => recentProject && navigate(`/projects/${recentProject.id}/agents`)}
                  >
                    <span className="v16-agent-avatar" style={{ background: view.agent.accent }}>{view.agent.name.slice(0, 1)}</span>
                    <span><strong>{view.agent.name}</strong><small>{view.agent.role}</small></span>
                    <StatusPill tone="success" dot>执行中</StatusPill>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="v16-glass-card">
            <div className="v16-card-title"><strong>本地资源</strong><span>实时</span></div>
            <div className="v16-resource-list">
              <div><span>项目</span><strong>{projects.length}</strong><ProgressBar value={Math.min(1, projects.length / 10)} height={5} /></div>
              <div><span>任务</span><strong>{taskTotal}</strong><ProgressBar value={Math.min(1, taskTotal / 80)} height={5} /></div>
              <div><span>会话</span><strong>{stats?.sessions ?? 0}</strong><ProgressBar value={Math.min(1, (stats?.sessions ?? 0) / 40)} height={5} /></div>
              <div><span>交付物</span><strong>{stats?.artifacts ?? 0}</strong><ProgressBar value={Math.min(1, (stats?.artifacts ?? 0) / 40)} height={5} /></div>
            </div>
          </section>
        </aside>
      </div>

      <DialogShell open={createOpen} onOpenChange={(open) => { if (!open) setCreateOpen(false) }} ariaLabel={importMode ? '导入现有项目' : '新建本地项目'} width={560}>
        <OverlayHeader eyebrow="PROJECT" title={importMode ? '导入现有项目' : '新建本地项目'} closeLabel={importMode ? '关闭导入项目' : '关闭新建项目'} />
        <OverlayScrollArea className="po-dialog-form-scroll">
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ createDirectory: !importMode, initGit: false, description: '' }}
          className="po-form"
        >
          <Form.Item
            name="name"
            label="项目名称"
            rules={[{ required: true, message: '请输入项目名称' }, { max: 120 }]}
          >
            <Input placeholder="例如：Aurora Notes" autoFocus />
          </Form.Item>
          <Form.Item name="description" label="项目描述">
            <Input.TextArea rows={3} placeholder="目标、范围、技术边界。" maxLength={8000} showCount />
          </Form.Item>
          <Form.Item
            name="rootPath"
            label="项目根目录"
            rules={[
              { required: true, message: '请选择项目根目录' },
              {
                validator: async (_rule, value: string) => {
                  if (!value) return
                  if (!/^([A-Za-z]:[\\/]|\/)/.test(value)) {
                    throw new Error('请输入绝对路径')
                  }
                },
              },
            ]}
          >
            <Input
              placeholder="D:\\Projects\\aurora-notes"
              addonAfter={
                <Tooltip title="选择目录">
                  <Button type="text" size="small" icon={<FolderOpenOutlined />} onClick={() => void pickDirectory()}>
                    浏览
                  </Button>
                </Tooltip>
              }
            />
          </Form.Item>
          {!importMode ? (
            <div className="po-form-row">
              <Form.Item name="createDirectory" label="目录不存在时创建" valuePropName="checked">
                <Switch />
              </Form.Item>
              <Form.Item name="initGit" label="初始化 Git 仓库" valuePropName="checked">
                <Switch />
              </Form.Item>
            </div>
          ) : <div className="v16-inline-note">导入不会复制或移动现有文件，也不会初始化 Git。</div>}
          {createProject.error ? <ErrorState compact message={errorMessage(createProject.error)} /> : null}
        </Form>
        </OverlayScrollArea>
        <OverlayFooter>
          <Button onClick={() => setCreateOpen(false)}>取消</Button>
          <Button type="primary" loading={createProject.isPending} onClick={() => void submit()}>{importMode ? '导入项目' : '创建项目'}</Button>
        </OverlayFooter>
      </DialogShell>
    </div>
  )
}
