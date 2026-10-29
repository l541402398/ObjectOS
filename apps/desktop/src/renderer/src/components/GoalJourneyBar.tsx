import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { DownOutlined, RightOutlined, UpOutlined } from '@ant-design/icons'
import type { JourneyStage } from '@projectos/contracts'
import { JOURNEY_OWNER_LABEL, JOURNEY_STATE_LABEL, currentJourneyStage, journeyProgress } from '../lib/journey'
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

function useCompactJourney(): boolean {
  const [compact, setCompact] = useState(() => window.innerWidth < 1180)
  useEffect(() => {
    const onResize = (): void => setCompact(window.innerWidth < 1180)
    window.addEventListener('resize', onResize)
    // The plan workspace hides the titlebar for a full-screen DAG; the bar must compact there but
    // must never unmount (it is rendered outside `.po-titlebar`).
    const observer = new MutationObserver(() => setCompact(window.innerWidth < 1180 || document.body.classList.contains('po-plan-workspace-open')))
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    onResize()
    return () => {
      window.removeEventListener('resize', onResize)
      observer.disconnect()
    }
  }, [])
  return compact
}

export function GoalJourneyBar({ projectId }: { projectId: string | null }) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const compact = useCompactJourney()
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
  const current = useMemo(() => currentJourneyStage(stages), [stages])
  const owner = data?.nextAction.owner ?? 'none'

  if (!data && journey.isLoading) {
    return (
      <section className="po-journey is-loading" data-testid="goal-journey" aria-label="全局目标旅程">
        <span className="po-journey-loading">正在读取目标状态…</span>
      </section>
    )
  }

  if (data && !data.projectId) {
    return (
      <section className="po-journey" data-testid="goal-journey" data-owner="user" aria-label="全局目标旅程">
        <div className="po-journey-left">
          <span className="po-journey-eyebrow">目标旅程</span>
          <strong className="po-journey-goal">还没有项目</strong>
        </div>
        <div className="po-journey-next">
          <span className="po-journey-owner is-user">{OWNER_LABEL.user}</span>
          <button type="button" className="po-journey-action" onClick={() => navigate('/')} data-testid="journey-next">
            创建或打开项目
          </button>
        </div>
      </section>
    )
  }

  const openStage = (stage: JourneyStage): void => {
    if (stage.entry?.route) navigate(stage.entry.route)
  }

  return (
    <section
      className={`po-journey ${compact ? 'is-compact' : ''}`.trim()}
      data-testid="goal-journey"
      data-owner={owner}
      data-stage={current?.key ?? 'none'}
      aria-label="全局目标旅程"
    >
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

      {compact ? (
        <button type="button" className="po-journey-track-compact" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          <span className="po-journey-progress">{doneCount}/{stages.length || 9}</span>
          <span className={`po-journey-dot is-${current?.state ?? 'pending'}`} aria-hidden />
          <span className="po-journey-current">{current?.label ?? '准备中'}</span>
          <span className="po-journey-current-detail">{current?.detail?.slice(0, 40)}</span>
        </button>
      ) : (
        <ol className="po-journey-track">
          {stages.map((stage, index) => (
            <li key={stage.key} className={`po-journey-step is-${stage.state}`} data-stage={stage.key} data-state={stage.state}>
              {index > 0 ? <span className="po-journey-connector" aria-hidden /> : null}
              <button
                type="button"
                className="po-journey-step-button"
                onClick={() => openStage(stage)}
                disabled={!stage.entry?.route}
                title={`${stage.label} · ${STATE_LABEL[stage.state]}：${stage.detail}`}
                aria-current={stage.key === current?.key ? 'step' : undefined}
              >
                <span className={`po-journey-dot is-${stage.state}`} aria-hidden />
                <span className="po-journey-step-label">{stage.label}</span>
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className="po-journey-next">
        <span className={`po-journey-owner is-${owner}`}>{OWNER_LABEL[owner]}</span>
        <span className="po-journey-next-label" title={data?.nextAction.detail ?? ''}>
          {data?.nextAction.label}
        </span>
        {data?.nextAction.route ? (
          <button
            type="button"
            className="po-journey-action"
            onClick={() => navigate(data.nextAction.route!)}
            data-testid="journey-next"
            title={data.nextAction.detail}
          >
            去处理 <RightOutlined />
          </button>
        ) : null}
        <button
          type="button"
          className="po-journey-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? '收起旅程详情' : '展开旅程详情'}
          data-testid="journey-toggle"
        >
          {expanded ? <UpOutlined /> : <DownOutlined />}
        </button>
      </div>

      {expanded ? (
        <div className="po-journey-panel" role="region" aria-label="旅程详情" data-testid="journey-panel">
          <div className="po-journey-panel-head">
            <span>
              选中目标：<strong>{data?.goal || '—'}</strong>
            </span>
            <span className="po-journey-selection">{data?.selection.reason}</span>
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
        </div>
      ) : null}
    </section>
  )
}
