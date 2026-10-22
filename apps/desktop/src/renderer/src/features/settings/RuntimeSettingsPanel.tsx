import { useState } from 'react'
import { App, Button, Form, Input, Select, Tag, Tooltip } from 'antd'
import { PlusOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorState, KeyValueList, StatusPill } from '@projectos/ui'
import type { RuntimeProfile } from '@projectos/contracts'
import { AcpRegistryPanel } from './AcpRegistryPanel'
import { useUiStore } from '../../stores/ui'
import { errorMessage } from '../../lib/errors'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from '../../next-ui/overlay/overlay-shell'

export function RuntimeSettingsPanel() {
  const settingsOpen = useUiStore((state) => state.settingsOpen)
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const preferences = useQuery({ queryKey: ['appPreferences'], queryFn: () => window.projectos.app.preferences() })
  const health = useQuery({ queryKey: ['runtimeHealth'], queryFn: () => window.projectos.runtime.health(), refetchInterval: 10_000, retry: false })
  const profiles = useQuery({ queryKey: ['runtime-profiles', 'settings'], queryFn: () => window.projectos.runtimeProfiles.list(), refetchOnMount: 'always' })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'available' | 'missing'>('all')
  const [authProfile, setAuthProfile] = useState<RuntimeProfile | null>(null)
  const [authMethod, setAuthMethod] = useState('')
  const [editingProfile, setEditingProfile] = useState<RuntimeProfile | null>(null)
  const [editName, setEditName] = useState('')
  const [editExecutable, setEditExecutable] = useState('')
  const [form] = Form.useForm()

  const detect = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.projectos.runtimeProfiles.detect()
      await queryClient.invalidateQueries({ queryKey: ['runtime-profiles'] })
      message.success('Runtime 检测完成')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const install = (profile: RuntimeProfile): void => {
    modal.confirm({
      title: `安装 ${profile.name}？`,
      content: '将从 npm 全局安装该 Harness。需要网络访问，安装完成后会自动重新检测。',
      okText: '安装',
      cancelText: '取消',
      onOk: async () => {
        setInstalling(profile.id)
        try {
          const result = await window.projectos.runtimeProfiles.install(profile.id)
          await queryClient.invalidateQueries({ queryKey: ['runtime-profiles'] })
          message.success(`${profile.name}：${result.detection.status === 'available' ? '已安装' : result.detection.message}`)
        } catch (error) {
          message.error(errorMessage(error))
        } finally {
          setInstalling(null)
        }
      },
    })
  }

  const runHarnessTest = async (profile: RuntimeProfile): Promise<void> => {
    setTestingId(profile.id)
    try {
      const prompt = 'Reply with exactly: PROJECTOS-HARNESS-OK'
      if (profile.protocol === 'acp') {
        const result = await window.projectos.runtimeProfiles.acpPrompt(profile.id, prompt)
        setTestResults((current) => ({ ...current, [profile.id]: { ok: true, text: JSON.stringify(result.result).slice(0, 4000) } }))
        message.success('Harness 测试完成')
      } else {
        const result = await window.projectos.runtimeProfiles.execute(profile.id, prompt)
        setTestResults((current) => ({ ...current, [profile.id]: { ok: result.status === 'completed', text: `[${result.status}] ${result.output}`.slice(0, 4000) } }))
        if (result.status === 'completed') message.success('Harness 测试通过')
        else message.warning(`Harness 测试 ${result.status}`)
      }
    } catch (error) {
      setTestResults((current) => ({ ...current, [profile.id]: { ok: false, text: errorMessage(error) } }))
      message.error(errorMessage(error))
    } finally {
      setTestingId(null)
    }
  }

  const authenticateAcp = async (): Promise<void> => {
    if (!authProfile || !authMethod.trim()) return
    try {
      const result = await window.projectos.runtimeProfiles.acpAuthenticate(authProfile.id, authMethod.trim())
      message.success('认证成功：' + JSON.stringify(result.result))
      setAuthProfile(null)
      setAuthMethod('')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const saveRuntimeEdit = async (): Promise<void> => {
    if (!editingProfile || !editName.trim()) return
    try {
      await window.projectos.runtimeProfiles.upsert({
        id: editingProfile.id,
        name: editName.trim(),
        protocol: editingProfile.protocol,
        executable: editExecutable.trim() || null,
        endpoint: editingProfile.endpoint,
        args: editingProfile.args,
        authRef: editingProfile.authRef,
        modelRef: editingProfile.modelRef,
        options: editingProfile.options,
        capabilities: editingProfile.capabilities,
      })
      message.success('Runtime 已更新')
      setEditingProfile(null)
      await queryClient.invalidateQueries({ queryKey: ['runtime-profiles'] })
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const create = async (): Promise<void> => {    const values = await form.validateFields()
    try {
      await window.projectos.runtimeProfiles.upsert({
        name: values.name,
        protocol: values.protocol,
        executable: values.executable || null,
        endpoint: values.endpoint || null,
        args: [],
        authRef: null,
        modelRef: null,
        options: {},
        capabilities: {},
      })
      await queryClient.invalidateQueries({ queryKey: ['runtime-profiles'] })
      setOpen(false)
      form.resetFields()
      message.success('Runtime 已添加')
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  const profileList = profiles.data?.profiles ?? []
  const availableCount = profileList.filter((profile) => profiles.data?.detections.find((item) => item.profileId === profile.id)?.status === 'available' || profile.status === 'available').length
  const missingCount = profileList.filter((profile) => {
    const detection = profiles.data?.detections.find((item) => item.profileId === profile.id)
    return detection?.status === 'unavailable' || profile.status === 'unavailable'
  }).length

  return (
    <div className="po-settings-panel v17-runtime-panel">
      <div className="po-settings-panel-head">
        <div><h2>运行时</h2><p>本地进程与 Agent Runtime</p></div>
        <Button icon={<ReloadOutlined />} onClick={() => { void health.refetch(); void preferences.refetch() }}>刷新</Button>
      </div>

      <div className="v17-runtime-healthbar">
        <div className="is-status">
          <span className={`po-status-dot is-${health.data ? 'ready' : 'unknown'}`} />
          <strong>{health.data ? '运行中' : health.isLoading ? '检测中' : '状态未知'}</strong>
          <StatusPill tone={health.data ? 'success' : 'neutral'}>{health.data ? 'ready' : '—'}</StatusPill>
        </div>
        {health.data ? (
          <div className="is-metrics">
            <span><em>PID</em><strong>{health.data.pid ?? '—'}</strong></span>
            <span><em>运行时长</em><strong>{Math.round(health.data.uptimeMs / 1000)}s</strong></span>
            <span><em>活跃运行</em><strong>{health.data.activeRuns}</strong></span>
            <span><em>待审批</em><strong>{health.data.queuedApprovals}</strong></span>
            <span><em>协议</em><strong>v{health.data.protocolVersion}</strong></span>
          </div>
        ) : null}
      </div>
      {health.isError ? <ErrorState title="无法读取 Runtime 健康" message={errorMessage(health.error)} onRetry={() => void health.refetch()} /> : null}

      <div className="po-settings-section-head po-runtime-head">
        <div><h2>Agent Runtime</h2><p>检测、安装与自定义执行引擎</p></div>
        <div className="po-runtime-actions">
          <Button icon={<ThunderboltOutlined />} loading={busy} onClick={() => void detect()}>检测环境</Button>
          <Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>自定义</Button>
        </div>
      </div>

      <div className="v17-runtime-toolbar">
        <div className="v17-runtime-filter">
          {([['all', '全部'], ['available', '可用'], ['missing', '未安装']] as const).map(([key, label]) => (
            <button type="button" key={key} className={filter === key ? 'is-active' : ''} onClick={() => setFilter(key)}>{label}</button>
          ))}
        </div>
        <span className="po-grow" />
        <span className="v17-runtime-summary"><strong>{availableCount}</strong> 可用 · <strong>{profileList.length}</strong> 登记 · <strong>{missingCount}</strong> 待安装</span>
        <span className="v17-runtime-hint">检测结果保存在本机</span>
      </div>

      <div className="v17-runtime-list">
        {(profiles.data?.profiles ?? []).map((profile) => {
          const detection = profiles.data?.detections.find((item) => item.profileId === profile.id)
          const adapterId = typeof profile.options.adapterId === 'string' ? profile.options.adapterId : profile.id
          const installable = ['claude-code', 'codex', 'opencode', 'qwen-code', 'gemini-cli', 'deepseek-harness'].includes(adapterId)
          const available = detection?.status === 'available' || profile.status === 'available'
          const missing = detection?.status === 'unavailable' || profile.status === 'unavailable'
          if (filter === 'available' && !available) return null
          if (filter === 'missing' && !missing) return null
          const testResult = testResults[profile.id]
          const executable = profile.executable ?? profile.endpoint ?? (profile.protocol === 'native' ? '内置运行时' : '未配置')
          return (
            <article className={`v17-runtime-card ${available ? 'is-available' : missing ? 'is-missing' : ''}`} key={profile.id}>
              <div className="v17-runtime-card-head">
                <span className="v17-runtime-icon"><ThunderboltOutlined /></span>
                <div className="v17-runtime-title">
                  <strong>{profile.name}</strong>
                  <span>{profile.protocol.toUpperCase()} · {profile.source === 'builtin' ? '内置' : profile.source === 'custom' ? '自定义' : profile.source}</span>
                </div>
                <StatusPill tone={available ? 'success' : missing ? 'danger' : 'neutral'}>
                  {available ? '可用' : missing ? '未安装' : '未检测'}
                </StatusPill>
              </div>

              <div className="v17-runtime-meta">
                <div className="v17-runtime-path">
                  <span>可执行文件</span>
                  <Tooltip title={executable}>
                    <code>{executable}</code>
                  </Tooltip>
                </div>
                <div>
                  <span>版本</span>
                  <strong>{detection?.version ?? '—'}</strong>
                </div>
                <div>
                  <span>来源</span>
                  <strong>{profile.source}</strong>
                </div>
              </div>

              <div className="v17-runtime-caps">
                {profile.capabilities.stream ? <Tag>stream</Tag> : null}
                {profile.capabilities.toolCalls ? <Tag>tools</Tag> : null}
                {profile.capabilities.skills ? <Tag>skills</Tag> : null}
                {profile.capabilities.systemPrompt !== 'unsupported' ? <Tag>prompt:{profile.capabilities.systemPrompt}</Tag> : null}
                {profile.capabilities.permissions ? <Tag>permissions</Tag> : null}
                {profile.capabilities.worktree ? <Tag>worktree</Tag> : null}
              </div>

              {!available && detection?.message ? (
                <div className="v17-runtime-warning">{detection.message.replace(/^安装不完整：/, '').slice(0, 420)}</div>
              ) : null}

              {testResult ? (
                <div className={`v17-runtime-test ${testResult.ok ? 'is-ok' : 'is-error'}`}>
                  <div><strong>{testResult.ok ? '测试通过' : '测试失败'}</strong><Button type="text" size="small" onClick={() => setTestResults((current) => { const next = { ...current }; delete next[profile.id]; return next })}>清除</Button></div>
                  <pre>{testResult.text}</pre>
                </div>
              ) : null}

              <div className="v17-runtime-card-actions">
                {!available && installable ? (
                  <Button size="small" type="primary" loading={installing === profile.id} onClick={() => install(profile)}>安装</Button>
                ) : null}
                {profile.protocol !== 'native' ? (
                  <Button size="small" loading={testingId === profile.id} onClick={() => void runHarnessTest(profile)}>测试</Button>
                ) : null}
                {profile.protocol === 'acp' ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setAuthProfile(profile)
                      setAuthMethod('')
                    }}
                  >
                    认证
                  </Button>
                ) : null}
                {profile.source === 'custom' ? (
                  <Button
                    size="small"
                    onClick={() => {
                      setEditingProfile(profile)
                      setEditName(profile.name)
                      setEditExecutable(profile.executable ?? '')
                    }}
                  >
                    编辑
                  </Button>
                ) : null}
                {profile.source === 'custom' ? (
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      void window.projectos.runtimeProfiles
                        .delete(profile.id)
                        .then(() => {
                          message.success('Runtime 已删除')
                          void queryClient.invalidateQueries({ queryKey: ['runtime-profiles'] })
                        })
                        .catch((error) => message.error(errorMessage(error)))
                    }}
                  >
                    删除
                  </Button>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>

      <AcpRegistryPanel />
      <div className="po-runtime-actions po-runtime-registry">
        <Button onClick={() => void window.projectos.runtimeProfiles.registry().then((result) => message.info(`ACP Registry：${result.entries.length} 个 Agent（${result.source}）`)).catch((error) => message.error(errorMessage(error)))}>
          拉取 ACP Registry
        </Button>
      </div>

      <div className="po-settings-divider" />
      <KeyValueList items={[
        { label: '数据目录', value: preferences.data?.dataDir ?? '—', mono: true },
        { label: '应用版本', value: preferences.data?.appVersion ?? '1.7.0' },
        { label: '平台', value: preferences.data?.platform ?? '—' },
        { label: 'Electron', value: window.projectos.system.versions.electron ?? '—' },
        { label: 'Node', value: window.projectos.system.versions.node ?? '—' },
        { label: '监听端口', value: '无', mono: true },
      ]} />
      <div className="po-setting-row is-actions">
        <div><strong>本地数据</strong></div>
        <Button onClick={() => preferences.data?.dataDir ? void window.projectos.app.revealPath(preferences.data.dataDir) : undefined}>打开目录</Button>
      </div>

      <DialogShell open={open && settingsOpen} onOpenChange={(next) => { if (!next) setOpen(false) }} ariaLabel="自定义 Runtime" width={520}>
        <OverlayHeader eyebrow="RUNTIME" title="自定义 Runtime" closeLabel="关闭自定义 Runtime" />
        <OverlayScrollArea className="po-dialog-form-scroll">
        <Form form={form} layout="vertical" initialValues={{ protocol: 'cli' }}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="protocol" label="协议" rules={[{ required: true }]}><Select options={[{ value: 'cli', label: 'CLI' }, { value: 'http', label: 'HTTP' }, { value: 'acp', label: 'ACP' }, { value: 'sdk', label: 'SDK' }]} /></Form.Item>
          <Form.Item name="executable" label="可执行路径"><Input placeholder="opencode" /></Form.Item>
          <Form.Item name="endpoint" label="Endpoint"><Input placeholder="http://127.0.0.1:4096" /></Form.Item>
        </Form>
        </OverlayScrollArea>
        <OverlayFooter>
          <Button onClick={() => setOpen(false)}>取消</Button>
          <Button type="primary" onClick={() => void create()}>添加</Button>
        </OverlayFooter>
      </DialogShell>

      <DialogShell open={Boolean(authProfile) && settingsOpen} onOpenChange={(next) => { if (!next) setAuthProfile(null) }} ariaLabel="ACP 认证" width={480}>
        <OverlayHeader eyebrow="ACP AUTH" title={`ACP 认证 · ${authProfile?.name ?? ''}`} closeLabel="关闭 ACP 认证" />
        <OverlayScrollArea className="po-dialog-form-scroll">
        <Form layout="vertical">
          <Form.Item label="认证方式 ID" required>
            <Input
              value={authMethod}
              onChange={(event) => setAuthMethod(event.target.value)}
              placeholder="例如 oauth 或 API Key 方式"
            />
          </Form.Item>
        </Form>
        </OverlayScrollArea>
        <OverlayFooter>
          <Button onClick={() => setAuthProfile(null)}>取消</Button>
          <Button type="primary" disabled={!authMethod.trim()} onClick={() => void authenticateAcp()}>认证</Button>
        </OverlayFooter>
      </DialogShell>

      <DialogShell open={Boolean(editingProfile) && settingsOpen} onOpenChange={(next) => { if (!next) setEditingProfile(null) }} ariaLabel="编辑 Runtime" width={480}>
        <OverlayHeader eyebrow="RUNTIME" title={`编辑 Runtime · ${editingProfile?.name ?? ''}`} closeLabel="关闭编辑 Runtime" />
        <OverlayScrollArea className="po-dialog-form-scroll">
        <Form layout="vertical">
          <Form.Item label="名称" required>
            <Input value={editName} onChange={(event) => setEditName(event.target.value)} />
          </Form.Item>
          <Form.Item label="可执行路径">
            <Input value={editExecutable} onChange={(event) => setEditExecutable(event.target.value)} placeholder="opencode" />
          </Form.Item>
        </Form>
        </OverlayScrollArea>
        <OverlayFooter>
          <Button onClick={() => setEditingProfile(null)}>取消</Button>
          <Button type="primary" disabled={!editName.trim()} onClick={() => void saveRuntimeEdit()}>保存</Button>
        </OverlayFooter>
      </DialogShell>
    </div>
  )
}
