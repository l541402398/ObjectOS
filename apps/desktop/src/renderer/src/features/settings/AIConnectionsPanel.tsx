import { useEffect, useMemo, useState } from 'react'
import {
  App as AntApp,
  Button,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Select,
  Slider,
  Switch,
  Tooltip,
  type FormInstance,
  type MenuProps,
} from 'antd'
import {
  ApiOutlined,
  ArrowLeftOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DeleteOutlined,
  EditOutlined,
  EllipsisOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  StarOutlined,
  SyncOutlined,
} from '@ant-design/icons'
import type { AIConnectionCreateInput, AIConnectionTestResult, AIConnectionView } from '@projectos/contracts'
import { EmptyState, ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { qk, useAIConnections } from '../../lib/queries'
import { errorMessage } from '../../lib/errors'
import { useUiStore } from '../../stores/ui'

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic',
  custom: '自定义',
  external: '外部 Agent',
}

const PROVIDER_PRESETS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  custom: '',
}

interface ConnectionFormValues {
  name: string
  providerId: string
  protocol: 'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'external-cli'
  baseUrl: string
  apiKey?: string
  defaultModelId?: string
  timeoutMs: number
  temperature: number
  enabled: boolean
  isDefault: boolean
}

function connectionStatus(connection: AIConnectionView): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (!connection.enabled) return { label: '已停用', tone: 'neutral' }
  if (!connection.hasSecret) return { label: '未配置密钥', tone: 'warning' }
  if (!connection.lastCheck) return { label: '未验证', tone: 'neutral' }
  if (connection.lastCheck.status === 'failed') return { label: '异常', tone: 'danger' }
  return { label: '可用', tone: 'success' }
}

function StageLine({ result }: { result: AIConnectionTestResult }) {
  return (
    <div className={`po-ai-test ${result.ok ? 'is-ok' : 'is-error'}`}>
      <div className="po-ai-test-head">
        {result.ok ? <CheckCircleFilled /> : <CloseCircleFilled />}
        <strong>{result.ok ? '连接通过' : result.code}</strong>
        <span>{result.latencyMs} ms</span>
      </div>
      <p>{result.message}</p>
      <div className="po-ai-test-stages">
        {result.stages.map((stage) => (
          <span key={stage.id} className={`is-${stage.status}`}>
            {stage.stage} · {stage.status === 'passed' ? '通过' : stage.status === 'failed' ? '失败' : '跳过'}
          </span>
        ))}
      </div>
    </div>
  )
}

