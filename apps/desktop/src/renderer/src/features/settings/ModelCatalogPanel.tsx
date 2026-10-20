import { useEffect, useMemo, useState } from 'react'
import { App as AntApp, Button, Drawer, Form, Input, InputNumber, Modal, Select, Table, Tag, type TableColumnsType } from 'antd'
import { DeleteOutlined, PlusOutlined, ReloadOutlined, StarOutlined, SyncOutlined } from '@ant-design/icons'
import type { AIModel } from '@projectos/contracts'
import { EmptyState, LoadingBlock, StatusPill } from '@projectos/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk, useAIConnections, useAIModels } from '../../lib/queries'
import { errorMessage } from '../../lib/errors'
import { useUiStore } from '../../stores/ui'

interface ModelFormValues {
  modelId: string
  displayName?: string
  contextWindow?: number
  maxOutputTokens?: number
}

const CAPABILITY_LABELS: Record<string, string> = {
  yes: '支持',
  no: '不支持',
  unknown: '未知',
}

export function ModelCatalogPanel() {
  const { message, modal } = AntApp.useApp()
  const queryClient = useQueryClient()
  const connectionsQuery = useAIConnections()
  const selectedConnectionId = useUiStore((state) => state.settingsConnectionId)
  const setSelectedConnectionId = useUiStore((state) => state.setSettingsConnectionId)
  const openSettings = useUiStore((state) => state.openSettings)
  const [addOpen, setAddOpen] = useState(false)
  const [detail, setDetail] = useState<AIModel | null>(null)
  const [form] = Form.useForm<ModelFormValues>()

  const connections = useMemo(() => connectionsQuery.data?.connections ?? [], [connectionsQuery.data])
  const connection =
    connections.find((item) => item.id === selectedConnectionId) ??
    connections.find((item) => item.isDefault) ??
    connections[0] ??
    null
  const modelsQuery = useAIModels(connection?.id)

  useEffect(() => {
    if (!connection && connections[0]) setSelectedConnectionId(connections[0].id)
    if (connection && connection.id !== selectedConnectionId) setSelectedConnectionId(connection.id)
  }, [connection, connections, selectedConnectionId, setSelectedConnectionId])

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.aiConnections }),
      queryClient.invalidateQueries({ queryKey: qk.aiModels(connection?.id ?? '') }),
      queryClient.invalidateQueries({ queryKey: qk.bootstrap }),
    ])
  }

  const discover = useMutation({
    mutationFn: () => window.projectos.aiConnections.discoverModels(connection!.id),
    onSuccess: async (result) => {
      await refresh()
      message.success(`已同步 ${result.models.length} 个模型`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const addModel = useMutation({
    mutationFn: (values: ModelFormValues) =>
      window.projectos.aiModels.create({
        connectionId: connection!.id,
        modelId: values.modelId,
        displayName: values.displayName,
        contextWindow: values.contextWindow ?? null,
        maxOutputTokens: values.maxOutputTokens ?? null,
      }),
    onSuccess: async () => {
      await refresh()
      setAddOpen(false)
      form.resetFields()
      message.success('模型已添加')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const removeModel = useMutation({
    mutationFn: (modelId: string) => window.projectos.aiModels.delete(connection!.id, modelId),
    onSuccess: async () => {
      await refresh()
      message.success('模型已移除')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const setDefaultModel = useMutation({
    mutationFn: (modelId: string) => window.projectos.aiModels.setDefault(connection!.id, modelId),
    onSuccess: async () => {
      await refresh()
      message.success('默认模型已更新')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const columns: TableColumnsType<AIModel> = [
    {
      title: '模型',
      dataIndex: 'modelId',
      render: (_value, model) => (
        <div className="po-model-name">
          <strong>{model.displayName}</strong>
          <span>{model.modelId}</span>
        </div>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 88,
      render: (value: AIModel['source']) => <Tag>{value === 'discovered' ? '发现' : '手动'}</Tag>,
    },
    {
      title: '流式',
      width: 76,
      render: (_value, model) => (
        <StatusPill tone={model.capabilities.streaming === 'yes' ? 'success' : 'neutral'}>
          {CAPABILITY_LABELS[model.capabilities.streaming]}
        </StatusPill>
      ),
    },
    {
      title: '工具',
      width: 76,
      render: (_value, model) => (
        <StatusPill tone={model.capabilities.toolCalling === 'yes' ? 'success' : 'neutral'}>
          {CAPABILITY_LABELS[model.capabilities.toolCalling]}
        </StatusPill>
      ),
    },
    {
      title: '上下文',
      width: 110,
      render: (_value, model) => (model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K` : '—'),
    },
    {
      title: '',
      width: 96,
      render: (_value, model) => (
        <div className="po-model-actions">
          <Button
            type="text"
            size="small"
            icon={<StarOutlined />}
            disabled={connection?.defaultModelId === model.modelId}
            onClick={() => setDefaultModel.mutate(model.modelId)}
            aria-label="设为默认模型"
          />
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              modal.confirm({
                title: `移除模型「${model.modelId}」？`,
                content: '仅从模型目录移除，不影响服务商侧模型。',
                okText: '移除',
                okButtonProps: { danger: true },
                cancelText: '取消',
                onOk: () => removeModel.mutate(model.modelId),
              })
            }
            aria-label="移除模型"
          />
        </div>
      ),
    },
  ]

  if (connectionsQuery.isLoading) return <LoadingBlock rows={6} />
  if (!connection) {
    return (
      <div className="po-settings-panel">
        <div className="po-settings-panel-head">
          <div>
            <h2>模型目录</h2>
            <p>0 个连接</p>
          </div>
        </div>
        <EmptyState
          title="暂无 AI 连接"
          action={
            <Button type="primary" onClick={() => openSettings('ai-connections')}>
              添加连接
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div>
          <h2>模型目录</h2>
          <p>{modelsQuery.data?.models.length ?? 0} 个模型</p>
        </div>
        <div className="po-panel-actions">
          <Select
            value={connection.id}
            onChange={setSelectedConnectionId}
            style={{ width: 220 }}
            options={connections.map((item) => ({ value: item.id, label: item.name }))}
          />
          <Button
            icon={<SyncOutlined />}
            loading={discover.isPending}
            disabled={!connection.hasSecret}
            onClick={() => discover.mutate()}
          >
            从服务发现
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            手动添加
          </Button>
        </div>
      </div>

      <div className="po-model-summary">
        <span>默认模型</span>
        <strong>{connection.defaultModelId || '未设置'}</strong>
        <span className="po-grow" />
        <Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => void modelsQuery.refetch()}>
          刷新
        </Button>
      </div>

      <Table
        rowKey="modelId"
        size="small"
        columns={columns}
        dataSource={modelsQuery.data?.models ?? []}
        loading={modelsQuery.isLoading}
        onRow={(model) => ({ onClick: () => setDetail(model), style: { cursor: 'pointer' } })}
        pagination={false}
        locale={{ emptyText: <EmptyState title="暂无模型" description="从服务同步，或手动添加模型 ID。" /> }}
      />

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} width={460} title="模型详情">
        {detail ? (
          <div className="v16-model-detail">
            <div className="v16-card-title"><strong>{detail.displayName}</strong><Tag>{detail.source === 'discovered' ? '发现' : '手动'}</Tag></div>
            <div className="v16-setting-kv"><span>模型 ID</span><strong>{detail.modelId}</strong></div>
            <div className="v16-setting-kv"><span>连接</span><strong>{connection.name}</strong></div>
            <div className="v16-setting-kv"><span>上下文</span><strong>{detail.contextWindow ? `${detail.contextWindow} tokens` : '未知'}</strong></div>
            <div className="v16-setting-kv"><span>最大输出</span><strong>{detail.maxOutputTokens ? `${detail.maxOutputTokens} tokens` : '未知'}</strong></div>
            <div className="v16-setting-kv"><span>流式</span><strong>{CAPABILITY_LABELS[detail.capabilities.streaming]}</strong></div>
            <div className="v16-setting-kv"><span>工具调用</span><strong>{CAPABILITY_LABELS[detail.capabilities.toolCalling]}</strong></div>
            <div className="v16-setting-kv"><span>默认模型</span><strong>{connection.defaultModelId === detail.modelId ? '是' : '否'}</strong></div>
            <Button type="primary" disabled={connection.defaultModelId === detail.modelId} onClick={() => setDefaultModel.mutate(detail.modelId)}>设为默认模型</Button>
          </div>
        ) : null}
      </Drawer>

      <Modal
        title="手动添加模型"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => void form.validateFields().then((values) => addModel.mutate(values))}
        okText="添加"
        cancelText="取消"
        confirmLoading={addModel.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} className="po-form">
          <Form.Item name="modelId" label="模型 ID" rules={[{ required: true, message: '请输入模型 ID' }]}>
            <Input placeholder="deepseek-chat" />
          </Form.Item>
          <Form.Item name="displayName" label="显示名称">
            <Input placeholder="可选" />
          </Form.Item>
          <div className="po-form-row">
            <Form.Item name="contextWindow" label="上下文窗口">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="maxOutputTokens" label="最大输出 Token">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
