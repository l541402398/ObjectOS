import { useNavigate, useParams } from 'react-router-dom'
import { Button } from 'antd'
import { ApartmentOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { EmptyState, LoadingBlock, PageHeader } from '@projectos/ui'
import { useProjectMetrics } from '../lib/queries'

export default function ProjectHealthPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const metrics = useProjectMetrics(projectId)

  if (metrics.isLoading) return <div className="po-page"><LoadingBlock rows={8} /></div>
  if (!metrics.data) return <div className="po-page"><EmptyState title="暂无健康数据" /></div>
  const data = metrics.data

  return (
    <div className="po-page v16-health-page">
      <PageHeader
        title="项目健康"
        description="真实任务、运行与 Agent 指标"
        actions={<Button type="primary" icon={<ApartmentOutlined />} onClick={() => navigate(`/projects/${projectId}/orchestration`)}>打开编排</Button>}
      />
      <div className="v16-stat-grid">
        <div className="v16-stat-card is-teal"><div className="v16-stat-value">{Math.round(data.completionRate * 100)}%</div><div className="v16-stat-label">完成率</div><span className="v16-stat-hint">{data.tasksDone}/{data.tasksTotal} 任务</span></div>
        <div className="v16-stat-card is-blue"><div className="v16-stat-value">{data.activeRuns}</div><div className="v16-stat-label">活跃运行</div><span className="v16-stat-hint">{data.throughput7d} 个 7 日完成</span></div>
        <div className="v16-stat-card is-violet"><div className="v16-stat-value">{data.blockedTasks}</div><div className="v16-stat-label">受阻任务</div><span className="v16-stat-hint">{data.criticalPath.length} 个关键路径节点</span></div>
        <div className="v16-stat-card is-amber"><div className="v16-stat-value">{Math.round(data.averageCycleTimeMs / 60000)}m</div><div className="v16-stat-label">平均周期</div><span className="v16-stat-hint">计划 r{data.planRevision ?? '—'}</span></div>
      </div>
      <div className="v16-settings-grid">
        <section className="v16-glass-card">
          <div className="v16-card-title"><strong>Agent 执行</strong><span>{data.agents.length}</span></div>
          {data.agents.length === 0 ? <EmptyState compact title="暂无 Agent 执行" /> : (
            <div className="v16-team-list">
              {data.agents.map((agent) => (
                <div className="v16-team-row" key={agent.agentId}>
                  <div><strong>{agent.name}</strong><span>{agent.runs} 次运行</span></div>
                  <span>{agent.completed} 完成</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="v16-glass-card">
          <div className="v16-card-title"><strong>关键路径</strong><span>计划任务</span></div>
          {data.criticalPath.length === 0 ? <EmptyState compact title="尚无已批准计划" description="生成并批准计划后显示关键路径。" /> : (
            <div className="v16-team-list">
              {data.criticalPath.map((task, index) => (
                <div className="v16-team-row" key={task.key}><span>{String(index + 1).padStart(2, '0')}</span><div><strong>{task.title}</strong><span>{task.key}</span></div></div>
              ))}
            </div>
          )}
          <Button icon={<ThunderboltOutlined />} onClick={() => navigate(`/projects/${projectId}/operations`)}>查看自主运营</Button>
        </section>
      </div>
    </div>
  )
}
