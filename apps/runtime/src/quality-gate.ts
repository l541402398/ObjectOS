import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface QualityCheck {
  name: string
  command: string
  /** `error`: the command could not run to completion (missing binary, timeout, abort). */
  status: 'passed' | 'failed' | 'error' | 'skipped'
  exitCode: number | null
  durationMs: number
  output: string
}

export interface QualityGateReport {
  passed: boolean
  skipped: boolean
  checks: QualityCheck[]
  startedAt: number
  finishedAt: number
}

const SCRIPT_ORDER = ['typecheck', 'lint', 'test', 'build'] as const
const SCRIPT_PATTERN = /^[a-zA-Z0-9:_-]+$/
const KILL_GRACE_MS = 5_000

function packageManager(root: string): string {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm run'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn run'
  return 'npm run'
}

function readScripts(root: string): Record<string, string> | null {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    return pkg.scripts ?? {}
  } catch {
    return null
  }
}

/** Kills the whole process tree; on Windows `child.kill()` would only end the shell. */
function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }
}

function skipped(name: string, reason: string): QualityCheck {
  return { name, command: '', status: 'skipped', exitCode: null, durationMs: 0, output: reason }
}

/** Runs a fixed, trusted command line (never model-generated text) inside `root`. */
async function execute(
  root: string,
  command: string,
  name: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<QualityCheck> {
  const startedAt = Date.now()
  if (signal?.aborted) return { name, command, status: 'error', exitCode: null, durationMs: 0, output: '[quality gate] cancelled' }
  return await new Promise((resolve) => {
    const child = spawn(command, {
      cwd: root,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    })
    let output = ''
    let settled = false
    let interrupted: string | null = null
    const append = (chunk: Buffer): void => {
      if (output.length < 80_000) output += chunk.toString('utf8')
    }
    const finish = (status: QualityCheck['status'], exitCode: number | null, extra = ''): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(grace)
      signal?.removeEventListener('abort', onAbort)
      resolve({
        name,
        command,
        status,
        exitCode,
        durationMs: Date.now() - startedAt,
        output: `${output}${extra}`.trim().slice(0, 80_000),
      })
    }
    let grace: NodeJS.Timeout | undefined
    const interrupt = (reason: string): void => {
      if (settled || interrupted) return
      interrupted = reason
      killTree(child)
      // Orphaned grandchildren can keep the pipes open; do not wait on them forever.
      grace = setTimeout(() => finish('error', null, `\n${reason}`), KILL_GRACE_MS)
    }
    const onAbort = (): void => interrupt('[quality gate] cancelled')
    const timer = setTimeout(() => interrupt(`[quality gate] timeout after ${timeoutMs}ms`), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.on('error', (error) => finish('error', null, `\n${error.message}`))
    child.on('close', (code) => {
      if (interrupted) finish('error', code, `\n${interrupted}`)
      else finish(code === 0 ? 'passed' : 'failed', code)
    })
  })
}

export class QualityGateService {
  async run(rootPath: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<QualityGateReport> {
    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs ?? 120_000
    const checks: QualityCheck[] = []
    if (existsSync(join(rootPath, 'pom.xml'))) {
      checks.push(await execute(rootPath, 'mvn -q -DskipTests=false test', 'maven-test', timeoutMs, options.signal))
    } else if (existsSync(join(rootPath, 'build.gradle')) || existsSync(join(rootPath, 'build.gradle.kts'))) {
      const wrapper = existsSync(join(rootPath, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'))
      const bin = wrapper ? (process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew') : 'gradle'
      checks.push(await execute(rootPath, `${bin} test`, 'gradle-test', timeoutMs, options.signal))
    } else {
      const scripts = readScripts(rootPath)
      const runner = packageManager(rootPath)
      for (const name of SCRIPT_ORDER) {
        if (!scripts) checks.push(skipped(name, '未找到 package.json'))
        else if (typeof scripts[name] !== 'string' || !SCRIPT_PATTERN.test(name)) checks.push(skipped(name, `未配置 ${name} 脚本`))
        else checks.push(await execute(rootPath, `${runner} ${name}`, name, timeoutMs, options.signal))
      }
    }
    const executed = checks.filter((check) => check.status !== 'skipped')
    return {
      passed: executed.every((check) => check.status === 'passed'),
      skipped: executed.length === 0,
      checks,
      startedAt,
      finishedAt: Date.now(),
    }
  }
}
