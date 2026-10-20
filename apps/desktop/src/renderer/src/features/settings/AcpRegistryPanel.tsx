import { useState } from 'react'
import { App, Button, Tag } from 'antd'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { useQueryClient } from '@tanstack/react-query'
import type { RuntimeRegistryEntry } from '@projectos/contracts'
import { errorMessage } from '../../lib/errors'

export function AcpRegistryPanel() {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const [entries, setEntries] = useState<RuntimeRegistryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    setLoading(true)
    try {
      const result = await window.projectos.runtimeProfiles.registry()
      setEntries(result.entries)
      message.info(`ACP Registry：${result.entries.length} 个 Agent（${result.source}）`)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const importEntry = async (entry: RuntimeRegistryEntry): Promise<void> => {
    setImporting(entry.id)
    try {
      await window.projectos.runtimeProfiles.importRegistry({
        registryId: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
      })
      await queryClient.invalidateQueries({ queryKey: ['runtime-profiles'] })
      message.success('已导入 Runtime，请配置认证与可执行路径')
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setImporting(null)
    }
  }

  return (
    <div className="po-acp-registry">
      <div className="po-acp-registry-head">
        <strong>ACP 可发现</strong>
        <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>拉取</Button>
      </div>
      {entries.slice(0, 20).map((entry) => (
        <div className="po-acp-registry-row" key={entry.id}>
          <div>
            <strong>{entry.name}</strong>
            <span>{entry.id} · {entry.version ?? '—'}</span>
          </div>
          <Tag>Registry</Tag>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            loading={importing === entry.id}
            onClick={() =>
              modal.confirm({
                title: `导入 ${entry.name}？`,
                content: '只注册 ACP Runtime 配置，不会下载或执行安装脚本。认证与可执行路径需另行配置。',
                okText: '导入',
                onOk: () => importEntry(entry),
              })
            }
          >
            导入
          </Button>
        </div>
      ))}
      {!entries.length ? <span className="po-acp-registry-empty">拉取 Registry 查看可接入 Agent</span> : null}
    </div>
  )
}

