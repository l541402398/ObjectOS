import crossSpawn from 'cross-spawn'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface WorktreeRef {
  path: string
  branch: string
  baseHead: string | null
}

function runGit(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = crossSpawn('git', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: error.message }))
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }))
  })
}

export class WorktreeManager {
  async create(repoRoot: string, worktreePath: string, branch: string): Promise<WorktreeRef> {
    if (!existsSync(`${repoRoot}/.git`)) {
      throw new Error('项目不是 Git 仓库，无法创建工作树')
    }
    if (existsSync(worktreePath)) {
      return { path: worktreePath, branch, baseHead: await this.head(worktreePath) }
    }
    mkdirSync(dirname(worktreePath), { recursive: true })
    let result = await runGit(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], repoRoot)
    if (result.code !== 0) {
      result = await runGit(['worktree', 'add', worktreePath, branch], repoRoot)
    }
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'git worktree add 失败')
    return { path: worktreePath, branch, baseHead: await this.head(worktreePath) }
  }

  async head(worktreePath: string): Promise<string | null> {
    const result = await runGit(['rev-parse', 'HEAD'], worktreePath)
    return result.code === 0 ? result.stdout.trim() : null
  }

  async diff(worktreePath: string): Promise<string> {
    const diff = await runGit(['diff', 'HEAD', '--no-ext-diff', '--unified=3'], worktreePath)
    const status = await runGit(['status', '--porcelain=v1'], worktreePath)
    return [`# git status\n${status.stdout.trim()}`, '# git diff', diff.stdout.trim()].join('\n\n').slice(0, 120_000)
  }

  async merge(repoRoot: string, branch: string, message: string): Promise<{ ok: boolean; message: string }> {
    const clean = await runGit(['status', '--porcelain=v1'], repoRoot)
    if (clean.code !== 0) return { ok: false, message: clean.stderr.trim() || '无法读取主工作区状态' }
    if (clean.stdout.trim()) return { ok: false, message: '主工作区存在未提交改动，拒绝合并' }
    const result = await runGit(['merge', '--no-ff', branch, '-m', message], repoRoot)
    return {
      ok: result.code === 0,
      message: (result.code === 0 ? result.stdout : result.stderr).trim().slice(0, 4000),
    }
  }

  async remove(repoRoot: string, worktreePath: string): Promise<void> {
    await runGit(['worktree', 'remove', '--force', worktreePath], repoRoot)
  }

  async list(repoRoot: string): Promise<Array<{ path: string; branch: string }>> {
    const result = await runGit(['worktree', 'list', '--porcelain'], repoRoot)
    if (result.code !== 0) return []
    const entries: Array<{ path: string; branch: string }> = []
    let current: { path: string; branch: string } | null = null
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        if (current) entries.push(current)
        current = { path: line.slice('worktree '.length), branch: '' }
      } else if (line.startsWith('branch ') && current) {
        current.branch = line.slice('branch '.length).replace('refs/heads/', '')
      }
    }
    if (current) entries.push(current)
    return entries
  }
}
