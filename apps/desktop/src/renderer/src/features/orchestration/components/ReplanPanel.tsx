import { useState } from 'react'
import { Alert, App as AntApp, Button, Input, Tag } from 'antd'
import { BranchesOutlined, CheckOutlined, CloseOutlined, ReloadOutlined } from '@ant-design/icons'
import type { PlanDraft, ReplanProposalView } from '@projectos/contracts'
import { StatusPill } from '@projectos/ui'

const TRIGGER_LABEL: Record<ReplanProposalView['trigger'], string> = {
  retry_exhausted: '重试耗尽',
  evidence_exhausted: '证据/补证耗尽',
  quality_gate_failed: '质量门禁失败',
  agent_unavailable: 'Agent/Runtime 不可用',
  artifact_invalid: '上游产物无效',
  user_requested: '用户主动调整',
  constraints_changed: '约束变化',
}

function statusTone(status: ReplanProposalView['status']): 'success' | 'danger' | 'warning' | 'neutral' {
  if (status === 'applied') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'rejected') return 'neutral'
  return 'warning'
}

const STATUS_LABEL: Record<ReplanProposalView['status'], string> = {
  proposed: '待确认',
  applying: '应用中',
  applied: '已应用',
  rejected: '已拒绝',
  failed: '生成失败',
}

