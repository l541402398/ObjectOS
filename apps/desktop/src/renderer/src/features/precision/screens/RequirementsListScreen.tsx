import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, CircleAlert, ListChecks, Plus, SearchX } from 'lucide-react'
import {
  STAGES,
  projectById,
  requirementStatus,
  type GateState,
  type ProjectSummary,
  type RequirementSummary,
} from '../data'
import { RequirementTable } from '../components'
import { Badge, Button, Callout, EmptyState, PageHeader, SearchInput, Segmented, SkeletonRows, Surface } from '../ui'

type RequirementState = 'ready' | 'empty' | 'error' | 'loading'
type Filter = 'all' | 'active' | 'gate' | 'delivered'

export function RequirementsListScreen({
  requirements,
  gates,
  state,
  query,
  onQuery,
  projectFilter,
  onClearProject,
  onOpenRequirement,
  onCreate,
  onRetry,
}: {
  requirements: RequirementSummary[]
  gates: Record<string, GateState>
  state: RequirementState
  query: string
  onQuery: (value: string) => void
  projectFilter: ProjectSummary | null
  onClearProject: () => void
  onOpenRequirement: (id: string) => void
  onCreate: () => void
  onRetry: () => void
}): ReactNode {
  const [filter, setFilter] = useState<Filter>('all')

  const scoped = projectFilter ? requirements.filter((requirement) => requirement.projectId === projectFilter.id) : requirements
  const counts = {
    all: scoped.length,
    active: scoped.filter((requirement) => requirement.stageIndex < STAGES.length - 1).length,
    gate: scoped.filter((requirement) => requirement.gate !== null).length,
    delivered: scoped.filter((requirement) => requirement.stageIndex === STAGES.length - 1).length,
  }

  const visible = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return scoped.filter((requirement) => {
      if (filter === 'active' && requirement.stageIndex >= STAGES.length - 1) return false
      if (filter === 'gate' && !requirement.gate) return false
      if (filter === 'delivered' && requirement.stageIndex !== STAGES.length - 1) return false
      if (!normalized) return true
      const project = projectById(requirement.projectId)
      return [requirement.id, requirement.title, requirement.owner, requirement.template, project?.name ?? '', project?.key ?? '']
        .some((value) => value.toLowerCase().includes(normalized))
    })
  }, [filter, query, scoped])

  const focused = requirements.find((requirement) => requirement.gate !== null) ?? requirements[0]

  return (
    <div className="pw-screen pw-requirements-list">
      <PageHeader
        title="需求中心"
        description="每条需求独立选择流程、独立拥有文档与 Worktree；当前门禁与下一步始终可见。"
        actions={
          <>
            <Button variant="ghost" onClick={() => onQuery('')} disabled={!query}>清空搜索</Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>创建需求</Button>
          </>
        }
      />

      {state === 'error' ? (
        <div className="pw-error-banner" role="alert">
          <span className="pw-error-icon"><CircleAlert size={16} /></span>
          <div>
            <strong>需求列表读取失败</strong>
            <p>组织作用域校验未通过或服务器不可达。真实产品会保留本地缓存并允许离线查看，演示环境不请求服务器。</p>
          </div>
          <Button variant="ghost" onClick={onRetry}>重试</Button>
        </div>
      ) : null}

      {projectFilter ? (
        <div className="pw-scope-chip">
          <span>项目范围</span>
          <strong>{projectFilter.name}</strong>
          <button type="button" onClick={onClearProject} aria-label="清除项目范围">×</button>
        </div>
      ) : null}

      <Surface
        className="pw-req-surface"
        title="全部需求"
        subtitle="支持按项目、模板和执行状态检索；创建后进入独立旅程"
        toolbar={
          <Segmented
            label="筛选需求"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: '全部', count: counts.all },
              { value: 'active', label: '执行中', count: counts.active },
              { value: 'gate', label: '待审核', count: counts.gate },
              { value: 'delivered', label: '已交付', count: counts.delivered },
            ]}
          />
        }
      >
        <div className="pw-list-toolbar">
          <SearchInput
            value={query}
            onChange={onQuery}
            placeholder="搜索需求标题、ID、负责人或项目"
            label="搜索需求"
          />
          <span className="pw-list-count pw-num">{visible.length} 条结果</span>
        </div>

        {state === 'loading' ? (
          <SkeletonRows rows={6} columns={5} />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={state === 'empty' ? <ListChecks size={20} /> : <SearchX size={20} />}
            title={state === 'empty' ? '还没有需求' : '没有匹配的需求'}
            description={state === 'empty'
              ? '创建第一条需求，选择流程模板并进入独立旅程。'
              : '调整搜索词或切换筛选条件；也可以清除项目范围后查看全部需求。'}
            action={state === 'empty'
              ? <Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>创建需求</Button>
              : <Button variant="ghost" onClick={() => { onQuery(''); setFilter('all'); onClearProject() }}>重置筛选</Button>}
          />
        ) : (
          <RequirementTable requirements={visible} gates={gates} onOpen={onOpenRequirement} />
        )}
      </Surface>

      {focused && state !== 'error' ? (
        <Callout tone={requirementStatus(focused, gates[focused.id]).tone} title={`当前需求：${focused.id} · ${requirementStatus(focused, gates[focused.id]).label}`}>
          <span>
            项目 {projectById(focused.projectId)?.name ?? '—'} · 分支 <span className="pw-mono">{focused.branch}</span> · {focused.nextStep}
          </span>
          <button type="button" className="pw-callout-link" onClick={() => onOpenRequirement(focused.id)}>
            进入需求工作台 <ArrowRight size={12} />
          </button>
        </Callout>
      ) : null}

      <p className="pw-screen-footnote">
        <Badge tone="neutral">DEMO</Badge>
        列表为受控演示数据；创建需求只写入当前原型会话，不写入 SQLite，也不会启动 Agent。
      </p>
    </div>
  )
}
