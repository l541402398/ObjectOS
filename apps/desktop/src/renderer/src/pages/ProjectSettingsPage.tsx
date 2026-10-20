import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { App as AntApp, Button, Form, Input, Select } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ErrorState, LoadingBlock, PageHeader } from '@projectos/ui'
import { useProjectOverview } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { stageLabel } from '../lib/labels'

interface FormValues { name: string; description: string; status: 'active' | 'archived' | 'completed' | 'paused' }

export default function ProjectSettingsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { message } = AntApp.useApp()
  const overview = useProjectOverview(projectId)
  const queryClient = useQueryClient()
  const [form] = Form.useForm<FormValues>()

  useEffect(() => {
    if (!overview.data) return
    form.setFieldsValue({
      name: overview.data.project.name,
      description: overview.data.project.description,
      status: overview.data.project.status,
    })
  }, [form, overview.data])

  const update = useMutation({
    mutationFn: (values: FormValues) => window.projectos.projects.update({
      projectId: projectId!,
      expectedVersion: overview.data!.project.version,
      name: values.name.trim(),
      description: values.description,
      status: values.status,
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['overview', projectId ?? ''] }),
        queryClient.invalidateQueries({ queryKey: ['bootstrap'] }),
      ])
      message.success('项目设置已保存')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  if (overview.isLoading) return <div className="po-page"><LoadingBlock rows={8} /></div>
  if (overview.isError || !overview.data) return <div className="po-page"><ErrorState message={overview.error ? errorMessage(overview.error) : '项目不存在'} /></div>
  const project = overview.data.project

  return (
    <div className="po-page v16-project-settings">
      <PageHeader title="项目设置" description={project.name} />
      <div className="v16-settings-grid">
        <section className="v16-glass-card">
          <div className="v16-card-title"><strong>基础信息</strong><span>{stageLabel(project.currentStage)}</span></div>
          <Form form={form} layout="vertical" onFinish={(values) => update.mutate(values)}>
            <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入项目名称' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="description" label="项目描述">
              <Input.TextArea rows={5} />
            </Form.Item>
            <Form.Item name="status" label="项目状态">
              <Select options={[{ value: 'active', label: '进行中' }, { value: 'paused', label: '已暂停' }, { value: 'completed', label: '已完成' }, { value: 'archived', label: '已归档' }]} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={update.isPending}>保存修改</Button>
          </Form>
        </section>
        <section className="v16-glass-card">
          <div className="v16-card-title"><strong>本地路径</strong><span>只读</span></div>
          <div className="v16-setting-kv"><span>项目根目录</span><strong>{project.rootPath}</strong></div>
          <div className="v16-setting-kv"><span>当前阶段</span><strong>{stageLabel(project.currentStage)}</strong></div>
          <div className="v16-setting-kv"><span>版本</span><strong>v{project.version}</strong></div>
          <div className="v16-setting-kv"><span>Git</span><strong>{overview.data.git ? `${overview.data.git.branch} · ${overview.data.git.clean ? 'clean' : `${overview.data.git.changedFiles} changes`}` : '未初始化'}</strong></div>
          <Button icon={<FolderOpenOutlined />} onClick={() => void window.projectos.app.revealPath(project.rootPath)}>打开目录</Button>
        </section>
      </div>
    </div>
  )
}