export function ReplanPanel(props: {
  plan: PlanDraft
  proposals: ReplanProposalView[]
  busy: boolean
  onPropose: (reason: string, trigger: 'user_requested' | 'constraints_changed') => Promise<void>
  onApply: (proposalId: string) => Promise<void>
  onReject: (proposalId: string) => Promise<void>
}) {
  const { message } = AntApp.useApp()
  const [reason, setReason] = useState('')
  const [trigger, setTrigger] = useState<'user_requested' | 'constraints_changed'>('user_requested')
  const latest = props.proposals[0] ?? null
  const canRequest = props.plan.status !== 'draft' && props.plan.status !== 'rejected'
  const activeProposal = props.proposals.find((proposal) => proposal.status === 'proposed')

  return (
    <section className="po-replan-panel" data-testid="replan-panel">
      <div className="po-replan-head">
        <div className="po-replan-title">
          <span className="po-replan-icon"><BranchesOutlined /></span>
          <div>
            <strong>动态重规划</strong>
            <span>基于真实执行事实生成修订提案；不会直接启动或接管 Scheduler。</span>
          </div>
        </div>
        <StatusPill tone={activeProposal ? 'warning' : 'neutral'}>
          {activeProposal ? '待确认' : latest?.status === 'applied' ? '已应用' : '无待确认提案'}
        </StatusPill>
      </div>

      {canRequest && !activeProposal ? (
        <div className="po-replan-request">
          <div className="po-replan-request-row">
            <select
              value={trigger}
              onChange={(event) => setTrigger(event.target.value as 'user_requested' | 'constraints_changed')}
              aria-label="重规划原因类型"
            >
              <option value="user_requested">用户主动调整</option>
              <option value="constraints_changed">项目约束变化</option>
            </select>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="说明需要调整的原因、约束或希望补强的验收目标"
              maxLength={4000}
              onPressEnter={() => {
                if (reason.trim().length < 3) return
                void props.onPropose(reason.trim(), trigger).then(() => setReason(''))
              }}
            />
            <Button
              icon={<ReloadOutlined />}
              loading={props.busy}
              disabled={reason.trim().length < 3}
              onClick={() => {
                void props.onPropose(reason.trim(), trigger).then(() => setReason(''))
              }}
            >
              生成修订提案
            </Button>
          </div>
          <div className="po-replan-hint">
            自动触发仅发生在重试/补证耗尽、质量门禁失败或 Agent 不可用时；可安全重试的失败不会触发。
          </div>
        </div>
      ) : null}

      {!latest ? (
        <div className="po-replan-empty">还没有重规划提案。计划仍按当前 revision 执行；需要调整时再生成。</div>
      ) : (
        <div className="po-replan-proposals">
          {props.proposals.slice(0, 3).map((proposal) => (
            <article className={`po-replan-card is-${proposal.status}`} key={proposal.id}>
              <div className="po-replan-card-head">
                <div>
                  <strong>{TRIGGER_LABEL[proposal.trigger]}</strong>
                  <span>源 r{proposal.sourceRevision} · {new Date(proposal.requestedAt).toLocaleString()}</span>
                </div>
                <StatusPill tone={statusTone(proposal.status)}>{STATUS_LABEL[proposal.status]}</StatusPill>
              </div>
              <p className="po-replan-reason">{proposal.reason}</p>
              {proposal.error ? <Alert type="error" showIcon message="提案未保存为可执行修订" description={proposal.error} /> : null}
              <div className="po-replan-diff">
                <span><b>{proposal.diff.kept.length}</b> 保留</span>
                <span><b>{proposal.diff.added.length}</b> 新增</span>
                <span><b>{proposal.diff.removed.length}</b> 删除/取消</span>
                <span><b>{proposal.diff.modified.length}</b> 修改</span>
                <span><b>{proposal.diff.reusableArtifacts.length}</b> 可复用成果</span>
                <span><b>{proposal.diff.revalidate.length}</b> 需重新验证</span>
              </div>
              {proposal.diff.modified.length ? (
                <div className="po-replan-lines">
                  {proposal.diff.modified.slice(0, 5).map((item) => (
                    <span key={item.key}><Tag>修改</Tag>{item.key} · {item.fields.join(' / ')}</span>
                  ))}
                </div>
              ) : null}
              {proposal.diff.agentChanges.length ? (
                <div className="po-replan-lines">
                  {proposal.diff.agentChanges.slice(0, 5).map((item) => (
                    <span key={item.key}><Tag>Agent</Tag>{item.key}：{item.beforeAgentName ?? '未分配'} → {item.afterAgentName ?? '未分配'}</span>
                  ))}
                </div>
              ) : null}
              {proposal.diff.reusableArtifacts.length ? (
                <div className="po-replan-reuse">
                  <strong>可复用已完成成果</strong>
                  {proposal.diff.reusableArtifacts.slice(0, 4).map((item) => (
                    <span key={item.taskKey}>{item.taskKey} · {item.artifactTitles.length} 个 Artifact</span>
                  ))}
                </div>
              ) : null}
              {proposal.diff.revalidate.length ? (
                <div className="po-replan-revalidate">
                  <strong>必须重新验证</strong>
                  {proposal.diff.revalidate.slice(0, 4).map((item) => (
                    <span key={`${item.taskKey}-${item.sourceTaskId}`}>{item.taskKey}：{item.reason}</span>
                  ))}
                </div>
              ) : null}
              <div className={`po-replan-grant ${proposal.grantImpact.requiresNewGrant ? 'is-warning' : ''}`}>
                <strong>授权变化</strong>
                <span>
                  {proposal.grantImpact.requiresNewGrant
                    ? `需要重新签发计划授权${proposal.grantImpact.withinOriginalScope ? '（语义上仍在原范围，但 revision 指纹已变）' : ''}`
                    : '授权语义仍在原范围内'}
                </span>
                {proposal.grantImpact.expanded.slice(0, 4).map((item) => <span key={item}>· {item}</span>)}
              </div>
              {proposal.status === 'proposed' ? (
                <div className="po-replan-actions">
                  {!proposal.canApply ? <em>{proposal.blockedReasons.join('；') || '当前不可应用'}</em> : null}
                  <Button
                    icon={<CheckOutlined />}
                    type="primary"
                    disabled={!proposal.canApply}
                    loading={props.busy}
                    onClick={() => {
                      void props.onApply(proposal.id).then(() => message.success('修订已应用为新的草稿 revision；请重新批准并授权'))
                    }}
                  >
                    应用为草稿 revision
                  </Button>
                  <Button
                    danger
                    icon={<CloseOutlined />}
                    loading={props.busy}
                    onClick={() => void props.onReject(proposal.id)}
                  >
                    拒绝修订
                  </Button>
                </div>
              ) : null}
              {proposal.status === 'applied' ? (
                <div className="po-replan-applied">
                  已应用为 r{proposal.appliedRevision ?? '?'} 草稿；需要重新批准计划并签发计划授权后才会执行。
                </div>
              ) : null}
              {proposal.status === 'rejected' ? <div className="po-replan-applied">已拒绝；旧计划未被修改。</div> : null}
              {proposal.generation?.model ? (
                <div className="po-replan-source">{proposal.generation.connectionName ?? 'Provider'} · {proposal.generation.model} · {proposal.generation.attempts} 次调用 · {proposal.contextChars} 字符上下文</div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
