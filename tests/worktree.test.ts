import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { WorktreeManager } from '@projectos/worktree'

const exec = promisify(execFile)
const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

async function repo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-worktree-'))
  dirs.push(dir)
  await exec('git', ['init', '-q'], { cwd: dir })
  await exec('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  await exec('git', ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'app.txt'), 'base\n')
  await exec('git', ['add', '.'], { cwd: dir })
  await exec('git', ['commit', '-qm', 'base'], { cwd: dir })
  return dir
}

describe('worktree isolation', () => {
  it('creates a branch worktree, captures diff, and merges only clean changes', async () => {
    const root = await repo()
    const manager = new WorktreeManager()
    const path = join(root, '..', `${root.split(/[\\/]/).pop()}-tree`)
    dirs.push(path)
    const ref = await manager.create(root, path, 'projectos/plan-test')
    expect(ref.branch).toBe('projectos/plan-test')
    const listed = await manager.list(root)
    expect(listed.length).toBeGreaterThan(1)

    writeFileSync(join(path, 'feature.txt'), 'feature\n')
    expect(await manager.diff(path)).toContain('feature.txt')
    await exec('git', ['add', '.'], { cwd: path })
    await exec('git', ['commit', '-qm', 'feature'], { cwd: path })

    const merged = await manager.merge(root, 'projectos/plan-test', 'merge plan')
    expect(merged.ok).toBe(true)
    expect(readFileSync(join(root, 'feature.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('feature\n')
  })

  it('commits untracked Agent files before merging so they are actually delivered', async () => {
    const root = await repo()
    const manager = new WorktreeManager()
    const path = join(root, '..', `${root.split(/[\\/]/).pop()}-untracked`)
    dirs.push(path)
    await manager.create(root, path, 'projectos/plan-untracked')
    writeFileSync(join(path, 'delivered.txt'), 'agent output\n')
    const diff = await manager.diff(path)
    expect(diff).toContain('delivered.txt')
    const merged = await manager.merge(root, 'projectos/plan-untracked', 'deliver untracked')
    expect(merged.ok).toBe(true)
    expect(readFileSync(join(root, 'delivered.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('agent output\n')
  })

  it('merges with ProjectOS identity when the repository has no git user configured', async () => {
    const root = await repo()
    await exec('git', ['config', '--unset', 'user.name'], { cwd: root })
    await exec('git', ['config', '--unset', 'user.email'], { cwd: root })
    const manager = new WorktreeManager()
    const path = join(root, '..', `${root.split(/[\\/]/).pop()}-no-identity`)
    dirs.push(path)
    await manager.create(root, path, 'projectos/plan-no-identity')
    writeFileSync(join(path, 'identity.txt'), 'identity\n')
    const merged = await manager.merge(root, 'projectos/plan-no-identity', 'merge without identity')
    expect(merged.ok).toBe(true)
    expect(readFileSync(join(root, 'identity.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('identity\n')
  })

  it('aborts a conflicting merge and leaves the main workspace clean', async () => {
    const root = await repo()
    const manager = new WorktreeManager()
    const path = join(root, '..', `${root.split(/[\\/]/).pop()}-conflict`)
    dirs.push(path)
    await manager.create(root, path, 'projectos/plan-conflict')
    writeFileSync(join(path, 'app.txt'), 'branch\n')
    await exec('git', ['commit', '-qam', 'branch'], { cwd: path })
    writeFileSync(join(root, 'app.txt'), 'main\n')
    await exec('git', ['commit', '-qam', 'main'], { cwd: root })

    const merged = await manager.merge(root, 'projectos/plan-conflict', 'merge conflict')
    expect(merged.ok).toBe(false)
    expect(merged.message).toContain('app.txt')
    const status = await exec('git', ['status', '--porcelain=v1'], { cwd: root })
    expect(status.stdout.trim()).toBe('')
    expect(readFileSync(join(root, 'app.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('main\n')
  })

  it('refuses to merge into a dirty main workspace', async () => {
    const root = await repo()
    const manager = new WorktreeManager()
    const path = join(root, '..', `${root.split(/[\\/]/).pop()}-dirty`)
    dirs.push(path)
    await manager.create(root, path, 'projectos/plan-dirty')
    writeFileSync(join(root, 'dirty.txt'), 'dirty\n')
    const merged = await manager.merge(root, 'projectos/plan-dirty', 'merge dirty')
    expect(merged.ok).toBe(false)
    expect(merged.message).toContain('未提交')
  })
})

