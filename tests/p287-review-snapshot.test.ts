import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { reviewVerdictOf } from '../packages/application/src/review-verdict.js'
import {
  buildSnapshot,
  readSnapshot,
  snapshotMatches,
  snapshotMismatch,
} from '../packages/application/src/review-snapshot.js'
import {
  resolveReviewEvidence,
  reviewRecordBindingOf,
  reviewRecordProvenance,
  reviewRecordStillCurrent,
} from '../packages/application/src/review-evidence.js'
import { collectReviewSnapshot } from '../apps/runtime/src/review-snapshot-collector.js'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

function workspace(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'p287-snap-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'src'), { recursive: true })
  for (const [path, body] of Object.entries(files)) writeFileSync(join(dir, path), body)
  return dir
}

function gitWorkspace(files: Record<string, string>): string {
  const dir = workspace(files)
  const run = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
  run('init', '-q')
  run('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'add', '-A')
  run('-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'init')
  return dir
}

function review(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifactType: 'review',
    reviewedObjects: ['src/a.mjs'],
    scope: 'src/a.mjs',
    findings: [],
    conclusion: '通过',
    blockers: [],
    verdict: 'approved',
    ...overrides,
  }
}

describe('ADR-0025 trusted review snapshot', () => {
  it('hashes the real reviewed file content', () => {
    const root = workspace({ 'src/a.mjs': 'export const a = 1\n' })
    const snapshot = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    expect(snapshot.files).toHaveLength(1)
    expect(snapshot.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('invalidates an approval when the file changes but git HEAD does not', () => {
    const root = gitWorkspace({ 'src/a.mjs': 'export const a = 1\n' })
    const reviewedAt = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    // Uncommitted edit: HEAD is untouched, content is not.
    writeFileSync(join(root, 'src/a.mjs'), 'export const a = 2\n')
    const later = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    expect(later.baselineCommit).toBe(reviewedAt.baselineCommit)
    expect(later.fingerprint).not.toBe(reviewedAt.fingerprint)
    expect(snapshotMatches(reviewedAt, later)).toBe(false)
    expect(snapshotMismatch(reviewedAt, later)).toContain('src/a.mjs')
  })

  it('treats untracked files as reviewed content, not invisible work', () => {
    const root = gitWorkspace({ 'src/a.mjs': 'x\n' })
    writeFileSync(join(root, 'src/new.mjs'), 'export const n = 1\n')
    const snapshot = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/new.mjs'] })
    expect(snapshot.files[0]?.state).toBe('untracked')
    expect(snapshot.changes.untracked).toContain('src/new.mjs')
    const before = snapshot.fingerprint
    writeFileSync(join(root, 'src/new.mjs'), 'export const n = 2\n')
    const after = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/new.mjs'] })
    expect(after.fingerprint).not.toBe(before)
  })

  it('records staged, unstaged, deleted and renamed changes of the worktree', () => {
    const root = gitWorkspace({ 'src/a.mjs': 'a\n', 'src/b.mjs': 'b\n' })
    writeFileSync(join(root, 'src/a.mjs'), 'a2\n')
    execFileSync('git', ['add', 'src/a.mjs'], { cwd: root, stdio: 'ignore' })
    writeFileSync(join(root, 'src/b.mjs'), 'b2\n')
    const snapshot = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs', 'src/b.mjs'] })
    expect(snapshot.changes.staged).toContain('src/a.mjs')
    expect(snapshot.changes.unstaged).toContain('src/b.mjs')

    execFileSync('git', ['mv', 'src/b.mjs', 'src/c.mjs'], { cwd: root, stdio: 'ignore' })
    const renamed = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/c.mjs'] })
    expect(renamed.changes.renamed.some((item) => item.to === 'src/c.mjs' || item.from === 'src/b.mjs')).toBe(true)
  })

  it('widens the snapshot only when the review explicitly says it is project-wide', () => {
    const root = gitWorkspace({ 'src/a.mjs': 'a\n', 'src/unrelated.mjs': 'u\n' })
    writeFileSync(join(root, 'src/unrelated.mjs'), 'u2\n')
    const narrow = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    expect(narrow.files.map((file) => file.path)).toEqual(['src/a.mjs'])
    const wide = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'], scope: 'project' })
    expect(wide.scope.expanded).toBe(true)
    expect(wide.files.map((file) => file.path)).toContain('src/unrelated.mjs')
    expect(wide.fingerprint).not.toBe(narrow.fingerprint)
  })

  it('never follows a symlink out of the workspace and records the rejection', () => {
    const root = gitWorkspace({ 'src/a.mjs': 'x\n' })
    const outside = mkdtempSync(join(tmpdir(), 'p287-outside-'))
    cleanups.push(() => rmSync(outside, { recursive: true, force: true }))
    writeFileSync(join(outside, 'secret.txt'), 'secret\n')
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, 'src', 'link.mjs'))
    } catch {
      return // Windows without symlink privilege: the path-safety unit test below still runs.
    }
    const snapshot = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/link.mjs'] })
    expect(snapshot.files).toEqual([])
    expect(snapshot.changes.rejected.join(' ')).toContain('src/link.mjs')
  })

  it('refuses a structured approved verdict once the content moved on', () => {
    const root = gitWorkspace({ 'src/a.mjs': 'export const a = 1\n' })
    const reviewedAt = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    const metadata = review({
      reviewedRevision: reviewedAt.baselineCommit,
      reviewSnapshot: reviewedAt,
    })
    expect(
      reviewVerdictOf(metadata, { currentRevision: reviewedAt.baselineCommit, currentSnapshot: reviewedAt }),
    ).toBe('approved')
    writeFileSync(join(root, 'src/a.mjs'), 'export const a = 3\n')
    const later = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    expect(
      reviewVerdictOf(metadata, { currentRevision: reviewedAt.baselineCommit, currentSnapshot: later }),
    ).toBe('inconclusive')
  })

  it('fails closed when a review carries no snapshot at all', () => {
    const root = workspace({ 'src/a.mjs': 'x\n' })
    const current = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    const metadata = review()
    expect(reviewVerdictOf(metadata, { currentRevision: current.baselineCommit, currentSnapshot: current })).toBe(
      'inconclusive',
    )
  })

  it('ignores paths that escape the workspace', () => {
    const root = workspace({ 'src/a.mjs': 'x\n' })
    const snapshot = collectReviewSnapshot({
      workspaceRoot: root,
      reviewedObjects: ['../outside.mjs', '/etc/passwd', 'src/a.mjs'],
    })
    expect(snapshot.files.map((file) => file.path)).toEqual(['src/a.mjs'])
    expect(snapshot.changes.rejected.join(' ')).toContain('../outside.mjs')
  })

  it('records deleted files as null instead of pretending they exist', () => {
    const root = workspace({ 'src/a.mjs': 'x\n' })
    const snapshot = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/gone.mjs'] })
    expect(snapshot.files[0]?.sha256).toBeNull()
  })

  it('is order independent and deterministic', () => {
    const files = [
      { path: 'b.mjs', sha256: '2' },
      { path: 'a.mjs', sha256: '1' },
    ]
    expect(buildSnapshot(null, files).fingerprint).toBe(buildSnapshot(null, [...files].reverse()).fingerprint)
  })

  it('does not invalidate a review just because the same bytes were committed', () => {
    const root = gitWorkspace({ 'src/a.mjs': 'v1\n' })
    const reviewedAt = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    const metadata = review({ reviewedRevision: reviewedAt.baselineCommit, reviewSnapshot: reviewedAt })
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qam', 'same bytes', '--allow-empty'], {
      cwd: root,
      stdio: 'ignore',
    })
    const after = collectReviewSnapshot({ workspaceRoot: root, reviewedObjects: ['src/a.mjs'] })
    expect(after.baselineCommit).not.toBe(reviewedAt.baselineCommit)
    // Content is the review subject, so a new commit of identical bytes stays current.
    expect(reviewVerdictOf(metadata, { currentRevision: after.baselineCommit, currentSnapshot: after })).toBe('approved')
  })

  it('round-trips a v2 snapshot through storage and keeps the scope and changes', () => {
    const root = gitWorkspace({ 'src/a.mjs': 'x\n' })
    writeFileSync(join(root, 'src/a.mjs'), 'y\n')
    const snapshot = collectReviewSnapshot({
      workspaceRoot: root,
      reviewedObjects: ['src/a.mjs'],
      projectId: 'prj_1',
      planId: 'pln_1',
      taskId: 'tsk_1',
      runId: 'run_1',
      reviewer: { agentId: 'agt_rev', name: 'Reviewer' },
      refs: { diffArtifactId: 'art_diff', artifactIds: ['art_1'], evidenceIds: ['evd_1'] },
    })
    const parsed = readSnapshot(JSON.parse(JSON.stringify(snapshot)))
    expect(parsed?.schemaVersion).toBe(2)
    expect(parsed?.planId).toBe('pln_1')
    expect(parsed?.runId).toBe('run_1')
    expect(parsed?.reviewer?.agentId).toBe('agt_rev')
    expect(parsed?.refs.diffArtifactId).toBe('art_diff')
    expect(parsed?.changes.unstaged).toContain('src/a.mjs')
    expect(parsed?.fingerprint).toBe(snapshot.fingerprint)
  })
})

