/** Sequential knowledge acceptance. Preserve every attempt and its source manifest. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('.')
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8) ?? 'k1'
if (!['k1', 'k2', 'k3'].includes(phase)) throw new Error('Unknown phase')
const evidence = join(root, `docs/v2/evidence/${phase === 'k1' ? 'organization-knowledge-phase1' : `organization-knowledge-${phase}`}`)
const spawn = createRequire(join(root, 'packages/workspace/package.json'))('cross-spawn')
mkdirSync(evidence, { recursive: true })
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0').filter(path => /^(apps|packages|tests|scripts|tooling)\//.test(path)).sort()
const hash = createHash('sha256'), files = []
for (const path of paths) {
  const bytes = readFileSync(join(root, path))
  const canonical = /\.(?:[cm]?[jt]sx?|json|css|html|ya?ml|md|toml)$/.test(path) ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes
  const sha256 = createHash('sha256').update(canonical).digest('hex')
  files.push({ path, sha256 }); hash.update(path + '\0' + sha256 + '\n')
}
const sourceHash = hash.digest('hex')
const manifestName = `source-manifest.${sourceHash.slice(0, 12)}.json`
if (phase !== 'k1') {
  const manifest = JSON.stringify({ head, normalization: 'CRLF to LF for text source; raw bytes for binary', sourceHash, files }, null, 2) + '\n'
  writeFileSync(join(evidence, manifestName), manifest)
  if (!existsSync(join(evidence, 'source-manifest.json'))) writeFileSync(join(evidence, 'source-manifest.json'), manifest)
}
const file = join(evidence, 'checks.json')
const attempts = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).attempts : []
const commands = [
  ...(phase === 'k3' ? [['baseline-package', process.execPath, ['docs/v2/evidence/organization-knowledge-k3/artifact-provenance.mjs', 'baseline']]] : []),
  ['lint', 'pnpm', ['lint']],
  ['typecheck', 'pnpm', ['typecheck']],
  ['test', 'pnpm', ['run', 'test', '--maxWorkers=2']],
  ['build', 'pnpm', ['build']],
  ...(phase === 'k3' ? [['tested-build', process.execPath, ['docs/v2/evidence/organization-knowledge-k3/artifact-provenance.mjs', 'tested']]] : []),
  ...(phase === 'k2' ? [
    ['knowledge-desktop', process.execPath, ['--import', 'tsx', 'scripts/org-knowledge-k2-e2e.mjs']],
    ['approved-dag', process.execPath, ['docs/v2/evidence/organization-knowledge-k2/run-approved-dag.mjs']],
    ['knowledge-contrast', process.execPath, ['--import', 'tsx', 'docs/v2/evidence/organization-knowledge-k2/run-knowledge-contrast.mjs']],
  ] : []),
  ...(phase === 'k3' ? [
    ['knowledge-desktop', process.execPath, ['--import', 'tsx', 'scripts/org-knowledge-k3-e2e.mjs']],
    ['approved-dag', process.execPath, ['docs/v2/evidence/organization-knowledge-k3/run-approved-dag.mjs']],
  ] : []),
  ['desktop-e2e', process.execPath, ['scripts/e2e.mjs']],
  ['agent-e2e', process.execPath, ['scripts/agent-e2e.mjs']],
  ['v12-e2e', process.execPath, ['scripts/v12-e2e.mjs']],
  ['v13-e2e', process.execPath, ['scripts/v13-e2e.mjs']],
  ['package-dir', 'pnpm', ['package:dir']],
  ['package-smoke', 'pnpm', ['test:package']],
  ...(phase === 'k3' ? [['artifact-verification', process.execPath, ['docs/v2/evidence/organization-knowledge-k3/artifact-provenance.mjs', 'final']]] : []),
]
const from = process.argv.find(arg => arg.startsWith('--from='))?.slice(7)
const start = from ? commands.findIndex(([name]) => name === from) : 0
if (start < 0) throw new Error('Unknown check name')
for (const [name, command, args] of commands.slice(start)) {
  const attempt = attempts.filter(item => item.name === name).length + 1
  const logName = `${name}-${attempt}.log`
  const log = createWriteStream(join(evidence, logName))
  const startedAt = new Date().toISOString()
  const exitCode = await new Promise(done => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
    child.once('error', error => { log.write(error.message); done(-1) })
    child.once('close', code => done(code ?? -1))
  })
  await new Promise(done => log.end(done))
  const check = { name, attempt, head, sourceHash, ...(phase !== 'k1' ? { sourceManifest: manifestName } : {}), command: [command, ...args].join(' '), status: exitCode === 0 ? 'PASS' : 'FAIL', exitCode,
    startedAt, finishedAt: new Date().toISOString(), log: logName }
  attempts.push(check)
  writeFileSync(file, JSON.stringify({ baseHead: head, sourceHash, attempts }, null, 2) + '\n')
  console.log(`${check.status} ${name}: ${logName}`)
  if (exitCode !== 0) { process.exitCode = 1; break }
}
