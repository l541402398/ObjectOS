import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { GitDeliveryService } from '../apps/runtime/src/git-delivery.js'
import { gitText } from '../apps/runtime/src/requirement-git.js'
import { createGitProject, FakeProvider, setup, waitFor } from './helpers/r1-fixture.js'
const cleanup:Array<()=>void>=[]
afterEach(()=>{while(cleanup.length)cleanup.pop()!()})
async function fixture(provider?:FakeProvider){
  const h=setup(provider);cleanup.push(()=>{h.close();rmSync(h.dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100})})
  const project=await createGitProject(h.services,h.dataDir,'delivery'),root=project.rootPath
  gitText(root,'config','core.autocrlf','false')
  const bare=join(h.dataDir,'remote.git'),other=join(h.dataDir,'other');mkdirSync(bare)
  gitText(bare,'init','--bare');gitText(root,'remote','add','origin',bare);gitText(root,'push','-u','origin','HEAD')
  gitText(h.dataDir,'clone','-c','core.autocrlf=false',bare,other)
  const branch=gitText(root,'branch','--show-current');gitText(other,'checkout',branch)
  const subject={projectId:project.id,planId:null,taskId:null},service=new GitDeliveryService(h.store,h.dataDir,h.runner,()=>{})
  const commit=(where:string,file:string,content:string)=>{writeFileSync(join(where,file),content);gitText(where,'add','--',file);gitText(where,'-c','user.name=Test','-c','user.email=test@local','commit','-qm','fixture')}
  const request=(kind:Parameters<typeof service.request>[0]['kind'],extra:Record<string,unknown>={})=>service.request({subject,kind,fingerprint:service.capture(subject).fingerprint,remote:'origin',mode:'manual',agentId:'agt_engineer',...extra})
  const approve=async(op:ReturnType<typeof request>)=>{await service.decide(op.approvalId,'approved','测试本次固定操作');await waitFor(()=>!['running','waiting_approval'].includes(h.store.read.getRun(op.runId)?.status??''),10000);return h.store.db.prepare('SELECT status FROM git_delivery_operations WHERE id=?').get(op.id)!}
  return {...h,project,root,bare,other,branch,subject,service,commit,request,approve}
}
describe('audited Git delivery',()=>{
  it('lets a conflict Agent read ordinary test context, but pauses its conflict-file write for a separate approval',async()=>{
    const fake=new FakeProvider(call=>call.index===0?{tool:{name:'read_file',args:{path:'package.json'}}}:call.index===1?{tool:{name:'write_file',args:{path:'shared.txt',content:'both sides\n'}}}:{text:'resolved in isolation'})
    const f=await fixture(fake);f.commit(f.root,'shared.txt','base\n');gitText(f.root,'push','origin',f.branch);gitText(f.other,'pull','--ff-only')
    f.commit(f.root,'shared.txt','ours\n');f.commit(f.other,'shared.txt','theirs\n');gitText(f.other,'push','origin',f.branch)
    await f.approve(f.request('fetch'));await f.approve(f.request('open_resolution',{mode:'agent'}))
    const resolution=f.service.state(f.subject).resolution!
    await waitFor(()=>f.store.read.listApprovalViews(f.project.id,resolution.agentRunId).some(a=>a.status==='pending'))
    expect(readFileSync(join(f.root,'shared.txt'),'utf8')).toBe('ours\n')
    const approval=f.store.read.listApprovalViews(f.project.id,resolution.agentRunId).find(a=>a.status==='pending')!
    await f.runner.decideApproval(approval.id,'approved','只写本次冲突文件')
    await waitFor(()=>f.store.read.getRun(resolution.agentRunId!)?.status==='completed')
    expect(readFileSync(join(resolution.root,'shared.txt'),'utf8')).toBe('both sides\n')
    expect(readFileSync(join(f.root,'shared.txt'),'utf8')).toBe('ours\n')
  },90000)
  it('fetches and fast forwards only after approval, records side effects and separately reviews/verifies exact push',async()=>{
    const f=await fixture(),before=gitText(f.root,'rev-parse','HEAD')
    f.commit(f.other,'remote.txt','remote\n');gitText(f.other,'push','origin',f.branch)
    const fetch=f.request('fetch');expect(gitText(f.root,'rev-parse','HEAD')).toBe(before)
    expect((await f.approve(fetch)).status).toBe('completed')
    const pull=f.request('pull');expect(gitText(f.root,'rev-parse','HEAD')).toBe(before)
    expect((await f.approve(pull)).status).toBe('completed');expect(readFileSync(join(f.root,'remote.txt'),'utf8')).toBe('remote\n')
    f.commit(f.root,'local.txt','local\n');expect(()=>f.request('push')).toThrow(/审查/)
    f.service.review({subject:f.subject,resolutionId:'project',fingerprint:f.service.capture(f.subject).fingerprint,note:'已检查实际提交与文件完整内容'})
    expect((await f.approve(f.request('verify_project',{command:'node -e "process.exit(0)"'}))).status).toBe('completed')
    const push=f.request('push');expect((await f.approve(push)).status).toBe('completed')
    expect(gitText(f.bare,'rev-parse',`refs/heads/${f.branch}`)).toBe(gitText(f.root,'rev-parse','HEAD'))
    const detail=f.store.read.getRunDetail(push.runId)!;expect(detail.toolCalls[0]?.status).toBe('completed');expect(f.store.getApprovalById(push.approvalId)?.status).toBe('approved')
  },90000)
  it('fully manually resolves in isolation, retains original three-way content after staging and gates integration',async()=>{
    const f=await fixture();f.commit(f.root,'shared.txt','base\n');gitText(f.root,'push','origin',f.branch);gitText(f.other,'pull','--ff-only')
    f.commit(f.root,'shared.txt','ours\n');f.commit(f.other,'shared.txt','theirs\n');gitText(f.other,'push','origin',f.branch)
    await f.approve(f.request('fetch'));const before=gitText(f.root,'rev-parse','HEAD')
    expect((await f.approve(f.request('pull'))).status).toBe('failed')
    expect((await f.approve(f.request('open_resolution'))).status).toBe('completed')
    expect((await f.approve(f.request('open_resolution'))).status).toBe('completed')
    let res=f.service.state(f.subject).resolution!;expect(res.files[0]).toMatchObject({base:'base\n',ours:'ours\n',theirs:'theirs\n',conflict:true})
    expect(()=>f.request('integrate_resolution',{resolutionId:res.id})).toThrow(/审查|验证/)
    await f.approve(f.request('resolve_file',{resolutionId:res.id,path:'shared.txt',content:'ours and theirs\n'}))
    expect(gitText(f.root,'rev-parse','HEAD')).toBe(before)
    res=f.service.state(f.subject).resolution!;expect(res.files[0]).toMatchObject({base:'base\n',ours:'ours\n',theirs:'theirs\n',conflict:false})
    await f.approve(f.request('verify_resolution',{resolutionId:res.id,command:'node -e "process.exit(0)"'}));res=f.service.state(f.subject).resolution!
    f.service.review({subject:f.subject,resolutionId:res.id,fingerprint:res.fingerprint,note:'保留双方意图，三方原文与实际验证均已检查'})
    expect((await f.approve(f.request('integrate_resolution',{resolutionId:res.id}))).status).toBe('completed')
    expect(f.service.state(f.subject).resolution).toBeNull()
    expect(readFileSync(join(f.root,'shared.txt'),'utf8')).toBe('ours and theirs\n')
    expect(gitText(f.bare,'rev-parse',`refs/heads/${f.branch}`)).not.toBe(gitText(f.root,'rev-parse','HEAD'))
  },90000)
  it('invalidates changed approvals and never retries unknown external outcomes',async()=>{
    const f=await fixture(),op=f.request('fetch');f.commit(f.root,'changed.txt','changed')
    await expect(f.service.decide(op.approvalId,'approved','changed')).rejects.toThrow(/变化/)
    const next=f.request('fetch');f.store.db.prepare("UPDATE git_delivery_operations SET status='executing' WHERE id=?").run(next.id)
    const recovered=new GitDeliveryService(f.store,f.dataDir,f.runner,()=>{})
    expect(recovered.state(f.subject).operations.find(o=>o.id===next.id)?.status).toBe('needs_reconciliation')
    expect(()=>f.request('fetch')).toThrow(/核对/)
    expect((await recovered.reconcile(next.id,'人工确认目标与中断之前完全一致')).status).toBe('failed')
    const rejected=f.request('fetch');await recovered.decide(rejected.approvalId,'rejected','拒绝');expect(f.store.read.getRun(rejected.runId)?.status).toBe('cancelled')
  },90000)
})
