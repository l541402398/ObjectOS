import { ArrowUpRight, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  STAGES,
  projectById,
  requirementStatus,
  stageLabel,
  type GateState,
  type RequirementSummary,
} from './data'
import { Avatar, Badge, Dot } from './ui'

export function RequirementTable({
  requirements,
  gates,
  onOpen,
  emptyLabel = '没有匹配的需求',
  compact = false,
}: {
  requirements: RequirementSummary[]
  gates: Record<string, GateState>
  onOpen: (id: string) => void
  emptyLabel?: string
  compact?: boolean
}): ReactNode {
  if (requirements.length === 0) {
    return <div className="pw-table-empty">{emptyLabel}。清空搜索或切换筛选后查看全部。</div>
  }

  return (
    <div className="pw-table-wrap">
      <table className={`pw-table${compact ? ' is-compact' : ''}`}>
        <thead>
          <tr>
            <th scope="col">需求 / 所属项目</th>
            <th scope="col">当前阶段</th>
            <th scope="col">负责人</th>
            <th scope="col" className="pw-col-secondary">流程模板</th>
            <th scope="col" className="pw-col-secondary">最近更新</th>
            <th scope="col" aria-label="打开" />
          </tr>
        </thead>
        <tbody>
          {requirements.map((requirement) => {
            const project = projectById(requirement.projectId)
            const status = requirementStatus(requirement, gates[requirement.id])
            const gateStatus = gates[requirement.id]?.status
            return (
              <tr
                key={requirement.id}
                className="pw-table-row"
                tabIndex={0}
                role="link"
                aria-label={`打开需求 ${requirement.id} ${requirement.title}`}
                onClick={() => onOpen(requirement.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpen(requirement.id)
                  }
                }}
              >
                <td>
                  <div className="pw-req-cell">
                    <span className="pw-id-chip pw-mono">{requirement.id}</span>
                    <div className="pw-req-copy">
                      <strong>{requirement.title}</strong>
                      <small>
                        {project?.name ?? '未归属项目'}
                        {project ? <span className="pw-req-key">· {project.key}</span> : null}
                      </small>
                    </div>
                  </div>
                </td>
                <td>
                  <Badge tone={status.tone} dot>
                    {status.label}
                  </Badge>
                  {gateStatus === 'approved' ? (
                    <span className="pw-cell-note">下一步：{stageLabel(Math.min(requirement.stageIndex + 1, STAGES.length - 1))}</span>
                  ) : null}
                </td>
                <td>
                  <span className="pw-owner">
                    <Avatar name={requirement.owner} initial={requirement.ownerInitial} size={22} tone="neutral" />
                    {requirement.owner}
                  </span>
                </td>
                <td className="pw-col-secondary">
                  <span className="pw-muted-cell">{requirement.template}</span>
                </td>
                <td className="pw-col-secondary">
                  <span className="pw-muted-cell pw-num">{requirement.updated}</span>
                </td>
                <td className="pw-row-arrow">
                  <ChevronRight size={14} aria-hidden="true" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ProjectRow({
  project,
  requirementCount,
  onOpen,
}: {
  project: NonNullable<ReturnType<typeof projectById>>
  requirementCount: number
  onOpen?: () => void
}): ReactNode {
  return (
    <button type="button" className="pw-project-row" onClick={onOpen}>
      <span className="pw-project-mark" data-tone={project.tone}>{project.key}</span>
      <span className="pw-project-copy">
        <strong>{project.name}</strong>
        <small>{project.description}</small>
      </span>
      <span className="pw-project-meta">
        <span className="pw-num">{requirementCount} 条需求</span>
        <span className="pw-project-branch pw-mono">{project.branch}</span>
      </span>
      <Badge tone={project.tone} dot>{project.status}</Badge>
      <ArrowUpRight size={14} className="pw-project-arrow" aria-hidden="true" />
    </button>
  )
}

export function StagePips({ index }: { index: number }): ReactNode {
  return (
    <span className="pw-stage-pips" aria-label={`阶段 ${index + 1} / ${STAGES.length}`}>
      {STAGES.map((stage, stageIndex) => (
        <i
          key={stage.id}
          className={stageIndex < index ? 'is-done' : stageIndex === index ? 'is-active' : ''}
          title={stage.label}
        />
      ))}
    </span>
  )
}

export function StatusLine({ tone, children }: { tone: 'ok' | 'warn' | 'accent' | 'neutral'; children: ReactNode }): ReactNode {
  return (
    <span className="pw-status-line">
      <Dot tone={tone} />
      {children}
    </span>
  )
}
