import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CodeReviewDialog, CodeDiffPreview } from './CodeReviewDialog'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Alert, Button, Input, Select } from 'antd'
import type { ApiParsedInput, GitSubject } from '@projectos/contracts'
import { ErrorState, LoadingBlock, StatusPill } from '@projectos/ui'
import { DialogShell, OverlayFooter, OverlayHeader, OverlayScrollArea } from '../next-ui/overlay/overlay-shell'
import { RequirementApproval } from './RequirementApproval'
import { errorMessage } from '../lib/errors'
import './requirement-work.css'

const TITLES = { fetch:'获取远端', pull:'同步提交', push:'推送提交', merge_plan:'合入计划', open_resolution:'准备解决工作区', resolve_file:'保存人工解决', verify_project:'验证项目', verify_resolution:'验证解决结果', integrate_resolution:'合入解决结果' }
const STATUS = { waiting_approval:'待审批', executing:'执行中', completed:'已完成', failed:'失败', rejected:'已拒绝', needs_reconciliation:'待核对' }
export function GitDeliveryDialog({ subject, onClose, onRefresh }: {subject:GitSubject;onClose:()=>void;onRefresh:()=>Promise<unknown>}) {
  const api=window.projectos.gitDelivery
  const navigate=useNavigate()
  const query=useQuery({queryKey:['git-delivery',subject],queryFn:()=>api.state(subject),refetchOnWindowFocus:false,refetchInterval:q=>q.state.data?.operations.some(op=>op.status==='executing')||q.state.data?.resolution?.agentRunId?2500:false})
  const data=query.data, resolution=data?.resolution
  const [mode,setMode]=useState<'manual'|'agent'>('manual'),[note,setNote]=useState(''),[noteFingerprint,setNoteFingerprint]=useState<string|null>(null)
  const [remote,setRemote]=useState('origin'),[codeOpen,setCodeOpen]=useState(false)
  const pending=data?.operations.find(op=>['waiting_approval','executing','needs_reconciliation'].includes(op.status))
  const action=useMutation({mutationFn:async(input:Partial<ApiParsedInput<'gitDelivery.request'>>&{kind:ApiParsedInput<'gitDelivery.request'>['kind']})=>{
    if(!data)return
    await api.request({subject,fingerprint:data.fingerprint,remote,mode,agentId:'agt_engineer',...input})
    await query.refetch()
  }})
  const review=useMutation({mutationFn:async()=>{if(!data)return;await api.review({subject,resolutionId:resolution?.id??'project',fingerprint:noteFingerprint??resolution?.fingerprint??data.fingerprint,note});setNote('');setNoteFingerprint(null);await query.refetch()}})
  const reconcile=useMutation({mutationFn:async()=>{if(pending){await api.reconcile({operationId:pending.id,note});await query.refetch()}}})
  const busy=action.isPending||review.isPending||reconcile.isPending||!!pending
  if(codeOpen)return <CodeReviewDialog subject={subject} resolutionId={resolution?.id} onClose={()=>setCodeOpen(false)} onSave={resolution?async(path,content,fingerprint)=>{await action.mutateAsync({kind:'resolve_file',resolutionId:resolution.id,resolutionFingerprint:fingerprint,path,content})}:undefined}/>
  return <DialogShell open onOpenChange={open=>{if(!open)onClose()}} dirty={note.length>0} ariaLabel="代码同步与合入" width={1100}>
    <OverlayHeader title="代码同步与合入" meta={data?`${data.branch} · ${data.head.slice(0,12)}`:undefined} actions={<Button onClick={()=>void query.refetch()} loading={query.isFetching}>刷新代码状态</Button>}/>
    <OverlayScrollArea className="rq-integration-scroll">
      {[action.error,review.error,reconcile.error].filter(Boolean).map((error,index)=><Alert key={index} type="error" showIcon message={errorMessage(error)}/>)}
      {query.isLoading?<LoadingBlock rows={5}/>:query.isError?<ErrorState title="无法读取代码状态" message={errorMessage(query.error)} onRetry={()=>void query.refetch()}/>:data&&<>
        <div className="rq-inline-actions">
          {!subject.planId&&!subject.taskId&&<><Select aria-label="代码远端" value={remote} onChange={setRemote} options={data.remotes.map(r=>({value:r.name,label:`${r.name} · ${r.location}`}))}/><Button disabled={busy||!data.remotes.length} onClick={()=>action.mutate({kind:'fetch'})}>申请获取远端</Button><Button disabled={busy||!data.remotes.length} onClick={()=>action.mutate({kind:'pull'})}>申请同步提交</Button></>}
          {subject.planId&&<Button disabled={busy} onClick={()=>action.mutate({kind:'merge_plan'})}>申请合入计划</Button>}
          <Select aria-label="冲突处理方式" value={mode} onChange={setMode} options={[{value:'manual',label:'全人工解决'},{value:'agent',label:'Agent 自动处理'}]}/>
          <Button disabled={busy} onClick={()=>action.mutate({kind:'open_resolution'})}>申请准备冲突工作区</Button>
        </div>
        {pending?.status==='waiting_approval'&&<RequirementApproval key={pending.approvalId} projectId={subject.projectId} approvalId={pending.approvalId} onDecided={async()=>{await query.refetch();await onRefresh()}}/>}
        {pending?.status==='executing'&&<Alert type="info" showIcon message={`${TITLES[pending.kind]}正在执行`}/>}
        {pending?.status==='needs_reconciliation'&&<Alert type="error" showIcon message={pending.error} action={<Button disabled={note.trim().length<8} loading={reconcile.isPending} onClick={()=>reconcile.mutate()}>核对实际结果</Button>}/>}
        {resolution?<>
          <div className="rq-review-heading"><h3>{resolution.mode==='agent'?'Agent 解决结果':'人工解决工作区'}</h3><StatusPill tone={resolution.verificationCurrent?'success':'warning'}>{resolution.verificationCurrent?'验证通过':'待验证'}</StatusPill></div>
          <p><code>{resolution.root}</code></p>
          <CodeDiffPreview diff={resolution.diff} onExpand={()=>setCodeOpen(true)}/>
          {resolution.agentRunId&&<Button type="link" onClick={()=>{onClose();navigate(`/projects/${subject.projectId}/runs?run=${resolution.agentRunId}`)}}>查看 Agent 运行与写入审批</Button>}
          {!resolution.files.length&&<p>无文本冲突，可验证完整合并结果。</p>}
        </>:<section><h3>当前提交改动</h3><CodeDiffPreview diff={data.diff} onExpand={()=>setCodeOpen(true)}/>{data.diffTruncated&&<Alert type="warning" message="预览超过大小上限，请先在本机完成完整审查。"/>}</section>}
        <div className="rq-integration-grid">
          <section><h3>代码验证</h3><Button disabled={busy} onClick={()=>action.mutate({kind:resolution?'verify_resolution':'verify_project',...(resolution?{resolutionId:resolution.id}:{})})}>运行验证</Button></section>
          <section><label htmlFor="git-review-note">审查或核对结论</label><Input.TextArea id="git-review-note" rows={3} value={note} onChange={e=>{setNote(e.target.value);setNoteFingerprint(resolution?.fingerprint??data.fingerprint)}}/><Button disabled={busy||note.trim().length<8} loading={review.isPending} onClick={()=>review.mutate()}>记录代码审查通过</Button><StatusPill tone={(resolution?.reviewCurrent??data.contentReviewed)?'success':'neutral'}>{(resolution?.reviewCurrent??data.contentReviewed)?'当前审查已记录':'待审查'}</StatusPill></section>
        </div>
        <details className="rq-integration-details"><summary>审批与操作记录</summary><ul>{data.operations.map(op=><li key={op.id}><strong>{TITLES[op.kind]} · {STATUS[op.status]}</strong>{op.resultCommit&&<code> {op.resultCommit.slice(0,12)}</code>}{op.error&&<p>{op.error}</p>}<code>{op.id} · {op.runId} · {op.approvalId}</code></li>)}</ul></details>
      </>}
    </OverlayScrollArea>
    <OverlayFooter><Button onClick={onClose}>关闭</Button>{resolution?<Button type="primary" disabled={busy||!resolution.reviewCurrent||!resolution.verificationCurrent||resolution.files.some(f=>f.conflict)} onClick={()=>action.mutate({kind:'integrate_resolution',resolutionId:resolution.id})}>申请合入解决结果</Button>:!subject.planId&&!subject.taskId&&<Button type="primary" disabled={busy||!data?.contentReviewed||!data?.contentVerified} onClick={()=>action.mutate({kind:'push'})}>申请推送当前提交</Button>}</OverlayFooter>
  </DialogShell>
}