describe('ADR-0024 shared review evidence resolution', () => {
  const root = (): string => gitWorkspace({ 'src/a.mjs': 'x\n' })
  const optionsFor = (dir: string, reviewedObjects = ['src/a.mjs']) => {
    const snapshot = collectReviewSnapshot({ workspaceRoot: dir, reviewedObjects })
    return { currentRevision: snapshot.baselineCommit, currentSnapshot: snapshot }
  }

  it('approves only when the current content review is positive', () => {
    const dir = root()
    const options = optionsFor(dir)
    const resolved = resolveReviewEvidence(
      [{ id: 'art_1', title: 'Review', metadata: review({ reviewSnapshot: options.currentSnapshot }) }],
      options,
    )
    expect(resolved.approved).toBe(true)
    expect(resolved.verdict).toBe('approved')
  })

  it('does not let a structured approved verdict bypass the version check', () => {
    const dir = root()
    const staleSnapshot = collectReviewSnapshot({ workspaceRoot: dir, reviewedObjects: ['src/a.mjs'] })
    writeFileSync(join(dir, 'src/a.mjs'), 'changed\n')
    // The workspace changed after the review: this is the *current* content.
    const currentSnapshot = collectReviewSnapshot({ workspaceRoot: dir, reviewedObjects: ['src/a.mjs'] })
    const resolved = resolveReviewEvidence(
      [
        {
          id: 'art_1',
          title: 'Review',
          metadata: review({ verdict: 'approved', reviewSnapshot: staleSnapshot, reviewedRevision: 'deadbeef' }),
        },
      ],
      { currentRevision: 'feedface', currentSnapshot },
    )
    expect(resolved.approved).toBe(false)
    expect(resolved.historical).toHaveLength(1)
    expect(resolved.verdict).toBe('inconclusive')
  })

  it('keeps a historical negative review for audit but does not let it block a re-reviewed version', () => {
    const dir = root()
    const oldSnapshot = collectReviewSnapshot({ workspaceRoot: dir, reviewedObjects: ['src/a.mjs'] })
    writeFileSync(join(dir, 'src/a.mjs'), 'fixed\n')
    const options = optionsFor(dir)
    const resolved = resolveReviewEvidence(
      [
        {
          id: 'art_old',
          title: 'Old review',
          metadata: review({ verdict: 'changes_requested', conclusion: '需要修改', reviewSnapshot: oldSnapshot }),
        },
        {
          id: 'art_new',
          title: 'Re-review',
          metadata: review({ reviewSnapshot: options.currentSnapshot }),
        },
      ],
      options,
    )
    expect(resolved.approved).toBe(true)
    expect(resolved.historical.map((item) => item.id)).toEqual(['art_old'])
    expect(resolved.reasons.join(' ')).toContain('已忽略')
  })

  it('refuses to let one positive review override a current contradictory review', () => {
    const dir = root()
    const options = optionsFor(dir)
    const resolved = resolveReviewEvidence(
      [
        {
          id: 'art_ok',
          title: 'Positive',
          metadata: review({ reviewSnapshot: options.currentSnapshot }),
        },
        {
          id: 'art_bad',
          title: 'Negative',
          metadata: review({
            verdict: 'changes_requested',
            conclusion: '需要修改',
            reviewSnapshot: options.currentSnapshot,
          }),
        },
      ],
      options,
    )
    expect(resolved.approved).toBe(false)
    expect(resolved.conflicts).toBeGreaterThan(0)
    expect(resolved.verdict).toBe('changes_requested')
  })

  it('blocks while a current review records an unresolved blocker', () => {
    const dir = root()
    const options = optionsFor(dir)
    const resolved = resolveReviewEvidence(
      [
        {
          id: 'art_1',
          title: 'Review',
          metadata: review({ reviewSnapshot: options.currentSnapshot, blockers: ['登录接口未鉴权'] }),
        },
        {
          id: 'art_2',
          title: 'Second opinion',
          metadata: review({ reviewSnapshot: options.currentSnapshot }),
        },
      ],
      options,
    )
    expect(resolved.approved).toBe(false)
    expect(resolved.verdict).toBe('blocked')
    expect(resolved.blockingFindings).toBe(1)
  })

  it('cannot approve anything when the version cannot be verified', () => {
    const dir = root()
    const resolved = resolveReviewEvidence(
      [{ id: 'art_1', title: 'Review', metadata: review() }],
      {},
    )
    expect(resolved.approved).toBe(false)
    expect(resolved.unverifiable).toHaveLength(1)
    expect(resolved.reasons.join(' ')).toContain('没有可校验的当前审查')
    // A plan-level caller that knows nothing about the content must not silently pass.
    expect(resolveReviewEvidence([], {}).approved).toBe(false)
  })

  it('does not approve on stale reviews alone', () => {
    const dir = root()
    const oldSnapshot = collectReviewSnapshot({ workspaceRoot: dir, reviewedObjects: ['src/a.mjs'] })
    writeFileSync(join(dir, 'src/a.mjs'), 'new\n')
    const options = optionsFor(dir)
    const resolved = resolveReviewEvidence(
      [{ id: 'art_1', title: 'Old', metadata: review({ reviewSnapshot: oldSnapshot }) }],
      options,
    )
    expect(resolved.approved).toBe(false)
    expect(resolved.verdict).toBe('inconclusive')
  })
})

