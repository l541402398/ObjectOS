import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getGitStatus,
  readTextFile,
  readWorkspaceTree,
  resolveWorkspacePath,
  runApprovedCommand,
  runReadonlyCommand,
  writeTextFile,
} from '@projectos/workspace'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-workspace-'))
  dirs.push(dir)
  return dir
}

describe('workspace safety and IO', () => {
  it('rejects traversal and absolute paths', () => {
    const workspace = root()
    expect(() => resolveWorkspacePath(workspace, '../outside.txt')).toThrow(/\.\.|工作区/)
    expect(() => resolveWorkspacePath(workspace, 'C:\\Windows\\win.ini')).toThrow(/相对路径|工作区/)
  })

  it('reads a tree while ignoring dependency directories', () => {
    const workspace = root()
    mkdirSync(join(workspace, 'src'))
    mkdirSync(join(workspace, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(workspace, 'README.md'), '# Readme\n')
    const entries = readWorkspaceTree(workspace)
    expect(entries.some((entry) => entry.path === 'src/a.ts')).toBe(true)
    expect(entries.some((entry) => entry.path.includes('node_modules'))).toBe(false)
  })

  it('writes and reads files inside the workspace', () => {
    const workspace = root()
    writeTextFile(workspace, 'docs/notes/a.md', '# Hello\n')
    const file = readTextFile(workspace, 'docs/notes/a.md')
    expect(file.content).toContain('Hello')
    expect(file.language).toBe('markdown')
    expect(() => readTextFile(workspace, '../outside.md')).toThrow()
  })

  it('blocks shell injection in readonly commands', async () => {
    const workspace = root()
    await expect(runReadonlyCommand(workspace, 'git status; rm -rf /')).rejects.toThrow(/只读/)
    await expect(runReadonlyCommand(workspace, 'curl http://example.com')).rejects.toThrow(/白名单/)
  })

  it('executes approved commands without a shell', async () => {
    const workspace = root()
    const result = await runApprovedCommand(workspace, 'node --version')
    expect(result.exitCode).toBe(0)
    expect(result.stdout.trim()).toMatch(/^v\d+/)
  })

  it('returns null git status for non-repositories', async () => {
    const workspace = root()
    expect(await getGitStatus(workspace)).toBeNull()
  })
})
