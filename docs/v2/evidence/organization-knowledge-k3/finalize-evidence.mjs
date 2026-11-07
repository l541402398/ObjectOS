/** Verify frozen inputs and summarize recorded outputs; does not execute or redefine tests. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = resolve('docs/v2/evidence/organization-knowledge-k3')
const read = name => JSON.parse(readFileSync(resolve(base, name), 'utf8'))
const write = (name, value) => writeFileSync(resolve(base, name), JSON.stringify(value, null, 2) + '\n')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = read('source-manifest.json')
const actualPaths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(path => /^(apps|packages|tests|scripts|tooling)\//.test(path)).sort()
const changedFiles = manifest.files.filter(file => {
  const bytes = readFileSync(file.path)
  const canonical = /\.(?:[cm]?[jt]sx?|json|css|html|ya?ml|md|toml)$/.test(file.path) ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes
  return sha(canonical) !== file.sha256
}).map(file => file.path)
const addedOrRemoved = JSON.stringify(actualPaths) !== JSON.stringify(manifest.files.map(file => file.path))
const sourcePass = changedFiles.length === 0 && !addedOrRemoved
write('source-verification.json', { baseHead: manifest.head, sourceHash: manifest.sourceHash, fileCount: manifest.files.length, changedFiles, addedOrRemoved, pass: sourcePass })
const before = readFileSync(resolve(base, 'screenshots/before-protected-dag.png')), after = readFileSync(resolve(base, 'screenshots/after-protected-dag.png'))
const sameDag = before.equals(after)
write('protected-baseline-comparison.json', { before: { path: 'screenshots/before-protected-dag.png', sha256: sha(before) }, after: { path: 'screenshots/after-protected-dag.png', sha256: sha(after) }, byteIdentical: sameDag })
const desktop = read('desktop-checks.json'), commands = read('checks.json'), artifacts = read('artifact-hashes.json')
const latest = new Map(commands.attempts.map(item => [item.name, item]))
const contrastCount = desktop.audits.reduce((sum, item) => sum + item.contrast.count, 0)
const minimumContrast = Math.min(...desktop.audits.map(item => item.contrast.minimum))
const violations = desktop.audits.flatMap(item => item.violations)
const contrastFailures = desktop.audits.flatMap(item => item.contrast.failures)
const summary = {
  baseHead: manifest.head, sourceHash: manifest.sourceHash, files: manifest.files.length,
  commands: [...latest.values()].map(({ name, status, log, exitCode }) => ({ name, status, log, exitCode })),
  desktop: { checks: desktop.checks.length, failures: desktop.checks.filter(item => item.status !== 'PASS'), captures: desktop.captures.length,
    axeStates: desktop.audits.length, violations, axeContrastIncomplete: desktop.audits.filter(item => item.incomplete.includes('color-contrast')).length,
    contrastCount, minimumContrast, contrastFailures, rendererErrors: desktop.errors, submissions: desktop.submissions, decisions: desktop.decisions },
  sourceUnchanged: sourcePass, protectedDagByteIdentical: sameDag, testedBuildMatchesPackage: artifacts.pass,
}
write('phase-summary.json', summary)
if (!sourcePass || !sameDag || !artifacts.pass || [...latest.values()].some(item => item.status !== 'PASS') || summary.desktop.failures.length || violations.length || contrastFailures.length || desktop.errors.length)
  throw new Error('Evidence contains a failure; inspect the retained records')
console.log(JSON.stringify({ sourceHash: manifest.sourceHash, fileCount: manifest.files.length, commands: latest.size, checks: desktop.checks.length, captures: desktop.captures.length, contrastCount, minimumContrast, pass: true }, null, 2))
