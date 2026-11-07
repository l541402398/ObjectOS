/** Preserve the final source scope and distinguish earlier development manifests honestly. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const base = resolve('docs/v2/evidence/member-assignment-k4')
const checks = JSON.parse(readFileSync(resolve(base, 'checks.json'), 'utf8'))
const manifestName = `source-manifest.${checks.sourceHash.slice(0, 12)}.json`
const final = JSON.parse(readFileSync(resolve(base, manifestName), 'utf8'))
const initial = JSON.parse(readFileSync(resolve(base, 'source-manifest.6000463ef4cb.json'), 'utf8'))
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(path => /^(apps|packages|tests|scripts|tooling)\//.test(path)).sort()
const hash = createHash('sha256')
for (const path of paths) {
  const raw = readFileSync(path), bytes = /\.(?:[cm]?[jt]sx?|json|css|html|ya?ml|md|toml)$/.test(path) ? Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n')) : raw
  hash.update(path + '\0' + createHash('sha256').update(bytes).digest('hex') + '\n')
}
const currentSourceHash = hash.digest('hex'), sameFinalSource = currentSourceHash === final.sourceHash
const test = checks.attempts.filter(item => item.name === 'test' && item.status === 'PASS').at(-1)
const changes = final.files.filter(file => initial.files.find(prior => prior.path === file.path)?.sha256 !== file.sha256).map(file => {
  const lastWriteAt = statSync(file.path).mtime.toISOString()
  return { path: file.path, lastWriteAt, beforeUnitStart: Date.parse(lastWriteAt) <= Date.parse(test.startedAt) }
})
const nonUiTypescriptChangesAfterUnitStart = changes.filter(file => /\.[jt]sx?$/.test(file.path) && !file.path.startsWith('apps/desktop/src/renderer/') && !file.beforeUnitStart)
const result = {
  baseHead: final.head, currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  finalSourceManifest: manifestName, currentSourceHash, sameFinalSource,
  unitStart: test.startedAt, changesSinceInitialCoordinatorManifest: changes, nonUiTypescriptChangesAfterUnitStart,
  note: 'The first coordinator manifest predates edits between commands. Compare against the latest passing full unit command. The original 197 desktop checks cover unchanged renderer bytes; later changes guard legacy unscoped plan chat and update its tests/check coordinator. Final source, new full unit checks, original desktop regressions and package byte comparisons corroborate the scope. File mtimes are not an immutable historical start snapshot. source-manifest.json is the retained initial alias; use finalSourceManifest for final code.',
}
writeFileSync(resolve(base, 'scope-provenance.json'), JSON.stringify(result, null, 2) + '\n')
if (!sameFinalSource || nonUiTypescriptChangesAfterUnitStart.length) throw new Error('Final source differs or Runtime/test code changed after the unit command began')
console.log('PASS final source scope:', currentSourceHash)
