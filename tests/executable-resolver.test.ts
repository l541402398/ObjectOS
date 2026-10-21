import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveExecutable } from '../apps/runtime/src/executable-resolver.js'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'projectos-resolve-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('resolveExecutable', () => {
  it('finds a CLI in PATH', async () => {
    const dir = tempDir()
    const file = join(dir, 'codex')
    writeFileSync(file, '#!/bin/sh\n')
    chmodSync(file, 0o755)
    await expect(resolveExecutable('codex', { home: tempDir(), path: dir, shell: '/nonexistent' })).resolves.toBe(file)
  })

  it('finds a CLI in ~/.local/bin when desktop PATH does not contain it', async () => {
    const home = tempDir()
    const bin = join(home, '.local', 'bin')
    mkdirSync(bin, { recursive: true })
    const file = join(bin, 'codex')
    writeFileSync(file, '#!/bin/sh\n')
    chmodSync(file, 0o755)
    await expect(resolveExecutable('codex', { home, path: '', shell: '/nonexistent' })).resolves.toBe(file)
  })

  it('finds an absolute executable and rejects a missing one', async () => {
    const dir = tempDir()
    const file = join(dir, 'tool')
    writeFileSync(file, '')
    await expect(resolveExecutable(file, { home: tempDir(), path: '', shell: '/nonexistent' })).resolves.toBe(file)
    await expect(resolveExecutable(join(dir, 'missing'), { home: tempDir(), path: '', shell: '/nonexistent' })).resolves.toBeNull()
  })

  it('returns null when no candidate exists', async () => {
    await expect(resolveExecutable('does-not-exist-projectos', { home: tempDir(), path: '', shell: '/nonexistent' })).resolves.toBeNull()
  })
})
