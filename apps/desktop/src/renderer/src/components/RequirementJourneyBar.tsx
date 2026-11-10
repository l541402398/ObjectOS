import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button, Dropdown, Select } from 'antd'
import { ArrowRightOutlined, MoreOutlined } from '@ant-design/icons'
import type {
  RequirementFlowBinding,
  RequirementFlowGraph,
  RequirementFlowNode,
  RequirementFlowView,
  TaskFlow,
} from '@projectos/contracts'
import { useRequirements, useTaskBoard } from '../lib/queries'
import { useUiStore } from '../stores/ui'
import { currentPageKey } from '../page-registry'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from '../next-ui/overlay/overlay-shell'
import { RequirementMaterials } from '../pages/RequirementMaterials'
import { GoalJourneyBar } from './GoalJourneyBar'
import '../pages/requirement-flow.css'
import './journey.css'

export interface StageAggregation {
  nodeId: string
  title: string
  stage: RequirementFlowNode['stage']
  total: number
  completed: number
  stale: number
  running: number
  waitingApproval: number
  waitingReview: number
  failed: number
  ready: number
  notStarted: number
  allCompleted: boolean
  stateClass: string
  label: string
}

export function summarizeStage(node: RequirementFlowNode, taskFlows: TaskFlow[]): StageAggregation {
  const steps = taskFlows.flatMap((task) => task.steps.filter((step) => step.nodeId === node.id))
  const total = steps.length
  const isReview = ['requirement_review', 'design_review', 'code_review'].includes(node.stage)
  const completed = steps.filter((step) => step.status === 'completed' && !step.stale).length
  const stale = steps.filter((step) => step.status === 'completed' && step.stale).length
  const running = steps.filter((step) => step.status === 'starting' || step.status === 'running').length
  const waitingApproval = steps.filter((step) => step.status === 'waiting_approval').length
  const failed = steps.filter((step) => step.status === 'failed' || step.status === 'needs_reconciliation').length
  const ready = steps.filter((step) => step.status === 'ready').length
  const pending = steps.filter((step) => step.status === 'pending').length
  const waitingReview = isReview ? ready + running + waitingApproval : 0
  const notStarted = isReview ? pending : pending + ready
  const active = running > 0 || waitingApproval > 0
  // Never claim full stage completion unless every task in the requirement has validly completed this node.
  const allCompleted = total > 0 && completed === total

  const stateClass = failed > 0
    ? 'is-failed'
    : stale > 0
      ? 'is-stale'
      : active
        ? 'is-active'
        : allCompleted
          ? 'is-complete'
          : completed > 0
            ? 'is-partial'
            : ''

  let label = '尚未开始'
  if (total === 1) {
    if (failed > 0) label = '需要处理'
    else if (stale > 0) label = isReview ? '旧审核已失效' : '已过期需重跑'
    else if (active) label = '正在进行'
    else if (allCompleted) label = '1/1 已完成'
    else if (isReview && ready > 0) label = '待审核'
    else label = '尚未开始'
  } else if (total > 1) {
    if (allCompleted) {
      label = `${completed}/${total} 已完成`
    } else if (
      completed === 0 &&
      running === 0 &&
      waitingApproval === 0 &&
      failed === 0 &&
      stale === 0 &&
      (!isReview || ready === 0)
    ) {
      label = `尚未开始 (${total})`
    } else {
      const parts: string[] = []
      if (running > 0) parts.push(`进行中 ${running}`)
      if (waitingApproval > 0) parts.push(`待授权 ${waitingApproval}`)
      if (isReview && ready > 0) parts.push(`待审核 ${ready}`)
      if (failed > 0) parts.push(`失败 ${failed}`)
      if (stale > 0) parts.push(`已过期 ${stale}`)
      if (completed > 0) parts.push(`已完成 ${completed}/${total}`)
      if (notStarted > 0) parts.push(`未开始 ${notStarted}`)
      label = parts.join(' · ')
    }
  }

  return {
    nodeId: node.id,
    title: node.title,
    stage: node.stage,
    total,
    completed,
    stale,
    running,
    waitingApproval,
    waitingReview,
    failed,
    ready,
    pending,
    notStarted,
    allCompleted,
    stateClass,
    label,
  } as StageAggregation
}

