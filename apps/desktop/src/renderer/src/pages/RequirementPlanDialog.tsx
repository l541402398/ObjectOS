import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Button } from 'antd'
import { CheckCircleFilled, LoadingOutlined, ReloadOutlined } from '@ant-design/icons'
import { EmptyState, ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import type { Requirement } from '@projectos/contracts'
import { errorMessage } from '../lib/errors'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from '../next-ui/overlay/overlay-shell'

/** "确认并开始" only confirms the plan and then requests a policy-bound start; every side effect keeps its own approval. */
export function RequirementPlanDialog({
  requirement,
  onClose,
  onApplied,
  onStart,
}: {
  requirement: Requirement
  onClose: () => void
  onApplied: () => Promise<void>
  onStart?: (taskIds: string[]) => void
}) {
  const actionLockRef = useRef(false)
  const [elapsedSec, setElapsedSec] = useState(0)

  const plans = useQuery({
    queryKey: ['requirement-plans', requirement.id],
    queryFn: () => window.projectos.plans.list(requirement.projectId),
    refetchInterval: 2500,
  })
  const snapshotQuery = useQuery({
    queryKey: ['project-snapshot', requirement.projectId],
    queryFn: () => window.projectos.projectAnalysis.snapshot(requirement.projectId),
  })

  const plan = plans.data?.plans
    .filter((item) => item.requirementId === requirement.id && item.status === 'draft')
    .sort((a, b) => b.revision - a.revision)[0]

  const scan = useMutation({
    mutationFn: async () => {
      if (actionLockRef.current) return null
      actionLockRef.current = true
      try {
        return await window.projectos.projectAnalysis.scan(requirement.projectId)
      } finally {
        actionLockRef.current = false
      }
    },
    onSuccess: async () => {
      await snapshotQuery.refetch()
    },
  })

  const generate = useMutation({
    mutationFn: async () => {
      if (actionLockRef.current) return null
      actionLockRef.current = true
      try {
        if (!snapshotQuery.data?.snapshot) {
          await window.projectos.projectAnalysis.scan(requirement.projectId).catch(() => null)
          await snapshotQuery.refetch()
        }
        return await window.projectos.plans.generate(
          requirement.projectId,
          `拆分需求「${requirement.title}」的交付任务`,
          {
            mode: 'ai',
            requirementId: requirement.id,
            allowRuleFallback: false,
            maxTasks: 12,
          },
        )
      } finally {
        actionLockRef.current = false
      }
    },
    onSuccess: async () => {
      await Promise.all([plans.refetch(), snapshotQuery.refetch()])
    },
  })

  const approve = useMutation({
    mutationFn: async (decision: 'approve' | 'approve_start' | 'reject') => {
      if (!plan || actionLockRef.current) return
      actionLockRef.current = true
      try {
        if (decision === 'reject') {
          await window.projectos.plans.reject(plan.id)
          await plans.refetch()
          return
        }
        const approved = await window.projectos.plans.approve(plan.id)
        await onApplied()
        onClose()
        if (decision === 'approve_start') onStart?.(approved.taskIds)
      } finally {
        actionLockRef.current = false
      }
    },
  })

  useEffect(() => {
    if (!generate.isPending) {
      setElapsedSec(0)
      return undefined
    }
    setElapsedSec(0)
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [generate.isPending])

  const busy = generate.isPending || approve.isPending || scan.isPending
  const snap = snapshotQuery.data?.snapshot ?? null
  const isGreenfield = Boolean(
    snap && snap.languages.length === 0 && snap.frameworks.length === 0 && snap.modules.length === 0,
  )

  const visibleWarnings = (plan?.generation?.warnings ?? []).filter(
    (w) =>
      !w.includes('项目尚未扫描') &&
      !w.includes('没有找到与需求匹配的文件摘要') &&
      !w.includes('首次模型输出未通过校验，已进行一次有界纠错') &&
      !w.includes('已补充标准交付物标签') &&
      !w.includes('已忽略模型'),
  )

  const progressSteps = [
    {
      title: '扫描并识别项目工作区上下文',
      detail: isGreenfield
        ? '已识别为全新空白项目，将按从零构建方式规划任务结构'
        : snap
          ? `已识别技术栈（${snap.languages.slice(0, 3).join(' / ') || '通用工程'}）与 ${snap.modules.length} 个模块`
          : '自动检测存量代码模块或空白工作区',
      state: elapsedSec >= 2 ? 'done' : 'active',
    },
    {
      title: '装载需求全文与验收标准契约',
      detail: `已装载 ${(requirement.body?.length ?? 0) + requirement.acceptanceCriteria.join('').length} 字需求说明与 ${requirement.acceptanceCriteria.length} 条验收标准`,
      state: elapsedSec < 2 ? 'pending' : elapsedSec >= 5 ? 'done' : 'active',
    },
    {
      title: 'AI 模型拆解可独立交付任务与依赖关系（DAG）',
      detail: '正在生成任务边界、前置依赖拓扑与每项任务的验收条目…',
      state: elapsedSec < 5 ? 'pending' : elapsedSec >= 22 ? 'done' : 'active',
    },
    {
      title: '结构化校验、验收覆盖率核对与 Agent 能力匹配',
      detail: '若首次输出格式或字段不完整，系统会自动执行一次有界纠错…',
      state: elapsedSec < 22 ? 'pending' : 'active',
    },
  ] as const

  return (
    <DialogShell
      open
      ariaLabel="AI 拆分任务"
      width={900}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <OverlayHeader title="AI 拆分任务" meta={requirement.title} />
      <OverlayScrollArea className="rq-integration-scroll">
        <div className="rq-plan-context-bar" role="region" aria-label="项目工作区扫描状态">
          <div className="rq-plan-context-info">
            {snap ? (
              isGreenfield ? (
                <>
                  <StatusPill tone="neutral">全新空白项目 · 从零构建</StatusPill>
                  <span className="rq-secondary">工作区尚无存量代码文件，AI 将直接根据需求从零规划任务</span>
                </>
              ) : (
                <>
                  <StatusPill tone="success">
                    已扫描代码库 · {snap.languages.slice(0, 3).join(' / ') || '存量工程'}
                    {snap.modules.length > 0 ? ` · ${snap.modules.length} 个模块` : ''}
                  </StatusPill>
                  <span className="rq-secondary">AI 拆分将自动结合当前项目真实技术栈与目录结构</span>
                </>
              )
            ) : (
              <>
                <StatusPill tone="accent">自动识别工作区</StatusPill>
                <span className="rq-secondary">拆分时将自动扫描项目结构（新建空白项目无需手动扫描）</span>
              </>
            )}
          </div>
          <Button
            size="small"
            icon={<ReloadOutlined aria-hidden />}
            loading={scan.isPending}
            disabled={busy}
            onClick={() => scan.mutate()}
          >
            {snap ? '重新扫描项目' : '扫描项目代码'}
          </Button>
        </div>

        {(generate.isError || approve.isError || scan.isError) && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={errorMessage(generate.error ?? approve.error ?? scan.error)}
          />
        )}

        {generate.isPending ? (
          <div className="rq-plan-progress-card" role="status" aria-live="polite">
            <div className="rq-plan-progress-head">
              <div className="rq-plan-progress-title">
                <LoadingOutlined spin className="rq-plan-progress-spinner" aria-hidden />
                <div>
                  <h4>AI 正在结合需求与项目资料拆分任务…</h4>
                  <p>复杂需求的任务拆解与依赖校验通常需要 15～45 秒，请勿关闭窗口或重复点击。</p>
                </div>
              </div>
              <StatusPill tone="accent">已耗时 {elapsedSec}s</StatusPill>
            </div>
            <ol className="rq-plan-progress-steps">
              {progressSteps.map((step, idx) => (
                <li key={idx} className={`rq-plan-progress-step is-${step.state}`}>
                  <span className="rq-plan-progress-step-icon" aria-hidden>
                    {step.state === 'done' ? (
                      <CheckCircleFilled />
                    ) : step.state === 'active' ? (
                      <LoadingOutlined spin />
                    ) : (
                      <span>{idx + 1}</span>
                    )}
                  </span>
                  <div className="rq-plan-progress-step-body">
                    <strong>{step.title}</strong>
                    <span>{step.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : plans.isLoading ? (
          <LoadingBlock label="正在读取已有草稿" rows={4} />
        ) : plans.isError ? (
          <ErrorState
            title="任务计划读取失败"
            message={errorMessage(plans.error)}
            onRetry={() => void plans.refetch()}
          />
        ) : plan ? (
          <>
            <div className="rq-section-title">
              <h3>确认本次任务范围</h3>
              <div className="rq-inline-actions">
                <StatusPill tone="success">
                  全文装载 · {(requirement.body?.length ?? 0) + requirement.acceptanceCriteria.join('').length} 字
                </StatusPill>
                {requirement.acceptanceCriteria.length > 0 && (
                  <StatusPill tone="accent">
                    验收覆盖 {requirement.acceptanceCriteria.length}/{requirement.acceptanceCriteria.length} 项
                  </StatusPill>
                )}
                <StatusPill tone="neutral">
                  {plan.tasks.length} 项任务 · 草稿 r{plan.revision}
                </StatusPill>
              </div>
            </div>
            {visibleWarnings.length > 0 && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="规划治理与覆盖审计"
                description={visibleWarnings.join('；')}
              />
            )}
            <ol className="rq-plan-tasks">
              {plan.tasks.map((task) => (
                <li key={task.key}>
                  <strong>{task.title}</strong>
                  <p>{task.description}</p>
                  <ul>
                    {task.acceptanceCriteria.map((criterion, index) => (
                      <li key={index}>{criterion}</li>
                    ))}
                  </ul>
                  {task.dependsOn.length > 0 && (
                    <p className="rq-secondary">
                      前置：{task.dependsOn.map((key) => plan.tasks.find((item) => item.key === key)?.title ?? key).join('、')}
                    </p>
                  )}
                </li>
              ))}
            </ol>
            {plan.risks.length > 0 && <Alert type="warning" showIcon message="需要留意" description={plan.risks.join('；')} />}
          </>
        ) : (
          <EmptyState
            title="让 AI 提出任务拆分"
            description="生成后先核对任务与依赖。确认的每个任务都将继承这个需求的完整流程，并完整承接每一条验收标准。"
          />
        )}
      </OverlayScrollArea>
      <OverlayFooter>
        <span className="rq-secondary">
          {generate.isPending
            ? `AI 正在拆分任务（已用时 ${elapsedSec}s），按钮已锁定防重放…`
            : '确认任务范围不代表授权写文件、执行命令或合并。'}
        </span>
        {plan && !generate.isPending ? (
          <>
            <Button icon={<ReloadOutlined aria-hidden />} disabled={busy} onClick={() => generate.mutate()}>
              重新拆分
            </Button>
            <Button danger loading={approve.isPending && approve.variables === 'reject'} disabled={busy} onClick={() => approve.mutate('reject')}>
              放弃草稿
            </Button>
            {onStart && (
              <Button
                loading={approve.isPending && approve.variables === 'approve'}
                disabled={busy}
                onClick={() => approve.mutate('approve')}
              >
                确认并创建任务
              </Button>
            )}
            <Button
              type="primary"
              loading={approve.isPending && approve.variables !== 'approve' && approve.variables !== 'reject'}
              disabled={busy}
              onClick={() => approve.mutate(onStart ? 'approve_start' : 'approve')}
            >
              {onStart ? '确认并开始' : '确认并创建任务'}
            </Button>
          </>
        ) : (
          <Button
            type="primary"
            loading={generate.isPending}
            disabled={busy || plans.isLoading || plans.isError}
            onClick={() => generate.mutate()}
          >
            生成任务草稿
          </Button>
        )}
      </OverlayFooter>
    </DialogShell>
  )
}
