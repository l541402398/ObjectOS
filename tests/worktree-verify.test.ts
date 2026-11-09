import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WorktreeManager,
  clearWorktreeRegistry,
  registerWorktree,
  verifyIsolatedWorktree,
} from '@projectos/worktree'

const exec = promisify(execFile)
const dirs: string[] = []
afterEach(() => {
  clearWorktreeRegistry()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function repo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-verify-'))
  dirs.push(dir)
  await exec('git', ['init', '-q'], { cwd: dir })
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'app.txt'), 'base\n')
  await exec('git', ['add', '.'], { cwd: dir })
  await exec('git', ['commit', '-qm', 'base'], { cwd: dir })
  return dir
}

describe('verifyIsolatedWorktree', () => {
  it('rejects a fake worktree directory that is not a git worktree', async () => {
    const project = await repo()
    const fake = mkdtempSync(join(tmpdir(), 'projectos-fake-wt-'))
    dirs.push(fake)
    writeFileSync(join(fake, 'src.ts'), 'export {}\n')
    registerWorktree(project, fake)
    const result = await verifyIsolatedWorktree({ candidatePath: fake, projectRootPath: project })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/Git|worktree|git-dir/i)
  })

  it('rejects a symlink that points at the main repository', async () => {
    const project = await repo()
    const linkParent = mkdtempSync(join(tmpdir(), 'projectos-link-parent-'))
    dirs.push(linkParent)
    const linkPath = join(linkParent, 'escape-link')
    symlinkSync(project, linkPath)
    registerWorktree(project, linkPath)
    const result = await verifyIsolatedWorktree({ candidatePath: linkPath, projectRootPath: project })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/主工作区|符号链接/)
  })

  it('rejects a plain subdirectory of the main repository', async () => {
    const project = await repo()
    const sub = join(project, 'packages', 'nested')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'x.ts'), 'export {}\n')
    registerWorktree(project, sub)
    const result = await verifyIsolatedWorktree({ candidatePath: sub, projectRootPath: project })
    expect(result.ok).toBe(false)
    // subdirectory of main has git-dir === git-common-dir
    expect(result.ok).toBe(false)
  })

  it('accepts a real ObjectOS-registered git worktree', async () => {
    const project = await repo()
    const manager = new WorktreeManager()
    const wt = join(project, '.projectos', 'runtime-worktrees', 'run-test-1')
    dirs.push(join(project, '.projectos'))
    const ref = await manager.create(project, wt, 'projectos/verify-ok')
    expect(ref.path).toBe(wt)
    const result = await verifyIsolatedWorktree({ candidatePath: wt, projectRootPath: project })
    expect(result.ok).toBe(true)
    expect(result.details?.listed).toBe(true)
    expect(result.details?.registered).toBe(true)
  })

  it('rejects a real git worktree that ObjectOS never registered', async () => {
    const project = await repo()
    const wt = join(project, '..', `${project.split(/[\\/]/).pop()}-orphan-wt`)
    dirs.push(wt)
    // Create via raw git so registry stays empty
    clearWorktreeRegistry()
    await exec('git', ['worktree', 'add', '-b', 'orphan-branch', wt, 'HEAD'], { cwd: project })
    clearWorktreeRegistry()
    const result = await verifyIsolatedWorktree({ candidatePath: wt, projectRootPath: project })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/注册表/)
  })
})
