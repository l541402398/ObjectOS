/** Supplemental native-compositor measurements; retain every original K2 desktop assertion. */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const base = resolve('docs/v2/evidence/organization-knowledge-k2')
const originalPath = 'scripts/org-knowledge-k2-e2e.mjs'
let source = readFileSync(originalPath, 'utf8').replace(/\r\n/g, '\n')
const sha256 = createHash('sha256').update(source).digest('hex')
const expected = JSON.parse(readFileSync(resolve(base, 'source-manifest.json'), 'utf8')).files.find(file => file.path === originalPath)?.sha256
if (sha256 !== expected) throw new Error('K2 desktop harness changed after the acceptance manifest')
const replacements = [
  ["resolve('docs/v2/evidence/organization-knowledge-k2')", "resolve('docs/v2/evidence/organization-knowledge-k2/composited-contrast')"],
  ["'playwright-core'", JSON.stringify(import.meta.resolve('playwright-core'))],
  ...['tests/helpers/org-postgres.ts', 'apps/server/src/postgres-store.ts', 'apps/server/src/persistent-server.ts'].map(path => [JSON.stringify('../' + path).replaceAll('"', "'"), JSON.stringify(pathToFileURL(resolve(path)).href)]),
  ["  audits.push({ name, ...audit });", "  const composite = await compositeContrast(page, win, selector)\n  audit.compositedContrast = composite\n  check(name + ' native composited contrast', composite.count > 0 && composite.failures.length === 0, { count: composite.count, minimum: composite.minimum, failures: composite.failures })\n  audits.push({ name, ...audit });"],
]
for (const [from, to] of replacements) {
  if (source.split(from).length !== 2) throw new Error('Unexpected K2 desktop harness structure: ' + from)
  source = source.replace(from, to)
}
source = `import { compositeContrast } from ${JSON.stringify(pathToFileURL(resolve('scripts/lib/premium-contrast.mjs')).href)}\n` + source
writeFileSync(resolve(base, 'composited-contrast-harness.json'), JSON.stringify({ originalPath, sha256,
  originalAssertionsChanged: false, additionalAssertion: 'Visible native-composited text samples must meet conservative 4.5:1.',
  replacements: replacements.map(([from, to]) => ({ from, to })),
}, null, 2) + '\n')
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
