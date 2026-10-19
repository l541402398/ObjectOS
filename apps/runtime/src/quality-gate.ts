import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface QualityCheck {
  name: string
  command: string
  status: 'passed' | 'failed' | 'skipped'
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

function packageManager(root: string): { bin: string; args: string[] } {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return { bin: 'pnpm', args: ['run'] }
  if (existsSync(join(root, 'yarn.lock'))) return { bin: 'yarn', args: ['run'] }
  return { bin: 'npm', args: ['run'] }
}

function detectScripts(root: string): string[] {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    return SCRIPT_ORDER.filter((name) => typeof pkg.scripts?.[name] === 'string' && SCRIPT_PATTERN.test(name))
  } catch {
    return []
  }
}

async function execute(
  root: string,
  bin: string,
  args: string[],
  name: string,
  timeoutMs = 120_000,
): Promise<QualityCheck> {
  const startedAt = Date.now()
  const command = [bin, ...args].join(' ')
  return await new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: root,
      shell: true,
      windowsHide: true,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    })
    let output = ''
    let settled = false
    const append = (chunk: Buffer): void => {
      if (output.length < 80_000) output += chunk.toString('utf8')
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => {
      if (!settled) {
        child.kill('SIGTERM')
        output += `\n[quality gate] timeout after ${timeoutMs}ms`
      }
    }, timeoutMs)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        name,
        command,
        status: 'failed',
        exitCode: null,
        durationMs: Date.now() - startedAt,
        output: `${output}\n${error.message}`.trim().slice(0, 80_000),
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        name,
        command,
        status: code === 0 ? 'passed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - startedAt,
        output: output.trim().slice(0, 80_000),
      })
    })
  })
}

export class QualityGateService {
  async run(rootPath: string): Promise<QualityGateReport> {
    const startedAt = Date.now()
    const checks: QualityCheck[] = []
    if (existsSync(join(rootPath, 'pom.xml'))) {
      checks.push(await execute(rootPath, 'mvn', ['-q', '-DskipTests=false', 'test'], 'maven-test'))
    } else if (existsSync(join(rootPath, 'build.gradle')) || existsSync(join(rootPath, 'build.gradle.kts'))) {
      const wrapper = existsSync(join(rootPath, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'))
      const bin = wrapper ? (process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew') : 'gradle'
      checks.push(await execute(rootPath, bin, ['test'], 'gradle-test'))
    } else {
      const pm = packageManager(rootPath)
      const scripts = detectScripts(rootPath)
      for (const script of scripts) {
        checks.push(await execute(rootPath, pm.bin, [...pm.args, script], script))
      }
    }
    const skipped = checks.length === 0
    return {
      passed: skipped || checks.every((check) => check.status === 'passed'),
      skipped,
      checks,
      startedAt,
      finishedAt: Date.now(),
    }
  }
}
