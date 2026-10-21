import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export interface ResolveExecutableOptions {
  home?: string
  path?: string
  shell?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

function isExecutableFile(file: string): boolean {
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}

function variants(command: string, windows: boolean, env: NodeJS.ProcessEnv): string[] {
  if (!windows || /\.[a-z0-9]+$/i.test(command)) return [command]
  const extensions = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension && extension !== '.ps1')
  return [command, ...extensions.map((extension) => `${command}${extension}`)]
}

function versionRoots(root: string, command: string, windows: boolean, env: NodeJS.ProcessEnv): string[] {
  const results: string[] = []
  try {
    for (const version of readdirSync(root)) {
      for (const leaf of ['', 'bin', 'installation', 'installation/bin']) {
        const directory = leaf ? join(root, version, leaf) : join(root, version)
        for (const variant of variants(command, windows, env)) results.push(join(directory, variant))
      }
    }
  } catch {
    // version manager not installed
  }
  return results
}

function directCandidates(command: string, home: string, windows: boolean, env: NodeJS.ProcessEnv): string[] {
  const directories: string[] = []
  if (windows) {
    const appData = env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    const userProfile = env.USERPROFILE ?? home
    const programData = env.ProgramData ?? 'C:\\ProgramData'
    directories.push(
      join(appData, 'npm'),
      join(localAppData, 'pnpm'),
      join(localAppData, 'Volta', 'bin'),
      join(localAppData, 'Microsoft', 'WindowsApps'),
      join(userProfile, 'scoop', 'shims'),
      join(programData, 'chocolatey', 'bin'),
      join(userProfile, '.local', 'bin'),
      join(userProfile, '.bun', 'bin'),
      join(userProfile, '.cargo', 'bin'),
      join(userProfile, '.volta', 'bin'),
    )
  } else {
    directories.push(
      join(home, '.local', 'bin'),
      join(home, '.npm-global', 'bin'),
      join(home, '.npm', 'bin'),
      join(home, '.volta', 'bin'),
      join(home, '.bun', 'bin'),
      join(home, '.cargo', 'bin'),
      join(home, '.asdf', 'shims'),
      join(home, 'bin'),
      join(home, '.local', 'share', 'pnpm'),
      join(home, '.local', 'share', 'npm', 'bin'),
      join(home, 'Library', 'pnpm'),
      join('/usr/local/bin'),
      join('/usr/bin'),
      join('/snap/bin'),
      join('/home/linuxbrew/.linuxbrew/bin'),
      join('/opt/homebrew/bin'),
      join(home, '.linuxbrew', 'bin'),
    )
  }

  const candidates: string[] = []
  for (const directory of directories) {
    for (const variant of variants(command, windows, env)) candidates.push(join(directory, variant))
  }

  const roots = windows
    ? [
        env.NVM_HOME,
        join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'nvm'),
        join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'fnm', 'node-versions'),
      ]
    : [join(home, '.nvm', 'versions', 'node'), join(home, '.local', 'share', 'fnm', 'node-versions')]
  for (const root of roots) {
    if (root) candidates.push(...versionRoots(root, command, windows, env))
  }
  return candidates
}

/**
 * Resolve a CLI that may exist outside the PATH inherited by a desktop-launched
 * app. This is intentionally read-only and limited to known bin folders.
 */
export async function resolveExecutable(command: string, options: ResolveExecutableOptions = {}): Promise<string | null> {
  if (!command) return null
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const windows = platform === 'win32'
  if (isAbsolute(command)) return isExecutableFile(command) ? command : null

  const pathValue = options.path ?? env.PATH ?? ''
  for (const directory of pathValue.split(windows ? ';' : ':')) {
    if (!directory) continue
    for (const variant of variants(command, windows, env)) {
      const candidate = join(directory, variant)
      if (isExecutableFile(candidate)) return candidate
    }
  }

  if (windows && process.platform === 'win32') {
    try {
      const result = await exec('where.exe', [command], { timeout: 5_000, windowsHide: true })
      const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      if (first && isExecutableFile(first)) return first
    } catch {
      // fall through to known locations
    }
  }

  const home = options.home ?? env.HOME ?? env.USERPROFILE ?? homedir()
  for (const candidate of directCandidates(command, home, windows, env)) {
    if (isExecutableFile(candidate)) return candidate
  }

  if (!windows) {
    const shell = options.shell ?? env.SHELL ?? '/bin/bash'
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
