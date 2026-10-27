import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface QualityCheck {
  name: string
  command: string
  /** `error`: the command could not run to completion (missing binary, timeout, abort). */
  status: 'passed' | 'failed' | 'error' | 'skipped' | 'not_applicable'
  exitCode: number | null
  durationMs: number
  output: string
}

export type QualityGateOutcome = 'passed' | 'failed' | 'error' | 'skipped' | 'not_applicable'

export interface QualityPolicy {
  required: string[]
  optional: string[]
}

export const DEFAULT_QUALITY_POLICY: QualityPolicy = {
  required: ['test'],
  optional: ['typecheck', 'lint', 'build'],
}

export function autoQualityGateEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PROJECTOS_ENABLE_AUTO_QUALITY_GATE === '1' || env.NODE_ENV === 'test'
}

/**
 * Phase 0 fail-closed switch. Package scripts are arbitrary repository code and
 * currently run through a shell, so automatic execution stays off outside the
 * test harness until a trusted, approval-backed runner is wired.
 */
export const AUTO_QUALITY_GATE_ENABLED = autoQualityGateEnabled()

export interface QualityGateReport {
  passed: boolean
  skipped: boolean
  outcome: QualityGateOutcome
  required: string[]
  optional: string[]
  missingRequired: string[]
  checks: QualityCheck[]
  startedAt: number
  finishedAt: number
}

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
  async run(
    rootPath: string,
    options: { signal?: AbortSignal; timeoutMs?: number; policy?: QualityPolicy } = {},
  ): Promise<QualityGateReport> {
    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs ?? 120_000
    if (!AUTO_QUALITY_GATE_ENABLED) {
      const policy = options.policy ?? DEFAULT_QUALITY_POLICY
      const required = [...new Set(policy.required)]
      return {
        passed: false,
        skipped: true,
        outcome: 'skipped',
        required,
        optional: [...new Set(policy.optional)].filter((name) => !required.includes(name)),
        missingRequired: required,
        checks: [],
        startedAt,
        finishedAt: Date.now(),
      }
    }
    const checks: QualityCheck[] = []
    let required: string[]
    let optional: string[]
    if (existsSync(join(rootPath, 'pom.xml'))) {
      required = ['maven-test']
      optional = []
      checks.push(await execute(rootPath, 'mvn -q -DskipTests=false test', 'maven-test', timeoutMs, options.signal))
    } else if (existsSync(join(rootPath, 'build.gradle')) || existsSync(join(rootPath, 'build.gradle.kts'))) {
      required = ['gradle-test']
      optional = []
      const wrapper = existsSync(join(rootPath, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'))
      const bin = wrapper ? (process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew') : 'gradle'
      checks.push(await execute(rootPath, `${bin} test`, 'gradle-test', timeoutMs, options.signal))
    } else {
      const policy = options.policy ?? DEFAULT_QUALITY_POLICY
      required = [...new Set(policy.required)]
      optional = [...new Set(policy.optional)].filter((name) => !required.includes(name))
      const scripts = readScripts(rootPath)
      const runner = packageManager(rootPath)
      for (const name of [...required, ...optional]) {
        if (!SCRIPT_PATTERN.test(name)) {
          checks.push(skipped(name, `非法的检查脚本名：${name}`))
          continue
        }
        const isRequired = required.includes(name)
        if (!scripts) {
          checks.push(isRequired ? skipped(name, '未找到 package.json，必需检查未执行') : notApplicable(name, '未找到 package.json'))
          continue
        }
        if (typeof scripts[name] !== 'string') {
          checks.push(isRequired ? skipped(name, `必需脚本未配置：${name}`) : notApplicable(name, `可选脚本未配置：${name}`))
          continue
        }
        checks.push(await execute(rootPath, `${runner} ${name}`, name, timeoutMs, options.signal))
      }
    }
    const requiredChecks = checks.filter((check) => required.includes(check.name))
    const missingRequired = requiredChecks.filter((check) => check.status === 'skipped').map((check) => check.name)
    const outcome: QualityGateOutcome =
      requiredChecks.length === 0
        ? 'not_applicable'
        : requiredChecks.some((check) => check.status === 'error')
          ? 'error'
          : requiredChecks.some((check) => check.status === 'failed')
            ? 'failed'
            : requiredChecks.some((check) => check.status === 'skipped')
              ? 'skipped'
              : 'passed'
    return {
      passed: outcome === 'passed',
      skipped: outcome === 'skipped',
      outcome,
      required,
      optional,
      missingRequired,
      checks,
      startedAt,
      finishedAt: Date.now(),
    }
  }
}

function notApplicable(name: string, reason: string): QualityCheck {
  return { name, command: '', status: 'not_applicable', exitCode: null, durationMs: 0, output: reason }
}