export function summarizeParallelStages(graph: RequirementFlowGraph, taskFlows: TaskFlow[]) {
  const summaries = graph.nodes.map((node) => summarizeStage(node, taskFlows))
  const outDegree = new Map<string, number>()
  const inDegree = new Map<string, number>()
  for (const edge of graph.edges) {
    outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }
  const hasBranchingEdges = [...outDegree.values()].some((c) => c > 1) || [...inDegree.values()].some((c) => c > 1)
  const activeNodes = summaries.filter(
    (s) => s.running > 0 || s.waitingApproval > 0 || s.failed > 0 || s.stale > 0 || s.waitingReview > 0,
  )
  const readyNodes = summaries.filter((s) => s.ready > 0 && !activeNodes.some((a) => a.nodeId === s.nodeId))
  const focusNodes = activeNodes.length > 0 ? activeNodes : readyNodes
  const hasParallelActive = focusNodes.length > 1 || hasBranchingEdges

  let headline = '尚未开始'
  if (summaries.length > 0 && summaries.every((s) => s.allCompleted)) {
    headline = `全部 ${summaries.length} 个阶段已完成`
  } else if (focusNodes.length > 1) {
    headline = `并行阶段：${focusNodes.map((n) => `${n.title}（${n.label}）`).join(' / ')}`
  } else if (focusNodes.length === 1) {
    headline = `${focusNodes[0]!.title} · ${focusNodes[0]!.label}`
  }

  return {
    summaries,
    activeNodes: focusNodes,
    hasParallelActive,
    headline,
  }
}

