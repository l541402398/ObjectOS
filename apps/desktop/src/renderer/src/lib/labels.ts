import { STAGE_LABELS, TASK_STATUS_LABELS, type StageKey, type TaskStatus } from '@projectos/contracts'

export const RUN_STATUS_LABELS: Record<string, string> = {
  created: '已创建',
  queued: '排队中',
  running: '执行中',
  waiting_tool: '等待工具',
  waiting_approval: '等待授权',
  verifying: '验证中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  suspended: '已挂起',
  needs_reconciliation: '待核对',
}

export const PRIORITY_LABELS: Record<number, string> = {
  1: '紧急',
  2: '高',
  3: '中',
  4: '低',
}

export const APPROVAL_LABELS: Record<string, string> = {
  pending: '待授权',
  approved: '已批准',
  rejected: '已拒绝',
  expired: '已过期',
  cancelled: '已取消',
}

export const HANDOFF_LABELS: Record<string, string> = {
  requested: '待接受',
  accepted: '已接受',
  rejected: '已拒绝',
  expired: '已过期',
  cancelled: '已取消',
}

export const DELIVERY_LABELS: Record<string, string> = {
  stored: '已持久化',
  delivered: '已投递',
  accepted: '已唤醒',
  completed: '已完成',
  failed: '投递失败',
  unknown: '结果未知',
}

export const REQUIREMENT_LABELS: Record<string, string> = {
  draft: '草稿',
  review: '待评审',
  approved: '已批准',
  implemented: '已实现',
  cancelled: '已取消',
}

export const MILESTONE_LABELS: Record<string, string> = {
  planned: '计划中',
  active: '进行中',
  completed: '已完成',
  cancelled: '已取消',
}

export const DECISION_LABELS: Record<string, string> = {
  proposed: '提议中',
  accepted: '已接受',
  superseded: '已被取代',
  rejected: '已拒绝',
}

export const ARTIFACT_LABELS: Record<string, string> = {
  document: '文档',
  code: '代码',
  'test-report': '测试报告',
  diff: '差异',
  design: '设计',
  'release-note': '发布说明',
  other: '其他',
}

export const SESSION_STATUS_LABELS: Record<string, string> = {
  active: '活跃',
  idle: '空闲',
  archived: '已归档',
}

export function taskStatusLabel(status: TaskStatus | string): string {
  return TASK_STATUS_LABELS[status as TaskStatus] ?? status
}

export function stageLabel(stage: StageKey | string): string {
  return STAGE_LABELS[stage as StageKey] ?? stage
}

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS[status] ?? status
}

export function priorityLabel(priority: number): string {
  return PRIORITY_LABELS[priority] ?? '中'
}

export function riskLabel(risk: string): string {
  switch (risk) {
    case 'read':
      return '只读'
    case 'workspace-write':
      return '工作区写入'
    case 'process':
      return '进程执行'
    case 'git-write':
      return 'Git 写入'
    default:
      return risk
  }
}
