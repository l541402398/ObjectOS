import { useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import type { ProjectAutonomySettings } from '@projectos/contracts'
import { useAutonomySettings } from '../../lib/queries'
import { errorMessage } from '../../lib/errors'

type Family = ProjectAutonomySettings['worktreeAutoAllowFamilies'][number]

const FAMILIES: Array<{ value: Family; label: string }> = [
  { value: 'test', label: '测试' },
  { value: 'lint', label: 'Lint' },
  { value: 'typecheck', label: '类型检查' },
  { value: 'build', label: '构建' },
]

/**
 * ADR-0089 project switch: inside a verified isolated plan Worktree, grant-covered writes and the
 * chosen verification commands run without a per-call click. Everything else still asks.
 */
export function WorktreeAutoAllowControl({ projectId, compact = false }: { projectId: string | null; compact?: boolean }): ReactElement | null {
  const queryClient = useQueryClient()
  const settings = useAutonomySettings(projectId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const data = settings.data
  if (!projectId || !data) return null
  const enabled = data.worktreeAutoAllow
  const families = new Set(data.worktreeAutoAllowFamilies)

  const save = async (patch: { worktreeAutoAllow?: boolean; worktreeAutoAllowFamilies?: Family[] }): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.projectos.actions.setAutonomy({ projectId, mode: data.mode, ...patch })
      queryClient.setQueryData(['autonomy-settings', projectId], next)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  const toggleFamily = (family: Family): void => {
    const next = new Set(families)
    if (next.has(family)) next.delete(family)
    else next.add(family)
    void save({ worktreeAutoAllowFamilies: FAMILIES.map((entry) => entry.value).filter((value) => next.has(value)) })
  }

  return (
    <div className={`wt-allow ${compact ? 'is-compact' : ''} ${enabled ? 'is-on' : 'is-off'}`} data-testid="worktree-auto-allow">
      <div className="wt-allow-head">
        <span className="wt-allow-glyph" aria-hidden><GitBranch size={14} /></span>
        <span className="wt-allow-copy">
          <strong>隔离 Worktree 自动放行</strong>
          <small>{enabled ? '计划授权内的写入与所选命令免逐次确认' : '每次写入与命令都需要你确认'}</small>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="隔离 Worktree 自动放行"
          className="wt-switch"
          disabled={busy}
          onClick={() => void save({ worktreeAutoAllow: !enabled })}
        >
          <span />
        </button>
      </div>
      <div className="wt-allow-families" role="group" aria-label="自动放行的命令" aria-disabled={!enabled}>
        {FAMILIES.map((family) => (
          <button
            key={family.value}
            type="button"
            aria-pressed={families.has(family.value)}
            className={families.has(family.value) ? 'is-on' : ''}
            disabled={busy || !enabled}
            onClick={() => toggleFamily(family.value)}
          >
            {family.label}
          </button>
        ))}
      </div>
      {error ? <div className="wt-allow-error" role="alert">{error}</div> : null}
    </div>
  )
}
