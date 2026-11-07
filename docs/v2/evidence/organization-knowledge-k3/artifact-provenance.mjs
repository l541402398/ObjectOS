/** Hash real files; compare the tested build with the package rebuilt by package:dir. */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const base = resolve('docs/v2/evidence/organization-knowledge-k3')
const digest = path => {
  const bytes = readFileSync(path)
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}
const write = (name, value) => writeFileSync(resolve(base, name), JSON.stringify({ capturedAt: new Date().toISOString(), ...value }, null, 2) + '\n')
const mode = process.argv[2]
if (mode === 'baseline') {
  const expected = JSON.parse(readFileSync('docs/v2/evidence/organization-knowledge-k2/artifact-hashes.json', 'utf8')).files.filter(file => file.path.startsWith('release/'))
  const files = expected.map(file => ({ ...digest(file.path), expected: file.sha256 }))
  const pass = files.length === 3 && files.every(file => file.sha256 === file.expected)
  write('baseline-package-provenance.json', { files, pass })
  if (!pass) throw new Error('Protected comparison package is not the recorded K2 package')
} else if (mode === 'tested') {
  const paths = ['apps/desktop/out', 'apps/runtime/dist', 'apps/server/dist'].flatMap(dir => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => resolve(item.parentPath, item.name).slice(resolve('.').length + 1).replaceAll('\\', '/'))).sort()
  write('tested-build-hashes.json', { files: paths.map(digest) })
} else if (mode === 'final') {
  const tested = JSON.parse(readFileSync(resolve(base, 'tested-build-hashes.json'), 'utf8')).files
  const files = tested.map(file => digest(file.path))
  const changedAfterPackaging = files.filter((file, i) => file.sha256 !== tested[i].sha256).map(file => file.path)
  const packaged = ['release/win-unpacked/ProjectOS.exe', 'release/win-unpacked/resources/app.asar', 'release/win-unpacked/resources/runtime/index.mjs'].map(digest)
  const packagedRuntimeMatchesBuild = packaged[2].sha256 === files.find(file => file.path === 'apps/runtime/dist/index.mjs')?.sha256
  const pass = changedAfterPackaging.length === 0 && packagedRuntimeMatchesBuild
  write('artifact-hashes.json', { files: [...files, ...packaged], changedAfterPackaging, packagedRuntimeMatchesBuild, pass })
  if (!pass) throw new Error('Tested build changed during packaging')
} else throw new Error('Expected baseline, tested or final')
console.log('PASS artifact provenance:', mode)
