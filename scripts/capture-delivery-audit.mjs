/** Read-only persisted evidence following real UI actions; no product mutations or credentials. */
import { DatabaseSync } from 'node:sqlite'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const evidence=resolve('docs/v2/evidence/delivery-organization-closure')
const {profile}=JSON.parse(readFileSync(join(evidence,'desktop-session.json'),'utf8'))
const db=new DatabaseSync(join(profile,'data/projectos.db'),{readOnly:true})
try {
 const project=db.prepare('SELECT id,name,root_path FROM projects WHERE name=?').get('同步与冲突闭环验收')
 if(!project)throw new Error('Missing UI-created project')
 const operations=db.prepare('SELECT id,kind,status,approval_id,run_id,tool_call_id,parent_id,result_json,error FROM git_delivery_operations WHERE project_id=? ORDER BY created_at').all(project.id).map(({result_json,...row})=>({...row,result:JSON.parse(result_json??'{}')}))
 const runs=db.prepare('SELECT id,agent_id,task_id,status,error,input_tokens,output_tokens FROM agent_runs WHERE project_id=? ORDER BY created_at').all(project.id)
 const native=runs.filter(r=>r.agent_id==='agt_engineer')
 const details=native.map(run=>({run,snapshot:JSON.parse(db.prepare('SELECT snapshot_json FROM run_snapshots WHERE run_id=?').get(run.id)?.snapshot_json??'null'),tools:db.prepare('SELECT id,tool_name,status,args_json,result_json,error FROM tool_calls WHERE run_id=? ORDER BY created_at').all(run.id).map(({args_json,result_json,...row})=>({...row,args:JSON.parse(args_json),result:JSON.parse(result_json??'null')})),approvals:db.prepare('SELECT id,status,title,decision FROM approvals WHERE run_id=? ORDER BY requested_at').all(run.id)}))
 const receipts=db.prepare('SELECT job_id,organization_id,grant_id,fencing,status,run_id,frozen_json,error FROM worker_job_receipts ORDER BY created_at').all().map(({frozen_json,...row})=>({...row,frozen:JSON.parse(frozen_json)}))
 const reviews=db.prepare('SELECT resolution_id,fingerprint,artifact_id,note FROM git_resolution_reviews').all()
 const git=(where,...args)=>execFileSync('git',['-C',where,...args],{encoding:'utf8',windowsHide:true}).trim()
 const output={method:'Read-only persisted audit after real desktop UI; no business API mutations',project,operations,details,receipts,reviews,localHead:git(project.root_path,'rev-parse','HEAD'),remoteHead:git(join(profile,'delivery-remote.git'),'rev-parse','refs/heads/main')}
 writeFileSync(join(evidence,'persisted-delivery-audit.json'),JSON.stringify(output,null,2))
 console.log(JSON.stringify({gitOperations:operations.length,nativeRuns:native.length,jobs:receipts.map(r=>({jobId:r.job_id,status:r.status,runId:r.run_id})),localHead:output.localHead,remoteHead:output.remoteHead}))
} finally {db.close()}