describe('ADR-0024 review_record evidence is bound to revision and content', () => {
  const binding = {
    reviewArtifactId: 'art_review',
    planId: 'pln_1',
    planRevision: 2,
    snapshotFingerprint: 'a'.repeat(64),
    verdict: 'approved' as const,
    reviewedRevision: 'commit1',
  }

  it('round-trips provenance without inventing a verdict', () => {
    const parsed = reviewRecordBindingOf(reviewRecordProvenance(binding))
    expect(parsed).toEqual(binding)
    expect(reviewRecordBindingOf({ verdict: 'approved' })).toBeNull()
    expect(reviewRecordBindingOf(reviewRecordProvenance({ ...binding, verdict: 'changes_requested' }))?.verdict).toBe(
      'changes_requested',
    )
  })

  it('is only current when plan, revision and content fingerprint all match', () => {
    expect(
      reviewRecordStillCurrent(binding, {
        planId: 'pln_1',
        planRevision: 2,
        snapshotFingerprint: 'a'.repeat(64),
      }).current,
    ).toBe(true)
    expect(
      reviewRecordStillCurrent(binding, {
        planId: 'pln_1',
        planRevision: 3,
        snapshotFingerprint: 'a'.repeat(64),
      }),
    ).toMatchObject({ current: false })
    expect(
      reviewRecordStillCurrent(binding, {
        planId: 'pln_1',
        planRevision: 2,
        snapshotFingerprint: 'b'.repeat(64),
      }).reason,
    ).toContain('内容快照')
    expect(
      reviewRecordStillCurrent({ ...binding, verdict: 'changes_requested' }, {
        planId: 'pln_1',
        planRevision: 2,
        snapshotFingerprint: 'a'.repeat(64),
      }).current,
    ).toBe(false)
  })
})
