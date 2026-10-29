import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  Circle,
  CircleDashed,
  Clock,
  FileText,
  GitBranch,
  GitMerge,
  Hash,
  LockKeyhole,
  MessageSquare,
  Play,
  SearchX,
  ShieldCheck,
  Sparkles,
  CircleAlert,
  TestTube2,
  UserRound,
} from 'lucide-react'
import {
  STAGES,
  projectById,
  requirementStatus,
  stageLabel,
  type AuditEvent,
  type GateState,
  type RequirementSummary,
} from '../data'
import {
  Badge,
  Button,
  Callout,
  CopyButton,
  EmptyState,
  KeyValue,
  SearchInput,
  Segmented,
  SkeletonRows,
  Surface,
  Tabs,
} from '../ui'

type ReqTab = 'overview' | 'document' | 'execution' | 'evidence'
type DocMode = 'requirement' | 'design'
type ReqState = 'ready' | 'empty' | 'error' | 'loading'

const TAB_LABELS: { value: ReqTab; label: string }[] = [
  { value: 'overview', label: '概览' },
  { value: 'document', label: '需求与设计' },
  { value: 'execution', label: '执行' },
  { value: 'evidence', label: '证据' },
]

function actorIcon(kind: AuditEvent['actorKind']): ReactNode {
  if (kind === 'human') return <UserRound size={13} />
  if (kind === 'agent') return <Sparkles size={13} />
  return <Activity size={13} />
}

function Timeline({ events }: { events: AuditEvent[] }): ReactNode {
  return (
    <ol className="pw-timeline">
      {events.map((event) => (
        <li key={event.id} className="pw-timeline-item">
          <span className="pw-timeline-rail" aria-hidden="true">
            <i className={`pw-timeline-icon is-${event.actorKind}`}>{actorIcon(event.actorKind)}</i>
          </span>
          <div className="pw-timeline-body">
            <div className="pw-timeline-head">
              <strong>{event.action}</strong>
              <span className="pw-timeline-time pw-mono">{event.time}</span>
            </div>
            {event.detail ? <p>{event.detail}</p> : null}
            <span className="pw-timeline-actor">{event.actor}</span>
          </div>
        </li>
      ))}
    </ol>
  )
}

function StageJourney({ index, gateApproved }: { index: number; gateApproved: boolean }): ReactNode {
  const active = gateApproved && index === 3 ? 4 : index
  return (
    <ol className="pw-mini-journey" aria-label="需求阶段">
      {STAGES.map((stage, stageIndex) => {
        const state = stageIndex < active ? 'done' : stageIndex === active ? 'active' : 'future'
        return (
          <li key={stage.id} className={`pw-mini-step is-${state}`}>
            <i aria-hidden="true">{stageIndex < active ? <Check size={10} /> : null}</i>
            <span>{stage.label}</span>
          </li>
        )
      })}
    </ol>
  )
}

