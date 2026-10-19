import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  App as AntApp,
  Button,
  Form,
  Input,
  Modal,
  Switch,
  Tooltip,
} from 'antd'
import {
  ArrowRightOutlined,
  AuditOutlined,
  ClockCircleOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import type { CreateProjectInput, ProjectSummary } from '@projectos/contracts'
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  MetricCard,
  PageHeader,
  ProgressBar,
  SectionCard,
  StatusPill,
  toneForStatus,
} from '@projectos/ui'
import { useBootstrap } from '../lib/queries'
import { formatRelative, truncate } from '../lib/format'
import { stageLabel } from '../lib/labels'
import { errorMessage } from '../lib/errors'

interface CreateFormValues {
  name: string
  description: string
  rootPath: string
  createDirectory: boolean
  initGit: boolean
}

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: () => void }) {
  const done = project.stats.tasksDone
  const total = project.stats.tasksTotal
  return (
    <button type="button" className="po-project-card" onClick={onOpen}>
      <div className="po-project-card-top">
        <div className="po-project-card-title">
          <span className={`po-status-dot is-${project.status}`} />
          <span>{project.name}</span>
        </div>
        <StatusPill tone={toneForStatus(project.status)} dot={false}>
          {stageLabel(project.currentStage)}
        </StatusPill>
      </div>
      <div className="po-project-card-description">
        {project.description ? truncate(project.description, 110) : '尚未填写项目描述。'}
      </div>
      <div className="po-project-card-progress">
        <div className="po-row is-between">
          <span className="po-caption po-muted">
            {done}/{total} 任务完成 · {Math.round(project.stats.progress * 100)}%
          </span>
          <span className="po-caption po-muted">{project.stats.sessions} 个会话</span>
        </div>
        <ProgressBar value={project.stats.progress} height={5} />
      </div>
      <div className="po-project-card-footer">
        <span>
          <ClockCircleOutlined /> {formatRelative(project.lastActivityAt)}
        </span>
        {project.isDemo ? <span className="po-demo-tag">示例</span> : null}
        <span className="po-project-open">
          打开 <ArrowRightOutlined />
        </span>
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
  const activity = bootstrap.data?.recentActivity ?? []

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
      createDirectory: values.createDirectory,
      initGit: values.initGit,
    })
  }

  return (
    <div className="po-page po-center-page">
      <PageHeader
        title="项目中心"
        actions={
          <>
            <Button icon={<FolderOpenOutlined />} onClick={() => void seedDemo.mutate()} loading={seedDemo.isPending}>
              载入示例项目
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新建项目
            </Button>
          </>
        }
      />

      {bootstrap.isError ? (
        <ErrorState message={errorMessage(bootstrap.error)} onRetry={() => void bootstrap.refetch()} />
      ) : null}

      {recentProject ? (
        <section className="po-continue-card">
          <div className="po-continue-glow" />
          <div className="po-continue-main">
            <div className="po-continue-eyebrow">
              <span className="po-live-dot" /> 继续工作
            </div>
            <h2>{recentProject.name}</h2>
            <p>{recentProject.description || '继续推进项目生命周期。'}</p>
            <div className="po-continue-meta">
              <StatusPill tone={toneForStatus(recentProject.status)}>{stageLabel(recentProject.currentStage)}</StatusPill>
              <span>{recentProject.stats.activeRuns} 个 Agent 运行中</span>
              <span>{recentProject.stats.pendingApprovals} 个待授权</span>
              <span>最近活动 {formatRelative(recentProject.lastActivityAt)}</span>
            </div>
          </div>
          <div className="po-continue-side">
            <div className="po-continue-progress">
              <strong>{Math.round(recentProject.stats.progress * 100)}%</strong>
              <span>生命周期进度</span>
            </div>
            <Button type="primary" onClick={() => navigate(`/projects/${recentProject.id}`)}>
              打开工作台 <ArrowRightOutlined />
            </Button>
          </div>
        </section>
      ) : null}

      <div className="po-metric-grid">
        <MetricCard
          label="本地项目"
          value={stats?.tasksTotal !== undefined ? projects.length : '—'}
          icon={<FolderAddOutlined />}
          tone="accent"
          hint={`${projects.filter((project) => project.status === 'active').length} 个进行中`}
        />
        <MetricCard
          label="任务进度"
          value={stats ? `${Math.round(stats.progress * 100)}%` : '—'}
          icon={<RocketOutlined />}
          tone="success"
          progress={stats?.progress}
          hint={stats ? `${stats.tasksDone + stats.tasksCancelled}/${stats.tasksTotal} 已结束` : '暂无任务'}
        />
        <MetricCard
          label="待授权"
          value={bootstrap.data?.pendingApprovals.length ?? 0}
          icon={<SafetyCertificateOutlined />}
          tone={bootstrap.data?.pendingApprovals.length ? 'warning' : 'neutral'}
          hint="写文件与命令执行需要人工确认"
        />
        <MetricCard
          label="交付物"
          value={stats?.artifacts ?? 0}
          icon={<AuditOutlined />}
          tone="info"
          hint={`${stats?.requirementsApproved ?? 0} 条需求已批准`}
        />
      </div>

      <div className="po-center-grid">
        <div className="po-center-main">
          {bootstrap.isLoading ? (
            <SectionCard title="最近项目">
              <LoadingBlock rows={4} />
            </SectionCard>
          ) : projects.length === 0 ? (
            <SectionCard>
              <EmptyState
                icon={<FolderAddOutlined />}
                title="创建第一个本地项目"
                description="选择一个本地目录，或载入示例项目。"
                action={
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
                    新建项目
                  </Button>
                }
                secondary={
                  <Button icon={<RocketOutlined />} onClick={() => void seedDemo.mutate()} loading={seedDemo.isPending}>
                    载入示例项目
                  </Button>
                }
              />
            </SectionCard>
          ) : (
            <SectionCard
              title="最近项目"
              subtitle={`${projects.length} 个项目`}
              extra={<span className="po-caption po-muted">按最近活动排序</span>}
            >
              <div className="po-project-grid">
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={() => navigate(`/projects/${project.id}`)}
                  />
                ))}
              </div>
            </SectionCard>
          )}
          <SectionCard title="全生命周期">
            <div className="po-lifecycle-strip">
              {[
                ['构思', 'ideation'],
                ['需求', 'requirements'],
                ['架构', 'architecture'],
                ['规划', 'planning'],
                ['实现', 'implementation'],
                ['测试', 'testing'],
                ['发布', 'release'],
                ['维护', 'maintenance'],
              ].map(([label, stage], index) => (
                <div className="po-lifecycle-step" key={stage}>
                  <span className="po-lifecycle-index">{String(index + 1).padStart(2, '0')}</span>
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
        <aside className="po-center-side">
          <SectionCard title="近期活动">
            {activity.length === 0 ? (
              <EmptyState compact title="暂无活动" />
            ) : (
              <div className="po-activity-list">
                {activity.map((item) => (
                  <div className="po-activity-item" key={item.id}>
                    <span className={`po-activity-mark is-${item.tone}`} />
                    <div className="po-activity-body">
                      <div className="po-activity-text">{item.summary}</div>
                      <div className="po-activity-meta">
                        {item.actorName ? `${item.actorName} · ` : ''}
                        {formatRelative(item.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </aside>
      </div>

      <Modal
        title="新建本地项目"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submit()}
        okText="创建项目"
        cancelText="取消"
        confirmLoading={createProject.isPending}
        destroyOnHidden
        width={560}
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ createDirectory: true, initGit: false, description: '' }}
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
            <Input.TextArea
              rows={3}
              placeholder="目标、范围、技术边界。该描述会进入 Agent 执行上下文。"
              maxLength={8000}
              showCount
            />
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
            extra="ProjectOS 直接在你的目录中工作，不会复制项目文件。"
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
          <div className="po-form-row">
            <Form.Item name="createDirectory" label="目录不存在时创建" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="initGit" label="初始化 Git 仓库" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          {createProject.error ? <ErrorState compact message={errorMessage(createProject.error)} /> : null}
        </Form>
      </Modal>
    </div>
  )
}
