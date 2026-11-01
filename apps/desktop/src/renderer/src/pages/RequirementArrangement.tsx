import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Button, Checkbox, Select } from 'antd'
import type { FlowAssignmentPreview, FlowAssignmentSource, RequirementFlowBinding, TaskFlow } from '@projectos/contracts'
import { AgentAvatar, ErrorState, LoadingBlock } from '@projectos/ui'
import { useAgents } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea, useOverlayDismiss } from '../next-ui/overlay/overlay-shell'

const sourceLabels: Record<FlowAssignmentSource, string> = { default: '默认', manual: '人工指定', ai: 'AI 分配' }

function CancelButton({ disabled }: { disabled: boolean }) {
  const dismiss = useOverlayDismiss()
  return <Button disabled={disabled} onClick={dismiss}>取消</Button>
}

/** ADR-0077: requirement-level default owners, an explicit preview, then one transactional apply. */
export function RequirementArrangement({
  requirementId,
  projectId,
  binding,
  taskFlows,
  onClose,
  onChanged,
}: {
  requirementId: string
  projectId: string
  binding: RequirementFlowBinding
  taskFlows?: TaskFlow[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const agents = useAgents(projectId)
  const effectiveInitialAssignments = useMemo(() => {
    const map: Record<string, string | null> = { ...binding.assignments }
    if (taskFlows && taskFlows.length > 0) {
      for (const node of binding.graph.nodes) {
        if (!map[node.id]) {
          const assignedIds = [
            ...new Set(
              taskFlows
                .map((tf) => tf.steps.find((s) => s.nodeId === node.id)?.agentId)
                .filter((id): id is string => Boolean(id)),
            ),
          ]
          const allTasksAssigned = taskFlows.every((tf) =>
            Boolean(tf.steps.find((s) => s.nodeId === node.id)?.agentId),
          )
          if (allTasksAssigned && assignedIds.length >= 1) {
            map[node.id] = assignedIds[0]!
          }
        }
      }
    }
    return map
  }, [binding.assignments, binding.graph.nodes, taskFlows])

  const [draft, setDraft] = useState<Record<string, string | null>>(() => ({ ...effectiveInitialAssignments }))
  const [replace, setReplace] = useState<Set<string>>(() => new Set())
  const dirty = binding.graph.nodes.some(
    (node) => (draft[node.id] ?? null) !== (effectiveInitialAssignments[node.id] ?? null),
  )
  const preview = useQuery({
    queryKey: ['flow-assignment-preview', requirementId, binding.version],
    queryFn: () => window.projectos.workflows.previewAssignments(requirementId),
    enabled: !dirty,
  })
  const save = useMutation({
    mutationFn: () =>
      window.projectos.workflows.setDefaults({
        requirementId,
        expectedBindingVersion: binding.version,
        assignments: draft,
      }),
    onSuccess: async () => {
      const nextPreview = await window.projectos.workflows.previewAssignments(requirementId)
      const autoReplace = new Set(
        nextPreview.items
          .filter((item) => item.action === 'replaceable' && item.source !== 'manual')
          .map((item) => item.stepId),
      )
      setReplace(autoReplace)
      await onChanged()
      await preview.refetch()
    },
  })
  const apply = useMutation({
    mutationFn: (current: FlowAssignmentPreview) =>
      window.projectos.workflows.applyAssignments({
        requirementId,
        expectedBindingVersion: current.bindingVersion,
        token: current.token,
        replaceStepIds: [...replace],
      }),
    onSuccess: async () => {
      await onChanged()
      onClose()
    },
    onError: () => {
      setReplace(new Set())
      void preview.refetch()
    },
  })
  const options =
    agents.data?.agents.map(({ agent }) => ({
      value: agent.id,
      label: `${agent.name} · ${agent.role}`,
    })) ?? []
  const items = useMemo(() => preview.data?.items ?? [], [preview.data?.items])
  const fill = items.filter((item) => item.action === 'fill')
  const replaceable = useMemo(() => items.filter((item) => item.action === 'replaceable'), [items])
  const locked = items.filter((item) => item.action === 'locked').length
  const missingDefault = items.filter((item) => item.action === 'no_default').length
  const groups = useMemo(
    () =>
      [...new Map(replaceable.map((item) => [item.taskId, item.taskTitle])).entries()].map(
        ([taskId, title]) => ({
          taskId,
          title,
          items: replaceable.filter((item) => item.taskId === taskId),
        }),
      ),
    [replaceable],
  )
  const taskGroupsAll = useMemo(
    () =>
      [...new Map(items.map((item) => [item.taskId, item.taskTitle])).entries()].map(
        ([taskId, title]) => ({
          taskId,
          title,
          items: items.filter((item) => item.taskId === taskId),
        }),
      ),
    [items],
  )
  const toggle = (stepId: string, checked: boolean) =>
    setReplace((previous) => {
      const next = new Set(previous)
      if (checked) next.add(stepId)
      else next.delete(stepId)
      return next
    })
  const busy = save.isPending || apply.isPending
  const total = fill.length + replace.size

  return (
    <DialogShell
      open
      dirty={dirty || replace.size > 0}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
      ariaLabel="任务安排"
      width={880}
    >
      <OverlayHeader title="任务安排" meta={binding.templateName} />
      <OverlayScrollArea className="rq-integration-scroll rq-arrangement">
        {(save.isError || apply.isError) && (
          <Alert type="error" showIcon message={errorMessage(save.error ?? apply.error)} />
        )}
        <section aria-labelledby="rq-defaults-title">
          <div className="rq-section-title">
            <h3 id="rq-defaults-title">默认负责人</h3>
            <Button
              loading={save.isPending}
              disabled={!dirty || apply.isPending}
              onClick={() => save.mutate()}
            >
              保存默认负责人
            </Button>
          </div>
          <ol className="rq-default-owners">
            {binding.graph.nodes.map((node, index) => (
              <li key={node.id}>
                <span className="rq-step-number" aria-hidden>
                  {index + 1}
                </span>
                <label htmlFor={`rq-default-${node.id}`}>{node.title}</label>
                <Select
                  id={`rq-default-${node.id}`}
                  aria-label={`${node.title}默认负责人`}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="未设置"
                  value={draft[node.id] ?? undefined}
                  loading={agents.isLoading}
                  disabled={busy}
                  options={options}
                  onChange={(value?: string) =>
                    setDraft((previous) => ({ ...previous, [node.id]: value ?? null }))
                  }
                />
              </li>
            ))}
          </ol>
        </section>
        <section
          className="rq-apply-preview"
          aria-labelledby="rq-apply-title"
          aria-busy={preview.isFetching}
        >
          <h3 id="rq-apply-title">应用到任务</h3>
          {dirty ? (
            <p className="rq-secondary">保存默认负责人后预览变化。</p>
          ) : preview.isLoading ? (
            <LoadingBlock label="正在计算安排变化" rows={3} />
          ) : preview.isError ? (
            <ErrorState
              title="安排预览失败"
              message={errorMessage(preview.error)}
              onRetry={() => void preview.refetch()}
            />
          ) : (
            <>
              <ul className="rq-apply-summary">
                <li>
                  <strong>{fill.length}</strong>
                  <span>个未分配节点将填入默认</span>
                </li>
                <li>
                  <strong>{replaceable.length}</strong>
                  <span>个节点已有其他负责人</span>
                </li>
                {locked > 0 && (
                  <li>
                    <strong>{locked}</strong>
                    <span>个已开始节点保持不变</span>
                  </li>
                )}
                {missingDefault > 0 && (
                  <li>
                    <strong>{missingDefault}</strong>
                    <span>个节点没有可用默认</span>
                  </li>
                )}
              </ul>
              {groups.length > 0 && (
                <div className="rq-replace-list">
                  <p className="rq-secondary">
                    已有负责人默认保留；勾选的节点改为默认负责人。
                  </p>
                  {groups.map((group) => (
                    <fieldset key={group.taskId}>
                      <legend>{group.title}</legend>
                      {group.items.map((item) => (
                        <Checkbox
                          key={item.stepId}
                          checked={replace.has(item.stepId)}
                          disabled={busy}
                          onChange={(event) => toggle(item.stepId, event.target.checked)}
                        >
                          <span className="rq-replace-step">{item.title}</span>
                          <span className="rq-secondary">
                            {item.currentAgentName ?? item.currentAgentId}
                            {item.source ? ` · ${sourceLabels[item.source]}` : ''} →{' '}
                            {item.defaultAgentName}
                          </span>
                        </Checkbox>
                      ))}
                    </fieldset>
                  ))}
                </div>
              )}
              {taskGroupsAll.length > 0 && (
                <div className="rq-arrangement-live-list" aria-label="各任务阶段当前负责人状态">
                  {taskGroupsAll.map((group) => (
                    <div key={group.taskId} className="rq-arrangement-task-card">
                      <div className="rq-arrangement-task-head">
                        <strong>{group.title}</strong>
                        <span className="rq-secondary">各阶段当前绑定 Agent（全工作台实时联动）</span>
                      </div>
                      <div className="rq-arrangement-stage-grid">
                        {group.items.map((item, idx) => {
                          const agentDisplay =
                            item.currentAgentName ?? item.defaultAgentName ?? '未分配'
                          const actionBadge =
                            item.action === 'locked'
                              ? '已开始/已完成'
                              : item.action === 'unchanged'
                                ? '已生效'
                                : item.action === 'fill'
                                  ? '待填入默认'
                                  : item.action === 'replaceable'
                                    ? replace.has(item.stepId)
                                      ? `将改为 ${item.defaultAgentName}`
                                      : '保留当前负责人'
                                    : '未设置'
                          return (
                            <div
                              key={item.stepId}
                              className={`rq-arrangement-stage-chip is-${item.action}`}
                            >
                              <span className="rq-arrangement-stage-num">{idx + 1}</span>
                              <div className="rq-arrangement-stage-info">
                                <div className="rq-arrangement-stage-title-row">
                                  <strong>{item.title}</strong>
                                  {item.source && (
                                    <span className="rq-assignment-source">
                                      {sourceLabels[item.source]}
                                    </span>
                                  )}
                                </div>
                                <div className="rq-arrangement-stage-agent-row">
                                  {agentDisplay !== '未分配' && (
                                    <AgentAvatar name={agentDisplay} size={18} status="idle" />
                                  )}
                                  <span>{agentDisplay}</span>
                                  <em className="rq-arrangement-stage-state">{actionBadge}</em>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </OverlayScrollArea>
      <OverlayFooter>
        <CancelButton disabled={busy} />
        <Button
          type="primary"
          loading={apply.isPending}
          disabled={dirty || !preview.data || total === 0 || save.isPending}
          onClick={() => preview.data && apply.mutate(preview.data)}
        >
          {total ? `应用到 ${total} 个节点` : '没有需要应用的变化'}
        </Button>
      </OverlayFooter>
    </DialogShell>
  )
}
