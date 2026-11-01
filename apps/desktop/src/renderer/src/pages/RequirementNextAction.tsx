import { useRef, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Alert, Button } from 'antd'
import { CloseOutlined, ExclamationCircleOutlined, PauseCircleOutlined, PlayCircleOutlined, TeamOutlined } from '@ant-design/icons'
import type { FlowStartIntent, FlowStartOutcome, RequirementFlowView, TaskCard } from '@projectos/contracts'
import { errorMessage } from '../lib/errors'

export const startOutcomeLabels: Record<FlowStartOutcome, string> = {
  started: '已开始', running: '已在执行', waiting_approval: '待授权工作区', waiting_dependency: '等待前置任务', waiting_workspace: '排队申请工作区', needs_assignment: '缺少负责人',
  invalid_agent: 'Agent 不可用', needs_attention: '需要处理', paused: '已暂停', completed: '流程已完成', finished: '任务已结束',
  failed: '未能开始', scope_changed: '安排已变化', revoked: '已停止', queued: '排队中',
}
const attention: FlowStartOutcome[] = ['needs_assignment', 'invalid_agent', 'needs_attention', 'failed', 'scope_changed']

type Primary = { key: string; label: string; icon?: ReactNode; run: () => void } | null

/** Shows only the action the persisted state calls for; full controls remain in task details. */
export function RequirementNextAction({ requirementId, flow, tasks, result, onResult, onArrange, onSelectTask, onShowMaterials, onRefresh }: {
  requirementId: string; flow: RequirementFlowView; tasks: TaskCard[]; result: FlowStartIntent | null; onResult: (intent: FlowStartIntent | null) => void
  onArrange: () => void; onSelectTask: (taskId: string) => void; onShowMaterials: () => void; onRefresh: () => Promise<void>
}) {
  const key = useRef<string | null>(null)
  const binding = flow.binding
  const start = useMutation({
    mutationFn: () => {
      key.current ??= `start-${crypto.randomUUID()}`
      return window.projectos.workflows.startAll({ requirementId, expectedBindingVersion: binding!.version, requestKey: key.current })
    },
    onSuccess: async data => { onResult(data.intent); await onRefresh() },
    onSettled: () => { key.current = null },
  })
  const stop = useMutation({ mutationFn: () => window.projectos.workflows.stopAll({ requirementId, reason: '已人工停止自动推进' }), onSuccess: async () => { onResult(null); await onRefresh() } })
  if (!binding || flow.tasks.length === 0) return null

  const open = new Set(tasks.filter(task => !['done', 'cancelled'].includes(task.status)).map(task => task.id))
  const flows = flow.tasks
  const approvals = flows.filter(item => item.pendingApprovalId)
  const problems = flows.filter(item => item.status === 'blocked' || item.steps.some(step => ['failed', 'needs_reconciliation'].includes(step.status)))
  const intent = flow.startIntent
  const waiting = intent?.status === 'active' ? intent.items.filter(item => item.status === 'waiting') : []
  const waitingIds = new Set(waiting.map(item => item.taskId))
  const idle = flows.filter(item => item.status === 'idle' && open.has(item.taskId) && !waitingIds.has(item.taskId))
  const unassigned = idle.filter(item => item.steps.some(step => !step.agentId))
  const startable = binding.assignmentMode === 'ai' ? idle : idle.filter(item => item.steps.every(step => step.agentId))
  const running = flows.filter(item => item.status === 'running')
  const completed = flows.filter(item => item.status === 'completed')
  const busy = start.isPending || stop.isPending

  const primary: Primary = approvals.length ? { key: 'approval', label: `处理授权 ${approvals.length}`, run: () => onSelectTask(approvals[0]!.taskId) }
    : problems.length ? { key: 'problem', label: `处理问题 ${problems.length}`, run: () => onSelectTask(problems[0]!.taskId) }
      : startable.length ? { key: 'start', label: `开始执行 ${startable.length} 个任务`, icon: <PlayCircleOutlined aria-hidden />, run: () => start.mutate() }
        : unassigned.length ? { key: 'arrange', label: '确认安排', icon: <TeamOutlined aria-hidden />, run: onArrange }
          : !running.length && !waiting.length && completed.length === flows.length ? { key: 'results', label: '查看成果', run: onShowMaterials }
            : null
  const facts = [
    [running.length, '执行中'], [flows.filter(item => item.status === 'paused').length, '已暂停'], [approvals.length, '待授权'], [problems.length, '待处理'], [waiting.length, '等待中'],
    [unassigned.length, '待安排'], [startable.length - (binding.assignmentMode === 'ai' ? unassigned.length : 0), '可开始'], [completed.length, '流程完成'],
  ].filter(([count]) => Number(count) > 0) as Array<[number, string]>
  const shown = result ?? (waiting.length ? intent : null)

  return <section className="rq-next-action" aria-label="需求下一步">
    <div className="rq-next-action-bar">
      <p className="rq-next-facts" aria-live="polite">{facts.length ? facts.map(([count, label]) => <span key={label}><strong>{count}</strong> {label}</span>) : <span>{flows.length} 个任务</span>}</p>
      <div className="rq-inline-actions">
        {primary?.key !== 'arrange' && <Button icon={<TeamOutlined aria-hidden />} disabled={busy} onClick={onArrange}>任务安排</Button>}
        {(running.length > 0 || waiting.length > 0) && <Button icon={<PauseCircleOutlined aria-hidden />} loading={stop.isPending} disabled={start.isPending} onClick={() => stop.mutate()}>停止自动推进</Button>}
        {primary && <Button type="primary" icon={primary.icon} loading={primary.key === 'start' && start.isPending} disabled={busy && primary.key !== 'start'} onClick={primary.run}>{primary.label}</Button>}
      </div>
    </div>
    {(start.isError || stop.isError) && <Alert type="error" showIcon message={errorMessage(start.error ?? stop.error)} />}
    {shown && <div className="rq-start-result" role="status">
      <div className="rq-section-title"><h3>{result ? '本次开始结果' : '满足条件后自动开始'}</h3>{result && <Button type="text" icon={<CloseOutlined aria-hidden />} aria-label="收起开始结果" onClick={() => onResult(null)} />}</div>
      <ul>{shown.items.filter(item => result || item.status === 'waiting').map(item => <li key={item.taskId} className={attention.includes(item.outcome) ? 'is-attention' : undefined}>
        <button type="button" onClick={() => onSelectTask(item.taskId)}>{item.title}</button>
        <span className="rq-start-outcome">{attention.includes(item.outcome) && <ExclamationCircleOutlined aria-hidden />}{startOutcomeLabels[item.outcome]}</span>
        {item.reason && <span className="rq-secondary">{item.reason}</span>}
      </li>)}</ul>
    </div>}
  </section>
}