export function AIConnectionsPanel() {
  const { message, modal } = AntApp.useApp()
  const queryClient = useQueryClient()
  const connectionsQuery = useAIConnections()
  const openSettings = useUiStore((state) => state.openSettings)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AIConnectionView | 'new' | null>(null)
  const [form] = Form.useForm<ConnectionFormValues>()
  const [testingId, setTestingId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, AIConnectionTestResult>>({})

  const connections = useMemo(() => connectionsQuery.data?.connections ?? [], [connectionsQuery.data])
  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return connections
    return connections.filter(
      (connection) =>
        connection.name.toLowerCase().includes(keyword) ||
        connection.baseUrl.toLowerCase().includes(keyword) ||
        (connection.defaultModelId ?? '').toLowerCase().includes(keyword),
    )
  }, [connections, search])

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: qk.aiConnections }),
      queryClient.invalidateQueries({ queryKey: qk.bootstrap }),
      queryClient.invalidateQueries({ queryKey: qk.providerSettings }),
      queryClient.invalidateQueries({ queryKey: ['aiModels'] }),
    ])
  }

  const create = useMutation({
    mutationFn: (values: ConnectionFormValues) =>
      window.projectos.aiConnections.create({
        name: values.name,
        providerId: values.providerId as AIConnectionCreateInput['providerId'],
        protocol: values.protocol,
        backendKind: 'native-llm',
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        defaultModelId: values.defaultModelId,
        timeoutMs: values.timeoutMs,
        temperature: values.temperature,
        enabled: values.enabled,
        isDefault: values.isDefault,
      }),
    onSuccess: async () => {
      await refresh()
      setEditing(null)
      message.success('连接已创建')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const update = useMutation({
    mutationFn: (input: ConnectionFormValues & { id: string }) =>
      window.projectos.aiConnections.update({
        id: input.id,
        name: input.name,
        providerId: input.providerId as AIConnectionCreateInput['providerId'],
        protocol: input.protocol,
        backendKind: 'native-llm',
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        defaultModelId: input.defaultModelId || null,
        timeoutMs: input.timeoutMs,
        temperature: input.temperature,
        enabled: input.enabled,
        isDefault: input.isDefault,
      }),
    onSuccess: async () => {
      await refresh()
      setEditing(null)
      message.success('连接已更新')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const remove = useMutation({
    mutationFn: (id: string) => window.projectos.aiConnections.delete(id),
    onSuccess: async () => {
      await refresh()
      message.success('连接已删除')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const setDefault = useMutation({
    mutationFn: (id: string) => window.projectos.aiConnections.setDefault(id),
    onSuccess: async () => {
      await refresh()
      message.success('默认连接已切换')
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const test = useMutation({
    mutationFn: (id: string) => {
      setTestingId(id)
      return window.projectos.aiConnections.test(id)
    },
    onSuccess: async (result, id) => {
      setResults((current) => ({ ...current, [id]: result }))
      await refresh()
      message[result.ok ? 'success' : 'warning'](result.ok ? '连接测试通过' : result.message)
    },
    onError: (error) => message.error(errorMessage(error)),
    onSettled: () => setTestingId(null),
  })

  const discover = useMutation({
    mutationFn: (id: string) => window.projectos.aiConnections.discoverModels(id),
    onSuccess: async (result) => {
      await refresh()
      message.success(`已同步 ${result.models.length} 个模型`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  useEffect(() => {
    if (!editing) return
    if (editing === 'new') {
      form.resetFields()
      form.setFieldsValue({
        name: '',
        providerId: 'deepseek',
        protocol: 'openai-chat',
        baseUrl: PROVIDER_PRESETS.deepseek ?? '',
        defaultModelId: 'deepseek-chat',
        timeoutMs: 30_000,
        temperature: 0.2,
        enabled: true,
        isDefault: connections.length === 0,
        apiKey: undefined,
      })
    } else {
      form.resetFields()
      form.setFieldsValue({
        name: editing.name,
        providerId: editing.providerId,
        protocol: editing.protocol,
        baseUrl: editing.baseUrl,
        defaultModelId: editing.defaultModelId ?? undefined,
        timeoutMs: editing.timeoutMs,
        temperature: editing.temperature,
        enabled: editing.enabled,
        isDefault: editing.isDefault,
        apiKey: undefined,
      })
    }
  }, [connections.length, editing, form])

  const save = async (): Promise<void> => {
    const values = await form.validateFields()
    if (editing && editing !== 'new') update.mutate({ ...values, id: editing.id })
    else create.mutate(values)
  }

  const menuFor = (connection: AIConnectionView): MenuProps['items'] => [
    {
      key: 'edit',
      label: '编辑连接',
      icon: <EditOutlined />,
      onClick: () => setEditing(connection),
    },
    {
      key: 'default',
      label: '设为默认',
      icon: <StarOutlined />,
      disabled: connection.isDefault || !connection.enabled || !connection.hasSecret,
      onClick: () => setDefault.mutate(connection.id),
    },
    {
      key: 'models',
      label: '管理模型',
      icon: <ApiOutlined />,
      onClick: () => openSettings('models', connection.id),
    },
    { type: 'divider' },
    {
      key: 'delete',
      label: '删除连接',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () =>
        modal.confirm({
          title: `删除「${connection.name}」？`,
          content: '连接与模型目录会被删除，已保存的密钥也会移除。历史运行记录不受影响。',
          okText: '删除',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => remove.mutate(connection.id),
        }),
    },
  ]

  if (connectionsQuery.isLoading) return <LoadingBlock rows={6} />
  if (connectionsQuery.isError) {
    return (
      <ErrorState
        title="无法读取 AI 连接"
        message={errorMessage(connectionsQuery.error)}
        onRetry={() => void connectionsQuery.refetch()}
      />
    )
  }

  if (editing) {
    return (
      <ConnectionEditor
        editing={editing}
        form={form}
        pending={create.isPending || update.isPending}
        onCancel={() => setEditing(null)}
        onSave={() => void save()}
      />
    )
  }

  return (
    <div className="po-settings-panel po-ai-connections">
      <div className="po-settings-panel-head">
        <div>
          <h2>AI 连接</h2>
          <p>{connections.length} 个连接</p>
        </div>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
          新增连接
        </Button>
      </div>

      {connections.length > 0 ? (
        <div className="po-ai-toolbar">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索连接或模型"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void connectionsQuery.refetch()}>
            刷新
          </Button>
        </div>
      ) : null}

      {connections.length === 0 ? (
        <EmptyState
          title="暂无 AI 连接"
          description="添加 OpenAI-compatible 服务后，Agent 才能执行真实任务。"
          action={
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
              新增连接
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="没有匹配的连接" />
      ) : (
        <div className="po-ai-connection-list">
          {filtered.map((connection) => {
            const status = connectionStatus(connection)
            const result = results[connection.id]
            return (
              <div className={`po-ai-connection-card ${connection.isDefault ? 'is-default' : ''}`.trim()} key={connection.id}>
                <div className="po-ai-connection-head">
                  <span className="po-ai-connection-icon">
                    <ApiOutlined />
                  </span>
                  <div className="po-ai-connection-title">
                    <div>
                      <strong>{connection.name}</strong>
                      {connection.isDefault ? <span className="po-ai-default-tag">默认</span> : null}
                    </div>
                    <span>
                      {PROVIDER_LABELS[connection.providerId] ?? connection.providerId} · {connection.protocol}
                    </span>
                  </div>
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  <Dropdown menu={{ items: menuFor(connection) }} trigger={['click']} placement="bottomRight">
                    <Button type="text" icon={<EllipsisOutlined />} aria-label={`更多操作：${connection.name}`} />
                  </Dropdown>
                </div>
                <div className="po-ai-connection-meta">
                  <span>{connection.defaultModelId || '未设置默认模型'}</span>
                  <span>{connection.modelCount} 个模型</span>
                  <span>{connection.hasSecret ? '密钥已保存' : '无密钥'}</span>
                </div>
                {connection.lastCheck && !result ? (
                  <div className={`po-ai-last-check is-${connection.lastCheck.status}`}>
                    {connection.lastCheck.status === 'passed' ? <CheckCircleFilled /> : <CloseCircleFilled />}
                    <span>
                      {connection.lastCheck.errorCode ? `${connection.lastCheck.errorCode} · ` : ''}
                      {connection.lastCheck.message}
                    </span>
                  </div>
                ) : null}
                {result ? <StageLine result={result} /> : null}
                <div className="po-ai-connection-actions">
                  <Button
                    size="small"
                    icon={<SyncOutlined />}
                    loading={testingId === connection.id}
                    onClick={() => test.mutate(connection.id)}
                  >
                    测试连接
                  </Button>
                  <Button
                    size="small"
                    icon={<ApiOutlined />}
                    loading={discover.isPending && discover.variables === connection.id}
                    disabled={!connection.hasSecret}
                    onClick={() => discover.mutate(connection.id)}
                  >
                    同步模型
                  </Button>
                  <Button
                    size="small"
                    disabled={connection.isDefault || !connection.enabled || !connection.hasSecret}
                    icon={<StarOutlined />}
                    onClick={() => setDefault.mutate(connection.id)}
                  >
                    {connection.isDefault ? '默认连接' : '设为默认'}
                  </Button>
                  <Tooltip title="编辑">
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(connection)} />
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ConnectionEditor({
  editing,
  form,
  pending,
  onCancel,
  onSave,
}: {
  editing: AIConnectionView | 'new'
  form: FormInstance<ConnectionFormValues>
  pending: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="po-settings-panel po-ai-editor">
      <div className="po-ai-editor-top">
        <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={onCancel}>
          AI 连接
        </Button>
        <div className="po-ai-editor-actions">
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={pending} onClick={onSave}>
            保存
          </Button>
        </div>
      </div>
      <div className="po-ai-editor-title">
        <h2>{editing === 'new' ? '新增连接' : '编辑连接'}</h2>
        <p>{editing === 'new' ? 'OpenAI-compatible' : editing.name}</p>
      </div>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        className="po-form po-ai-editor-form"
        onValuesChange={(changed) => {
          if (changed.providerId) {
            const preset = PROVIDER_PRESETS[changed.providerId as string]
            if (preset) form.setFieldValue('baseUrl', preset)
            if (changed.providerId === 'anthropic') form.setFieldValue('protocol', 'anthropic-messages')
            else form.setFieldValue('protocol', 'openai-chat')
          }
        }}
        onFinish={onSave}
      >
        <div className="po-form-section-title">基础</div>
        <div className="po-form-row">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入连接名称' }]}>
            <Input placeholder="例如 DeepSeek 主账号" />
          </Form.Item>
          <Form.Item name="providerId" label="服务商">
            <Select
              options={[
                { value: 'deepseek', label: 'DeepSeek' },
                { value: 'openai', label: 'OpenAI' },
                { value: 'anthropic', label: 'Anthropic' },
                { value: 'custom', label: '自定义 OpenAI-compatible' },
              ]}
            />
          </Form.Item>
        </div>
        <div className="po-form-section-title">认证</div>
        <div className="po-form-row">
          <Form.Item
            name="baseUrl"
            label="Base URL"
            rules={[{ required: true, message: '请输入 Base URL' }, { type: 'url', message: '请输入合法 URL' }]}
          >
            <Input placeholder="https://api.deepseek.com/v1" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key">
            <Input.Password
              autoComplete="off"
              placeholder={editing !== 'new' && editing.hasSecret ? '已保存，留空保持不变' : 'sk-...'}
            />
          </Form.Item>
        </div>
        <div className="po-form-section-title">模型与网络</div>
        <div className="po-form-row">
          <Form.Item name="protocol" label="协议">
            <Select
              options={[
                { value: 'openai-chat', label: 'OpenAI Chat Completions' },
                { value: 'anthropic-messages', label: 'Anthropic Messages' },
                { value: 'openai-responses', label: 'OpenAI Responses' },
              ]}
            />
          </Form.Item>
          <Form.Item name="defaultModelId" label="默认模型">
            <Input placeholder="deepseek-chat" />
          </Form.Item>
        </div>
        <div className="po-form-row">
          <Form.Item name="timeoutMs" label="超时（毫秒）">
            <InputNumber min={1_000} max={120_000} step={1_000} style={{ width: '100%' }} />
          </Form.Item>
          <div />
        </div>
        <div className="po-ai-editor-inline">
          <Form.Item name="temperature" label="Temperature">
            <Slider min={0} max={2} step={0.05} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="isDefault" label="设为默认" valuePropName="checked">
            <Switch />
          </Form.Item>
        </div>
      </Form>
    </div>
  )
}

