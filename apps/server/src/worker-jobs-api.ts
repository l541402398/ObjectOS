import { createHash, randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Pool, PoolClient } from 'pg'
import { z } from 'zod'
import { WorkerJobSubmitSchema, WorkerJobSchema, WorkerJobCheckSchema, WorkerJobProofSchema, WorkerJobFinishSchema, SharedAssetVersionSchema, canonicalAssetDefinition, type WorkerJob } from '@projectos/organization-contracts'
import { AssetScopeError } from './assets-api.js'
import { audit, inTransaction } from './postgres-store.js'
import { OrganizationWorkers } from './workers-api.js'

const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const denied = () => new AssetScopeError(403, 'JOB_FORBIDDEN', '任务权限、设备授权或发布版本已失效。')
const conflict = () => new AssetScopeError(409, 'JOB_CONFLICT', '任务已被处理或租约已失效，不能重新执行。')
type JobRow = { id: string; frozen: WorkerJob; status: WorkerJob['status']; fencing: number; lease_hash: string | null; lease_expires_at: string | null; tool_calls: number; run_id: string | null; created_at: string; updated_at: string }
export class OrganizationWorkerJobs {
  private readonly workers: OrganizationWorkers
  constructor(private readonly pool: Pool) { this.workers = new OrganizationWorkers(pool) }
  private view(row: JobRow) { return WorkerJobSchema.parse({ ...row.frozen, status: row.status, fencing: row.fencing, toolCalls: row.tool_calls, runId: row.run_id, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }) }
  private async project(client: PoolClient, org: string, project: string, account: string, write = true) {
    const row = (await client.query(`SELECT pm.role FROM organization_project_members pm JOIN organization_projects p ON p.id=pm.project_id AND p.organization_id=pm.organization_id
      JOIN member m ON m."organizationId"=pm.organization_id AND m."userId"=pm.account_id
      WHERE pm.organization_id=$1 AND pm.project_id=$2 AND pm.account_id=$3 AND p.status='active' FOR SHARE OF pm,p,m`, [org, project, account])).rows[0]
    if (!row || (write && !['owner','maintainer','contributor'].includes(row.role))) throw denied()
  }
  private async asset(client: PoolClient, org: string, project: string, version: string) {
    const row = (await client.query(`SELECT v.id,v.asset_id AS "assetId",v.version,v.definition,v.checksum,v.status,v.revision,v.created_at::float8 AS "createdAt",v.published_at::float8 AS "publishedAt"
      FROM organization_asset_versions v JOIN organization_assets a ON a.id=v.asset_id AND a.organization_id=v.organization_id
      JOIN organization_asset_bindings b ON b.organization_id=v.organization_id AND b.asset_id=v.asset_id AND b.version_id=v.id AND b.project_id=$2
      WHERE v.organization_id=$1 AND v.id=$3 AND v.status='published' AND (a.visibility='organization' OR a.project_id=$2) FOR SHARE OF v,a,b`, [org, project, version])).rows[0]
    if (!row) throw denied()
    const asset = SharedAssetVersionSchema.parse(row)
    if (`sha256:${digest(canonicalAssetDefinition(asset.definition))}` !== asset.checksum) throw denied()
    return asset
  }
  private async grant(client: PoolClient, org: string, id: string) {
    const grant = (await client.query(`SELECT g.*,w.owner_id FROM organization_worker_grants g JOIN organization_workers w ON w.id=g.worker_id AND w.organization_id=g.organization_id
      WHERE g.organization_id=$1 AND g.id=$2 AND g.revoked_at IS NULL AND g.expires_at>$3 AND w.state='active' FOR SHARE OF g,w`, [org, id, Date.now()])).rows[0]
    if (!grant) throw denied()
    await this.project(client, org, grant.project_id, grant.owner_id)
    return grant
  }
  async submit(org: string, account: string, session: string, raw: unknown) {
    const input = WorkerJobSubmitSchema.parse(raw)
    return this.workers.scope(org, account, session, async client => {
      const old = (await client.query('SELECT * FROM organization_worker_jobs WHERE id=$1 FOR UPDATE', [input.id])).rows[0] as JobRow | undefined
      if (old) {
        if (old.frozen.organizationId !== org || old.frozen.requesterId !== account || old.frozen.grantId !== input.grantId || old.frozen.agent.id !== input.agentVersionId || old.frozen.prompt !== input.prompt) throw conflict()
        await this.project(client, org, old.frozen.projectId, account)
        return this.view(old)
      }
      const grant = await this.grant(client, org, input.grantId)
      await this.project(client, org, grant.project_id, account)
      const agent = await this.asset(client, org, grant.project_id, input.agentVersionId)
      if (agent.definition.kind !== 'agent' || agent.definition.runtime !== 'native') throw denied()
      const skills = []
      for (const version of agent.definition.skillVersionIds) {
        const skill = await this.asset(client, org, grant.project_id, version)
        if (skill.definition.kind !== 'skill') throw denied()
        skills.push(skill)
      }
      const declared = new Set([...agent.definition.toolIds, ...skills.flatMap(s => s.definition.kind === 'skill' ? s.definition.toolIds : [])])
      const scope = { ...grant.scope, tools: grant.scope.tools.filter((tool: string) => declared.has(tool)) }
      if (!scope.tools.length) throw denied()
      const timestamp = Date.now()
      const job = WorkerJobSchema.parse({ id: input.id, organizationId: org, projectId: grant.project_id, workerId: grant.worker_id, grantId: grant.id, requesterId: account,
        prompt: input.prompt, agent, skills, scope, scopeDigest: grant.scope_digest, fencing: 0, status: 'pending', toolCalls: 0, runId: null, createdAt: timestamp, updatedAt: timestamp })
      await client.query(`INSERT INTO organization_worker_jobs(id,organization_id,project_id,worker_id,grant_id,requester_id,frozen,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8,$8)`, [job.id,org,job.projectId,job.workerId,job.grantId,account,JSON.stringify(job),timestamp])
      await audit(client, account, org, 'worker.job.submitted', job.id, { projectId: job.projectId, agentVersionId: agent.id, checksum: agent.checksum })
      return job
    })
  }
  async list(org: string, account: string, session: string) {
    return this.workers.scope(org, account, session, async client => {
      await client.query(`UPDATE organization_worker_jobs SET status='needs_reconciliation',updated_at=$2 WHERE organization_id=$1 AND status='running' AND lease_expires_at<=$2`, [org,Date.now()])
      const rows = (await client.query(`SELECT j.* FROM organization_worker_jobs j JOIN organization_project_members pm ON pm.organization_id=j.organization_id AND pm.project_id=j.project_id AND pm.account_id=$2 WHERE j.organization_id=$1 ORDER BY j.created_at DESC LIMIT 200`,[org,account])).rows as JobRow[]
      return { jobs: rows.map(row => this.view(row)) }
    })
  }
  async cancel(org: string, account: string, session: string, id: string) {
    z.uuid().parse(id)
    return this.workers.scope(org,account,session,async client => {
      const row = (await client.query('SELECT * FROM organization_worker_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE',[org,id])).rows[0] as JobRow | undefined
      if (!row) throw denied()
      await this.project(client,org,row.frozen.projectId,account)
      if (!['pending','running'].includes(row.status)) throw conflict()
      await client.query("UPDATE organization_worker_jobs SET status='cancelled',updated_at=$2 WHERE id=$1",[id,Date.now()])
      await audit(client,account,org,'worker.job.cancelled',id,{})
      return { ok: true }
    })
  }
  async reconcile(org:string,account:string,session:string,id:string,raw:unknown){
    z.uuid().parse(id);const {note}=z.object({note:z.string().trim().min(8).max(2000)}).strict().parse(raw)
    return this.workers.scope(org,account,session,async client=>{
      const row=(await client.query('SELECT * FROM organization_worker_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE',[org,id])).rows[0] as JobRow|undefined
      if(!row)throw denied()
      await this.project(client,org,row.frozen.projectId,account)
      if(row.status!=='needs_reconciliation')throw conflict()
      await client.query("UPDATE organization_worker_jobs SET status='failed',updated_at=$2 WHERE id=$1",[id,Date.now()])
      await audit(client,account,org,'worker.job.reconciled',id,{note,fencing:row.fencing,runId:row.run_id,outcome:'closed-without-success-or-replay'})
      return {ok:true}
    })
  }
  async work(org: string, worker: string, secret: string, id: string, action: 'claim'|'check'|'finish', raw: unknown) {
    z.uuid().parse(id)
    return inTransaction(this.pool,async client => {
      await client.query('SELECT id FROM organization WHERE id=$1 FOR UPDATE',[org])
      const device = await this.workers.device(client,org,worker,secret)
      const row = (await client.query('SELECT * FROM organization_worker_jobs WHERE organization_id=$1 AND id=$2 AND worker_id=$3 FOR UPDATE',[org,id,worker])).rows[0] as JobRow | undefined
      if (!row) throw denied()
      const grant = await this.grant(client,org,row.frozen.grantId)
      await this.project(client,org,row.frozen.projectId,row.frozen.requesterId)
      if (grant.scope_digest !== row.frozen.scopeDigest) throw denied()
      for (const pin of [row.frozen.agent,...row.frozen.skills]) if ((await this.asset(client,org,row.frozen.projectId,pin.id)).checksum !== pin.checksum) throw denied()
      if (action === 'claim') {
        z.object({}).strict().parse(raw)
        if (row.status !== 'pending' || Number(row.fencing) !== 0) throw conflict()
        if ((await client.query("SELECT id FROM organization_worker_jobs WHERE grant_id=$1 AND status='running'",[grant.id])).rowCount) throw conflict()
        const token = randomBytes(48).toString('base64url')
        await client.query("UPDATE organization_worker_jobs SET status='running',fencing=fencing+1,lease_hash=$2,lease_expires_at=$3,updated_at=$4 WHERE id=$1",[id,digest(token),Date.now()+120_000,Date.now()])
        await audit(client,device.owner_id,org,'worker.job.accepted',id,{fencing:row.fencing+1})
        return { job: {...this.view(row),status:'running',fencing:row.fencing+1},token }
      }
      const proof = WorkerJobProofSchema.parse({ fencing: (raw as {fencing?: unknown})?.fencing, token: (raw as {token?: unknown})?.token })
      if (row.status !== 'running' || row.fencing !== proof.fencing || row.lease_hash !== digest(proof.token) || Number(row.lease_expires_at) <= Date.now()) throw conflict()
      if (action === 'check') {
        const input = WorkerJobCheckSchema.parse(raw)
        if(input.runId&&row.run_id&&input.runId!==row.run_id)throw conflict()
        if (input.consume && (!input.tool || !row.frozen.scope.tools.includes(input.tool) || row.tool_calls >= row.frozen.scope.maxToolCalls)) throw denied()
        if (input.tool && !row.frozen.scope.tools.includes(input.tool)) throw denied()
        await client.query('UPDATE organization_worker_jobs SET lease_expires_at=$2,tool_calls=tool_calls+$3,updated_at=$4,run_id=COALESCE(run_id,$5) WHERE id=$1',[id,Date.now()+120_000,input.consume?1:0,Date.now(),input.runId??null])
        if (input.consume) await audit(client,device.owner_id,org,'worker.job.tool.authorized',id,{fencing:proof.fencing,tool:input.tool,sequence:row.tool_calls+1})
      } else {
        const input = WorkerJobFinishSchema.parse(raw)
        await client.query('UPDATE organization_worker_jobs SET status=$2,run_id=$3,lease_expires_at=NULL,updated_at=$4 WHERE id=$1',[id,input.status,input.runId,Date.now()])
        await audit(client,device.owner_id,org,'worker.job.finished',id,{status:input.status,runId:input.runId,fencing:proof.fencing})
      }
      return { ok: true }
    })
  }
}
export function registerOrganizationWorkerJobs(app: FastifyInstance,pool: Pool,accountFor: (auth: string|undefined,reply: FastifyReply)=>Promise<{id:string}|null>) {
  const service = new OrganizationWorkerJobs(pool), prefix='/v1/organizations/:orgId/worker-jobs'
  const session = (auth: string) => createHash('sha256').update(auth.slice(7)).digest('base64url')
  app.get(prefix,async(req,reply)=>{const account=await accountFor(req.headers.authorization,reply);if(account)return service.list((req.params as {orgId:string}).orgId,account.id,session(req.headers.authorization!))})
  app.post(prefix,async(req,reply)=>{const account=await accountFor(req.headers.authorization,reply);if(account)return service.submit((req.params as {orgId:string}).orgId,account.id,session(req.headers.authorization!),req.body)})
  app.delete(prefix+'/:jobId',async(req,reply)=>{const account=await accountFor(req.headers.authorization,reply);if(account){const p=req.params as {orgId:string;jobId:string};return service.cancel(p.orgId,account.id,session(req.headers.authorization!),p.jobId)}})
  app.post(prefix+'/:jobId/reconcile',async(req,reply)=>{const account=await accountFor(req.headers.authorization,reply);if(account){const p=req.params as {orgId:string;jobId:string};return service.reconcile(p.orgId,account.id,session(req.headers.authorization!),p.jobId,req.body)}})
  for(const action of ['claim','check','finish'] as const) app.post(prefix+'/:jobId/workers/:workerId/'+action,async req=>{
    const p=z.object({orgId:z.string().min(1).max(128),jobId:z.uuid(),workerId:z.uuid()}).parse(req.params)
    const bearer=z.string().regex(/^Bearer [A-Za-z0-9_-]{64}$/).parse(req.headers.authorization)
    return service.work(p.orgId,p.workerId,bearer.slice(7),p.jobId,action,req.body)
  })
}
