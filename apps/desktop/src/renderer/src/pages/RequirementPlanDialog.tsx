import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Button } from 'antd'
import { EmptyState, ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import type { Requirement } from '@projectos/contracts'
import { errorMessage } from '../lib/errors'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from '../next-ui/overlay/overlay-shell'

/** "确认并开始" only confirms the plan and then requests a policy-bound start; every side effect keeps its own approval. */
export function RequirementPlanDialog({ requirement, onClose, onApplied, onStart }: { requirement: Requirement; onClose: () => void; onApplied: () => Promise<void>; onStart?: (taskIds: string[]) => void }) {
  const plans = useQuery({ queryKey: ['requirement-plans', requirement.id], queryFn: () => window.projectos.plans.list(requirement.projectId) })
  const plan = plans.data?.plans.filter(item => item.requirementId === requirement.id && item.status === 'draft').sort((a, b) => b.revision - a.revision)[0]
  const generate = useMutation({ mutationFn: () => window.projectos.plans.generate(requirement.projectId, `拆分需求「${requirement.title}」的交付任务`, { mode: 'ai', requirementId: requirement.id, allowRuleFallback: false, maxTasks: 12 }), onSuccess: async () => { await plans.refetch() } })
  const approve = useMutation({ mutationFn: async (decision: 'approve' | 'approve_start' | 'reject') => {
    if (!plan) return
    if (decision === 'reject') { await window.projectos.plans.reject(plan.id); await plans.refetch(); return }
    const approved = await window.projectos.plans.approve(plan.id)
    await onApplied(); onClose()
    if (decision === 'approve_start') onStart?.(approved.taskIds)
  } })
  return <DialogShell open ariaLabel="AI 拆分任务" width={900} onOpenChange={open => { if (!open && !approve.isPending && !generate.isPending) onClose() }}>
    <OverlayHeader title="AI 拆分任务" meta={requirement.title} />
    <OverlayScrollArea className="rq-integration-scroll">
      {(generate.isError || approve.isError) && <Alert type="error" showIcon message={errorMessage(generate.error ?? approve.error)} />}
      {generate.isPending ? <LoadingBlock label="AI 正在结合需求与项目资料拆分任务" rows={6} /> : plans.isLoading ? <LoadingBlock label="正在读取已有草稿" rows={4} /> : plans.isError ? <ErrorState title="任务计划读取失败" message={errorMessage(plans.error)} onRetry={() => void plans.refetch()} /> : plan ? <>
        <div className="rq-section-title"><h3>确认本次任务范围</h3><StatusPill tone="neutral">{plan.tasks.length} 项任务 · 草稿</StatusPill></div>
        <ol className="rq-plan-tasks">{plan.tasks.map(task => <li key={task.key}><strong>{task.title}</strong><p>{task.description}</p><ul>{task.acceptanceCriteria.map((criterion, index) => <li key={index}>{criterion}</li>)}</ul>{task.dependsOn.length > 0 && <p className="rq-secondary">前置：{task.dependsOn.map(key => plan.tasks.find(item => item.key === key)?.title ?? key).join('、')}</p>}</li>)}</ol>
        {plan.risks.length > 0 && <Alert type="warning" showIcon message="需要留意" description={plan.risks.join('；')} />}
      </> : <EmptyState title="让 AI 提出任务拆分" description="生成后先核对任务与依赖。确认的每个任务都将继承这个需求的完整流程。" />}
    </OverlayScrollArea>
    <OverlayFooter><span className="rq-secondary">确认任务范围不代表授权写文件、执行命令或合并。</span>{plan ? <><Button danger disabled={approve.isPending} onClick={() => approve.mutate('reject')}>放弃草稿</Button>{onStart && <Button loading={approve.isPending && approve.variables === 'approve'} disabled={approve.isPending} onClick={() => approve.mutate('approve')}>确认并创建任务</Button>}<Button type="primary" loading={approve.isPending && approve.variables !== 'approve'} disabled={approve.isPending} onClick={() => approve.mutate(onStart ? 'approve_start' : 'approve')}>{onStart ? '确认并开始' : '确认并创建任务'}</Button></> : <Button type="primary" loading={generate.isPending} disabled={plans.isError} onClick={() => generate.mutate()}>生成任务草稿</Button>}</OverlayFooter>
  </DialogShell>
}
