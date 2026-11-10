import type { ActionItem } from '@projectos/contracts'

/**
 * One label/CTA table for action-center kinds, shared by the global action panel and the
 * home "next step" surface so the two can never disagree about what an item is.
 */
export const ACTION_KIND_LABEL: Record<string, string> = {
  tool_approval: '工具授权',
  task_acceptance: '任务验收',
  delivery_approval: '发布/部署审批',
  version_gate: '版本门禁',
  deployment_reconciliation: '部署对账',
  run_failure: 'Run 失败',
  plan_review: '计划审核',
  replan_scope: '范围变更',
  plan_delivery: '计划交付',
}

const ACTION_KIND_CTA: Record<string, string> = {
  tool_approval: '处理审批',
  delivery_approval: '处理审批',
  task_acceptance: '查看验收',
  version_gate: '查看版本门禁',
  deployment_reconciliation: '处理对账',
  run_failure: '查看失败原因',
  plan_review: '审核计划',
  replan_scope: '处理范围变更',
  plan_delivery: '查看计划交付',
}

export function actionKindLabel(kind: ActionItem['kind'] | string): string {
  return ACTION_KIND_LABEL[kind] ?? kind
}

export function actionKindCta(kind: ActionItem['kind'] | string): string {
  return ACTION_KIND_CTA[kind] ?? '前往处理'
}
