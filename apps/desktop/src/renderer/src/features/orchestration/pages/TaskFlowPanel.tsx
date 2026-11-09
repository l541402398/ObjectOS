import { useMemo } from 'react'
import { Button, Popconfirm, Tag } from 'antd'
import {
  CheckCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  MergeCellsOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import type { ApprovalView, PlanDraft, WorktreeInfo } from '@projectos/contracts'
import { ApprovalCard } from '@projectos/ai-ui'
import { StatusPill } from '@projectos/ui'

export type FlowPhase = 'plan' | 'agents' | 'merge'

export interface TaskFlowPanelProps {
  plan: PlanDraft | null
  pendingApprovals: ApprovalView[]
  runningCount: number
  worktreeInfo: WorktreeInfo | null
  busyApprovalId?: string | null
  onOpenPlan: () => void
  onApprovePlan?: () => void
  onStart?: () => void
  onLoadDiff: () => void
  onMerge: () => void
  onDiscard: () => void
  onDecideApproval: (approvalId: string, decision: 'approved' | 'rejected') => void
  onApproveKind?: (approval: ApprovalView) => void
  onGotoAgents: () => void
}

function phaseOf(plan: PlanDraft | null, pendingApprovals: number, runningCount: number): FlowPhase {
  if (!plan || plan.status === 'draft') return 'plan'
  const execution = plan.execution
  if (execution?.mergedAt) return 'merge'
  if (
    execution &&
    execution.workspaceRef &&
    !execution.mergedAt &&
    ['completed', 'failed', 'cancelled', 'paused'].includes(execution.status)
  ) {
    return 'merge'
  }
  if (pendingApprovals > 0 || runningCount > 0 || execution?.status === 'running') return 'agents'
  if (plan.status === 'approved') return execution ? 'agents' : 'plan'
  return 'plan'
}

function parseDiffFiles(diff: string | null | undefined): string[] {
  if (!diff) return []
  const files = new Set<string>()
  for (const line of diff.split(/\r?\n/)) {
    const status = line.match(/^(?:[MADRC]|\?| [MA])\s+(.+)$/)
    const statusName = status?.[1]?.trim()
    if (statusName) {
      files.add(statusName)
      continue
    }
    const header = line.match(/^diff --git a\/(.+) b\/(.+)$/)
    const headerName = header?.[2]
    if (headerName) files.add(headerName)
  }
  return [...files].slice(0, 40)
}

export function TaskFlowPanel({
  plan,
  pendingApprovals,
  runningCount,
  worktreeInfo,
  busyApprovalId,
  onOpenPlan,
  onApprovePlan,
  onStart,
  onLoadDiff,
  onMerge,
  onDiscard,
  onDecideApproval,
  onApproveKind,
  onGotoAgents,
}: TaskFlowPanelProps) {
  const phase = phaseOf(plan, pendingApprovals.length, runningCount)
  const files = useMemo(() => parseDiffFiles(worktreeInfo?.diff), [worktreeInfo?.diff])
  const execution = plan?.execution
  const mergeReady =
    Boolean(execution?.workspaceRef) &&
    !execution?.mergedAt &&
    ['completed', 'failed', 'cancelled', 'paused'].includes(execution?.status ?? '')

  const steps: Array<{ id: FlowPhase; label: string; detail: string }> = [
    {
      id: 'plan',
      label: '计划批准',
      detail: !plan ? '尚未生成计划' : plan.status === 'draft' ? '等待人工批准' : '计划已批准',
    },
    {
      id: 'agents',
      label: 'Agents · Worktree',
      detail:
        pendingApprovals.length > 0
          ? `${pendingApprovals.length} 项待授权`
          : runningCount > 0
            ? `${runningCount} 个 Agent 运行中`
            : execution?.status === 'completed'
              ? '执行完成，进入合并门'
              : execution?.status === 'running'
                ? '隔离 Worktree 执行中'
                : '等待开始执行',
    },
    {
      id: 'merge',
      label: '合并门',
      detail: execution?.mergedAt
        ? '已合并到主分支'
        : mergeReady
          ? '审 Diff → 合并 / 丢弃'
          : '等待执行完成',
    },
  ]

  const order: FlowPhase[] = ['plan', 'agents', 'merge']
  const activeIndex = order.indexOf(phase)

  return (
    <section className="po-task-flow" aria-label="任务时间线">
      <div className="po-task-flow-head">
        <div>
          <span className="po-task-flow-kicker">
            <ThunderboltOutlined /> 主流程
          </span>
          <h2>计划 → Worktree 执行 → 合并门</h2>
          <p>把授权与合并收进同一条时间线，避免在卡片堆里跳来跳去。</p>
        </div>
        <div className="po-task-flow-summary">
          <StatusPill tone={phase === 'merge' && mergeReady ? 'warning' : phase === 'agents' ? 'accent' : 'neutral'}>
            {phase === 'plan' ? '检查点 · 计划' : phase === 'agents' ? '执行中' : mergeReady ? '检查点 · 合并' : '已合并'}
          </StatusPill>
          {plan?.execution?.branch ? <Tag>{plan.execution.branch}</Tag> : null}
        </div>
      </div>

      <ol className="po-task-flow-rail">
        {steps.map((step, index) => {
          const state = index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'todo'
          return (
            <li key={step.id} className={`po-task-flow-step is-${state}`} aria-current={state === 'active' ? 'step' : undefined}>
              <button
                type="button"
                className="po-task-flow-node"
                onClick={() => {
                  if (step.id === 'plan') onOpenPlan()
                  else if (step.id === 'agents') onGotoAgents()
                  else if (mergeReady || worktreeInfo) onLoadDiff()
                }}
                aria-label={step.label}
              >
                {state === 'done' ? <CheckCircleOutlined /> : index + 1}
              </button>
              <div className="po-task-flow-copy">
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
              {index < steps.length - 1 ? <span className="po-task-flow-connector" aria-hidden /> : null}
            </li>
          )
        })}
      </ol>

      <div className="po-task-flow-stage">
        {phase === 'plan' ? (
          <div className="po-task-flow-panel">
            <div className="po-task-flow-panel-copy">
              <SafetyCertificateOutlined />
              <div>
                <strong>{plan ? (plan.status === 'draft' ? '批准计划后才会创建任务与 Worktree' : '计划已批准') : '还没有计划'}</strong>
                <p>{plan?.goal ?? '从目标生成多 Agent 计划，再进入隔离执行。'}</p>
              </div>
            </div>
            <div className="po-task-flow-panel-actions">
              <Button onClick={onOpenPlan}>{plan ? '查看计划' : '生成计划'}</Button>
              {plan?.status === 'draft' && onApprovePlan ? (
                <Button type="primary" icon={<CheckCircleOutlined />} onClick={onApprovePlan}>
                  批准并创建任务
                </Button>
              ) : null}
              {plan?.status === 'approved' && !plan.execution && onStart ? (
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={onStart}>
                  开始执行
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {phase === 'agents' ? (
          <div className="po-task-flow-panel is-agents">
            <div className="po-task-flow-panel-copy">
              <PlayCircleOutlined />
              <div>
                <strong>Agents 在隔离 Worktree 中执行</strong>
                <p>
                  {pendingApprovals.length
                    ? '下方内联授权，批准后继续；白名单写文件与测试命令已在已验证 Worktree 内自动放行。'
                    : runningCount
                      ? '运行中 — 拓扑图与 Inspector 可查看细节。'
                      : '准备启动或等待调度。'}
                </p>
              </div>
            </div>
            {pendingApprovals.length ? (
              <div className="po-task-flow-approvals" role="list">
                {pendingApprovals.slice(0, 4).map((approval) => (
                  <div role="listitem" key={approval.id}>
                    <ApprovalCard
                      approval={approval}
                      compact
                      busy={busyApprovalId === approval.id}
                      onDecide={(decision) => onDecideApproval(approval.id, decision)}
                      onApproveKind={onApproveKind ? () => onApproveKind(approval) : undefined}
                    />
                  </div>
                ))}
                {pendingApprovals.length > 4 ? (
                  <Button type="link" onClick={onGotoAgents}>
                    还有 {pendingApprovals.length - 4} 项 → Agent 工作台
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="po-task-flow-empty">
                <PauseCircleOutlined />
                <span>当前无待授权 — Agents 可继续推进</span>
                <Button size="small" onClick={onGotoAgents}>
                  打开 Agent 工作台
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {phase === 'merge' ? (
          <div className="po-merge-gate" aria-label="合并门检查点">
            <div className="po-merge-gate-head">
              <div>
                <span className="po-merge-gate-kicker">
                  <MergeCellsOutlined /> 合并门 · 主检查点
                </span>
                <h3>{execution?.mergedAt ? '已合并' : '审阅 Diff 后合并或丢弃'}</h3>
                <p>
                  {execution?.branch ?? '隔离分支'} · {execution?.workspaceRef ?? '无 Worktree'}
                </p>
              </div>
              <div className="po-merge-gate-actions">
                <Button icon={<FileTextOutlined />} onClick={onLoadDiff}>
                  {worktreeInfo?.diff ? '刷新 Diff' : '加载 Diff'}
                </Button>
                {!execution?.mergedAt ? (
                  <>
                    <Popconfirm
                      title="合并到主分支？"
                      description="需先确认 Diff。主工作区有未提交改动时会拒绝合并。"
                      okText="合并"
                      cancelText="取消"
                      onConfirm={onMerge}
                    >
                      <Button type="primary" icon={<MergeCellsOutlined />} disabled={!mergeReady}>
                        合并到主分支
                      </Button>
                    </Popconfirm>
                    <Popconfirm title="丢弃该计划的 Worktree？" onConfirm={onDiscard}>
                      <Button danger icon={<DeleteOutlined />}>
                        丢弃
                      </Button>
                    </Popconfirm>
                  </>
                ) : (
                  <Tag color="green">merged</Tag>
                )}
              </div>
            </div>
            <div className="po-merge-gate-body">
              <aside className="po-merge-files">
                <div className="po-merge-files-head">变更文件</div>
                {files.length ? (
                  <ul>
                    {files.map((file) => (
                      <li key={file}>
                        <FileTextOutlined />
                        <span>{file}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="po-merge-files-empty">加载 Diff 后显示文件列表</div>
                )}
              </aside>
              <pre className="po-merge-diff" tabIndex={0}>
                {worktreeInfo?.diff?.trim() || '点击「加载 Diff」预览隔离分支相对主仓的改动。'}
              </pre>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
