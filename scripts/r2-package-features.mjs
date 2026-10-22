/**
 * R2 Phase 4: verify the freshly packaged Windows build actually contains the
 * R1/R2 runtime and renderer features (not just that the old EXE still boots).
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const asar = require(join(process.cwd(), 'node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar'))
const packageDir = resolve(process.cwd(), process.env.PROJECTOS_PACKAGE_DIR ?? 'release/win-unpacked')
const runtimeFile = join(packageDir, 'resources', 'runtime', 'index.mjs')
const archive = join(packageDir, 'resources', 'app.asar')

const runtime = readFileSync(runtimeFile, 'utf8')
const runtimeChecks = {
  'V19 agent_execution_slots': runtime.includes('agent_execution_slots'),
  'V20 deadline_at': runtime.includes('deadline_at'),
  'V20 budget_json': runtime.includes('budget_json'),
  'V21 run_file_changes': runtime.includes('run_file_changes'),
  'run.reconcile handler': runtime.includes('"run.reconcile"'),
  'orchestration.reassign': runtime.includes('"orchestration.reassign"'),
  'orchestration.declineReassign': runtime.includes('"orchestration.declineReassign"'),
  'P0-04 task.acceptancePolicy': runtime.includes('"task.acceptancePolicy"'),
  'P0-04 task.requestAcceptance': runtime.includes('"task.requestAcceptance"'),
  'P0-04 task.confirmAcceptance': runtime.includes('"task.confirmAcceptance"'),
}

const entries = asar.listPackage(archive)
const workspaceChunk = entries.find((entry) => /OrchestrationWorkspace-.*\.js$/.test(entry))
const workspaceCss = entries.find((entry) => /OrchestrationWorkspace-.*\.css$/.test(entry))
if (!workspaceChunk || !workspaceCss) throw new Error('packaged orchestration chunk missing')
const js = asar.extractFile(archive, workspaceChunk.replace(/^[\\/]/, '')).toString('utf8')
const css = asar.extractFile(archive, workspaceCss.replace(/^[\\/]/, '')).toString('utf8')
const rendererChecks = {
  'reassign panel': js.includes('reassign-panel'),
  'reassign confirm API': js.includes('declineReassign') && js.includes('orchestration.reassign'),
  'reassign styles': css.includes('po-reassign'),
}

const failures = []
for (const [name, ok] of Object.entries({ ...runtimeChecks, ...rendererChecks })) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failures.push(name)
}
if (failures.length > 0) {
  console.error(`[r2-package-features] FAIL missing: ${failures.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(
    `[r2-package-features] PASS runtime=${Object.keys(runtimeChecks).length} renderer=${Object.keys(rendererChecks).length} ` +
      `chunk=${workspaceChunk}`,
  )
}
