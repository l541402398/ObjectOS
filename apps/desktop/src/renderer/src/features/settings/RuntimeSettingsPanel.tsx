import { useState } from 'react'
import { App, Button, Form, Input, Modal, Select, Tag } from 'antd'
import { PlusOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorState, KeyValueList, LoadingBlock, StatusPill } from '@projectos/ui'
import type { RuntimeProfile } from '@projectos/contracts'
import { AcpRegistryPanel } from './AcpRegistryPanel'
import { errorMessage } from '../../lib/errors'

export function RuntimeSettingsPanel() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const preferences = useQuery({ queryKey: ['appPreferences'], queryFn: () => window.projectos.app.preferences() })
  const health = useQuery({ queryKey: ['runtimeHealth'], queryFn: () => window.projectos.runtime.health(), refetchInterval: 10_000, retry: false })
  const profiles = useQuery({ queryKey: ['runtime-profiles'], queryFn: () => window.projectos.runtimeProfiles.list() })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [installing, setInstalling] = useState<string | null>(null)
  const [testProfile, setTestProfile] = useState<RuntimeProfile | null>(null)
  const [testPrompt, setTestPrompt] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
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

  const runTest = async (): Promise<void> => {
    if (!testProfile) return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await window.projectos.runtimeProfiles.execute(testProfile.id, testPrompt)
      setTestResult(`[${result.status}] ${result.output}`)
    } catch (error) {
      setTestResult(errorMessage(error))
    } finally {
      setTesting(false)
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

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div><h2>运行时</h2><p>本地进程与 Agent Runtime</p></div>
        <Button icon={<ReloadOutlined />} onClick={() => { void health.refetch(); void preferences.refetch() }}>刷新</Button>
      </div>

      <div className="po-runtime-status-card">
        <div><span className={`po-status-dot is-${health.data ? 'ready' : 'unknown'}`} /><strong>{health.data ? '运行中' : '状态未知'}</strong></div>
        <StatusPill tone={health.data ? 'success' : 'neutral'}>{health.data ? 'ready' : '—'}</StatusPill>
      </div>
      {health.isLoading ? <LoadingBlock rows={3} /> : health.isError ? <ErrorState title="无法读取 Runtime 健康" message={errorMessage(health.error)} onRetry={() => void health.refetch()} /> : (
        <KeyValueList items={[
          { label: 'PID', value: health.data?.pid ?? '—' },
          { label: '运行时长', value: health.data ? `${Math.round(health.data.uptimeMs / 1000)}s` : '—' },
          { label: '活跃运行', value: health.data?.activeRuns ?? '—' },
          { label: '待审批', value: health.data?.queuedApprovals ?? '—' },
          { label: '协议版本', value: health.data?.protocolVersion ?? '—' },
        ]} />
      )}

      <div className="po-settings-divider" />
      <div className="po-settings-section-head po-runtime-head">
        <div><h2>Agent Runtime</h2><p>检测、安装与自定义执行引擎</p></div>
        <div className="po-runtime-actions">
          <Button icon={<ThunderboltOutlined />} loading={busy} onClick={() => void detect()}>检测环境</Button>
          <Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>自定义</Button>
        </div>
      </div>
      <div className="po-runtime-list">
        {(profiles.data?.profiles ?? []).map((profile) => {
          const detection = profiles.data?.detections.find((item) => item.profileId === profile.id)
          const adapterId = typeof profile.options.adapterId === 'string' ? profile.options.adapterId : profile.id
          const installable = ['claude-code', 'codex', 'opencode', 'qwen-code', 'gemini-cli'].includes(adapterId)
          const available = detection?.status === 'available' || profile.status === 'available'
          return (
            <div className="po-runtime-row" key={profile.id}>
              <div className="po-runtime-row-main">
                <strong>{profile.name}</strong>
                <span>{profile.protocol} · {profile.executable ?? profile.endpoint ?? '内置'}</span>
                <div className="po-runtime-caps">
                  {profile.capabilities.stream ? <Tag>stream</Tag> : null}
                  {profile.capabilities.toolCalls ? <Tag>tools</Tag> : null}
                  {profile.capabilities.skills ? <Tag>skills</Tag> : null}
                  {profile.capabilities.systemPrompt !== 'unsupported' ? <Tag>prompt:{profile.capabilities.systemPrompt}</Tag> : null}
                </div>
              </div>
              <div className="po-runtime-state">
                <StatusPill tone={available ? 'success' : detection?.status === 'unavailable' ? 'danger' : 'neutral'}>
                  {available ? '可用' : detection?.status === 'unavailable' ? '未安装' : '未检测'}
                </StatusPill>
                <span>{detection?.version ?? detection?.message ?? ''}</span>
                {!available && installable ? (
                  <Button size="small" type="primary" loading={installing === profile.id} onClick={() => install(profile)}>安装</Button>
                ) : null}
                {!available && adapterId === 'deepseek-harness' ? <Tag>手动安装</Tag> : null}
                {profile.protocol === 'acp' ? (
                  <Button
                    size="small"
                    onClick={() => {
                      const method = window.prompt('认证方式 ID')
                      if (method) {
                        void window.projectos.runtimeProfiles
                          .acpAuthenticate(profile.id, method)
                          .then((result) => message.success('认证成功：' + JSON.stringify(result.result)))
                          .catch((error) => message.error(errorMessage(error)))
                      }
                    }}
                  >
                    认证
                  </Button>
                ) : null}
                {profile.protocol !== 'native' ? (
                  <Button size="small" onClick={() => { setTestProfile(profile); setTestPrompt(''); setTestResult(null) }}>
                    测试
                  </Button>
                ) : null}
                {profile.source === 'custom' ? (
                  <Button
                    size="small"
                    onClick={() => {
                      const name = window.prompt('Runtime 名称', profile.name)
                      if (!name) return
                      const executable = window.prompt('可执行路径', profile.executable ?? '')
                      void window.projectos.runtimeProfiles
                        .upsert({
                          id: profile.id,
                          name,
                          protocol: profile.protocol,
                          executable: executable || null,
                          endpoint: profile.endpoint,
                          args: profile.args,
                          authRef: profile.authRef,
                          modelRef: profile.modelRef,
                          options: profile.options,
                          capabilities: profile.capabilities,
                        })
                        .then(() => {
                          message.success('Runtime 已更新')
                          void queryClient.invalidateQueries({ queryKey: ['runtime-profiles'] })
                        })
                        .catch((error) => message.error(errorMessage(error)))
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
            </div>
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
        { label: '应用版本', value: preferences.data?.appVersion ?? '1.6.0' },
        { label: '平台', value: preferences.data?.platform ?? '—' },
        { label: 'Electron', value: window.projectos.system.versions.electron ?? '—' },
        { label: 'Node', value: window.projectos.system.versions.node ?? '—' },
        { label: '监听端口', value: '无', mono: true },
      ]} />
      <div className="po-setting-row is-actions">
        <div><strong>本地数据</strong></div>
        <Button onClick={() => preferences.data?.dataDir ? void window.projectos.app.revealPath(preferences.data.dataDir) : undefined}>打开目录</Button>
      </div>

      <Modal open={open} title="自定义 Runtime" onCancel={() => setOpen(false)} onOk={() => void create()} okText="添加" destroyOnHidden>
        <Form form={form} layout="vertical" initialValues={{ protocol: 'cli' }}>
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="protocol" label="协议" rules={[{ required: true }]}><Select options={[{ value: 'cli', label: 'CLI' }, { value: 'http', label: 'HTTP' }, { value: 'acp', label: 'ACP' }, { value: 'sdk', label: 'SDK' }]} /></Form.Item>
          <Form.Item name="executable" label="可执行路径"><Input placeholder="opencode" /></Form.Item>
          <Form.Item name="endpoint" label="Endpoint"><Input placeholder="http://127.0.0.1:4096" /></Form.Item>
        </Form>
      </Modal>
      <Modal open={Boolean(testProfile)} title={`测试 ${testProfile?.name ?? ''}`} onCancel={() => setTestProfile(null)} onOk={() => void runTest()} okText="运行" confirmLoading={testing} width={680} destroyOnHidden>
        <Input.TextArea rows={3} value={testPrompt} onChange={(event) => setTestPrompt(event.target.value)} placeholder="输入测试任务" />
        {testResult ? <pre className="po-runtime-output">{testResult}</pre> : null}
      </Modal>
    </div>
  )
}





