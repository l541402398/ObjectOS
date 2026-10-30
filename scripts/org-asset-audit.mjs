import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Optional installed design detector; its absence is evidence, never a simulated a11y pass. */
export async function auditAssetRenderer({ app, evidence, userData }) {
  const summary = { tool:'Impeccable rendered CDP detector', result:'SKIP', findings:null, note:'' }
  let stage='port discovery'
  try {
    const appData = await app.evaluate(({app})=>app.getPath('userData'))
    const portPath = [join(appData,'DevToolsActivePort'),join(userData,'DevToolsActivePort')].find(existsSync)
    if (!portPath) throw new Error('The isolated Electron instance did not expose a DevTools port file')
    const port = Number(readFileSync(portPath,'utf8').split(/\r?\n/)[0])
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid isolated DevTools port')
    const launcher=resolve('.tmp/reference-impeccable/cursor-plugin/skills/impeccable/scripts/impeccable.cmd').replace(/'/g,"''")
    stage='detector execution'
    const output=execFileSync('pwsh',['-NoProfile','-NonInteractive','-Command',`& '${launcher}' detect --cdp ${port} --target 'ProjectOS' --json`],{windowsHide:true,timeout:45_000,encoding:'utf8',stdio:['ignore','pipe','pipe']})
    writeFileSync('.tmp/a2-rendered-raw.json',output)
    stage='report parsing'
    const report=JSON.parse(output)
    const findings=Array.isArray(report)?report:Array.isArray(report.findings)?report.findings:null
    if (!findings) throw new Error('The installed detector returned an unrecognized report shape')
    summary.result=findings.length?'REVIEW':'PASS';summary.findings=findings.length
    summary.note='Read-only detector only; no full axe/WCAG or screen-reader certification.'
  } catch (error) {
    if(error.stderr)writeFileSync('.tmp/a2-rendered-stderr.txt',error.stderr)
    summary.note=`${stage} could not complete (${error.status ?? error.code ?? error.name}); source detection and focused Electron checks remain separate evidence.`
  }
  writeFileSync(join(evidence,'rendered-audit.json'),JSON.stringify(summary,null,2)+'\n')
  console.log('RENDERED AUDIT',JSON.stringify(summary))
}
