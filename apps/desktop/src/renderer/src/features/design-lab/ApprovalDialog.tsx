import type { ReactElement } from 'react'
import { AlertTriangle, Check } from 'lucide-react'
import { DialogShell, OverlayFooter, OverlayHeader } from '../../next-ui/overlay/overlay-shell'
import type { LabTask } from './data'

export function ApprovalDialog({
  open,
  theme,
  tasks,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  theme: 'light' | 'dark'
  tasks: LabTask[]
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): ReactElement | null {
  const risks = tasks.filter((task) => task.risk)
  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="批准计划"
      width={520}
      theme={theme}
      skin="projectos"
      testId="design-lab-approval-dialog"
    >
      <OverlayHeader
        eyebrow="APPROVAL · R2"
        title="批准计划并创建任务？"
        meta={<><span>4 个阶段</span><span>{tasks.length} 项工作</span><span>{risks.length} 项需复核</span></>}
      />
      <div className="pui-overlay-body">
        <section className="pdl-approval-section">
          <span className="pdl-field-label">审批影响</span>
          <div className="pdl-approval-impact">
            <div><strong>{tasks.length}</strong><span>创建任务</span></div>
            <div><strong>{tasks.reduce((total, task) => total + task.dependsOn.length, 0)}</strong><span>依赖关系</span></div>
            <div><strong>{tasks.filter((task) => task.requiresApproval).length}</strong><span>需人工执行</span></div>
          </div>
        </section>
        {risks.length ? (
          <section className="pdl-approval-risk">
            <div className="pdl-approval-risk-head"><AlertTriangle size={14} /><span>需要复核</span></div>
            {risks.map((task) => <div className="pdl-approval-risk-row" key={task.id}><span>{task.code}</span><p>{task.risk}</p></div>)}
          </section>
        ) : null}
        <p className="pdl-approval-note"><Check size={12} />原型操作：仅更新本地状态，不写入数据库，也不启动 Agent。</p>
      </div>
      <OverlayFooter meta="不可逆操作需人工确认">
        <button type="button" className="pui-overlay-button pui-overlay-button-quiet" onClick={() => onOpenChange(false)}>取消</button>
        <button type="button" className="pui-overlay-button pui-overlay-button-primary" onClick={onConfirm}><Check size={13} />确认批准</button>
      </OverlayFooter>
    </DialogShell>
  )
}
