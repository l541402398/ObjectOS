import { describe, expect, it } from 'vitest'
import { normalizeWorkspaceWritePath } from '../apps/runtime/src/agent-runner.js'

/**
 * ADR-0035 — a real run failed at the very last step because the developer passed the absolute
 * worktree path to write_file: the grant refused it as an escape and the task went to `blocked`.
 * Absolute paths inside the workspace are normalized; escapes fail with a retryable BAD_REQUEST.
 */
describe('ADR-0035 write_file paths', () => {
  const root = process.platform === 'win32' ? 'C:\\ws\\plan' : '/ws/plan'

  it('accepts a workspace-relative path', () => {
    expect(normalizeWorkspaceWritePath(root, 'src/sums.mjs')).toBe('src/sums.mjs')
    expect(normalizeWorkspaceWritePath(root, './src/sums.mjs')).toBe('src/sums.mjs')
  })

  it('normalizes an absolute path that is inside the workspace', () => {
    const absolute = process.platform === 'win32' ? 'C:\\ws\\plan\\src\\sums.mjs' : '/ws/plan/src/sums.mjs'
    expect(normalizeWorkspaceWritePath(root, absolute)).toBe('src/sums.mjs')
  })

  it('rejects an absolute path outside the workspace with a retryable error', () => {
    const outside = process.platform === 'win32' ? 'C:\\Users\\Administrator\\elsewhere\\a.mjs' : '/tmp/a.mjs'
    expect(() => normalizeWorkspaceWritePath(root, outside)).toThrowError(/工作区相对路径/)
  })

  it('rejects ../ escapes with a retryable error', () => {
    expect(() => normalizeWorkspaceWritePath(root, '../../Administrator/secret.mjs')).toThrowError(/不能使用 \.\./)
    expect(() => normalizeWorkspaceWritePath(root, 'src/../../outside.mjs')).toThrowError(/不能使用 \.\./)
  })

  it('rejects an empty path', () => {
    expect(() => normalizeWorkspaceWritePath(root, '   ')).toThrowError(/相对路径/)
  })
})
