import { useEffect, useState } from 'react'
import { App as AntApp, Button, InputNumber, Tag } from 'antd'
import { ReloadOutlined, SaveOutlined, SettingOutlined } from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_RUNTIME_SETTINGS, type RuntimeSettings } from '@projectos/contracts'

const QUERY_KEY = ['runtime-settings'] as const

const FIELDS: Array<{
  key: keyof RuntimeSettings
  label: string
  hint: string
  min: number
  max: number
  suffix: string
}> = [
  {
    key: 'plannerMaxOutputTokens',
    label: 'Planner 输出上限',
    hint: '复杂 DAG 的 JSON 输出预算；建议 8192–16384。模型本身仍可能先达到服务端上限。',
    min: 2048,
    max: 32768,
    suffix: 'tokens',
  },
  { key: 'plannerMaxTasks', label: 'Planner 最大任务数', hint: '生成计划允许的最大节点数。', min: 1, max: 20, suffix: '个' },
  { key: 'plannerTimeoutMs', label: 'Planner 单次超时', hint: '单次模型调用超时；过长会拖慢失败反馈。', min: 30_000, max: 300_000, suffix: 'ms' },
  { key: 'agentMaxSteps', label: 'Agent 最大轮次', hint: '单个 Run 的模型/工具轮次上限。', min: 1, max: 200, suffix: '轮' },
  { key: 'agentMaxToolCalls', label: 'Agent 最大工具调用', hint: '单个 Run 实际执行的 ToolCall 上限。', min: 1, max: 500, suffix: '次' },
  { key: 'agentRunTimeoutMinutes', label: 'Agent Run 超时', hint: '单个 Agent Run 的墙钟上限。', min: 1, max: 1440, suffix: '分钟' },
  { key: 'planTimeoutMinutes', label: '计划执行超时', hint: '整个 Plan 执行的墙钟上限。', min: 1, max: 10_080, suffix: '分钟' },
]

export function GeneralSettingsPanel() {
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: QUERY_KEY, queryFn: () => window.projectos.runtime.settings.get() })
  const [draft, setDraft] = useState<RuntimeSettings>(DEFAULT_RUNTIME_SETTINGS)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings.data) setDraft(settings.data)
  }, [settings.data])

  const save = async (): Promise<void> => {
    setSaving(true)
    try {
      const next = await window.projectos.runtime.settings.update(draft)
      setDraft(next)
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      message.success('运行限制已保存；新的 Planner 调用和新的 Run/Plan 会使用新上限')
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="po-settings-panel" data-testid="general-settings">
      <div className="po-settings-panel-head">
        <div>
          <h2>通用与运行限制</h2>
          <p>统一配置 Planner 输出、Agent 执行预算和计划超时；硬限制仍由 Runtime 执行。</p>
        </div>
        <Tag icon={<SettingOutlined />} color="blue">Runtime enforced</Tag>
      </div>

      <div className="po-settings-section-title">Planner</div>
      <div className="v17-preferences-group">
        {FIELDS.filter((field) => field.key.startsWith('planner')).map((field) => (
          <div className="po-setting-row" key={field.key}>
            <div>
              <strong>{field.label}（{field.suffix}）</strong>
              <span>{field.hint}</span>
            </div>
            <InputNumber
              min={field.min}
              max={field.max}
              step={field.key === 'plannerTimeoutMs' ? 5_000 : 1}
              value={draft[field.key]}
              className="po-setting-number"
              style={{ width: 210 }}
              onChange={(value) => {
                if (typeof value === 'number') setDraft((current) => ({ ...current, [field.key]: value }))
              }}
            />
          </div>
        ))}
      </div>

      <div className="po-settings-section-title">Agent / Plan</div>
      <div className="v17-preferences-group">
        {FIELDS.filter((field) => !field.key.startsWith('planner')).map((field) => (
          <div className="po-setting-row" key={field.key}>
            <div>
              <strong>{field.label}（{field.suffix}）</strong>
              <span>{field.hint}</span>
            </div>
            <InputNumber
              min={field.min}
              max={field.max}
              value={draft[field.key]}
              className="po-setting-number"
              style={{ width: 210 }}
              onChange={(value) => {
                if (typeof value === 'number') setDraft((current) => ({ ...current, [field.key]: value }))
              }}
            />
          </div>
        ))}
      </div>

      <div className="po-general-settings-note">
        这些是 Runtime 硬预算：修改只影响新的 Planner 调用、新的 Agent Run 和新的 Plan。已经开始执行的 Run/Plan 保留启动时的预算快照，避免中途被扩大权限。
      </div>

      <div className="po-general-settings-actions">
        <Button icon={<ReloadOutlined />} onClick={() => setDraft(DEFAULT_RUNTIME_SETTINGS)} disabled={saving}>
          恢复默认值
        </Button>
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>
          保存运行限制
        </Button>
      </div>
    </div>
  )
}
