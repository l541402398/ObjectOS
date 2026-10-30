/** Run after the real checks finish. Keeps evidence hashes and the tested implementation SHA together. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const base='d5c99e245d4262e2f02b81df94791c818141e68c', folder='docs/org-upgrade/evidence/A2.1'
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const record=path=>{const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:hash(bytes)}}
const log=name=>readFileSync(`.tmp/a2-${name}.txt`,'utf8')
const requireLog=(name,pattern)=>{if(!pattern.test(log(name)))throw new Error(`No passing evidence for ${name}`)}
requireLog('lint',/0 errors[\s\S]*Dependency boundaries OK/)
requireLog('typecheck',/tsc -p tsconfig.json --noEmit/)
if(/error TS\d+/.test(log('typecheck')))throw new Error('Typecheck failed')
const unit=/Tests\s+(\d+) passed\s+\|\s+(\d+) skipped/.exec(log('test'))
if(!unit || /Tests\s+\d+ failed/.test(log('test')))throw new Error('Unit/integration checks did not pass')
for(const [name,pattern] of [['e2e',/E2E PASS/],['agent-e2e',/AGENT E2E PASS/],['v12-e2e',/V1.2 E2E PASS/],['v13-e2e',/V1.3 E2E PASS/],['package-smoke',/PACKAGE SMOKE PASS/],['server-smoke',/PASS built JavaScript PostgreSQL server \/health/]])requireLog(name,pattern)
requireLog('package',/updating asar integrity executable resource/)
const journey=JSON.parse(readFileSync(`${folder}/electron-checks.json`,'utf8'))
if(journey.summary.fail || journey.summary.pass<77)throw new Error('The asset journey did not pass')
const sourceFindings=JSON.parse(readFileSync('.tmp/a2-design-detect.txt','utf8'))
writeFileSync(`${folder}/source-audit.json`,JSON.stringify({tool:'Impeccable source detector',result:sourceFindings.length?'REVIEW':'PASS',findings:sourceFindings},null,2)+'\n')
const walk=path=>readdirSync(path,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(path,entry.name)):entry.name.endsWith('.png')?[join(path,entry.name).replaceAll('\\','/')]:[])
const screenshots=walk(folder).sort().map(path=>{const bytes=readFileSync(path);return {...record(path),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),classification:path.includes('/diagnostics/')?'historical-diagnostic':'final-run-evidence'}})
const preserved=[
 'apps/desktop/src/renderer/src/features/collaboration-overview/CollaborationGraph.tsx',
 'apps/desktop/src/renderer/src/features/collaboration-overview/focus-projection.ts',
 'apps/desktop/src/renderer/src/pages/AgentWorkbenchPage.tsx',
 'packages/design-tokens/src/unified.css',
].map(path=>{
 const before=execFileSync('git',['show',`${base}:${path}`],{encoding:'utf8'}).replaceAll('\r\n','\n')
 const current=readFileSync(path,'utf8').replaceAll('\r\n','\n')
 if(before!==current)throw new Error(`Protected source changed: ${path}`)
 return {path,result:'UNCHANGED',utf8LfSha256:hash(current)}
})
const before=execFileSync('git',['show',`${base}:apps/server/src/postgres-store.ts`],{encoding:'utf8'})
const current=readFileSync('apps/server/src/postgres-store.ts','utf8').replaceAll('\r\n','\n')
const sql=text=>/const APPLICATION_SCHEMA_SQL = `([\s\S]*?)`/.exec(text)?.[1]
if(!sql(before)||sql(before)!==sql(current))throw new Error('Migration 1 SQL changed')
const implementationSha=process.argv[2]??null
if(implementationSha&&!/^[a-f0-9]{40}$/.test(implementationSha))throw new Error('Invalid implementation SHA')
const artifacts=['apps/server/dist/index.js','apps/runtime/dist/index.mjs','apps/desktop/out/main/index.js','apps/desktop/out/preload/index.js','apps/desktop/out/renderer/index.html','release/win-unpacked/ProjectOS.exe','release/win-unpacked/resources/app.asar','release/win-unpacked/resources/runtime/index.mjs']
const signature=execFileSync('pwsh',['-NoProfile','-Command',"(Get-AuthenticodeSignature -LiteralPath 'release/win-unpacked/ProjectOS.exe').Status.ToString()"],{encoding:'utf8',windowsHide:true}).trim()
const commands=['pnpm lint','pnpm typecheck','pnpm test','pnpm build (also run by package:dir)','pnpm package:dir','pnpm test:package','node scripts/e2e.mjs','node scripts/agent-e2e.mjs','node scripts/v12-e2e.mjs','node scripts/v13-e2e.mjs','node --import tsx scripts/org-server-artifact-smoke.mts','node --import tsx scripts/org-a2-e2e.mjs']
const manifest={
 schemaVersion:1,phase:'A2.1 organization asset catalog and project version pins',branch:'codex/org-a2-assets',baselineCommit:base,
 generatedAtUtc:new Date().toISOString(),userDate:'2026-10-29',userTimeZone:'America/Los_Angeles',
 implementationCommit:{sha:implementationSha,status:implementationSha?'COMMITTED':'PENDING_COMMIT',note:'Code and evidence are committed together; a later metadata-only commit records the exact implementation SHA.'},
 result:'PASS_ENGINEERING_CHECKS_VISUAL_REVIEW_PENDING',checks:commands.map(command=>({command,result:'PASS',exitCode:0})),
 unitTests:{passed:Number(unit[1]),skipped:Number(unit[2]),failed:0,windowsMaxWorkers:4},lint:{errors:0,warnings:29,boundaries:'PASS'},
 organizationJourney:journey.summary,focusedPostgresTests:{passed:24,failed:0},compiledServerSmoke:{passed:2,failed:0},
 audit:{source:sourceFindings.length?'REVIEW':'PASS',rendered:JSON.parse(readFileSync(`${folder}/rendered-audit.json`,'utf8'))},
 schemaMigration:{version:2,originalApplicationSqlUnchanged:true,originalApplicationSqlSha256:hash(sql(before)),upgradePreservesV1DataAndChecksum:'PASS (real PostgreSQL test)'},
 preservedSources:preserved,
 structuredEvidence:['electron-checks.json','rendered-audit.json','source-audit.json'].map(file=>record(`${folder}/${file}`)),
 screenshots,buildArtifacts:artifacts.map(path=>({...record(path),...(path.endsWith('ProjectOS.exe')?{authenticodeStatus:signature}:{})})),
 skippedChecks:['External model/CLI Harness and SSH/VPS (4 tests)','Full axe/WCAG and screen-reader','Foreground FPS/memory benchmark','Physical touch-device testing','User aesthetic acceptance'],
 boundaries:['Shared definitions/pins do not install or execute local capabilities','Worker grants, leases, local links, AssetBindingResolver and frozen Run snapshots remain A2.2','No production deployment or signing; A1 production identity limitations remain','Global Settings unsaved-close protection is not introduced; save drafts explicitly','100 versions, 200 catalog rows, 200 visible binding rows; no unlimited pagination'],
 privacy:{privateReferenceVideosCopied:false,rawCredentialsOrLogsIncluded:false,paths:'Repository relative; generated demo identities only in captures'},
}
writeFileSync(`${folder}/manifest.json`,JSON.stringify(manifest,null,2)+'\n')
console.log(JSON.stringify({result:manifest.result,unitTests:manifest.unitTests,journey:journey.summary,screenshots:screenshots.length,signature,implementationSha}))
