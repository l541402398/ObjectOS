/** Run the existing approved-DAG assertions; redirect evidence without overwriting older baselines. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const base = resolve('docs/v2/evidence/member-assignment-k4')
const originalPath = 'scripts/premium-lab-e2e.mjs'
let source = readFileSync(originalPath, 'utf8').replace(/\r\n/g, '\n')
const sha256 = createHash('sha256').update(source).digest('hex')
const expected = JSON.parse(readFileSync(resolve(base, 'source-manifest.json'), 'utf8')).files.find(file => file.path === originalPath)?.sha256
if (sha256 !== expected) throw new Error('Approved-DAG source changed after the acceptance manifest')
const replacements = [
  ["resolve('docs/design/system-premium/lab')", "resolve('docs/v2/evidence/member-assignment-k4/approved-dag-regression')"],
  ["'./lib/premium-contrast.mjs'", JSON.stringify(pathToFileURL(resolve('scripts/lib/premium-contrast.mjs')).href)],
  ["'playwright-core'", JSON.stringify(import.meta.resolve('playwright-core'))],
  ['createRequire(import.meta.url)', `createRequire(${JSON.stringify(pathToFileURL(resolve(originalPath)).href)})`],
]
for (const [from, to] of replacements) {
  if (source.split(from).length !== 2) throw new Error('Unexpected approved-DAG harness structure')
  source = source.replace(from, to)
}
writeFileSync(resolve(base, 'approved-dag-harness.json'), JSON.stringify({
  originalPath, sha256, assertionsChanged: false,
  adaptation: 'Output directory redirect and absolute module resolution for data-URL execution only.',
  replacements: replacements.map(([from, to]) => ({ from, to })),
}, null, 2) + '\n')
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
