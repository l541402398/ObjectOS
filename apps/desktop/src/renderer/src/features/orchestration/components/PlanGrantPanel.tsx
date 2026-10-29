import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Tag,
} from 'antd'
import {
  ClockCircleOutlined,
  LockOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type {
  PlanDraft,
  PlanExecutionGrantIssueInput,
  PlanExecutionGrantView,
  ProjectBudgetStatus,
} from '@projectos/contracts'
import { StatusPill } from '@projectos/ui'

export interface PlanGrantPanelProps {
  plan: PlanDraft
  grant: PlanExecutionGrantView | null
  budget: ProjectBudgetStatus | null
  busy: boolean
  onIssue: (input: PlanExecutionGrantIssueInput, start: boolean) => Promise<void>
  onRevoke: (grantId: string) => Promise<void>
  onStart: (grantId: string) => Promise<void>
  onResume: (grantId: string) => Promise<void>
}

function statusTone(status: PlanExecutionGrantView['status']): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') return 'success'
  if (status === 'revoked') return 'danger'
  if (status === 'expired' || status === 'exhausted') return 'warning'
  return 'neutral'
}

function statusLabel(status: PlanExecutionGrantView['status']): string {
  if (status === 'active') return '有效'
  if (status === 'revoked') return '已撤销'
  if (status === 'expired') return '已过期'
  if (status === 'exhausted') return '已用尽'
  return status
}

