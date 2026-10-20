import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from 'antd'
import { CodeOutlined, DatabaseOutlined, FolderOpenOutlined, RobotOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { PageHeader } from '@projectos/ui'
import { useAIConnections, useRuntimeProfiles, useSkills } from '../lib/queries'
import { useUiStore } from '../stores/ui'

export default function ResourcesPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const openSettings = useUiStore((state) => state.openSettings)
  const workspace = useQuery({
    queryKey: ['workspace', projectId ?? ''],
    queryFn: () => window.projectos.workspace.snapshot(projectId!),
    enabled: Boolean(projectId),
  })
  const runtimes = useRuntimeProfiles()
  const skills = useSkills()
  const connections = useAIConnections()

  const stats = useMemo(() => {
    const entries = workspace.data?.entries ?? []
    const files = entries.filter((entry) => entry.type === 'file')
    const dirs = entries.filter((entry) => entry.type === 'directory')
    return { files: files.length, dirs: dirs.length, bytes: files.reduce((sum, entry) => sum + (entry.size ?? 0), 0) }
  }, [workspace.data])

  return (
    <div className="po-page v16-resources-page">
      <PageHeader
        title="资源中心"
        description="项目文件、Skills、Runtime 与 AI 连接"
        actions={<Button icon={<CodeOutlined />} onClick={() => navigate(`/projects/${projectId}/workspace`)}>打开工作区</Button>}
      />

      <div className="v16-resource-cards">
        <section className="v16-glass-card">
          <div className="v16-resource-icon is-blue"><FolderOpenOutlined /></div>
          <strong>项目文件</strong><span>{stats.files} 个文件 · {stats.dirs} 个目录</span>
          <Button size="small" onClick={() => navigate(`/projects/${projectId}/workspace`)}>浏览文件</Button>
        </section>
        <section className="v16-glass-card">
          <div className="v16-resource-icon is-teal"><RobotOutlined /></div>
          <strong>Runtime</strong><span>{runtimes.data?.profiles.length ?? 0} 个已注册</span>
          <Button size="small" onClick={() => openSettings('runtime')}>在设置中管理</Button>
        </section>
        <section className="v16-glass-card">
          <div className="v16-resource-icon is-violet"><DatabaseOutlined /></div>
          <strong>Skills</strong><span>{skills.data?.skills.length ?? 0} 个已导入</span>
          <Button size="small" onClick={() => openSettings('tools')}>查看 Skills</Button>
        </section>
        <section className="v16-glass-card">
          <div className="v16-resource-icon is-amber"><ThunderboltOutlined /></div>
          <strong>AI 连接</strong><span>{connections.data?.connections.length ?? 0} 个连接</span>
          <Button size="small" onClick={() => openSettings('ai-connections')}>打开设置</Button>
        </section>
      </div>

      <section className="v16-glass-card v16-resource-detail">
        <div className="v16-card-title"><strong>项目文件</strong><span>{workspace.data?.rootPath ?? '加载中'}</span></div>
        {workspace.isLoading ? <div className="v16-empty-inline">正在读取工作区…</div> : null}
        {workspace.isError ? <div className="v16-empty-inline">无法读取工作区文件</div> : null}
        <div className="v16-resource-file-list">
          {(workspace.data?.entries ?? []).slice(0, 24).map((entry) => (
            <div key={entry.path} className="v16-resource-file">
              <span>{entry.type === 'directory' ? '目录' : '文件'}</span>
              <strong title={entry.path}>{entry.path}</strong>
              <em>{entry.size != null ? `${Math.max(1, Math.round(entry.size / 1024))} KB` : '—'}</em>
            </div>
          ))}
          {(workspace.data?.entries ?? []).length === 0 ? <div className="v16-empty-inline">目录为空</div> : null}
        </div>
      </section>
    </div>
  )
}
