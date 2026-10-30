import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
const root = resolve('docs/design/startup-journey')
const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const commandResults = new Map()
for (const file of ['checks.json', 'rechecks.json']) {
  const path = join(root, 'validation', file)
  if (existsSync(path)) for (const check of [].concat(read(path))) commandResults.set(check.name, check)
}
const sources = [
  'apps/desktop/electron.vite.config.ts', 'apps/desktop/src/renderer/index.html',
  'apps/desktop/src/renderer/public/startup-preferences.js',
  ...['components/BootScreen.tsx', 'components/GoalJourneyBar.tsx', 'components/goal-journey.css', 'startup/boot-content.html', 'styles/boot.css', 'styles/app.css', 'styles/system-premium.css', 'main.tsx', 'router.tsx'].map(path => `apps/desktop/src/renderer/src/${path}`),
  ...['e2e.mjs', 'recording.mjs', 'verify.ps1', 'manifest.mjs'].map(file => `scripts/startup-journey-${file}`),
].map(path => ({ path, sha256: hash(path), gitBlob: execFileSync('git', ['hash-object', '--path', path, path], { encoding: 'utf8' }).trim() }))
const files = []
function walk(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    if (item.name === 'probe' || item.name === 'evidence-manifest.json') continue
    const path = join(directory, item.name)
    if (item.isDirectory()) walk(path)
    else files.push({ path: relative(root, path).replaceAll('\\', '/'), sha256: hash(path) })
  }
}
walk(root)
const ui = read(join(root, 'after/checks.json'))
const manifest = {
  baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  testedState: 'Working tree based on baseHead; raw SHA256 and normalized gitBlob identify tested source. Code and evidence are committed together.',
  generatedAt: new Date().toISOString(), commands: [...commandResults.values()],
  ui: { pass: ui.checks.filter(c => c.status === 'PASS').length, fail: ui.checks.filter(c => c.status === 'FAIL').length, screenshotCount: files.filter(f => f.path.startsWith('after/') && f.path.endsWith('.png')).length, fps: ui.checks.find(c => c.name === 'Startup animation frame rate') },
  skipped: ['4 existing opt-in external Harness/SSH tests', 'manual screen reader', 'other OS rendering', 'startup error fault-injection capture', 'full prior 645-image system sweep'],
  sources, files,
}
writeFileSync(join(root, 'evidence-manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ baseHead: manifest.baseHead, commands: manifest.commands.map(c => [c.name, c.status]), ui: manifest.ui }))
