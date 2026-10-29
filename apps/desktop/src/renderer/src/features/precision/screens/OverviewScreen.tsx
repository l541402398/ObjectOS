import { useState, type ReactNode } from 'react'
import {
  ArrowRight,
  CalendarClock,
  CircleAlert,
  ListFilter,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import {
  ATTENTION,
  STAGES,
  projectsForOrg,
  requirementsForProject,
  type AttentionItem,
  type GateState,
  type RequirementSummary,
} from '../data'
import { ProjectRow, RequirementTable } from '../components'
import type { PrecisionView } from '../navigation'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  IconButton,
  KeyValue,
  Meter,
  PageHeader,
  Segmented,
  SkeletonRows,
  Surface,
} from '../ui'

type OverviewState = 'ready' | 'empty' | 'error' | 'loading'
type StatusFilter = 'all' | 'active' | 'review'

export function OverviewScreen({
  orgId,
  requirements,
  gates,
  state,
  onOpenRequirement,
  onOpenAttention,
  onNavigate,
  onCreate,
  onRetry,
}: {
  orgId: string
  requirements: RequirementSummary[]
  gates: Record<string, GateState>
  state: OverviewState
  onOpenRequirement: (id: string) => void
  onOpenAttention: (item: AttentionItem) => void
  onNavigate: (view: PrecisionView) => void
  onCreate: () => void
  onRetry: () => void
}): ReactNode {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [filterOpen, setFilterOpen] = useState(false)

  const orgRequirements = state === 'empty' ? [] : requirements
  const attention = state === 'empty' ? [] : ATTENTION
  const projects = projectsForOrg(orgId)
  const active = orgRequirements.filter((requirement) => requirement.stageIndex < STAGES.length - 1)
  const delivered = orgRequirements.filter((requirement) => requirement.stageIndex === STAGES.length - 1)
  const pendingDecisions = attention.length

  const visible = filter === 'active'
    ? active
    : filter === 'review'
      ? orgRequirements.filter((requirement) => requirement.gate !== null)
      : orgRequirements

  const loading = state === 'loading'

  return (
    <div className="pw-screen pw-overview" data-state={state}>
      {state === 'error' ? (
        <div className="pw-error-banner" role="alert">
          <span className="pw-error-icon"><CircleAlert size={16} /></span>
          <div>
            <strong>无法读取组织数据</strong>
            <p>组织会话已失效（ORG_FORBIDDEN）。真实产品会重新校验成员身份并保留本地未提交的工作；演示环境不请求服务器。</p>
          </div>
          <button type="button" className="pw-btn pw-btn--ghost pw-btn--sm" onClick={onRetry}>重试读取</button>
        </div>
      ) : null}

      <PageHeader
        title="研发工作台"
        description={`今天有 ${active.length} 项需求在推进，${pendingDecisions} 项决策等待你的确认。`}
        actions={
          <>
            <Button
              variant="ghost"
              icon={<ListFilter size={14} />}
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((open) => !open)}
            >
              筛选
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>创建需求</Button>
          </>
        }
      />

      {filterOpen ? (
        <div className="pw-filter-bar">
          <Segmented
            label="按状态筛选需求"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: '全部', count: orgRequirements.length },
              { value: 'active', label: '进行中', count: active.length },
              { value: 'review', label: '待审核', count: orgRequirements.filter((item) => item.gate !== null).length },
            ]}
          />
          <span className="pw-filter-hint">筛选只影响当前视图，不改变需求状态。</span>
          <IconButton label="关闭筛选" active={false} onClick={() => setFilterOpen(false)}>
            <span aria-hidden="true">×</span>
          </IconButton>
        </div>
      ) : null}

      <div className="pw-metrics" role="group" aria-label="组织研发指标">
        <div className="pw-metric">
          <span className="pw-metric-label">活跃项目</span>
          <strong className="pw-metric-value pw-num">{String(projects.length).padStart(2, '0')}</strong>
          <span className="pw-metric-foot">{state === 'empty' ? '当前演示为空态' : `${projects.filter((project) => project.status === '进行中').length} 个项目有进行中的需求`}</span>
        </div>
        <div className="pw-metric">
          <span className="pw-metric-label">进行中的需求</span>
          <strong className="pw-metric-value pw-num">{String(active.length).padStart(2, '0')}</strong>
          <span className="pw-metric-foot">{orgRequirements.length - active.length} 条需求已交付或归档</span>
        </div>
        <div className="pw-metric">
          <span className="pw-metric-label">等待我的决策</span>
          <strong className={`pw-metric-value pw-num${pendingDecisions > 0 ? ' is-warn' : ''}`}>{String(pendingDecisions).padStart(2, '0')}</strong>
          <span className="pw-metric-foot">{pendingDecisions > 0 ? '设计审核 · 资产授权' : '当前没有待处理门禁'}</span>
        </div>
        <div className="pw-metric">
          <span className="pw-metric-label">已验证交付</span>
          <strong className="pw-metric-value pw-num">{String(delivered.length).padStart(2, '0')}</strong>
          <span className="pw-metric-foot">包含合并后的真实回归证据</span>
        </div>
      </div>

      <div className="pw-overview-grid">
        <div className="pw-overview-main">
          <Surface
            title="正在推进的需求"
            subtitle="跨项目查看真实执行状态与当前责任人"
            toolbar={
              <button type="button" className="pw-link" onClick={() => onNavigate('requirements')}>
                查看全部 <ArrowRight size={13} aria-hidden="true" />
              </button>
            }
          >
            {loading ? (
              <SkeletonRows rows={5} columns={5} />
            ) : state === 'error' ? (
              <EmptyState
                icon={<CircleAlert size={20} />}
                title="数据不可用"
                description="重试后仍失败时会保留本地工作，并提示检查组织权限与网络。"
                action={<Button variant="ghost" onClick={onRetry}>重试读取</Button>}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<Sparkles size={20} />}
                title={state === 'empty' ? '还没有需求' : '没有符合筛选的需求'}
                description={state === 'empty'
                  ? '创建第一条需求后，项目旅程、执行与门禁会从这里开始。'
                  : '清空筛选，或从需求中心查看全部需求。'}
                action={state === 'empty' ? <Button variant="primary" onClick={onCreate}>创建需求</Button> : <Button variant="ghost" onClick={() => setFilter('all')}>查看全部</Button>}
              />
            ) : (
              <RequirementTable
                requirements={visible.slice(0, 5)}
                gates={gates}
                onOpen={onOpenRequirement}
                compact
              />
            )}
          </Surface>

          <Surface
            title="我的项目"
            subtitle="你参与的项目与工作分支"
            toolbar={
              <button type="button" className="pw-link" onClick={() => onNavigate('projects')}>
                项目中心 <ArrowRight size={13} aria-hidden="true" />
              </button>
            }
          >
            <div className="pw-project-list">
              {projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  requirementCount={state === 'empty' ? 0 : requirementsForProject(project.id).length}
                  onOpen={() => onNavigate('projects')}
                />
              ))}
            </div>
          </Surface>
        </div>

        <aside className="pw-overview-rail" aria-label="待办与执行状态">
          <Surface title="需要你处理" subtitle="系统已完成可自动推进的部分">
            {attention.length === 0 ? (
              <div className="pw-rail-empty">
                <ShieldCheck size={18} />
                <span>没有等待你的门禁</span>
              </div>
            ) : (
              <div className="pw-attention-list">
                {attention.map((item) => (
                  <button type="button" key={item.id} className="pw-attention" onClick={() => onOpenAttention(item)}>
                    <span className={`pw-attention-icon is-${item.tone}`}>
                      {item.kind === 'gate' ? <ShieldCheck size={15} /> : <Users size={15} />}
                    </span>
                    <span className="pw-attention-copy">
                      <strong>{item.title}</strong>
                      <small>{item.meta}</small>
                    </span>
                    <ArrowRight size={13} aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
            <Button
              variant="ghost"
              className="pw-block"
              trailing={<ArrowRight size={13} />}
              disabled={attention.length === 0}
              onClick={() => {
                const first = attention[0]
                if (first) onOpenAttention(first)
              }}
            >
              打开审批中心
            </Button>
          </Surface>

          <Surface title="AI / Worker 状态" subtitle="隔离执行，不继承组织管理员权限">
            <KeyValue
              dense
              rows={[
                { label: 'Local Worker', value: <span className="pw-inline-ok"><i />已连接</span> },
                { label: '运行中的 Agent', value: <span className="pw-num">{state === 'empty' ? '00 / 08' : '03 / 08'}</span> },
                { label: '今日已完成任务', value: <span className="pw-num">{state === 'empty' ? '0' : '19'}</span> },
                { label: '本周可用性', value: <span className="pw-num">{state === 'empty' ? '—' : '99.6%'}</span> },
              ]}
            />
            <div className="pw-worker-meter">
              <Meter value={state === 'empty' ? 0 : 73} label="本周执行容量使用率" />
              <span className="pw-meter-caption"><CalendarClock size={11} /> {state === 'empty' ? '当前没有执行任务' : '本周容量已使用 73%'}</span>
            </div>
            <Callout tone="accent" title="接下来">
              完成 REQ-124 设计审核后，系统才会在既定授权范围内创建执行计划、Worktree 与 Agent Run。
            </Callout>
          </Surface>
        </aside>
      </div>

      <p className="pw-screen-footnote">
        <Badge tone="neutral">DEMO</Badge>
        本页为 A0 设计母版：使用演示数据验证信息架构与交互，不读取真实 SQLite，也不创建需求或启动 Agent。
      </p>
    </div>
  )
}
