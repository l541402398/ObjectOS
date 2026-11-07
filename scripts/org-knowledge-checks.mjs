/** Sequential K1 acceptance. Preserve all attempts and command output beside the report. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve('.')
const evidence = join(root, 'docs/v2/evidence/organization-knowledge-phase1')
const spawn = createRequire(join(root, 'packages/workspace/package.json'))('cross-spawn')
mkdirSync(evidence, { recursive: true })
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0').filter(path => /^(apps|packages|tests|scripts|tooling)\//.test(path)).sort()
const hash = createHash('sha256')
for (const path of paths) { hash.update(path + '\0'); hash.update(readFileSync(join(root, path))) }
const sourceHash = hash.digest('hex')
const file = join(evidence, 'checks.json')
const attempts = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).attempts : []
const commands = [
  ['lint', 'pnpm', ['lint']],
  ['typecheck', 'pnpm', ['typecheck']],
  ['test', 'pnpm', ['run', 'test', '--maxWorkers=2']],
  ['build', 'pnpm', ['build']],
  ['desktop-e2e', process.execPath, ['scripts/e2e.mjs']],
  ['agent-e2e', process.execPath, ['scripts/agent-e2e.mjs']],
  ['v12-e2e', process.execPath, ['scripts/v12-e2e.mjs']],
  ['v13-e2e', process.execPath, ['scripts/v13-e2e.mjs']],
  ['package-dir', 'pnpm', ['package:dir']],
  ['package-smoke', 'pnpm', ['test:package']],
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
  const check = { name, attempt, head, sourceHash, command: [command, ...args].join(' '), status: exitCode === 0 ? 'PASS' : 'FAIL', exitCode,
    startedAt, finishedAt: new Date().toISOString(), log: logName }
  attempts.push(check)
  writeFileSync(file, JSON.stringify({ baseHead: head, sourceHash, attempts }, null, 2) + '\n')
  console.log(`${check.status} ${name}: ${logName}`)
  if (exitCode !== 0) { process.exitCode = 1; break }
}