function DocSection({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <section className="pw-doc-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function RequirementDoc({ requirement }: { requirement: RequirementSummary }): ReactNode {
  return (
    <article className="pw-doc" aria-label="需求文档">
      <div className="pw-doc-meta">
        <span className="pw-doc-version pw-mono">文档 v1.1</span>
        <span>内容已冻结</span>
        <span className="pw-mono">sha256:2b71c0aa…</span>
        <span>最后编辑 10:18</span>
      </div>
      <DocSection title="背景与问题">
        <p>{requirement.goal}</p>
        <p>
          当前项目把计划、运行与交付状态分散在多处，人工审批与真实证据之间缺少强绑定。需求进入执行后，
          文档修订、审批结论与代码快照可能互相脱节，导致“看起来完成、实际未验证”。本需求把这条链路收敛到可复核的门禁上。
        </p>
      </DocSection>
      <DocSection title="范围">
        <ul>
          {requirement.scope.map((item) => <li key={item}>{item}</li>)}
        </ul>
      </DocSection>
      <DocSection title="验收标准">
        <ul className="pw-acceptance">
          {requirement.acceptance.map((item) => (
            <li key={item.id} className={item.met ? 'is-met' : ''}>
              {item.met ? <CheckCircle2 size={14} /> : <Circle size={14} />}
              <span>{item.text}</span>
              <em>{item.met ? '已验证' : '待验证'}</em>
            </li>
          ))}
        </ul>
      </DocSection>
      <DocSection title="风险与回滚">
        <p>
          门禁证据与内容 hash 绑定；文档修订后旧审批自动失效。若发现设计不可行，保留已产生的 Run 与证据，
          回到上一个已通过阶段并重新生成设计，不删除历史记录。
        </p>
      </DocSection>
    </article>
  )
}

function DesignDoc({ requirement, gate }: { requirement: RequirementSummary; gate?: GateState }): ReactNode {
  if (requirement.id !== 'REQ-124') {
    return (
      <EmptyState
        icon={<FileText size={20} />}
        title="设计文档尚未生成"
        description="该需求还没有到达「技术设计」阶段，或流程模板未要求设计文档。设计文档生成后会在这里以冻结版本呈现。"
      />
    )
  }
  return (
    <article className="pw-doc" aria-label="设计文档">
      <div className="pw-doc-meta">
        <span className="pw-doc-version pw-mono">设计 v1.2</span>
        <span>等待审核</span>
        <span className="pw-mono">sha256:9f2c41d8…</span>
        <span>Sage · 10:28</span>
      </div>
      <DocSection title="设计目标">
        <p>
          在不改变现有 Planner、Scheduler、AgentRunner、Review 与 Worktree 实现的前提下，增加需求级旅程投影与门禁证据绑定。
          门禁只读取真实证据，不把“任务完成”当作“审核通过”。
        </p>
      </DocSection>
      <DocSection title="关键决策">
        <div className="pw-doc-table">
          <div className="pw-doc-table-head"><span>决策</span><span>取舍</span></div>
          <div><span>门禁以内容 hash 绑定</span><span>文档修订使旧审批失效，避免复用过期结论</span></div>
          <div><span>计划在批准后创建</span><span>门禁未过时不产生空转 Run 与无意义费用</span></div>
          <div><span>Worktree 由需求拥有</span><span>每条需求独立分支，不复制整套源码</span></div>
        </div>
      </DocSection>
      <DocSection title="影响面">
        <ul>
          <li><span className="pw-mono">apps/runtime/src/orchestration.ts</span> — 计划创建前增加门禁检查</li>
          <li><span className="pw-mono">packages/planning</span> — 计划 lineage 绑定需求与模板版本</li>
          <li><span className="pw-mono">packages/worktree</span> — 需求级 Worktree 与 baseCommit 记录</li>
          <li><span className="pw-mono">renderer</span> — 需求旅程读取同一份状态投影</li>
        </ul>
      </DocSection>
      <DocSection title="测试与回滚">
        <p>
          单元测试覆盖门禁证据 hash 失效；集成测试覆盖“批准后恢复执行”；真实 Electron E2E 覆盖审批抽屉与旅程推进。
          回滚时保留既有迁移与证据，仅关闭新的门禁读取路径，不删除用户数据。
        </p>
      </DocSection>
      {gate?.status === 'changes' && gate.note ? (
        <div className="pw-doc-note">
          <strong>修改要求</strong>
          <p>{gate.note}</p>
        </div>
      ) : null}
    </article>
  )
}

export function RequirementWorkspace({
  requirements,
  gates,
  selectedId,
  state,
  initialTab = 'overview',
  onSelect,
  onBack,
  onOpenApproval,
  onToast,
  onRetry,
  onNavigateRuns,
}: {
  requirements: RequirementSummary[]
  gates: Record<string, GateState>
  selectedId: string | null
  state: ReqState
  initialTab?: ReqTab
  onSelect: (id: string) => void
  onBack: () => void
  onOpenApproval: (requirement: RequirementSummary) => void
  onToast: (message: string) => void
  onRetry: () => void
  onNavigateRuns: () => void
}): ReactNode {
  const [tab, setTab] = useState<ReqTab>(initialTab)
  const [docMode, setDocMode] = useState<DocMode>('requirement')
  const [listQuery, setListQuery] = useState('')

  const selected = requirements.find((requirement) => requirement.id === selectedId) ?? requirements[0] ?? null

  useEffect(() => {
    setTab(initialTab)
    setDocMode('requirement')
  }, [initialTab, selectedId])

  const filtered = useMemo(() => {
    const normalized = listQuery.trim().toLowerCase()
    if (!normalized) return requirements
    return requirements.filter((requirement) =>
      [requirement.id, requirement.title, requirement.owner].some((value) => value.toLowerCase().includes(normalized)),
    )
  }, [listQuery, requirements])

  const needsYou = filtered.filter((requirement) => requirement.gate && gates[requirement.id]?.status !== 'approved' && gates[requirement.id]?.status !== 'changes')
  const others = filtered.filter((requirement) => !needsYou.includes(requirement))

  if (!selected || state === 'empty') {
    return (
      <div className="pw-screen pw-requirement is-empty">
        <EmptyState
          icon={<FileText size={22} />}
          title="还没有可打开的需求"
          description="需求创建后会拥有独立的文档、执行计划与门禁。先回到需求中心创建或选择一条需求。"
          action={<Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={onBack}>返回需求中心</Button>}
        />
      </div>
    )
  }

  const project = projectById(selected.projectId)
  const gate = gates[selected.id]
  const status = requirementStatus(selected, gate)
  const gateApproved = gate?.status === 'approved'
  const effectiveStage = gateApproved && selected.stageIndex === 3 ? 4 : selected.stageIndex
  const pending = selected.gate !== null && gate?.status === undefined
  const decided = gate !== undefined

  return (
    <div className="pw-screen pw-requirement" data-state={state}>
      {state === 'error' ? (
        <div className="pw-error-banner is-inline" role="alert">
          <span className="pw-error-icon"><CircleAlert size={16} /></span>
          <div>
            <strong>需求上下文读取失败</strong>
            <p>组织会话或项目权限校验未通过。真实产品会保留本地缓存并阻止执行，演示环境不请求服务器。</p>
          </div>
          <Button variant="ghost" onClick={onRetry}>重试读取</Button>
        </div>
      ) : null}
      <header className="pw-req-head">
        <div className="pw-req-heading">
          <button type="button" className="pw-back" onClick={onBack}>
            <ArrowLeft size={14} /> 需求中心
          </button>
          <div className="pw-req-title-line">
            <span className="pw-id-chip pw-mono">{selected.id}</span>
            <h1>{selected.title}</h1>
            <Badge tone={status.tone} dot>{status.label}</Badge>
          </div>
          <div className="pw-req-meta">
            <span>{project?.name ?? '未归属项目'}</span>
            <span className="pw-meta-sep">·</span>
            <span className="pw-mono">{selected.branch}</span>
            <span className="pw-meta-sep">·</span>
            <span>{selected.template}</span>
            <span className="pw-meta-sep">·</span>
            <span>负责人 {selected.owner}</span>
          </div>
        </div>
        <div className="pw-req-actions">
          <CopyButton text={selected.branch} label="复制分支" onCopied={() => onToast('已复制分支名到剪贴板')} />
          <Button
            variant={pending ? 'primary' : 'ghost'}
            icon={pending ? <ShieldCheck size={14} /> : <MessageSquare size={14} />}
            onClick={() => onOpenApproval(selected)}
          >
            {pending ? '打开审批' : decided ? '查看审批记录' : '查看阶段说明'}
          </Button>
        </div>
      </header>

      <div className="pw-req-grid">
        <aside className="pw-req-list" aria-label="需求列表">
          <div className="pw-req-list-head">
            <SearchInput value={listQuery} onChange={setListQuery} placeholder="在此项目中搜索" label="搜索当前项目需求" />
            <span className="pw-req-list-count pw-num">{filtered.length} 条</span>
          </div>
          <div className="pw-req-list-scroll">
            {needsYou.length > 0 ? (
              <div className="pw-req-group">
                <div className="pw-req-group-label">需要你处理 <span>{needsYou.length}</span></div>
                {needsYou.map((requirement) => {
                  const itemStatus = requirementStatus(requirement, gates[requirement.id])
                  return (
                    <button
                      key={requirement.id}
                      type="button"
                      className={`pw-req-item${requirement.id === selected.id ? ' is-selected' : ''}`}
                      onClick={() => onSelect(requirement.id)}
                    >
                      <span className="pw-req-item-top">
                        <span className="pw-mono">{requirement.id}</span>
                        <Badge tone={itemStatus.tone} dot>{itemStatus.label}</Badge>
                      </span>
                      <strong>{requirement.title}</strong>
                      <span className="pw-req-item-foot">
                        <span>{projectById(requirement.projectId)?.key}</span>
                        <span className="pw-meta-sep">·</span>
                        <span>{requirement.owner}</span>
                        <span className="pw-req-item-time pw-num">{requirement.updated}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}
            <div className="pw-req-group">
              <div className="pw-req-group-label">全部需求 <span>{others.length}</span></div>
              {others.map((requirement) => {
                return (
                  <button
                    key={requirement.id}
                    type="button"
                    className={`pw-req-item${requirement.id === selected.id ? ' is-selected' : ''}`}
                    onClick={() => onSelect(requirement.id)}
                  >
                    <span className="pw-req-item-top">
                      <span className="pw-mono">{requirement.id}</span>
                      <span className="pw-req-stage">{stageLabel(requirement.stageIndex)}</span>
                    </span>
                    <strong>{requirement.title}</strong>
                    <span className="pw-req-item-foot">
                      <span>{projectById(requirement.projectId)?.key}</span>
                      <span className="pw-meta-sep">·</span>
                      <span>{requirement.owner}</span>
                      <span className="pw-req-item-time pw-num">{requirement.updated}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            {filtered.length === 0 ? (
              <div className="pw-req-list-empty">
                <SearchX size={16} />
                <span>没有匹配的需求</span>
                <button type="button" onClick={() => setListQuery('')}>清空搜索</button>
              </div>
            ) : null}
          </div>
        </aside>

        <main className="pw-req-center">
          <div className="pw-req-tabs">
            <Tabs label="需求视图" value={tab} tabs={TAB_LABELS} onChange={setTab} />
            <span className="pw-req-tabs-note">
              <Clock size={12} /> 最近更新 {selected.updated}
            </span>
          </div>

          <div className="pw-req-center-scroll">
            {state === 'loading' ? <SkeletonRows rows={8} columns={3} /> : null}

            {state !== 'loading' && tab === 'overview' ? (
              <div className="pw-overview-detail">
                <section className="pw-detail-block">
                  <h2>目标</h2>
                  <p className="pw-detail-goal">{selected.goal}</p>
                </section>

                <section className="pw-detail-block is-split">
                  <div>
                    <h2>范围</h2>
                    <ul className="pw-bullet-list">
                      {selected.scope.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                  <div>
                    <h2>验收标准</h2>
                    <ul className="pw-acceptance is-compact">
                      {selected.acceptance.map((item) => (
                        <li key={item.id} className={item.met ? 'is-met' : ''}>
                          {item.met ? <CheckCircle2 size={13} /> : <Circle size={13} />}
                          <span>{item.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>

                <section className="pw-detail-block">
                  <div className="pw-block-head">
                    <h2>阶段与门禁</h2>
                    <span className="pw-block-hint">当前 {stageLabel(effectiveStage)}</span>
                  </div>
                  <StageJourney index={selected.stageIndex} gateApproved={gateApproved} />
                  <div className={`pw-gate-strip is-${gate ? gate.status : 'none'}`}>
                    {selected.gate ? (
                      <>
                        <span className="pw-gate-strip-icon">
                          {gateApproved ? <CheckCircle2 size={16} /> : gate?.status === 'changes' ? <MessageSquare size={16} /> : <ShieldCheck size={16} />}
                        </span>
                        <div>
                          <strong>{selected.gate.title} · {gateApproved ? '已批准' : gate?.status === 'changes' ? '需要修改' : '等待处理'}</strong>
                          <p>
                            {gateApproved
                              ? `${gate?.decidedBy ?? '项目 Maintainer'} 于 ${gate?.decidedAt ?? '刚刚'} 批准，证据绑定内容 hash ${selected.gate.hash}。`
                              : gate?.status === 'changes'
                                ? gate.note ?? '审批人要求修改设计文档后再提交。'
                                : `由${selected.gate.role}审核 ${selected.gate.docVersion}（${selected.gate.hash}）。`}
                          </p>
                        </div>
                        <Button variant={pending ? 'primary' : 'ghost'} onClick={() => onOpenApproval(selected)}>
                          {pending ? '处理审批' : '查看记录'}
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="pw-gate-strip-icon"><CircleDashed size={16} /></span>
                        <div>
                          <strong>当前阶段没有人工门禁</strong>
                          <p>{selected.nextStep}</p>
                        </div>
                        <Badge tone="neutral">无阻断</Badge>
                      </>
                    )}
                  </div>
                </section>

                <section className="pw-detail-block">
                  <div className="pw-block-head">
                    <h2>最近事件</h2>
                    <button type="button" className="pw-link" onClick={onNavigateRuns}>运行中心 <ArrowRight size={12} /></button>
                  </div>
                  {decided ? (
                    <div className={`pw-decision-note is-${gate?.status}`}>
                      <Check size={13} />
                      <span>
                        你于{gate?.decidedAt ?? '刚刚'}{gate?.status === 'approved' ? '批准了' : '要求修改'}「{selected.gate?.title}」
                        {gate?.note ? `：${gate.note}` : ''}
                      </span>
                    </div>
                  ) : null}
                  <Timeline events={selected.events} />
                </section>
              </div>
            ) : null}

            {state !== 'loading' && tab === 'document' ? (
              <div className="pw-doc-view">
                <div className="pw-doc-toolbar">
                  <Segmented
                    label="文档类型"
                    value={docMode}
                    onChange={setDocMode}
                    options={[
                      { value: 'requirement', label: '需求文档' },
                      { value: 'design', label: '设计文档' },
                    ]}
                  />
                  <span className="pw-doc-toolbar-note">
                    <LockKeyhole size={12} /> 版本冻结后审批才可提交
                  </span>
                </div>
                {docMode === 'requirement'
                  ? <RequirementDoc requirement={selected} />
                  : <DesignDoc requirement={selected} gate={gate} />}
              </div>
            ) : null}

            {state !== 'loading' && tab === 'execution' ? (
              <div className="pw-exec">
                {!gateApproved && selected.gate ? (
                  <div className="pw-exec-blocked" role="status">
                    <span className="pw-exec-blocked-icon"><LockKeyhole size={16} /></span>
                    <div>
                      <strong>执行被门禁阻塞：{selected.gate.title}</strong>
                      <p>计划草稿不会创建任务、Worktree 写入或 Agent Run。批准后系统才请求执行授权。</p>
                    </div>
                    <Button variant="primary" onClick={() => onOpenApproval(selected)}>处理审批</Button>
                  </div>
                ) : (
                  <div className="pw-exec-ready">
                    <span><CheckCircle2 size={16} /></span>
                    <div>
                      <strong>{gateApproved ? '门禁已通过，执行计划就绪' : '计划尚未开始'}</strong>
                      <p>{gateApproved ? '计划与 Worktree 仍未创建；真实执行需要 Worker 专用授权。' : selected.nextStep}</p>
                    </div>
                    <Button
                      variant="ghost"
                      icon={<Play size={13} />}
                      onClick={() => onToast('原型说明：A0 不启动真实 Agent，也不写入本地文件')}
                    >
                      开始执行（原型）
                    </Button>
                  </div>
                )}

                <section className="pw-detail-block">
                  <div className="pw-block-head">
                    <h2>执行计划草稿</h2>
                    <Badge tone="neutral">4 个阶段 · 11 项任务</Badge>
                  </div>
                  <ol className="pw-phase-list">
                    {[
                      { name: '设计与评审', tasks: 4, state: 'done', note: '设计文档 v1.2 已冻结，等待门禁' },
                      { name: '实现与自测', tasks: 6, state: gateApproved ? 'ready' : 'blocked', note: gateApproved ? '可以创建 Worktree 与开发任务' : '等待设计审核门禁' },
                      { name: '真实测试与构建', tasks: 3, state: 'blocked', note: '需要当前代码快照与命令退出码' },
                      { name: '独立审查与交付', tasks: 2, state: 'blocked', note: 'Review 快照不可过期复用' },
                    ].map((phase, index) => (
                      <li key={phase.name} className={`pw-phase is-${phase.state}`}>
                        <span className="pw-phase-index pw-mono">{String(index + 1).padStart(2, '0')}</span>
                        <div className="pw-phase-copy">
                          <strong>{phase.name}</strong>
                          <small>{phase.note}</small>
                        </div>
                        <span className="pw-phase-tasks pw-num">{phase.tasks} 项</span>
                        <Badge tone={phase.state === 'done' ? 'ok' : phase.state === 'ready' ? 'accent' : 'neutral'} dot>
                          {phase.state === 'done' ? '已完成' : phase.state === 'ready' ? '可开始' : '被阻塞'}
                        </Badge>
                      </li>
                    ))}
                  </ol>
                </section>

                <div className="pw-exec-cards">
                  <Surface title="执行 Agent" subtitle="组织资产 · 版本已冻结">
                    <div className="pw-agent-line">
                      <span className="pw-agent-mark">S</span>
                      <div><strong>Sage</strong><small>架构 Agent · 负责设计与影响面分析</small></div>
                      <Badge tone="ok" dot>已发布</Badge>
                    </div>
                    <KeyValue
                      dense
                      rows={[
                        { label: '资产版本', value: <span className="pw-mono">v1.9.3</span> },
                        { label: 'Skill 快照', value: <span className="pw-mono">sha256:4c11…</span> },
                        { label: '工具权限', value: '只读项目 · 无 Shell' },
                      ]}
                    />
                  </Surface>
                  <Surface title="执行节点" subtitle="本机 Local Worker">
                    <KeyValue
                      dense
                      rows={[
                        { label: '节点', value: 'local-bruce-win' },
                        { label: '工作区引用', value: <span className="pw-mono">ws://req/124</span> },
                        { label: '写租约', value: '未申请' },
                        { label: '预算', value: '未分配' },
                      ]}
                    />
                    <Callout tone="neutral">组织管理员不会自动获得本机文件与命令执行权，Worker 会在本机再次校验授权。</Callout>
                  </Surface>
                </div>
              </div>
            ) : null}

            {state !== 'loading' && tab === 'evidence' ? (
              <div className="pw-evidence">
                <div className="pw-evidence-head">
                  <div>
                    <h2>证据链</h2>
                    <p>门禁只接受当前内容快照对应的真实证据；任务完成不等于审核通过。</p>
                  </div>
                  <Badge tone="neutral">{selected.evidence.length} 项</Badge>
                </div>
                <div className="pw-evidence-list">
                  {selected.evidence.map((item) => (
                    <div className="pw-evidence-item" key={item.id}>
                      <span className={`pw-evidence-icon is-${item.status === 'PASS' ? 'ok' : item.status === 'FAIL' ? 'danger' : 'neutral'}`}>
                        {item.kind === '测试' ? <TestTube2 size={15} /> : item.kind === 'Diff' ? <GitMerge size={15} /> : item.kind === 'Review' ? <ShieldCheck size={15} /> : <FileText size={15} />}
                      </span>
                      <div className="pw-evidence-copy">
                        <strong>{item.title}</strong>
                        <span>{item.kind} · {item.time}</span>
                      </div>
                      <span className="pw-evidence-hash pw-mono">
                        <Hash size={11} /> {item.hash}
                      </span>
                      <Badge tone={item.status === 'PASS' ? 'ok' : item.status === 'FAIL' ? 'danger' : 'neutral'} dot>{item.status}</Badge>
                      {item.hash !== '—' ? <CopyButton text={item.hash} label="复制" onCopied={() => onToast('已复制证据 hash')} /> : null}
                    </div>
                  ))}
                </div>
                <Callout tone="warn" title="为什么开发阶段证据是空的">
                  设计审核未通过前，系统不会创建执行计划，因此不存在测试与构建证据。这是刻意的门禁行为，不是加载失败。
                </Callout>
              </div>
            ) : null}
          </div>
        </main>

        <aside className="pw-req-inspector" aria-label="需求上下文">
          <div className="pw-inspector-scroll">
            <section className="pw-inspector-block">
              <div className="pw-inspector-head">
                <h2>{selected.gate ? '当前门禁' : '当前阶段'}</h2>
                {selected.gate ? <Badge tone={gateApproved ? 'ok' : gate?.status === 'changes' ? 'danger' : 'warn'} dot>{gateApproved ? '已批准' : gate?.status === 'changes' ? '需修改' : '待处理'}</Badge> : <Badge tone="neutral">无门禁</Badge>}
              </div>
              {selected.gate ? (
                <>
                  <div className="pw-gate-title">
                    <ShieldCheck size={15} />
                    <div><strong>{selected.gate.title}</strong><span>{selected.gate.role}</span></div>
                  </div>
                  <KeyValue
                    dense
                    rows={[
                      { label: '文档版本', value: selected.gate.docVersion, mono: true },
                      { label: '内容 hash', value: selected.gate.hash, mono: true },
                      { label: '审批策略', value: '单人批准 · 组织强制' },
                    ]}
                  />
                  <div className="pw-gate-requirements">
                    <span className="pw-gate-requirements-label">审批范围</span>
                    <ul>
                      {selected.gate.required.map((item) => (
                        <li key={item} className={gateApproved ? 'is-met' : ''}>
                          {gateApproved ? <CheckCircle2 size={12} /> : <Circle size={12} />}
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {decided ? (
                    <div className="pw-decision-card">
                      <div className="pw-decision-head">
                        <span className={`pw-decision-dot is-${gate?.status}`} />
                        <strong>{gate?.status === 'approved' ? '已批准' : '要求修改'}</strong>
                        <span className="pw-mono">{gate?.decidedAt ?? '刚刚'}</span>
                      </div>
                      <p>{gate?.decidedBy ?? '项目 Maintainer'} · {gate?.note ?? (gate?.status === 'approved' ? '证据与当前内容快照一致。' : '请修订设计文档后重新提交。')}</p>
                    </div>
                  ) : null}
                  <div className="pw-inspector-actions">
                    <Button variant="primary" onClick={() => onOpenApproval(selected)}>
                      {pending ? '审批此门禁' : '查看审批记录'}
                    </Button>
                    <Button variant="ghost" onClick={() => onOpenApproval(selected)}>
                      {pending ? '要求修改' : '查看范围'}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="pw-gate-none">
                  <CircleDashed size={18} />
                  <p>{selected.nextStep}</p>
                </div>
              )}
            </section>

            <section className="pw-inspector-block">
              <h2>负责人 · Agent</h2>
              <div className="pw-person-line">
                <span className="pw-person-avatar">{selected.ownerInitial}</span>
                <div><strong>{selected.owner}</strong><small>项目 Maintainer · 人类审批人</small></div>
              </div>
              <div className="pw-person-line">
                <span className="pw-person-avatar is-agent"><Bot size={14} /></span>
                <div><strong>Sage</strong><small>架构 Agent · 当前执行者</small></div>
              </div>
            </section>

            <section className="pw-inspector-block">
              <h2>分支与工作区</h2>
              <div className="pw-branch-line">
                <GitBranch size={13} />
                <span className="pw-mono">{selected.branch}</span>
                <CopyButton text={selected.branch} label="" onCopied={() => onToast('已复制分支名')} />
              </div>
              <KeyValue
                dense
                rows={[
                  { label: 'base commit', value: <span className="pw-mono">{selected.baseCommit}</span> },
                  { label: 'Worktree', value: <span className="pw-mono">req/124 / 未写入</span> },
                  { label: '流程模板', value: `${selected.template} · 已冻结` },
                ]}
              />
            </section>

            <Callout tone="accent" title="下一步">
              {gateApproved ? '设计已批准。可以创建执行计划与需求级 Worktree；本机执行仍需 Worker 授权。' : selected.nextStep}
            </Callout>

            {selected.gate ? (
              <div className="pw-inspector-foot">
                <LockKeyhole size={12} />
                <span>组织强制门禁不能被流程模板隐式跳过；审批记录写入审计事件。</span>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  )
}
