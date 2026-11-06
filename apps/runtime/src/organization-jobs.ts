import { isAbsolute, relative, resolve } from 'node:path'
import { AppError, WorkerJobInternalSchemas, newId, now } from '@projectos/contracts'
import { resolveWorkspacePath } from '@projectos/workspace'
import type { SqliteStore } from '@projectos/persistence'
import type { AgentRunner } from './agent-runner.js'
import type { LocalWorkerService } from './local-worker.js'

/** Ephemeral online authority wrapped around the existing native runner. No persisted bearer. */
export class OrganizationJobService {
  private readonly active = new Map<string, { runId: string | null; grantId: string; timer: NodeJS.Timeout }>()
  constructor(private readonly store: SqliteStore, private readonly runner: AgentRunner, private readonly local: LocalWorkerService) {
    store.db.prepare("UPDATE worker_job_receipts SET status='needs_reconciliation',error='Runtime interrupted; never replay',updated_at=? WHERE status IN ('starting','running')").run(now())
    local.onRevoked = id => {
      for (const [jobId, entry] of this.active) if (entry.grantId === id) {
        clearInterval(entry.timer)
        if (entry.runId) void runner.cancel(entry.runId)
        this.receipt(jobId,'needs_reconciliation','Local authority revoked; inspect any completed effects')
        this.active.delete(jobId)
      }
    }
  }
  private receipt(id: string, status: string, error: string | null = null) {
    this.store.db.prepare('UPDATE worker_job_receipts SET status=?,error=?,updated_at=? WHERE job_id=?').run(status,error,now(),id)
  }
  async accept(raw: unknown) {
    const input = WorkerJobInternalSchemas['runtime.worker.acceptJob'].input.parse(raw)
    const { lease, secret, ...scope } = input, job = lease.job
    const grant = this.local.executionGrant(job.grantId,scope)
    if (job.organizationId !== scope.organizationId || job.workerId !== grant.workerId || job.projectId !== grant.projectId || job.scopeDigest !== grant.scopeDigest || job.status !== 'running') throw new AppError('POLICY_DENIED','远程任务与本机授权不一致。')
    if (this.store.db.prepare('SELECT job_id FROM worker_job_receipts WHERE job_id=?').get(job.id)) throw new AppError('CONFLICT','此任务已有本机接收记录，不能重放。')
    if (job.agent.definition.kind !== 'agent' || job.agent.definition.runtime !== 'native') throw new AppError('POLICY_DENIED','远程执行仅支持已发布的原生 Agent。')
    const origin = new URL(scope.serverUrl)
    if ((origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(origin.hostname))) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new AppError('POLICY_DENIED','组织服务地址无效。')
    const endpoint = `${origin.origin}/v1/organizations/${encodeURIComponent(scope.organizationId)}/worker-jobs/${job.id}/workers/${job.workerId}/`
    const proof = { fencing: job.fencing, token: lease.token }
    const remote = async (action: 'check'|'finish', body: Record<string,unknown> = {}) => {
      this.local.executionGrant(job.grantId,scope)
      const response = await fetch(endpoint+action,{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json'},body:JSON.stringify({...proof,...body}),signal:AbortSignal.timeout(10_000),redirect:'error'})
      if (!response.ok) throw new AppError('POLICY_DENIED','远程租约、项目权限或发布版本已失效，已停止执行。')
      const parsed = await response.json() as {ok?: unknown}
      if (parsed.ok !== true) throw new AppError('POLICY_DENIED','组织服务未确认本次授权。')
    }
    await remote('check')
    this.store.db.prepare(`INSERT INTO worker_job_receipts(job_id,server_url,organization_id,account_id,grant_id,fencing,status,frozen_json,created_at,updated_at) VALUES(?,?,?,?,?,?,'starting',?,?,?)`)
      .run(job.id,scope.serverUrl,scope.organizationId,scope.accountId,grant.id,job.fencing,JSON.stringify(job),now(),now())
    const timestamp = now(), sessionId = newId('ses'), taskId = newId('tsk')
    this.store.createTask({id:taskId,projectId:grant.localProjectId,parentId:null,milestoneId:null,title:`组织任务 ${job.id.slice(0,8)}`,description:job.prompt,status:'ready',priority:2,assigneeAgentId:'agt_engineer',acceptanceCriteria:['仅在本机授权目录与工具范围内完成组织任务'],labels:['organization-job'],version:1,dueAt:null,createdAt:timestamp,updatedAt:timestamp},[])
    this.store.createSession({id:sessionId,projectId:grant.localProjectId,agentId:'agt_engineer',title:`组织远程执行 ${job.id.slice(0,8)}`,status:'active',createdAt:timestamp,updatedAt:timestamp})
    const entry = {runId:null as string|null,grantId:grant.id,timer:undefined as unknown as NodeJS.Timeout}
    let checking = false
    entry.timer = setInterval(() => {
      if (checking) return
      checking = true
      void (async () => {
        const run = entry.runId ? this.store.read.getRun(entry.runId) : null
        if (!run) return
        const terminal = ['completed','failed','cancelled','timed_out','budget_exhausted','needs_reconciliation'].includes(run.status)
        try {
          if (terminal) {
            const status = run.status === 'completed' ? 'completed' : run.status === 'cancelled' ? 'cancelled' : run.status === 'needs_reconciliation' ? 'needs_reconciliation' : 'failed'
            await remote('finish',{status,runId:run.id})
            this.receipt(job.id,status)
            clearInterval(entry.timer);this.active.delete(job.id)
          } else await remote('check')
        } catch {
          if (!terminal) await this.runner.cancel(run.id)
          this.receipt(job.id,'needs_reconciliation','Remote authority unavailable; local effects require inspection')
          clearInterval(entry.timer);this.active.delete(job.id)
        }
      })().finally(()=>{checking=false})
    },5_000)
    entry.timer.unref();this.active.set(job.id,entry)
    try {
      const definition = job.agent.definition
      const allowedTools = job.scope.tools.filter(tool=>grant.scope.tools.includes(tool))
      const result = await this.runner.startRun({projectId:grant.localProjectId,sessionId,taskId,workspaceRoot:grant.rootPath,prompt:job.prompt,
        authority:{kind:'organization-job',reference:job.id,allowedTools,maxToolCalls:Math.min(job.scope.maxToolCalls,grant.scope.maxToolCalls),isolatedContext:true,
          provenance:{organizationId:scope.organizationId,projectId:job.projectId,grantId:grant.id,fencing:job.fencing,agentVersionId:job.agent.id,checksum:job.agent.checksum,skillPins:job.skills.map(s=>({id:s.id,checksum:s.checksum}))},
          agentConfig:{agentName:`组织 Agent ${definition.role}`.slice(0,120),agentRole:definition.role,agentDescription:'',agentCapabilities:['implement'],
            persona:{role:definition.role,background:'',responsibilities:'',principles:'',style:'',constraints:`只可访问授权相对目录 ${JSON.stringify(grant.scope.directories)}；仅可使用 ${allowedTools.join(',')}。写入须逐次审批。`,systemPrompt:definition.instructions},
            skills:job.skills.map(skill=>({id:skill.id,name:skill.id.slice(0,120),description:'',version:skill.version,source:'organization',content:skill.definition.kind==='skill'?skill.definition.instructions:'',enabled:true}))},
          check:async(invocation,executing)=>{
            const current = this.local.executionGrant(job.grantId,scope)
            if (!allowedTools.includes(invocation.name as typeof allowedTools[number])) throw new AppError('POLICY_DENIED','工具超出组织执行授权。')
            // Missing readable files are ordinary tool errors, not loss of authority.
            const absolute = resolveWorkspacePath(current.rootPath,String(invocation.args.path??'.'),{forWrite:true})
            const permitted = current.scope.directories.some(dir=>{
              const rel=relative(resolve(current.rootPath,dir),absolute)
              return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')&&!rel.startsWith('..\\')
            })
            if (!permitted) throw new AppError('POLICY_DENIED','文件超出本机授权目录。')
            await remote('check',{tool:invocation.name,consume:executing})
            const after=this.local.executionGrant(job.grantId,scope)
            if(resolveWorkspacePath(after.rootPath,String(invocation.args.path??'.'),{forWrite:true})!==absolute)throw new AppError('POLICY_DENIED','在线核验期间目录已经变化。')
          }},
      })
      entry.runId=result.runId
      this.store.db.prepare("UPDATE worker_job_receipts SET status='running',run_id=?,updated_at=? WHERE job_id=?").run(result.runId,now(),job.id)
      return {runId:result.runId}
    } catch(error) {
      if(entry.runId)await this.runner.cancel(entry.runId)
      clearInterval(entry.timer);this.active.delete(job.id);this.receipt(job.id,'needs_reconciliation','Start failed; do not replay claimed job')
      throw error
    }
  }
}
