/** Reviewable, sequential final checks; logs and exit codes travel with the code. */
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { resolve, join } from 'node:path'
const root=resolve('.'),evidence=join(root,'docs/v2/evidence/delivery-organization-closure')
const crossSpawn=createRequire(join(root,'packages/workspace/package.json'))('cross-spawn')
mkdirSync(evidence,{recursive:true})
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(p=>/^(apps|packages|tests|scripts|tooling)\//.test(p)).sort()
const hash=createHash('sha256');for(const path of paths){hash.update(path+'\0');hash.update(readFileSync(join(root,path)))}
const sourceHash=hash.digest('hex'),checks=[]
const commands=[
 ['pnpm',['lint'],'lint-verified'],['pnpm',['typecheck'],'typecheck-verified'],
 ['pnpm',['exec','vitest','run','tests/org-job-runtime.test.ts','tests/org-local-worker.test.ts','--maxWorkers=1'],'remote-final-tests'],
 [process.execPath,['scripts/v13-e2e.mjs'],'v13-e2e'],
 ['pnpm',['package:dir'],'package-dir'],['pnpm',['test:package'],'package-smoke'],
 ...(process.argv.includes('--interactive')?[[process.execPath,['scripts/delivery-desktop-audit.mjs','--packaged'],'packaged-ui-session']]:[]),
]
for(const [command,args,name] of commands){
 const startedAt=new Date().toISOString(),log=createWriteStream(join(evidence,name+'.log'))
 const code=await new Promise(resolveCode=>{const child=crossSpawn(command,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});child.once('error',error=>{log.write(error.message);resolveCode(-1)});child.once('close',resolveCode)})
 await new Promise(r=>log.end(r))
 checks.push({command:[command,...args].join(' '),status:code===0?'PASS':'FAIL',exitCode:code,startedAt,finishedAt:new Date().toISOString(),log:name+'.log'})
 writeFileSync(join(evidence,'final-checks.json'),JSON.stringify({head,sourceHash,checks},null,2))
 console.log(`${code===0?'PASS':'FAIL'} ${name}`)
 if(code!==0){process.exitCode=1;break}
}
