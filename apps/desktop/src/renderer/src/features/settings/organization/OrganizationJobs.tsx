import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { OrganizationConnectionView, WorkerDesktopList } from '@projectos/contracts'
import { OrganizationError, OrganizationField, OrganizationLoading } from './OrganizationPrimitives'
import { organizationScopeKey } from './useOrganization'

const STATUS={pending:'待本机接收',running:'执行中',completed:'已完成',failed:'失败',cancelled:'已取消',needs_reconciliation:'待核对'}
export function OrganizationJobs({connection,workers}:{connection:OrganizationConnectionView;workers:WorkerDesktopList}) {
  const api=window.projectos.organization
  const query=useQuery({queryKey:organizationScopeKey(connection,'worker-jobs'),queryFn:()=>api.workerJobs(),refetchInterval:5000,retry:false})
  const assets=useQuery({queryKey:organizationScopeKey(connection,'job-assets'),queryFn:()=>api.assets(),retry:false})
  const [grantId,setGrantId]=useState(''),[agentVersionId,setAgentVersionId]=useState(''),[prompt,setPrompt]=useState(''),[notice,setNotice]=useState(''),[reconcileNote,setReconcileNote]=useState('')
  const action=useMutation({mutationFn:async(input:{kind:'submit'|'accept'|'cancel'|'reconcile';jobId?:string})=>{
    setNotice('')
    if(input.kind==='submit') {await api.submitWorkerJob({grantId,agentVersionId,prompt});setPrompt('');setNotice('任务已提交，等待执行设备接收。')}
    else if(input.kind==='accept'){const result=await api.acceptWorkerJob({jobId:input.jobId!});setNotice(`本机已接收。运行 ${result.runId}；写文件请在“审批”中确认。`)}
    else if(input.kind==='reconcile') await api.reconcileWorkerJob({jobId:input.jobId!,note:reconcileNote})
    else await api.cancelWorkerJob({jobId:input.jobId!})
    await query.refetch()
  }})
  return <section className="ow-job-section" aria-label="组织远程任务">
    <div className="org-section-heading"><div><h3>远程任务</h3><p>使用已绑定的原生 Agent 版本，由设备所属成员接收执行。</p></div><button className="org-button" onClick={()=>void query.refetch()} disabled={query.isFetching}>刷新任务</button></div>
    <form className="org-form" onSubmit={e=>{e.preventDefault();action.mutate({kind:'submit'})}}>
      <OrganizationField label="执行授权">{id=><select id={id} value={grantId} onChange={e=>setGrantId(e.target.value)} required><option value="">选择共享项目与执行设备</option>{workers.grants.filter(g=>g.status==='active').map(g=><option key={g.id} value={g.id}>{g.projectName} · {workers.workers.find(w=>w.id===g.workerId)?.name??g.workerId}</option>)}</select>}</OrganizationField>
      <OrganizationField label="已发布 Agent 版本">{id=><select id={id} value={agentVersionId} onChange={e=>setAgentVersionId(e.target.value)} required><option value="">选择项目已绑定的版本</option>{assets.data?.assets.filter(a=>a.kind==='agent'&&a.publishedVersionId).map(a=><option key={a.id} value={a.publishedVersionId!}>{a.name} · {a.publishedVersion}</option>)}</select>}</OrganizationField>
      <OrganizationField label="任务要求">{id=><textarea id={id} rows={3} maxLength={20000} value={prompt} onChange={e=>setPrompt(e.target.value)} required/>}</OrganizationField>
      <button className="org-button is-primary" disabled={action.isPending||!grantId||!agentVersionId||!prompt.trim()}>提交远程任务</button>
    </form>
    <OrganizationError error={action.error??query.error??assets.error}/>{notice&&<p role="status" className="org-message">{notice}</p>}
    {query.isLoading?<OrganizationLoading/>:<ul className="ow-grant-list">{query.data?.jobs.map(job=><li key={job.id}><div className="org-section-heading"><div><strong>{job.prompt.slice(0,100)}</strong><p>{STATUS[job.status]} · {job.toolCalls}/{job.scope.maxToolCalls} 次工具 · 租约序号 {job.fencing}</p><code>{job.id}</code>{job.runId&&<p>运行 {job.runId}</p>}</div><div className="org-inline-actions">{job.status==='pending'&&job.workerId===workers.currentWorkerId&&<button className="org-button is-primary" disabled={action.isPending} onClick={()=>action.mutate({kind:'accept',jobId:job.id})}>接收并执行</button>}{job.status==='needs_reconciliation'&&<details><summary>核对并结束任务</summary><label>核对结论<textarea aria-label="任务核对结论" rows={3} value={reconcileNote} onChange={e=>setReconcileNote(e.target.value)}/></label><button className="org-button" disabled={action.isPending||reconcileNote.trim().length<8} onClick={()=>action.mutate({kind:'reconcile',jobId:job.id})}>记录核对并结束</button></details>}{['pending','running'].includes(job.status)&&<button className="org-button" disabled={action.isPending} onClick={()=>action.mutate({kind:'cancel',jobId:job.id})}>取消任务</button>}</div></div></li>)}</ul>}
  </section>
}
