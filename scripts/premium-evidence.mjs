/** Reviewable evidence index. Run after the native matrix; no product or Git writes. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
const base=resolve('docs/design/system-premium')
const read=(name)=>JSON.parse(readFileSync(join(base,name),'utf8').replace(/^\uFEFF/,''))
const walk=(dir)=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):[path]})
const evidenceDirs=['before','lab','after','overlays','usability','readiness','validation','diagnostics','walkthrough']
const evidence=evidenceDirs.flatMap(dir=>walk(join(base,dir))).filter(path=>!path.endsWith('failure.png')).map(path=>({path:relative(base,path).replaceAll('\\','/'),bytes:statSync(path).size,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}))
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()
const tracked=execFileSync('git',['diff','HEAD','--name-only'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(path=>path.startsWith('apps/')||path.startsWith('packages/'))
const fresh=execFileSync('git',['ls-files','--others','--exclude-standard','apps','packages'],{encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean)
const implementation=[...new Set([...tracked,...fresh])].sort().map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),gitBlob:execFileSync('git',['hash-object',path],{encoding:'utf8'}).trim()}))
const initialValidation=read('validation/checks.json'), rechecks=existsSync(join(base,'validation/rechecks.json'))?read('validation/rechecks.json'):[]
const fontRechecks=existsSync(join(base,'validation/font-rechecks.json'))?read('validation/font-rechecks.json'):[]
const validation=[...new Map([...initialValidation,...rechecks,...fontRechecks].sort((a,b)=>Date.parse(a.startedAt)-Date.parse(b.startedAt)).map(check=>[check.name,check])).values()]
const lab=read('lab/checks.json'), usability=read('usability/checks.json'), overlays=read('overlays/checks.json')
const pages=read('after/inventory.json')
const count=(checks)=>({pass:checks.filter(c=>c.status==='PASS').length,fail:checks.filter(c=>c.status==='FAIL').length})
const manifest={baseHead:head,testedState:'working tree based on baseHead; raw SHA256 identifies built source and gitBlob accounts for repository line-ending normalization; review commit recorded separately after commit',generatedAt:new Date().toISOString(),validation,validationHistory:{full:initialValidation,rechecks,fontRechecks},lab:lab.summary,pages:count(pages.checks),routeRechecks:pages.rechecks,usability:count(usability.checks),readiness:count(read('readiness/checks.json').checks),overlays:count(overlays.checks),walkthrough:read('walkthrough/recording.json'),compositeReview:pages.results.filter(r=>r.failures?.length).map(r=>({name:r.name,findings:r.failures.map(({text,className,minimum})=>({text,className,minimum}))})),implementation,evidence}
writeFileSync(join(base,'evidence-manifest.json'),JSON.stringify(manifest,null,2))
console.log(JSON.stringify({head,files:evidence.length,screenshots:evidence.filter(e=>e.path.endsWith('.png')).length,validation:validation.map(c=>({name:c.name,status:c.status}))},null,2))
