import { useEffect, useMemo, useState } from 'react'
import { App, Button, Input, Select, Tag } from 'antd'
import { DeleteOutlined, SaveOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AgentBackendBinding } from '@projectos/contracts'
import { errorMessage } from '../../lib/errors'

const ROLES = [
  { role: '产品负责人', hint: '需求、范围与交付' },
  { role: '架构师', hint: '方案、边界与拆分' },
  { role: '开发工程师', hint: '实现与自测' },
  { role: '代码审查员', hint: '质量与风险' },
  { role: '测试工程师', hint: '验收与回归' },
]

interface Draft {
  connectionId: string | null
  modelId: string
  requiredCapabilities: Array<'streaming' | 'toolCalling' | 'vision' | 'reasoning'>
  maxConcurrency: number
  failurePolicy: 'fail' | 'fallback'
}

function bindingFor(bindings: AgentBackendBinding[], role: string): AgentBackendBinding | null {
  return (
    bindings
      .filter((binding) => binding.scopeType === 'agent' && binding.agentRole === role)
      .sort((a, b) => b.priority - a.priority)[0] ?? null
  )
}

function globalBinding(bindings: AgentBackendBinding[]): AgentBackendBinding | null {
  return bindings
    .filter((binding) => binding.scopeType === 'global')
    .sort((a, b) => b.priority - a.priority)[0] ?? null
}

