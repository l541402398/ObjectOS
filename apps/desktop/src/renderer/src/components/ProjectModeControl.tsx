import { App, Select } from 'antd'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAutonomySettings } from '../lib/queries'
import { errorMessage } from '../lib/errors'

export const PROJECT_MODES = [
  { value: 'assist', label: '辅助模式', description: '系统准备建议，由你决定何时推进。' },
  { value: 'autonomous', label: '自主模式', description: '在已有授权内自动执行，满足门禁后推进；需要决定时通知你。' },
  { value: 'managed', label: '托管模式', description: '沿用项目的受限托管范围；授权与门禁仍然生效。' },
] as const

export function ProjectModeControl({ projectId }: { projectId: string | null }) {
  const settings = useAutonomySettings(projectId), client = useQueryClient(), { message } = App.useApp()
  const change = useMutation({
    mutationFn: (mode: 'assist' | 'autonomous' | 'managed') => window.projectos.actions.setAutonomy({ projectId: projectId!, mode }),
    onSuccess: async (next) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['autonomy-settings', projectId ?? ''] }),
        client.invalidateQueries({ queryKey: ['action-center', projectId ?? ''] }),
        client.invalidateQueries({ queryKey: ['work', 'journey'] }),
      ])
      message.success(`已切换为${PROJECT_MODES.find((mode) => mode.value === next.mode)?.label ?? next.mode}`)
    },
    onError: (error) => message.error(errorMessage(error)),
  })
  return <Select className="po-project-mode" aria-label="项目工作模式" value={settings.data?.mode}
    placeholder={settings.isError ? '模式读取失败' : '读取工作模式'}
    disabled={!projectId || settings.isError || change.isPending} loading={settings.isLoading || change.isPending}
    style={{ width: 152 }} options={PROJECT_MODES.map(({ value, label, description }) => ({ value, label, title: description }))}
    onChange={(mode) => change.mutate(mode)} />
}
