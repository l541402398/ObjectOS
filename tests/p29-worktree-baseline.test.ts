import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'
import {
  WorktreeBaseMissingError,
  WorktreeManager,
  ensureBaselineCommit,
  resolveBaseCommit,
} from '../packages/worktree/src/index.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

/** A repository that exists but has no commit yet — the state the reported failure came from. */
function unbornRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'p29-unborn-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  git(dir, ['init', '-q'])
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

describe('ADR-0050 a git repository without commits can still host a plan worktree', () => {
  it('reports the real cause instead of "invalid reference: projectos/plan-…"', async () => {
    const repo = unbornRepo({ 'README.md': '# demo\n' })
    expect(await resolveBaseCommit(repo)).toBeNull()
    const worktrees = new WorktreeManager()
    const target = join(repo, '..', `${Date.now()}-wt`)
    await expect(worktrees.create(repo, target, 'projectos/plan-unborn')).rejects.toBeInstanceOf(WorktreeBaseMissingError)
    await expect(worktrees.create(repo, target, 'projectos/plan-unborn')).rejects.toThrow(/没有任何提交/)
    await expect(worktrees.create(repo, target, 'projectos/plan-unborn')).rejects.not.toThrow(/invalid reference/)
  })

  it('creates the baseline commit from the folder content, then the worktree works', async () => {
    const repo = unbornRepo({ 'README.md': '# demo\n', 'src/index.ts': 'export const x = 1\n' })
    const baseline = await ensureBaselineCommit(repo)
    expect(baseline?.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(baseline?.files).toBe(2)
    const head = await resolveBaseCommit(repo)
    expect(head).toBe(baseline?.commit)

    const worktrees = new WorktreeManager()
    const target = join(repo, '..', `${Date.now()}-wt-ok`)
    const ref = await worktrees.create(repo, target, 'projectos/plan-baseline')
    expect(ref.baseHead).toBe(baseline?.commit)
    expect(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: target, encoding: 'utf8' }).trim()).toBe(
      'projectos/plan-baseline',
    )
  })

  it('handles a completely empty repository with an empty commit', async () => {
    const repo = unbornRepo({})
    const baseline = await ensureBaselineCommit(repo)
    expect(baseline?.files).toBe(0)
    expect(baseline?.commit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('never rewrites an existing history', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'p29-existing-'))
    cleanups.push(() => rmSync(repo, { recursive: true, force: true }))
    git(repo, ['init', '-q'])
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'])
    git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'existing'])
    const before = git(repo, ['rev-parse', 'HEAD']).trim()
    const baseline = await ensureBaselineCommit(repo)
    expect(baseline).toBeNull()
    expect(git(repo, ['rev-parse', 'HEAD']).trim()).toBe(before)
  })
})
