import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { WorkerJobSchema, type LocalWorkerGrant } from '@projectos/contracts'
import { OrganizationJobService } from '../apps/runtime/src/organization-jobs.js'
import { LocalWorkerService } from '../apps/runtime/src/local-worker.js'
import { createGitProject, FakeProvider, setup, waitFor } from './helpers/r1-fixture.js'
const cleanup:Array<()=>void>=[]
afterEach(async()=>{while(cleanup.length)cleanup.pop()!()})
async function fixture(path='src/hello.txt'){
  let allowed=true
  const fake=new FakeProvider(call=>call.index===0?{tool:{name:'read_file',args:{path}}}:call.index===1?{tool:{name:'write_file',args:{path,content:'approved scoped content'}}}:{text:'done'})
  const h=setup(fake),project=await createGitProject(h.services,h.dataDir,'remote-job')
  mkdirSync(join(project.rootPath,'src'))
  const server=createServer((_req,res)=>{res.writeHead(allowed?200:403,{'content-type':'application/json'});res.end(JSON.stringify({ok:allowed}))})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const scope={serverUrl:`http://127.0.0.1:${(server.address() as {port:number}).port}`,organizationId:'org',accountId:'account'}
  const local=new LocalWorkerService(h.store),workerId=randomUUID()
  const grant=local.dispatch('runtime.worker.prepare',{...scope,workerId,request:{projectId:'shared',localProjectId:project.id,durationHours:1,scope:{directories:['src'],tools:['read_file','write_file'],maxToolCalls:4}}}) as LocalWorkerGrant
  local.dispatch('runtime.worker.confirm',{id:grant.id,scopeDigest:grant.scopeDigest});local.dispatch('runtime.worker.activate',{id:grant.id,scopeDigest:grant.scopeDigest})
  const jobs=new OrganizationJobService(h.store,h.runner,local),versionId=randomUUID(),timestamp=Date.now()
  const job=WorkerJobSchema.parse({id:randomUUID(),organizationId:'org',projectId:'shared',workerId,grantId:grant.id,requesterId:'account',prompt:'write the requested file',scope:grant.scope,scopeDigest:grant.scopeDigest,fencing:1,status:'running',toolCalls:0,runId:null,createdAt:timestamp,updatedAt:timestamp,
    agent:{id:versionId,assetId:randomUUID(),version:'1.0.0',definition:{kind:'agent',runtime:'native',role:'工程师',instructions:'Only write src/hello.txt',skillVersionIds:[],toolIds:['read_file','write_file']},checksum:'sha256:'+'a'.repeat(64),revision:1,status:'published',createdAt:timestamp,publishedAt:timestamp},skills:[]})
  const token=randomBytes(48).toString('base64url'),secret=randomBytes(48).toString('base64url')
  cleanup.push(()=>{local.dispatch('runtime.worker.clear',scope);server.closeAllConnections();server.close();h.close();rmSync(h.dataDir,{recursive:true,force:true,maxRetries:5,retryDelay:100})})
  return {...h,project,local,grant,job,token,secret,scope,jobs,revoke:()=>{allowed=false},accept:()=>jobs.accept({...scope,lease:{job,token},secret})}
}
it('rechecks live authority after write approval, keeps the file untouched and persists no bearer',async()=>{
  const f=await fixture(),run=await f.accept()
  await waitFor(()=>f.store.read.listApprovalViews(f.project.id,run.runId).some(a=>a.status==='pending'))
  const approval=f.store.read.listApprovalViews(f.project.id,run.runId).find(a=>a.status==='pending')!
  expect(f.store.read.getToolCalls(run.runId).find(call=>call.toolName==='read_file')?.status).toBe('denied')
  expect(existsSync(join(f.project.rootPath,'src/hello.txt'))).toBe(false)
  f.revoke()
  await f.runner.decideApproval(approval.id,'approved','仅批准本次目录写入').catch(()=>undefined)
  await waitFor(()=>['failed','cancelled'].includes(f.store.read.getRun(run.runId)?.status??''))
  expect(existsSync(join(f.project.rootPath,'src/hello.txt'))).toBe(false)
  const receipt=JSON.stringify(f.store.db.prepare('SELECT * FROM worker_job_receipts').all())
  const detail=JSON.stringify(f.store.read.getRunDetail(run.runId))
  for(const value of [receipt,detail]){expect(value).not.toContain(f.token);expect(value).not.toContain(f.secret)}
  await expect(f.accept()).rejects.toThrow(/记录/)
},15000)
it('rejects a path outside the granted directory before creating a file approval',async()=>{
  const f=await fixture('outside.txt'),run=await f.accept()
  await waitFor(()=>f.store.read.getRun(run.runId)?.status==='failed')
  expect(f.store.read.listApprovalViews(f.project.id,run.runId)).toHaveLength(0)
  expect(existsSync(join(f.project.rootPath,'outside.txt'))).toBe(false)
},15000)
