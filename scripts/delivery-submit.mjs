/** One explicit, non-forced submission of the reviewed code and its audit evidence. */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const root=resolve('.'),branch='codex/premium-system',base='0c2973ef4efbc0f6c5a1b512c55533d4c206ce00'
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}}).trim()
if(git('branch','--show-current')!==branch||git('rev-parse','HEAD')!==base)throw new Error('Branch or reviewed baseline changed; stop for review')
if(git('remote','get-url','origin')!=='https://github.com/l541402398/ObjectOS.git')throw new Error('Unexpected remote; no upload')
const checks=JSON.parse(readFileSync('docs/v2/evidence/delivery-organization-closure/final-checks.json','utf8'))
if(checks.checks.length<7||checks.checks.some(c=>c.status!=='PASS'))throw new Error('Final checks are incomplete')
const desktop=JSON.parse(readFileSync('docs/v2/evidence/delivery-organization-closure/desktop-checks.json','utf8'))
if(desktop.complete!==true||desktop.checks.some(c=>c.status!=='PASS'))throw new Error('Desktop acceptance is incomplete or has failures')
git('fetch','origin','--prune')
if(git('rev-parse',`origin/${branch}`)!==base)throw new Error('Remote advanced; preserve work and review before integration')
git('pull','--ff-only','origin',branch)
git('add','--','apps','packages','tests','scripts','docs/architecture.md','docs/design-system.md','docs/design/DESIGN_CHANGELOG.md',
 'docs/adr/0079-worktree-identity-and-merge-boundary.md','docs/adr/0080-compact-requirement-workspaces.md',
 'docs/adr/0081-audited-sync-conflicts-and-organization-jobs.md','docs/adr/0082-automatic-verification-selection.md',
 'docs/adr/0083-desktop-login-progress.md','docs/v2/evidence/2026-11-05-functional-audit','docs/v2/evidence/delivery-organization-closure',
 ':(exclude)docs/v2/evidence/2026-11-05-functional-audit/screenshots/11-organization-members.png')
// Actual check outputs are required audit artifacts despite the repository-wide *.log ignore.
for(const directory of ['docs/v2/evidence/2026-11-05-functional-audit','docs/v2/evidence/delivery-organization-closure']) {
 const logs=readdirSync(directory).filter(name=>name.endsWith('.log')).map(name=>`${directory}/${name}`)
 if(logs.length)git('add','--force','--',...logs)
}
const staged=git('diff','--cached','--name-only','-z').split('\0').filter(Boolean)
if(staged.some(p=>p==='pelican-bicycle-2d.html'||p.startsWith('.tmp/')||/\.(?:db|sqlite|vault)$/.test(p)))throw new Error('Unexpected staged private/unrelated data; no commit')
// UI text snapshots and raw command logs preserve tabs/blank lines from the actual run.
// Check authored source/docs without rewriting those audit records to satisfy whitespace lint.
git('diff','--cached','--check','--','.',':(glob,exclude)docs/v2/evidence/**/*.txt',':(glob,exclude)docs/v2/evidence/**/*.log')
console.log(git('diff','--cached','--stat'))
git('commit','-m','feat: close audited Git delivery and organization execution')
const commit=git('rev-parse','HEAD')
git('push','origin',`HEAD:refs/heads/${branch}`)
const observed=git('ls-remote','origin',`refs/heads/${branch}`).split(/\s/)[0]
if(observed!==commit)throw new Error('Push outcome needs read-only reconciliation; never retry blindly')
const result={commit,branch,remoteVerified:true,files:staged.length,status:git('status','--short')}
writeFileSync('.tmp/delivery-submission-result.json',JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
