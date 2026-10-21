import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface ResolveExecutableOptions {
  home?: string
  path?: string
  shell?: string
}

function isExecutableFile(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function directCandidates(command: string, home: string): string[] {
  const candidates = [
    join(home, '.local', 'bin', command),
    join(home, '.npm-global', 'bin', command),
    join(home, '.npm', 'bin', command),
    join(home, '.volta', 'bin', command),
    join(home, '.bun', 'bin', command),
    join(home, '.cargo', 'bin', command),
    join(home, '.asdf', 'shims', command),
    join(home, 'bin', command),
    join(home, '.local', 'share', 'pnpm', command),
    join('/usr/local/bin', command),
    join('/usr/bin', command),
    join('/snap/bin', command),
    join('/home/linuxbrew/.linuxbrew/bin', command),
    join('/opt/homebrew/bin', command),
    join(home, '.linuxbrew', 'bin', command),
    join(home, '.local', 'share', 'npm', 'bin', command),
  ]
  for (const root of [join(home, '.nvm', 'versions', 'node'), join(home, '.local', 'share', 'fnm', 'node-versions')]) {
    try {
      for (const version of readdirSync(root)) {
        candidates.push(join(root, version, 'bin', command))
        candidates.push(join(root, version, 'installation', 'bin', command))
      }
    } catch {
      // version manager not installed
    }
  }
  return candidates
}

/**
 * Resolve a CLI that may exist outside the PATH inherited by a desktop-launched
 * AppImage. This is intentionally read-only and limited to known bin folders.
 */
export async function resolveExecutable(command: string, options: ResolveExecutableOptions = {}): Promise<string | null> {
  if (!command) return null
  if (isAbsolute(command)) return isExecutableFile(command) ? command : null

  const pathValue = options.path ?? process.env.PATH ?? ''
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue
    const candidate = join(directory, command)
    if (isExecutableFile(candidate)) return candidate
  }

  if (process.platform === 'win32') {
    try {
      const result = await exec('where.exe', [command], { timeout: 5_000, windowsHide: true })
      const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      if (first && isExecutableFile(first)) return first
    } catch {
      // fall through to known locations
    }
  }

  const home = options.home ?? homedir()
  for (const candidate of directCandidates(command, home)) {
    if (isExecutableFile(candidate)) return candidate
  }

  if (process.platform !== 'win32') {
    const shell = options.shell ?? process.env.SHELL ?? '/bin/bash'
    if (existsSync(shell)) {
      try {
        const result = await exec(shell, ['-lc', 'command -v -- "$1"', 'projectos-resolve', command], { timeout: 5_000 })
        const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('/'))
        if (first && isExecutableFile(first)) return first
      } catch {
        // login shell unavailable or command absent
      }
    }
  }

  return null
}
