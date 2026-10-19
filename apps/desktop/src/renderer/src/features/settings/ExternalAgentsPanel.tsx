import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Input, Select } from 'antd'
import { ArrowLeftOutlined, PlayCircleOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons'
import { ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import { useBootstrap, useExternalAgents } from '../../lib/queries'
import { errorMessage } from '../../lib/errors'
import { useUiStore } from '../../stores/ui'

export function ExternalAgentsPanel() {
  const query = useExternalAgents()
  const bootstrap = useBootstrap()
  const navigate = useNavigate()
  const closeSettings = useUiStore((state) => state.closeSettings)
  const { message } = App.useApp()
  const [adapter, setAdapter] = useState<'claude-code' | 'codex' | null>(null)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [running, setRunning] = useState(false)

  const start = async (): Promise<void> => {
    if (!adapter || !projectId || prompt.trim().length < 3) {
      message.warning('请选择项目和填写任务描述')
      return
    }
    setRunning(true)
    try {
      const result = await window.projectos.externalAgents.execute({
        projectId,
        adapterId: adapter,
        prompt: prompt.trim(),
        allowWrite: false,
      })
      closeSettings()
      navigate(`/projects/${projectId}/agents?session=${result.sessionId}`)
      message.success(`外部 Agent 已启动 · ${result.readOnly ? '只读' : '可写'}`)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div>
          <h2>外部 Agent</h2>
          <p>Claude Code · Codex CLI</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void query.refetch()}>
          重新检测
        </Button>
      </div>

      <div className="po-external-note">
        <RobotOutlined />
        <span>执行使用外部 CLI 自身授权；ProjectOS 只记录运行、输出与事件。当前仅开放只读 Plan 模式。</span>
      </div>

      {query.isLoading ? (
        <LoadingBlock rows={4} />
      ) : query.isError ? (
        <ErrorState title="检测失败" message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <div className="po-external-list">
          {(query.data?.installations ?? []).map((item) => (
            <div className="po-external-card" key={item.adapterId}>
              <div className="po-external-head">
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.adapterId}</span>
                </div>
                <StatusPill tone={item.installed ? 'success' : 'neutral'}>
                  {item.installed ? '已安装' : '未安装'}
                </StatusPill>
              </div>
              <div className="po-external-meta">
                <span>版本</span>
                <strong>{item.version ?? '—'}</strong>
              </div>
              <div className="po-external-meta">
                <span>路径</span>
                <strong title={item.executablePath ?? undefined}>{item.executablePath ?? '—'}</strong>
              </div>
              <div className="po-external-message">{item.message}</div>
              {item.installed ? (
                <div className="po-external-actions">
                  <Button size="small" icon={<PlayCircleOutlined />} onClick={() => { setAdapter(item.adapterId); setPrompt('') }}>
                    只读运行
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {adapter ? (
        <div className="po-external-runner">
          <div className="po-external-runner-head">
            <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => setAdapter(null)}>
              外部 Agent
            </Button>
            <strong>{adapter} · 只读 Plan</strong>
          </div>
          <label>项目</label>
          <Select
            value={projectId}
            placeholder="选择项目"
            options={(bootstrap.data?.projects ?? []).map((project) => ({ value: project.id, label: project.name }))}
            onChange={setProjectId}
          />
          <label>任务描述</label>
          <Input.TextArea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="让外部 Agent 分析或规划什么？" />
          <div className="po-external-runner-actions">
            <Button onClick={() => setAdapter(null)}>取消</Button>
            <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={() => void start()}>
              启动只读运行
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
