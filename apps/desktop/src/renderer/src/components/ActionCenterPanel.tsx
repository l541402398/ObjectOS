import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Badge, Button, Empty, Popover, Tag } from 'antd'
import { BellOutlined, RightOutlined, SyncOutlined } from '@ant-design/icons'
import type { ActionItem } from '@projectos/contracts'
import { useActionCenter, useAutonomySettings } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import './action-center.css'
import { PROJECT_MODES, ProjectModeControl } from './ProjectModeControl'

const KIND_LABEL: Record<string, string> = {
  tool_approval: '工具授权',
  task_acceptance: '任务验收',
  delivery_approval: '发布/部署审批',
  version_gate: '版本门禁',
  deployment_reconciliation: '部署对账',
  run_failure: 'Run 失败',
}

/**
 * Global action panel. Every row is a real persisted object with an exact route, so
 * the user never has to guess which module to open, and nothing falls back to chat.
 */
export function ActionCenterButton({ projectId }: { projectId: string | null }) {
  const navigate = useNavigate()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const actions = useActionCenter(projectId)
  const autonomy = useAutonomySettings(projectId)
  const [open, setOpen] = useState(false)

  const items = actions.data?.items ?? []
  const summary = actions.data?.summary
  const openItems = items.filter((item) => !item.stale)
  const staleItems = items.filter((item) => item.stale)

  const tick = useMutation({
    mutationFn: () => window.projectos.actions.tick(projectId!),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['action-center', projectId ?? ''] })
      await queryClient.invalidateQueries({ queryKey: ['lifecycle'] })
      await queryClient.invalidateQueries({ queryKey: ['gate-overview'] })
      await queryClient.invalidateQueries({ queryKey: ['overview'] })
      if (result.advanced.length === 0) {
        message.info(result.mode === 'autonomous' ? '没有可自动推进的阶段（门禁未满足）' : '自主模式未开启，未自动推进')
      } else {
        message.success(`自动推进 ${result.advanced.length} 个阶段：${result.advanced.map((entry) => `${entry.from}→${entry.to}`).join('、')}`)
      }
    },
    onError: (error) => message.error(errorMessage(error)),
  })

  const openItem = (item: ActionItem): void => {
    setOpen(false)
    navigate(item.route)
  }

  const renderRow = (item: ActionItem) => (
    <button
      type="button"
      key={item.id}
      className={`ac-row ${item.stale ? 'is-stale' : ''}`}
      onClick={() => openItem(item)}
      title={item.route}
    >
      <span className={`ac-risk is-${item.risk}`} aria-hidden />
      <span className="ac-row-main">
        <span className="ac-row-head">
          <Tag className="ac-kind">{KIND_LABEL[item.kind] ?? item.kind}</Tag>
          <strong>{item.title}</strong>
          {item.stale ? <Tag color="default">已过期</Tag> : null}
        </span>
        <span className="ac-reason">{item.reason}</span>
        <span className="ac-decision">需要你：{item.requiredDecision}</span>
        <span className="ac-resume">处理后：{item.resume}</span>
      </span>
      <RightOutlined className="ac-go" />
    </button>
  )

  const content = (
    <div className="ac-panel">
      <header className="ac-head">
        <div>
          <strong>待办与决策</strong>
          <span>{openItems.length} 项需要你处理</span>
        </div>
        <ProjectModeControl projectId={projectId} />
      </header>
      <p className="ac-mode-hint">{PROJECT_MODES.find((mode) => mode.value === autonomy.data?.mode)?.description ?? '正在读取项目工作模式。'}</p>
      <div className="ac-list">
        {openItems.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={projectId ? '当前没有需要你处理的事项' : '先选择一个项目'}
          />
        ) : (
          openItems.map(renderRow)
        )}
        {staleItems.length > 0 ? (
          <>
            <div className="ac-section">已失效（对象已处理或过期）</div>
            {staleItems.map(renderRow)}
          </>
        ) : null}
      </div>
      <footer className="ac-foot">
        <Button
          size="small"
          icon={<SyncOutlined />}
          loading={tick.isPending}
          disabled={!projectId}
          onClick={() => tick.mutate()}
        >
          立即检查自动推进
        </Button>
        <span>
          {summary ? `${summary.total} 项 · ${Object.entries(summary.byKind).map(([kind, count]) => `${KIND_LABEL[kind] ?? kind} ${count}`).join(' · ')}` : ''}
        </span>
      </footer>
    </div>
  )

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      arrow={false}
      overlayClassName="ac-popover"
      content={content}
    >
      <button
        type="button"
        className="po-icon-button"
        aria-label="待办与决策"
        data-testid="action-center-button"
      >
        <Badge count={openItems.length} size="small" offset={[2, -1]}>
          <BellOutlined />
        </Badge>
      </button>
    </Popover>
  )
}