export function RoutingPanel() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const connectionsQuery = useQuery({
    queryKey: ['ai-connections'],
    queryFn: () => window.projectos.aiConnections.list(),
  })
  const routingQuery = useQuery({
    queryKey: ['ai-routing'],
    queryFn: () => window.projectos.aiRouting.list(),
  })
  const usageQuery = useQuery({
    queryKey: ['ai-usage'],
    queryFn: () => window.projectos.aiUsage.summary(),
  })
  const pricesQuery = useQuery({
    queryKey: ['ai-pricing'],
    queryFn: () => window.projectos.aiPricing.list(),
  })
  const [priceDraft, setPriceDraft] = useState({
    connectionId: null as string | null,
    modelId: '',
    inputPerMillion: 0,
    outputPerMillion: 0,
    currency: 'USD',
  })
  const savePrice = useMutation({
    mutationFn: () =>
      window.projectos.aiPricing.upsert({
        connectionId: priceDraft.connectionId ?? '',
        modelId: priceDraft.modelId.trim(),
        inputPerMillion: priceDraft.inputPerMillion,
        outputPerMillion: priceDraft.outputPerMillion,
        currency: priceDraft.currency.trim() || 'USD',
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ai-pricing'] })
      setPriceDraft((current) => ({ ...current, modelId: '' }))
      message.success('价格已保存')
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [globalDraft, setGlobalDraft] = useState<Draft>({
    connectionId: null,
    modelId: '',
    requiredCapabilities: [],
    maxConcurrency: 0,
    failurePolicy: 'fallback',
  })

  const connections = useMemo(() => connectionsQuery.data?.connections ?? [], [connectionsQuery.data])
  const executable = useMemo(
    () =>
      connections.filter(
        (connection) =>
          connection.enabled &&
          connection.backendKind === 'native-llm' &&
          connection.protocol === 'openai-chat' &&
          connection.hasSecret,
      ),
    [connections],
  )

  useEffect(() => {
    const bindings = routingQuery.data?.bindings ?? []
    const next: Record<string, Draft> = {}
    for (const role of ROLES) {
      const binding = bindingFor(bindings, role.role)
      next[role.role] = {
        connectionId: binding?.connectionId ?? null,
        modelId: binding?.modelId ?? '',
        requiredCapabilities: binding?.requiredCapabilities ?? [],
        maxConcurrency: binding?.maxConcurrency ?? 0,
        failurePolicy: binding?.failurePolicy ?? 'fallback',
      }
    }
    setDrafts(next)
    const fallback = globalBinding(bindings)
    setGlobalDraft({
      connectionId: fallback?.connectionId ?? null,
      modelId: fallback?.modelId ?? '',
      requiredCapabilities: fallback?.requiredCapabilities ?? [],
      maxConcurrency: fallback?.maxConcurrency ?? 0,
      failurePolicy: fallback?.failurePolicy ?? 'fallback',
    })
  }, [routingQuery.data])

  const save = useMutation({
    mutationFn: async ({ role, draft, global }: { role: string; draft: Draft; global?: boolean }) => {
      const existing = global
        ? globalBinding(routingQuery.data?.bindings ?? [])
        : bindingFor(routingQuery.data?.bindings ?? [], role)
      if (!draft.connectionId) {
        if (existing) await window.projectos.aiRouting.delete(existing.id)
        return
      }
      await window.projectos.aiRouting.upsert({
        id: existing?.id,
        scopeType: global ? 'global' : 'agent',
        scopeId: null,
        agentRole: global ? null : role,
        taskType: null,
        connectionId: draft.connectionId,
        modelId: draft.modelId.trim() || null,
        priority: 0,
        requiredCapabilities: draft.requiredCapabilities,
        maxConcurrency: draft.maxConcurrency,
        failurePolicy: draft.failurePolicy,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['ai-routing'] })
      message.success('路由已保存')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  return (
    <div className="po-settings-section">
      <div className="po-settings-section-head">
        <div>
          <h2>Agent 路由</h2>
          <p>按角色选择执行连接；未匹配时回退到项目默认连接。</p>
        </div>
        <Tag color={executable.length ? 'green' : 'orange'}>{executable.length} 个可执行连接</Tag>
      </div>

      <div className="po-routing-list">
        {ROLES.map(({ role, hint }) => {
          const binding = bindingFor(routingQuery.data?.bindings ?? [], role)
          const draft = drafts[role] ?? {
            connectionId: null,
            modelId: '',
            requiredCapabilities: [],
            maxConcurrency: 0,
            failurePolicy: 'fallback' as const,
          }
          return (
            <div className="po-routing-row" key={role}>
              <div className="po-routing-role">
                <strong>{role}</strong>
                <span>{hint}</span>
              </div>
              <Select
                allowClear
                value={draft.connectionId}
                placeholder="使用默认连接"
                options={executable.map((connection) => ({
                  value: connection.id,
                  label: `${connection.name} · ${connection.defaultModelId ?? '未设模型'}`,
                }))}
                onChange={(connectionId) => setDrafts((current) => ({ ...current, [role]: { ...draft, connectionId: connectionId ?? null } }))}
              />
              <Input
                value={draft.modelId}
                placeholder="模型覆盖（可选）"
                onChange={(event) => setDrafts((current) => ({ ...current, [role]: { ...draft, modelId: event.target.value } }))}
              />
              <Button
                icon={<SaveOutlined />}
                onClick={() => save.mutate({ role, draft })}
                loading={save.isPending && save.variables?.role === role}
              />
              <Button
                icon={<DeleteOutlined />}
                disabled={!binding}
                onClick={() => {
                  if (!binding) return
                  void window.projectos.aiRouting.delete(binding.id).then(async () => {
                    await queryClient.invalidateQueries({ queryKey: ['ai-routing'] })
                    message.success('已清除')
                  })
                }}
              />
            </div>
          )
        })}
      </div>

      <div className="po-settings-section-head po-routing-global-head">
        <div>
          <h2>全局回退</h2>
          <p>未命中角色、项目或任务规则时使用；再回退到默认连接。</p>
        </div>
      </div>
      <div className="po-routing-row">
        <div className="po-routing-role"><strong>Global</strong><span>所有 Agent</span></div>
        <Select
          allowClear
          value={globalDraft.connectionId}
          placeholder="使用默认连接"
          options={executable.map((connection) => ({
            value: connection.id,
            label: `${connection.name} · ${connection.defaultModelId ?? '未设模型'}`,
          }))}
          onChange={(connectionId) => setGlobalDraft((current) => ({ ...current, connectionId: connectionId ?? null }))}
        />
        <Input
          value={globalDraft.modelId}
          placeholder="模型覆盖（可选）"
          onChange={(event) => setGlobalDraft((current) => ({ ...current, modelId: event.target.value }))}
        />
        <Button
          icon={<SaveOutlined />}
          onClick={() => save.mutate({ role: 'global', draft: globalDraft, global: true })}
          loading={save.isPending && save.variables?.role === 'global'}
        />
      </div>

      <div className="po-settings-section-head po-routing-global-head">
        <div>
          <h2>用量</h2>
          <p>真实 Run 完成后记录；供应商未返回 usage 时标记为 unknown。</p>
        </div>
      </div>
      <div className="po-usage-grid">
        <div><span>Runs</span><strong>{usageQuery.data?.runs ?? 0}</strong></div>
        <div><span>Input tokens</span><strong>{usageQuery.data?.inputTokens ?? 0}</strong></div>
        <div><span>Output tokens</span><strong>{usageQuery.data?.outputTokens ?? 0}</strong></div>
        <div><span>估算费用</span><strong>{usageQuery.data?.estimatedCost ?? 0}</strong></div>
      </div>

      <div className="po-settings-section-head po-routing-global-head">
        <div>
          <h2>模型价格</h2>
          <p>按每百万 tokens 计价；仅用于估算，不代表账单。</p>
        </div>
      </div>
      <div className="po-routing-row po-price-row">
        <Select
          value={priceDraft.connectionId}
          placeholder="连接"
          options={connections.map((connection) => ({ value: connection.id, label: connection.name }))}
          onChange={(connectionId) => setPriceDraft((current) => ({ ...current, connectionId }))}
        />
        <Input
          value={priceDraft.modelId}
          placeholder="模型 ID"
          onChange={(event) => setPriceDraft((current) => ({ ...current, modelId: event.target.value }))}
        />
        <Input
          type="number"
          value={priceDraft.inputPerMillion}
          addonBefore="输入 / 1M"
          onChange={(event) => setPriceDraft((current) => ({ ...current, inputPerMillion: Number(event.target.value) || 0 }))}
        />
        <Input
          type="number"
          value={priceDraft.outputPerMillion}
          addonBefore="输出 / 1M"
          onChange={(event) => setPriceDraft((current) => ({ ...current, outputPerMillion: Number(event.target.value) || 0 }))}
        />
        <Button
          type="primary"
          icon={<SaveOutlined />}
          disabled={!priceDraft.connectionId || !priceDraft.modelId.trim()}
          loading={savePrice.isPending}
          onClick={() => savePrice.mutate()}
        />
      </div>
      <div className="po-price-list">
        {(pricesQuery.data?.prices ?? []).map((price) => (
          <div className="po-price-item" key={price.id}>
            <code>{price.modelId}</code>
            <span>{price.inputPerMillion} / {price.outputPerMillion} {price.currency} · 1M</span>
            <Button
              type="text"
              size="small"
              icon={<DeleteOutlined />}
              onClick={() => {
                void window.projectos.aiPricing.delete(price.id).then(async () => {
                  await queryClient.invalidateQueries({ queryKey: ['ai-pricing'] })
                })
              }}
            />
          </div>
        ))}
      </div>
      <div className="po-routing-footnote">
        路由支持原生 openai-chat、openai-responses 与 anthropic-messages；外部 Agent 不会被静默降级。
      </div>
    </div>
  )
}
