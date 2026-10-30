import { useEffect, useId, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Check } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { DownOutlined, RightOutlined, UpOutlined } from '@ant-design/icons'
import type { JourneyStage } from '@projectos/contracts'
import {
  journeyActionLabel,
  JOURNEY_OWNER_LABEL,
  JOURNEY_STATE_LABEL,
  currentJourneyStage,
  journeyProgress,
} from '../lib/journey'
import { useReducedMotionPreference } from '../hooks/useReducedMotionPreference'
import './goal-journey.css'

/**
 * ADR-0053 — one persistent goal journey for the whole app.
 *
 * It replaces "assemble the truth from five pages": the bar answers what the goal is, which of the
 * nine journey stages we are in, whether the system is working, and who owns the next move, using the
 * ProjectJourney projection (persisted facts only). It stays mounted on every business page and in
 * the plan full-screen workspace, where the titlebar is hidden.
 */

const STATE_LABEL = JOURNEY_STATE_LABEL
const OWNER_LABEL = JOURNEY_OWNER_LABEL

export function GoalJourneyBar({ projectId }: { projectId: string | null }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const journeyRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const reducedMotion = useReducedMotionPreference()
  useEffect(() => {
    if (!expanded) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !journeyRef.current?.contains(event.target)) setExpanded(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && journeyRef.current?.contains(document.activeElement)) {
        event.stopPropagation()
        setExpanded(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [expanded])
  // ADR-0059: a stale-evidence pause gets a real recovery action — a verification-only Run through
  // the same API the runs page uses. It never edits code and never marks anything done by itself.
  const reverify = useMutation({
    mutationFn: (taskId: string) => window.projectos.verification.request(projectId ?? '', taskId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['work', 'journey'] })
    },
  })
  const journey = useQuery({
    queryKey: ['work', 'journey', projectId ?? 'auto'],
    queryFn: () => window.projectos.work.journey(projectId),
    refetchInterval: 5_000,
    staleTime: 2_000,
  })
  const data = journey.data
  const stages = data?.stages ?? []
  const progress = journeyProgress(stages)
  const doneCount = progress.done
  const current = currentJourneyStage(stages)
  const owner = data?.nextAction.owner ?? 'none'

  if (!data && journey.isLoading) {
    return (
      <section
        ref={journeyRef}
        className="po-journey is-loading"
        data-testid="goal-journey"
        aria-label="全局目标旅程"
      >
        <span className="po-journey-loading">正在读取目标状态…</span>
      </section>
    )
  }

  if (data && !data.projectId) {
    return (
      <section
        ref={journeyRef}
        className="po-journey"
        data-testid="goal-journey"
        data-owner="user"
        aria-label="全局目标旅程"
      >
        <div className="po-journey-left">
          <span className="po-journey-eyebrow">目标旅程</span>
          <strong className="po-journey-goal">还没有项目</strong>
        </div>
        <div className="po-journey-next">
          <span className="po-journey-owner is-user">{OWNER_LABEL.user}</span>
          <button
            type="button"
            className="po-journey-action"
            onClick={() => navigate('/')}
            data-testid="journey-next"
          >
            创建或打开项目
          </button>
        </div>
      </section>
    )
  }

  const openStage = (stage: JourneyStage): void => {
    if (stage.entry?.route) {
      setExpanded(false)
      navigate(stage.entry.route)
    }
  }

  return (
    <section
      ref={journeyRef}
      className="po-journey"
      data-testid="goal-journey"
      data-owner={owner}
      data-stage={current?.key ?? 'none'}
      aria-label="全局目标旅程"
    >
      <div className="po-journey-header">
        <div className="po-journey-left">
          <span className="po-journey-eyebrow">目标旅程</span>
          <strong className="po-journey-goal" title={data?.goal ?? ''}>
            {data?.goal || data?.projectName || '未命名目标'}
          </strong>
          <span className="po-journey-project">{data?.projectName}</span>
          {data && data.background.runningProjects > 1 ? (
            <button
              type="button"
              className="po-journey-bg"
              onClick={() => navigate('/')}
              title="其他项目仍在后台运行"
              data-testid="journey-background"
            >
              {data.background.runningProjects} 个项目在运行
            </button>
          ) : null}
          {data && data.background.pendingApprovals > 0 ? (
            <button
              type="button"
              className="po-journey-bg is-warn"
              onClick={() => navigate(`/projects/${data.projectId}/approvals`)}
              data-testid="journey-approvals"
            >
              {data.background.pendingApprovals} 个审批待处理
            </button>
          ) : null}
        </div>

        <div className="po-journey-location" aria-live="polite" aria-atomic="true">
          <span>当前阶段</span>
          <strong className="po-journey-current">{current?.label ?? '准备中'}</strong>
          {current ? (
            <span className={`po-journey-state is-${current.state}`}>{STATE_LABEL[current.state]}</span>
          ) : null}
        </div>

        <div className="po-journey-next">
          <span className={`po-journey-owner is-${owner}`}>{OWNER_LABEL[owner]}</span>
          <span className="po-journey-next-label" title={data?.nextAction.detail ?? ''}>
            {data?.nextAction.label}
          </span>
          {data?.nextAction.action === 'reverify' && data?.nextAction.objectId ? (
            <button
              type="button"
              className="po-journey-action"
              onClick={() => reverify.mutate(data.nextAction.objectId!)}
              disabled={reverify.isPending}
              data-testid="journey-reverify"
              title={`${data.nextAction.detail}（只跑测试与报告，不改代码）`}
            >
              {reverify.isPending ? '正在启动验证…' : '重新验证'}
            </button>
          ) : data?.nextAction.route ? (
            <button
              type="button"
              className="po-journey-action"
              onClick={() => navigate(data.nextAction.route!)}
              data-testid="journey-next"
              title={data.nextAction.detail}
            >
              {journeyActionLabel(data.nextAction)} <RightOutlined />
            </button>
          ) : null}
          <button
            ref={toggleRef}
            type="button"
            className="po-journey-toggle"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={expanded ? panelId : undefined}
            aria-label={expanded ? '收起旅程详情' : '展开旅程详情'}
            data-testid="journey-toggle"
          >
            {expanded ? <UpOutlined /> : <DownOutlined />}
          </button>
        </div>
      </div>
      <ol className="po-journey-track" aria-label="项目阶段">
        {stages.map((stage, index) => (
          <li
            key={stage.key}
            className={`po-journey-step is-${stage.state}${current?.key === stage.key ? ' is-current' : ''}`}
          >
            <button
              type="button"
              className="po-journey-step-button"
              onClick={() => openStage(stage)}
              disabled={!stage.entry?.route}
              aria-current={current?.key === stage.key ? 'step' : undefined}
              aria-label={`${stage.label}，${STATE_LABEL[stage.state]}`}
              title={`${stage.label} · ${STATE_LABEL[stage.state]}${stage.detail ? `\n${stage.detail}` : ''}`}
            >
              <span className="po-journey-step-marker" aria-hidden="true">
                {stage.state === 'done' ? <Check size={12} strokeWidth={2} /> : index + 1}
              </span>
              <span className="po-journey-step-label">{stage.label}</span>
            </button>
          </li>
        ))}
      </ol>

      {expanded ? (
        <motion.div
          id={panelId}
          className="po-journey-panel"
          role="region"
          aria-label="旅程详情"
          data-testid="journey-panel"
          initial={reducedMotion ? false : { y: -4 }}
          animate={{ y: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.16 }}
        >
          <div className="po-journey-panel-head">
            <span>
              选中目标：<strong>{data?.goal || '—'}</strong>
            </span>
            <span className="po-journey-progress">
              已完成 {doneCount} / {stages.length} 阶段
            </span>
          </div>
          <ul className="po-journey-panel-list">
            {stages.map((stage) => (
              <li key={stage.key} className={`po-journey-panel-row is-${stage.state}`} data-stage={stage.key}>
                <span className={`po-journey-dot is-${stage.state}`} aria-hidden />
                <span className="po-journey-panel-label">{stage.label}</span>
                <span className="po-journey-panel-state">{STATE_LABEL[stage.state]}</span>
                <span className="po-journey-panel-detail">{stage.detail}</span>
                {stage.entry?.route ? (
                  <button type="button" className="po-journey-panel-entry" onClick={() => openStage(stage)}>
                    {stage.entry.label}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </motion.div>
      ) : null}
    </section>
  )
}
