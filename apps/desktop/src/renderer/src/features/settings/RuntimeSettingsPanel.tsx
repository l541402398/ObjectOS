import { Button } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { ErrorState, KeyValueList, LoadingBlock, StatusPill } from '@projectos/ui'
import { errorMessage } from '../../lib/errors'

export function RuntimeSettingsPanel() {
  const preferences = useQuery({
    queryKey: ['appPreferences'],
    queryFn: () => window.projectos.app.preferences(),
  })
  const health = useQuery({
    queryKey: ['runtimeHealth'],
    queryFn: () => window.projectos.runtime.health(),
    refetchInterval: 10_000,
    retry: false,
  })

  return (
    <div className="po-settings-panel">
      <div className="po-settings-panel-head">
        <div>
          <h2>运行时</h2>
          <p>本地进程与数据</p>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            void health.refetch()
            void preferences.refetch()
          }}
        >
          刷新
        </Button>
      </div>

      <div className="po-runtime-status-card">
        <div>
          <span className={`po-status-dot is-${health.data ? 'ready' : 'unknown'}`} />
          <strong>{health.data ? '运行中' : '状态未知'}</strong>
        </div>
        <StatusPill tone={health.data ? 'success' : 'neutral'}>{health.data ? 'ready' : '—'}</StatusPill>
      </div>

      {health.isLoading ? (
        <LoadingBlock rows={3} />
      ) : health.isError ? (
        <ErrorState
          title="无法读取 Runtime 健康"
          message={errorMessage(health.error)}
          onRetry={() => void health.refetch()}
        />
      ) : (
        <KeyValueList
          items={[
            { label: 'PID', value: health.data?.pid ?? '—' },
            { label: '运行时长', value: health.data ? `${Math.round(health.data.uptimeMs / 1000)}s` : '—' },
            { label: '活跃运行', value: health.data?.activeRuns ?? '—' },
            { label: '待审批', value: health.data?.queuedApprovals ?? '—' },
            { label: '协议版本', value: health.data?.protocolVersion ?? '—' },
          ]}
        />
      )}

      <div className="po-settings-divider" />

      <KeyValueList
        items={[
          { label: '数据目录', value: preferences.data?.dataDir ?? '—', mono: true },
          { label: '应用版本', value: preferences.data?.appVersion ?? '0.1.0' },
          { label: '平台', value: preferences.data?.platform ?? '—' },
          { label: 'Electron', value: window.projectos.system.versions.electron ?? '—' },
          { label: 'Node', value: window.projectos.system.versions.node ?? '—' },
          { label: '监听端口', value: '无', mono: true },
        ]}
      />

      <div className="po-setting-row is-actions">
        <div>
          <strong>本地数据</strong>
        </div>
        <Button
          onClick={() =>
            preferences.data?.dataDir ? void window.projectos.app.revealPath(preferences.data.dataDir) : undefined
          }
        >
          打开目录
        </Button>
      </div>
    </div>
  )
}
