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

