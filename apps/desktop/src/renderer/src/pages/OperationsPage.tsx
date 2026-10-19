import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { App, Button, Checkbox, Select, Tag } from 'antd'
import { PlayCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { EmptyState, ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import { useOperations } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'

export default function OperationsPage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const query = useOperations(projectId)
  const insights = useQuery({
    queryKey: ['operations-insights', projectId],
    queryFn: () => window.projectos.operations.insights(projectId),
    enabled: Boolean(projectId),
  })
  const trigger = useQuery({
    queryKey: ['operations-trigger', projectId],
    queryFn: () => window.projectos.operations.getTrigger(projectId),
    enabled: Boolean(projectId),
  })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['operations', projectId] })
  }

  const runChecks = async (): Promise<void> => {
    setBusy('checks')
    try {
      await window.projectos.operations.runChecks(projectId)
      await refresh()
      message.success('健康检查完成')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const propose = async (): Promise<void> => {
    if (!selected.length) return
    setBusy('propose')
    try {
      await window.projectos.operations.propose(projectId, selected)
      setSelected([])
      await refresh()
      message.success('修复提案已创建')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const startRepair = async (proposalId: string): Promise<void> => {
    setBusy(proposalId)
    try {
      await window.projectos.operations.grant(projectId, 24, 5)
      await window.projectos.operations.startRepair(proposalId)
      await refresh()
      message.success('修复计划已启动')
      navigate(`/projects/${projectId}/orchestration`)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  const review = async (proposalId: string, decision: 'approved' | 'rejected'): Promise<void> => {
    setBusy(proposalId)
    try {
      await window.projectos.operations.reviewProposal(proposalId, decision)
      await refresh()
      message.success(decision === 'approved' ? '提案已批准' : '提案已拒绝')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(null)
    }
  }

  if (query.isLoading) return <div className="po-page"><LoadingBlock rows={8} /></div>
  if (query.isError) return <div className="po-page"><ErrorState title="无法加载自主运营" message={errorMessage(query.error)} onRetry={() => void query.refetch()} /></div>
  const data = query.data

  return (
    <div className="po-page po-page-wide">
      <header className="po-page-header">
        <div>
          <div className="po-eyebrow"><SafetyCertificateOutlined /> 自主运营</div>
          <h1>健康检查与修复</h1>
        </div>
        <div className="po-operations-actions">
          <Select
            value={data?.mode ?? 'observe'}
            options={[
              { value: 'observe', label: 'Observe · 只观察' },
              { value: 'propose', label: 'Propose · 生成提案' },
              { value: 'approved-autofix', label: 'Approved autofix' },
            ]}
            onChange={(mode) => {
              void window.projectos.operations.setMode(projectId, mode as 'observe' | 'propose' | 'approved-autofix').then(refresh)
            }}
          />
          <Select
            value={trigger.data?.enabled ? trigger.data.intervalMinutes : 0}
            options={[
              { value: 0, label: '自动检查关闭' },
              { value: 15, label: '每 15 分钟' },
              { value: 30, label: '每 30 分钟' },
              { value: 60, label: '每 60 分钟' },
            ]}
            onChange={(minutes) => {
              void window.projectos.operations
                .setTrigger(projectId, minutes || 30, minutes > 0)
                .then(async () => {
                  await queryClient.invalidateQueries({ queryKey: ['operations-trigger', projectId] })
                  message.success(minutes > 0 ? `自动检查已设为每 ${minutes} 分钟` : '自动检查已关闭')
                })
            }}
          />
          <Button type="primary" icon={<PlayCircleOutlined />} loading={busy === 'checks'} onClick={() => void runChecks()}>
            运行健康检查
          </Button>
        </div>
      </header>

      <div className="po-operations-grid">
        <section className="po-operations-card">
          <div className="po-operations-card-head"><strong>检查</strong><span>{data?.checks.length ?? 0}</span></div>
          {(data?.checks ?? []).map((check) => (
            <div className="po-check-row" key={check.id}>
              <StatusPill tone={check.status === 'passed' ? 'success' : check.status === 'failed' ? 'danger' : 'neutral'}>{check.status}</StatusPill>
              <div><strong>{check.checkId}</strong><span>{formatRelative(check.startedAt)}</span></div>
            </div>
          ))}
          {!data?.checks.length ? <EmptyState compact title="尚未运行检查" /> : null}
        </section>

        <section className="po-operations-card">
          <div className="po-operations-card-head">
            <strong>Findings</strong>
            <Button size="small" disabled={!selected.length} loading={busy === 'propose'} onClick={() => void propose()}>
              生成提案 ({selected.length})
            </Button>
          </div>
          {(data?.findings ?? []).map((finding) => (
            <div className="po-finding-row" key={finding.id}>
              <Checkbox checked={selected.includes(finding.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, finding.id] : current.filter((id) => id !== finding.id))} />
              <div>
                <strong>{finding.title}</strong>
                <span>{finding.category} · {finding.severity} · ×{finding.occurrenceCount}</span>
                {finding.evidence[0]?.excerpt ? <code>{finding.evidence[0].excerpt.slice(-240)}</code> : null}
              </div>
              <Tag>{finding.status}</Tag>
            </div>
          ))}
          {!data?.findings.length ? <EmptyState compact title="没有 Finding" /> : null}
        </section>

        <section className="po-operations-card">
          <div className="po-operations-card-head"><strong>修复提案</strong><span>{data?.proposals.length ?? 0}</span></div>
          {(data?.proposals ?? []).map((proposal) => (
            <div className="po-proposal-row" key={proposal.id}>
              <div>
                <strong>{proposal.scope.join('；')}</strong>
                <span>{proposal.riskLevel} · {proposal.status} · {proposal.findingIds.length} findings</span>
              </div>
              {proposal.status === 'pending_approval' ? (
                <div className="po-proposal-actions">
                  <Button size="small" type="primary" loading={busy === proposal.id} onClick={() => void review(proposal.id, 'approved')}>批准</Button>
                  <Button size="small" onClick={() => void review(proposal.id, 'rejected')}>拒绝</Button>
                </div>
              ) : proposal.status === 'approved' && !proposal.planId ? (
                <Button size="small" type="primary" loading={busy === proposal.id} onClick={() => void startRepair(proposal.id)}>启动修复</Button>
              ) : <Tag>{proposal.planId ? '已排程' : proposal.status}</Tag>}
            </div>
          ))}
          {!data?.proposals.length ? <EmptyState compact title="没有修复提案" /> : null}
        </section>
      </div>
      <section className="po-operations-card po-insights-card">
        <div className="po-operations-card-head"><strong>项目洞察</strong><span>P1</span></div>
        <div className="po-insights-meta">
          <span>依赖 {insights.data?.dependencies ?? 0}</span>
          <span>开发依赖 {insights.data?.devDependencies ?? 0}</span>
          <span>CI {insights.data?.ciWorkflows.length ?? 0}</span>
        </div>
        <pre className="po-changelog">{insights.data?.changelog || '暂无 Git 历史'}</pre>
      </section>
    </div>
  )
}

