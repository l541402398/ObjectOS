/** Hash real files; compare the tested build with the package rebuilt by package:dir. */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createRequire } from 'node:module'

const base = resolve('docs/v2/evidence/organization-workspace-ux')
const digest = path => {
  const bytes = readFileSync(path)
  return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
}
const write = (name, value) => writeFileSync(resolve(base, name), JSON.stringify({ capturedAt: new Date().toISOString(), ...value }, null, 2) + '\n')
const mode = process.argv[2]
if (mode === 'baseline') {
  const expected = JSON.parse(readFileSync('docs/v2/evidence/member-assignment-k4/artifact-hashes.json', 'utf8')).files.filter(file => file.path.startsWith('release/'))
  const files = expected.map(file => ({ ...digest(file.path), expected: file.sha256 }))
  const pass = files.length === 3 && files.every(file => file.sha256 === file.expected)
  write('baseline-package-provenance.json', { files, pass })
  if (!pass) throw new Error('Protected comparison package is not the recorded K4 package')
} else if (mode === 'tested') {
  const paths = ['apps/desktop/out', 'apps/runtime/dist', 'apps/server/dist'].flatMap(dir => readdirSync(dir, { recursive: true, withFileTypes: true }).filter(item => item.isFile()).map(item => resolve(item.parentPath, item.name).slice(resolve('.').length + 1).replaceAll('\\', '/'))).sort()
  write('tested-build-hashes.json', { files: paths.map(digest) })
} else if (mode === 'final') {
  const tested = JSON.parse(readFileSync(resolve(base, 'tested-build-hashes.json'), 'utf8')).files
  const files = tested.map(file => digest(file.path))
  const changedAfterPackaging = files.filter((file, i) => file.sha256 !== tested[i].sha256).map(file => file.path)
  const packaged = ['release/win-unpacked/ProjectOS.exe', 'release/win-unpacked/resources/app.asar', 'release/win-unpacked/resources/runtime/index.mjs'].map(digest)
  const packagedRuntimeMatchesBuild = packaged[2].sha256 === files.find(file => file.path === 'apps/runtime/dist/index.mjs')?.sha256
  const asar = createRequire(import.meta.url)(resolve('node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar/lib/asar.js'))
  const desktopEntries = tested.filter(file => file.path.startsWith('apps/desktop/out/') && !file.path.endsWith('.map')).map(file => {
    const entry = file.path.slice('apps/desktop/'.length), bytes = asar.extractFile('release/win-unpacked/resources/app.asar', entry.split('/').join(sep))
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return { entry, sha256, expected: file.sha256, pass: sha256 === file.sha256 }
  })
  const packagedDesktopMatchesBuild = desktopEntries.length > 0 && desktopEntries.every(file => file.pass)
  const pass = changedAfterPackaging.length === 0 && packagedRuntimeMatchesBuild && packagedDesktopMatchesBuild
  write('artifact-hashes.json', { files: [...files, ...packaged], changedAfterPackaging, packagedRuntimeMatchesBuild, packagedDesktopMatchesBuild, desktopEntries, pass })
  if (!pass) throw new Error('Tested build changed during packaging')
} else throw new Error('Expected baseline, tested or final')
console.log('PASS artifact provenance:', mode)
