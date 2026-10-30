/** Verify actual local outputs, then carry a bounded audit record with the implementation commit. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const base = '4e1936965e26022379888277c6cced57c05a07e9', folder = 'docs/org-upgrade/evidence/A2.2a'
const hash = (value) => createHash('sha256').update(value).digest('hex')
const record = (path) => { const bytes = readFileSync(path); return { path, bytes: bytes.length, sha256: hash(bytes) } }
const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const read = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n')
const checks = []
for (const [name, command, pattern] of [
  ['lint', 'pnpm lint', /0 errors[\s\S]*Dependency boundaries OK/],
  ['typecheck', 'pnpm typecheck', /tsc -p tsconfig.json --noEmit/],
  ['test', 'pnpm test', /Tests\s+563 passed\s+\|\s+4 skipped/],
  ['build', 'pnpm build', /Build success/],
  ['e2e', 'node scripts/e2e.mjs', /E2E PASS/],
  ['agent-e2e', 'node scripts/agent-e2e.mjs', /AGENT E2E PASS/],
  ['v12-e2e', 'node scripts/v12-e2e.mjs', /V1.2 E2E PASS/],
  ['v13-e2e', 'node scripts/v13-e2e.mjs', /V1.3 E2E PASS/],
  ['package', 'pnpm package:dir', /updating asar integrity executable resource/],
  ['package-smoke', 'pnpm test:package', /PACKAGE SMOKE PASS/],
  ['server-smoke', 'node --import tsx scripts/org-server-artifact-smoke.mts', /PASS built JavaScript PostgreSQL server \/health/],
  ['electron', 'node --import tsx scripts/org-a22-e2e.mjs', /ORG A1 E2E SUMMARY \{"pass":77,"fail":0\}/],
]) {
  const path = `.tmp/a22-${name}.txt`, value = read(path)
  if (!pattern.test(value) || /error TS\d+|ELIFECYCLE|Tests\s+\d+ failed/.test(value)) throw new Error(`No passing result: ${command}`)
  checks.push({ command, status: 'PASS', exitCode: 0, fullOutputSha256: record(path).sha256, outputTail: value.trim().split('\n').slice(-16) })
}
const journey = JSON.parse(read(`${folder}/electron-checks.json`)), axe = JSON.parse(read(`${folder}/axe-audit.json`))
if (journey.summary.fail || journey.summary.pass !== 77 || axe.states.length !== 10 || axe.states.some((s) => s.violations.length)) throw new Error('Renderer checks incomplete')
const findings = JSON.parse(read('.tmp/a22-source-audit.json'))
if (findings.length) throw new Error('Unresolved source findings')
writeFileSync(`${folder}/source-audit.json`, JSON.stringify({ tool: 'Impeccable source detector', status: 'PASS', findings }, null, 2) + '\n')
const protectedPaths = [
  'apps/desktop/src/renderer/src/features/collaboration-overview/CollaborationGraph.tsx',
  'apps/desktop/src/renderer/src/features/collaboration-overview/focus-projection.ts',
  'apps/desktop/src/renderer/src/pages/AgentWorkbenchPage.tsx',
  'packages/design-tokens/src/unified.css',
  'apps/server/src/assets-schema.ts',
  'apps/server/src/postgres-auth-schema.ts',
]
const preserved = protectedPaths.map((path) => {
  const old = git(['show', `${base}:${path}`]).replaceAll('\r\n', '\n'), current = read(path).trimEnd()
  if (old !== current) throw new Error(`Protected source changed: ${path}`)
  return { path, status: 'UNCHANGED', utf8LfSha256: hash(current) }
})
const sql = (text) => /const APPLICATION_SCHEMA_SQL = `([\s\S]*?)`/.exec(text)?.[1]
const oldPg = sql(git(['show', `${base}:apps/server/src/postgres-store.ts`]).replaceAll('\r\n', '\n'))
if (!oldPg || oldPg !== sql(read('apps/server/src/postgres-store.ts'))) throw new Error('Original PG migration changed')
const sqliteSql = (text) => new Map([...text.matchAll(/^const (V\d+) = `([\s\S]*?)`/gm)].map((match) => [match[1], match[2]]))
const oldSqlite = sqliteSql(git(['show', `${base}:packages/persistence/src/migrations.ts`]).replaceAll('\r\n', '\n'))
const currentSqlite = sqliteSql(read('packages/persistence/src/migrations.ts'))
if (oldSqlite.size !== 36 || currentSqlite.size !== 37 || [...oldSqlite].some(([name, value]) => currentSqlite.get(name) !== value)) throw new Error('Old SQLite SQL changed')
const sourcePaths = [...new Set([
  ...git(['diff', '--name-only', base]).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard', 'apps', 'packages', 'scripts', 'tests']).split('\n'),
])].filter((p) => /^(apps|packages|scripts|tests|tooling)\//.test(p) || ['package.json', 'pnpm-lock.yaml'].includes(p))
  .filter((p) => p !== 'scripts/p29-settings-probe.mjs' && /\.(tsx?|css|mjs|mts|json|yaml)$/.test(p)).sort()
const walk = (path) => readdirSync(path, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(path, e.name)) : e.name.endsWith('.png') ? [join(path, e.name).replaceAll('\\', '/')] : [])
const screenshots = walk(folder).sort().map((path) => { const bytes = readFileSync(path); return { ...record(path), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), classification: path.includes('/before/') ? 'A2.1-comparison' : path.includes('/diagnostics/') ? 'historical-diagnostic' : 'final-run-evidence' } })
const signature = execFileSync('pwsh', ['-NoProfile', '-Command', "(Get-AuthenticodeSignature -LiteralPath 'release/win-unpacked/ProjectOS.exe').Status.ToString()"], { encoding: 'utf8', windowsHide: true }).trim()
const implementationSha = process.argv[2] ?? null
if (implementationSha && !/^[a-f0-9]{40}$/.test(implementationSha)) throw new Error('Invalid commit')
const manifest = {
  phase: 'A2.2a registered devices and native-confirmed local project consent', branch: 'codex/org-a2-worker',
  testedBaseHead: base, generatedAtUtc: new Date().toISOString(), userDate: '2026-10-29', timeZone: 'America/Los_Angeles',
  implementationCommit: { sha: implementationSha, status: implementationSha ? 'COMMITTED' : 'PENDING_COMMIT', note: 'Implementation and evidence travel together; follow-up metadata records the exact implementation SHA.' },
  status: 'PASS_ENGINEERING_CHECKS_VISUAL_ACCEPTANCE_PENDING', checks,
  unitTests: { pass: 563, skip: 4, fail: 0, files: 103, windowsMaxWorkers: 4 },
  organizationJourney: journey.summary, axe: { states: axe.states.length, violations: 0, incomplete: axe.states.reduce((n, s) => n + s.incomplete.length, 0), scope: axe.scope },
  migrations: { postgres: 3, originalApplicationSqlUnchanged: true, originalApplicationSqlSha256: hash(oldPg), sqlite: 37, previous36SqlUnchanged: true, previous36: [...oldSqlite].map(([name, value]) => ({ name, utf8LfSha256: hash(value) })) },
  preservedSources: preserved, testedSourceFiles: sourcePaths.map(record), screenshots,
  structuredEvidence: ['electron-checks.json', 'axe-audit.json', 'source-audit.json', 'native-consent-test.json'].map((p) => record(`${folder}/${p}`)),
  buildArtifacts: ['apps/server/dist/index.js', 'apps/runtime/dist/index.mjs', 'apps/desktop/out/main/index.js', 'apps/desktop/out/preload/index.js', 'release/win-unpacked/ProjectOS.exe', 'release/win-unpacked/resources/app.asar', 'release/win-unpacked/resources/runtime/index.mjs'].map((path) => ({ ...record(path), ...(path.endsWith('ProjectOS.exe') ? { authenticodeStatus: signature } : {}) })),
  boundaries: ['No task reception, job leases, fencing or organization Run adoption; A2.2b remains', 'Native file scope facts only; no command/Git/network/MCP authority', 'OS dialog response injected in harness; physical native dialog input/pixels unverified', 'No production deployment or signed installer', 'Full screen reader / physical touch / GPU FPS acceptance not claimed', 'Four pre-existing opt-in external model/CLI/SSH cases skipped', '200 registered devices per org, 200 grant records per device and 500 local records per scope; no retention/pagination UI', 'Shared-asset revocation applies to future execution in A2.2b; no Run is launched here'],
  privacy: { privateVideosCopied: false, rawCredentialsIncluded: false, output: 'bounded actual command tails; only generated test identities/temporary test paths in captures', paths: 'repository-relative source and artifact paths' },
}
writeFileSync(`${folder}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')
console.log(JSON.stringify({ status: manifest.status, implementationSha, screenshots: screenshots.length, journey: journey.summary, axe: manifest.axe, signature }))