export function RequirementJourneyTrack({
  projectId,
  requirementId,
  requirementTitle,
  binding,
  flow,
  tasks = [],
  onNavigate,
  variant = 'full',
}: {
  projectId: string
  requirementId: string
  requirementTitle?: string
  binding: RequirementFlowBinding
  flow: RequirementFlowView
  tasks?: Array<{ id: string; title: string }>
  onNavigate?: (path: string) => void
  /** `compact` renders the bead track used in the global top bar: only the focus stage is labelled. */
  variant?: 'full' | 'compact'
}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlStage = searchParams.get('stage')
  const urlTask = searchParams.get('task')
  const [openStageId, setOpenStageId] = useState<string | null>(() =>
    urlStage && binding.graph.nodes.some((n) => n.id === urlStage) ? urlStage : null,
  )
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (urlStage && binding.graph.nodes.some((n) => n.id === urlStage)) {
      setOpenStageId(urlStage)
    }
  }, [binding.graph.nodes, urlStage])

  const closeStageDialog = () => {
    const previousId = openStageId
    setOpenStageId(null)
    if (searchParams.has('stage')) {
      const next = new URLSearchParams(searchParams)
      next.delete('stage')
      setSearchParams(next, { replace: true })
    }
    if (previousId) {
      setTimeout(() => triggerRefs.current[previousId]?.focus(), 0)
    }
  }

  const stageSummaries = useMemo(
    () => binding.graph.nodes.map((node) => ({ node, summary: summarizeStage(node, flow.tasks) })),
    [binding.graph.nodes, flow.tasks],
  )

  // The focus stage: the first stage with live work, otherwise the first one that is not complete.
  const focusId = useMemo(() => {
    const parallel = summarizeParallelStages(binding.graph, flow.tasks)
    return parallel.activeNodes[0]?.nodeId ?? stageSummaries.find(({ summary }) => !summary.allCompleted)?.node.id ?? null
  }, [binding.graph, flow.tasks, stageSummaries])

  const activeStageNode = openStageId
    ? binding.graph.nodes.find((node) => node.id === openStageId) ?? null
    : null

  const stageMaterials = useMemo(() => {
    if (!openStageId) return []
    return flow.materials.filter(
      (material) =>
        material.nodeId === openStageId ||
        flow.tasks.some((task) =>
          task.steps.some((step) => step.nodeId === openStageId && step.id === material.stepId),
        ),
    )
  }, [flow.materials, flow.tasks, openStageId])

  return (
    <>
      {variant === 'compact' ? (
        <ol className="po-journey-track is-compact rq-journey-beads" aria-label="需求流程阶段">
          {stageSummaries.map(({ node, summary }, index) => {
            const state = summary.allCompleted ? 'done' : node.id === focusId ? 'active' : 'pending'
            const isFocus = node.id === focusId
            return (
              <li key={node.id} className={`po-journey-step is-${state}${isFocus ? ' is-current' : ''}${summary.failed > 0 ? ' is-failed' : ''}`}>
                <button
                  ref={(el) => { triggerRefs.current[node.id] = el }}
                  type="button"
                  className="po-journey-step-button"
                  data-stage-node={node.id}
                  data-testid={`journey-stage-${node.id}`}
                  aria-current={isFocus ? 'step' : undefined}
                  aria-label={`${node.title}，${summary.label}`}
                  title={`${node.title} · ${summary.label}`}
                  onClick={() => setOpenStageId(node.id)}
                >
                  <span className="po-journey-step-marker" aria-hidden="true">{summary.allCompleted ? '✓' : index + 1}</span>
                  <span className="po-journey-step-label">{node.title}</span>
                  {isFocus ? <span className="po-journey-step-state is-active" data-testid="requirement-journey-headline">{summary.label}</span> : null}
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <ol className="rq-flow-journey" aria-label="需求流程旅程">
          {stageSummaries.map(({ node, summary }, index) => {
            const isFocus = node.id === focusId
            return (
              <li key={node.id} className={`${summary.stateClass}${isFocus ? ' is-focus' : ''}`}>
                <button
                  ref={(el) => { triggerRefs.current[node.id] = el }}
                  type="button"
                  data-stage-node={node.id}
                  data-testid={`journey-stage-${node.id}`}
                  aria-current={isFocus ? 'step' : undefined}
                  title={`${node.title} · ${summary.label}`}
                  onClick={() => setOpenStageId(node.id)}
                >
                  <span className="rq-journey-mark">{summary.allCompleted ? '✓' : index + 1}</span>
                  <strong>{node.title}</strong>
                  <span className="rq-journey-state">{summary.label}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      {activeStageNode ? (
        <DialogShell
          open
          onOpenChange={(open) => {
            if (!open) closeStageDialog()
          }}
          ariaLabel="流程产出资料"
          width={1000}
        >
          <OverlayHeader title={activeStageNode.title} />
          <OverlayScrollArea className="rq-integration-scroll">
            <RequirementMaterials
              projectId={projectId}
              requirementId={requirementId}
              requirementTitle={requirementTitle}
              materials={stageMaterials}
              tasks={tasks}
              taskFlows={flow.tasks}
              stageNode={activeStageNode}
              initialTaskId={urlTask}
              onNavigate={(path) => {
                closeStageDialog()
                if (onNavigate) onNavigate(path)
              }}
            />
          </OverlayScrollArea>
          <OverlayFooter>
            <Button onClick={closeStageDialog}>关闭</Button>
          </OverlayFooter>
        </DialogShell>
      ) : null}
    </>
  )
}

export function TopJourneyBar({ projectId }: { projectId: string | null }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeKey = currentPageKey(location.pathname)
  const selectedByProject = useUiStore((state) => state.selectedRequirementByProject)
  const setSelectedRequirement = useUiStore((state) => state.setSelectedRequirement)
  const [legacyMode, setLegacyMode] = useState(false)

  const requirements = useRequirements(projectId)
  const board = useTaskBoard(projectId)
  const list = useMemo(() => requirements.data?.requirements ?? [], [requirements.data?.requirements])
  const urlReqId = searchParams.get('requirement')
  const storedReqId = projectId ? selectedByProject[projectId] : undefined

  const selectedRequirement = useMemo(() => {
    if (!projectId || !list.length) return null
    if (urlReqId) {
      const fromUrl = list.find((req) => req.id === urlReqId)
      if (fromUrl) return fromUrl
    }
    if (storedReqId) {
      const fromStore = list.find((req) => req.id === storedReqId)
      if (fromStore) return fromStore
    }
    return list[0] ?? null
  }, [list, projectId, storedReqId, urlReqId])

  useEffect(() => {
    if (projectId && selectedRequirement && storedReqId !== selectedRequirement.id) {
      setSelectedRequirement(projectId, selectedRequirement.id)
    }
  }, [projectId, selectedRequirement, setSelectedRequirement, storedReqId])

  const flow = useQuery({
    queryKey: ['requirement-flow', selectedRequirement?.id ?? 'none'],
    queryFn: () => window.projectos.workflows.view(selectedRequirement!.id),
    enabled: Boolean(projectId && selectedRequirement?.id && activeKey !== 'requirements'),
    refetchInterval: (query) => {
      const tasks = query.state.data?.tasks ?? []
      const hasActive = tasks.some((t) =>
        t.status === 'running' || t.steps.some((s) => s.status === 'starting' || s.status === 'running'),
      )
      return hasActive ? 3000 : 10000
    },
    refetchIntervalInBackground: false,
  })

  // On the requirements workbench, RequirementWorkspace renders the journey track directly so there is never a duplicate bar.
  if (activeKey === 'requirements') return null

  if (!projectId || legacyMode || !selectedRequirement || !flow.data?.binding) {
    return <GoalJourneyBar projectId={projectId} />
  }

  const binding = flow.data.binding
  const reqTasks = (board.data?.tasks ?? [])
    .filter((task) => task.requirementId === selectedRequirement.id && task.status !== 'cancelled')
    .map((task) => ({ id: task.id, title: task.title }))

  const chooseRequirement = (id: string) => {
    setSelectedRequirement(projectId, id)
    if (searchParams.has('requirement')) {
      const next = new URLSearchParams(searchParams)
      next.set('requirement', id)
      setSearchParams(next)
    }
  }

  const navigateWithRequirement = (subpath: string) => {
    const sep = subpath.includes('?') ? '&' : '?'
    navigate(`/projects/${projectId}/${subpath}${sep}requirement=${encodeURIComponent(selectedRequirement.id)}`)
  }

  const moreItems = [
    activeKey !== 'tasks' ? { key: 'tasks', label: `任务看板 · ${reqTasks.length || flow.data.tasks.length}` } : null,
    activeKey !== 'agents' ? { key: 'agents', label: 'Agent 协作' } : null,
    { key: 'legacy', label: '切换到项目阶段' },
  ].filter((item): item is { key: string; label: string } => Boolean(item))

  return (
    <section
      className="po-journey rq-top-journey"
      data-testid="requirement-journey"
      data-requirement-id={selectedRequirement.id}
      aria-label="全局需求流程旅程"
    >
      <div className="po-journey-header">
        <div className="po-journey-left">
          <span className="po-journey-eyebrow" title={binding.templateName}>需求</span>
          {list.length > 1 ? (
            <Select
              size="small"
              variant="borderless"
              aria-label="切换当前需求"
              value={selectedRequirement.id}
              onChange={chooseRequirement}
              options={list.map((req) => ({ value: req.id, label: req.title }))}
              className="rq-top-journey-select"
              popupMatchSelectWidth={false}
            />
          ) : (
            <strong className="po-journey-goal" title={selectedRequirement.title}>
              {selectedRequirement.title}
            </strong>
          )}
        </div>

        <RequirementJourneyTrack
          projectId={projectId}
          requirementId={selectedRequirement.id}
          requirementTitle={selectedRequirement.title}
          binding={binding}
          flow={flow.data}
          tasks={reqTasks}
          onNavigate={navigateWithRequirement}
          variant="compact"
        />

        <div className="po-journey-next">
          <button
            type="button"
            className="po-journey-action"
            onClick={() => navigateWithRequirement('requirements')}
            data-testid="journey-open-requirement"
          >
            需求工作台 <ArrowRightOutlined />
          </button>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: moreItems,
              onClick: ({ key }) => (key === 'legacy' ? setLegacyMode(true) : navigateWithRequirement(key)),
            }}
          >
            <button type="button" className="po-journey-toggle" aria-label="更多入口" data-testid="journey-more">
              <MoreOutlined />
            </button>
          </Dropdown>
        </div>
      </div>
    </section>
  )
}
