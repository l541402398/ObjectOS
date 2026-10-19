import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluateToolPolicy, redactSecrets } from '@projectos/policy'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-policy-'))
  dirs.push(dir)
  return dir
}

describe('tool policy', () => {
  it('allows read-only workspace reads', () => {
    const workspace = root()
    writeFileSync(join(workspace, 'README.md'), '# Readme\n')
    const result = evaluateToolPolicy({
      rootPath: workspace,
      toolName: 'read_file',
      args: { path: 'README.md' },
    })
    expect(result.decision).toBe('allow')
  })

  it('denies traversal and protected paths', () => {
    const workspace = root()
    const traversal = evaluateToolPolicy({
      rootPath: workspace,
      toolName: 'read_file',
      args: { path: '../secret.txt' },
    })
    expect(traversal.decision).toBe('deny')
    const env = evaluateToolPolicy({
      rootPath: workspace,
      toolName: 'read_file',
      args: { path: '.env' },
    })
    expect(env.decision).toBe('deny')
  })

  it('requires approval for writes and process execution', () => {
    const workspace = root()
    expect(
      evaluateToolPolicy({ rootPath: workspace, toolName: 'write_file', args: { path: 'a.txt', content: 'x' } })
        .decision,
    ).toBe('require_approval')
    expect(
      evaluateToolPolicy({ rootPath: workspace, toolName: 'run_command', args: { command: 'node --version' } })
        .decision,
    ).toBe('require_approval')
  })

  it('denies unknown tools', () => {
    const result = evaluateToolPolicy({ rootPath: root(), toolName: 'deploy_everything', args: {} })
    expect(result.decision).toBe('deny')
  })

  it('redacts credentials from text', () => {
    const token = 'sk-abcdefghijklmnopqrstuvwxyz'
    const redacted = redactSecrets(`api_key=${token} Authorization: Bearer ${token}`)
    expect(redacted).not.toContain(token)
    expect(redacted).toContain('••••')
  })
})
