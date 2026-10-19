import crossSpawn from 'cross-spawn'
import { now, type ExternalAgentInstallation } from '@projectos/contracts'

interface SpawnResult {
  code: number
  stdout: string
  stderr: string
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let child: ReturnType<typeof crossSpawn> | null = null
    const timerRef: { current: NodeJS.Timeout | undefined } = { current: undefined }
    const finish = (code: number): void => {
      if (settled) return
      settled = true
      if (timerRef.current) clearTimeout(timerRef.current)
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() })
    }
    timerRef.current = setTimeout(() => {
      try {
        child?.kill()
      } catch {
        // ignore
      }
      finish(124)
    }, timeoutMs)
    try {
      child = crossSpawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish(1)
      stderr = error instanceof Error ? error.message : String(error)
      return
    }
    child.stdout?.on('data', (chunk) => {
      if (stdout.length < 4000) stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk.toString()
    })
    child.on('error', (error) => {
      stderr = error.message
      finish(1)
    })
    child.on('close', (code) => finish(typeof code === 'number' ? code : 1))
  })
}

async function locate(executable: string): Promise<string | null> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which'
  const result = await runCommand(locator, [executable], 3_000)
  if (result.code !== 0) return null
  const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  return first ?? null
}

async function detect(
  adapterId: ExternalAgentInstallation['adapterId'],
  name: string,
  executable: string,
): Promise<ExternalAgentInstallation> {
  const checkedAt = now()
  const path = await locate(executable)
  if (!path) {
    return {
      adapterId,
      name,
      installed: false,
      executablePath: null,
      version: null,
      authState: 'unknown',
      lastCheckedAt: checkedAt,
      message: '未检测到可执行文件',
    }
  }
  const version = await runCommand(executable, ['--version'], 5_000)
  const text = version.stdout || version.stderr
  return {
    adapterId,
    name,
    installed: true,
    executablePath: path,
    version: text.split(/\r?\n/)[0]?.slice(0, 160) || null,
    authState: 'unknown',
    lastCheckedAt: checkedAt,
    message: version.code === 0 ? '已安装；授权状态需在 CLI 内自行确认' : '已安装；版本检测失败',
  }
}

export async function listExternalAgents(): Promise<ExternalAgentInstallation[]> {
  return Promise.all([
    detect('claude-code', 'Claude Code', 'claude'),
    detect('codex', 'Codex CLI', 'codex'),
  ])
}