function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export function PlanGrantPanel({
  plan,
  grant,
  budget,
  busy,
  onIssue,
  onRevoke,
  onStart,
  onResume,
}: PlanGrantPanelProps) {
  const [workspaceWrite, setWorkspaceWrite] = useState(false)
  // ADR-0056: test/read-only commands can be authorized up front instead of one approval each.
  const [runTests, setRunTests] = useState(true)
  const [allowedPaths, setAllowedPaths] = useState<string[]>([])
  const [maxToolCalls, setMaxToolCalls] = useState(40)
  const [maxRuns, setMaxRuns] = useState(1)
  const [ttlHours, setTtlHours] = useState(24)
  const [allowOverBudget, setAllowOverBudget] = useState(false)
  const [note, setNote] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)

  const resetSafeDefaults = useCallback((): void => {
    setWorkspaceWrite(false)
    setRunTests(true)
    setAllowedPaths([])
    setMaxToolCalls(40)
    setMaxRuns(1)
    setTtlHours(24)
    setAllowOverBudget(false)
    setNote('')
    setAcknowledged(false)
  }, [])

  useEffect(() => {
    resetSafeDefaults()
  }, [plan.id, resetSafeDefaults])

  // A revoked/expired/invalidated grant must not leave dangerous permissions
  // pre-checked for the next authorisation form.
  useEffect(() => {
    if (grant?.valid && grant.status === 'active') return
    resetSafeDefaults()
  }, [grant?.id, grant?.status, grant?.valid, resetSafeDefaults])

  const budgetLimit = budget?.budget?.softLimit ?? 0
  const budgetExceeded = Boolean(budget?.exceeded)
  const active = grant?.valid === true && grant.status === 'active'
  const executionRunning = plan.execution?.status === 'running'
  const executionPaused = plan.execution?.status === 'paused'
  const workspaceWriteSelected = workspaceWrite
  const canIssue =
    acknowledged &&
    !busy &&
    (!workspaceWriteSelected || allowedPaths.length > 0) &&
    (!allowOverBudget || note.trim().length >= 8)

  const issue = async (start: boolean): Promise<void> => {
    if (!canIssue) return
    await onIssue(
      {
        planId: plan.id,
        actions: [
          'plan.start',
          ...(workspaceWriteSelected ? (['workspace-write'] as const) : []),
          ...(runTests ? (['run-tests'] as const) : []),
        ],
        allowedPaths: workspaceWriteSelected ? allowedPaths : [],
        maxRuns,
        maxToolCalls,
        ttlHours,
        allowOverBudget,
        note: note.trim(),
        confirm: true,
      },
      start,
    )
  }

  return (
    <section className="po-grant" data-testid="plan-grant-panel">
      <div className="po-grant-head">
        <div className="po-grant-title">
          <span className="po-grant-icon"><LockOutlined /></span>
          <div>
            <span className="po-grant-kicker">PLAN EXECUTION GRANT</span>
            <strong>计划执行授权</strong>
            <span className="po-grant-sub">
              批准任务计划只创建任务；只有这里的有限授权才允许启动 Agent 与写文件。
            </span>
          </div>
        </div>
        <div className="po-grant-head-right">
          {grant?.valid && grant.status === 'active' && grant.canStart && !executionRunning && !executionPaused ? (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />} loading={busy} onClick={() => void onStart(grant.id)}>
              开始执行
            </Button>
          ) : null}
          {grant?.valid && grant.status === 'active' && executionPaused ? (
            <Button size="small" type="primary" icon={<PlayCircleOutlined />} loading={busy} onClick={() => void onResume(grant.id)}>
              继续执行
            </Button>
          ) : null}
          {grant ? <StatusPill tone={statusTone(grant.status)}>{statusLabel(grant.status)}</StatusPill> : <Tag>未授权</Tag>}
        </div>
      </div>

      {budget ? (
        <div className={`po-grant-budget${budgetExceeded ? ' is-warning' : ''}`}>
          <span>项目 AI 预算</span>
          <strong>{budget.spent.toFixed(4)} / {budgetLimit > 0 ? `${budgetLimit} ${budget.budget?.currency ?? ''}` : '未设置上限'}</strong>
          <em>{budgetExceeded ? '已超出软预算；继续执行必须在本授权中显式允许并记录原因。' : '按现有预算策略执行；不会自动放宽。'}</em>
        </div>
      ) : null}

      {active && grant ? (
        <div className="po-grant-active">
          <div className="po-grant-metrics">
            <span><strong>{grant.allowedTaskIds.length}</strong> 任务</span>
            <span><strong>{grant.allowedAgentIds.length}</strong> Agent</span>
            <span><strong>{grant.usedRuns + grant.reservedRuns}/{grant.maxRuns}</strong> 启动（含预留）</span>
            <span><strong>{grant.usedToolCalls}/{grant.maxToolCalls}</strong> 授权写入</span>
          </div>
          <div className="po-grant-scope">
            <span className="po-grant-label"><SafetyCertificateOutlined /> 允许操作</span>
            <div>
              {grant.actions.map((action) => (
                <Tag key={action} color={action === 'workspace-write' ? 'gold' : 'blue'}>
                  {action === 'workspace-write' ? '授权路径内写文件' : '启动已批准计划'}
                </Tag>
              ))}
              {grant.allowOverBudget ? <Tag color="orange">允许超软预算</Tag> : null}
            </div>
          </div>
          {grant.actions.includes('workspace-write') ? (
            <div className="po-grant-scope">
              <span className="po-grant-label">授权路径</span>
              <div>
                {grant.allowedPaths.map((path) => <Tag key={path}>{path === '.' ? '项目根（敏感路径除外）' : path}</Tag>)}
              </div>
            </div>
          ) : null}
          <div className="po-grant-foot">
            <span><ClockCircleOutlined /> 有效至 {formatTime(grant.expiresAt)}</span>
            <span>进程 / Git / 外部 Runtime / 敏感路径仍需逐次审批</span>
          </div>
          {grant.invalidReasons.length > 0 ? (
            <Alert type="warning" showIcon message="授权已失效" description={grant.invalidReasons.join('；')} />
          ) : null}
          <div className="po-grant-actions">
            {executionRunning ? <Tag color="blue">计划执行中；撤销会取消计划执行与活动 Run</Tag> : null}
            <Popconfirm
              title="撤销计划执行授权？"
              description="撤销后不再接受新的授权写入；正在执行的活动 Run 会被取消。"
              okText="撤销"
              cancelText="取消"
              disabled={busy}
              onConfirm={() => void onRevoke(grant.id)}
            >
              <Button danger icon={<StopOutlined />} loading={busy} data-testid="plan-grant-revoke">
                撤销授权
              </Button>
            </Popconfirm>
          </div>
        </div>
      ) : (
        <>
          {grant ? (
            <Alert
              type="warning"
              showIcon
              message="当前授权不可用"
              description={grant.invalidReasons.length > 0 ? grant.invalidReasons.join('；') : '请重新授权后开始执行'}
            />
          ) : (
            <Alert
              type="info"
              showIcon
              message="计划已批准，但尚未授权执行"
              description="批准计划不会启动 Agent。请选择最小范围后显式授权；不勾选写文件时，Agent 的 write_file 仍会逐次请求审批。"
            />
          )}

          <div className="po-grant-form">
            <div className="po-grant-form-row">
              <span>启动已批准计划</span>
              <Tag color="blue">plan.start（必选）</Tag>
            </div>
            <div className="po-grant-form-row">
              <span>测试与只读检查</span>
              <Checkbox
                checked={runTests}
                disabled={busy}
                onChange={(event) => setRunTests(event.target.checked)}
                data-testid="plan-grant-run-tests"
              >
                允许测试与只读检查命令（白名单）
              </Checkbox>
            </div>
            {runTests ? (
              <div className="po-grant-form-field">
                <em>
                  仅覆盖 node --test、npm/pnpm/yarn test、vitest、jest、pytest、go/cargo test、git status/diff/log/rev-parse/ls-files
                  以及 node --version；含 && ; | $() 等组合的命令一律仍需逐次审批。
                </em>
              </div>
            ) : null}
            <div className="po-grant-form-row">
              <span>写文件范围</span>
              <Checkbox
                checked={workspaceWrite}
                disabled={busy}
                onChange={(event) => setWorkspaceWrite(event.target.checked)}
              >
                允许在下列项目路径内写文件
              </Checkbox>
            </div>
            {workspaceWrite ? (
              <div className="po-grant-form-field">
                <span>授权路径（相对项目根，禁止绝对路径与 ..）</span>
                <Select
                  mode="tags"
                  value={allowedPaths}
                  placeholder="例如：src, tests, docs"
                  tokenSeparators={[',', '，', '\n']}
                  disabled={busy}
                  onChange={setAllowedPaths}
                  data-testid="plan-grant-paths"
                />
                <em>敏感路径（.env、secrets、auth/permissions、migrations、package.json、CI 等）不能纳入计划授权，仍需逐次审批。</em>
              </div>
            ) : null}
            <div className="po-grant-form-grid">
              <label>
                <span>授权有效期</span>
                <Select
                  value={ttlHours}
                  disabled={busy}
                  onChange={setTtlHours}
                  options={[
                    { value: 1, label: '1 小时' },
                    { value: 8, label: '8 小时' },
                    { value: 24, label: '24 小时' },
                    { value: 168, label: '7 天' },
                  ]}
                />
              </label>
              <label>
                <span>最多启动次数</span>
                <InputNumber min={1} max={10} value={maxRuns} disabled={busy} onChange={(value) => setMaxRuns(Number(value ?? 1))} />
              </label>
              <label>
                <span>最多授权写入次数</span>
                <InputNumber min={1} max={500} value={maxToolCalls} disabled={busy} onChange={(value) => setMaxToolCalls(Number(value ?? 40))} />
              </label>
            </div>
            {budgetExceeded ? (
              <div className="po-grant-overbudget">
                <Checkbox checked={allowOverBudget} disabled={busy} onChange={(event) => setAllowOverBudget(event.target.checked)}>
                  <span><WarningOutlined /> 本项目已超软预算，仍允许本次执行</span>
                </Checkbox>
                <Input.TextArea
                  rows={2}
                  value={note}
                  placeholder="超预算原因（必填，至少 8 个字符；会写入授权审计）"
                  disabled={busy || !allowOverBudget}
                  onChange={(event) => setNote(event.target.value)}
                />
                <em>超预算会继续消耗真实 Provider 额度，费用可能未知；系统不会猜测金额或自动续期。</em>
              </div>
            ) : (
              <Input
                value={note}
                placeholder="可选：授权说明（写入审计）"
                disabled={busy}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
            <Checkbox checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)}>
              我已核对任务、Agent、验收条件与授权范围；取消或撤销后不启动/不继续执行
            </Checkbox>
            <div className="po-grant-warning">
              <SafetyCertificateOutlined />
              <span>计划授权不等于 shell 权限。run_command / run_tests / git_commit / runtime.* 仍逐次审批；破坏性命令与敏感路径不会被本授权放行。</span>
            </div>
            <div className="po-grant-actions">
              <Button loading={busy} disabled={!canIssue} onClick={() => void issue(false)} data-testid="plan-grant-issue">
                仅授权
              </Button>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={busy}
                disabled={!canIssue}
                onClick={() => void issue(true)}
                data-testid="plan-grant-start"
              >
                {executionPaused ? '授权并继续' : '授权并开始执行'}
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
