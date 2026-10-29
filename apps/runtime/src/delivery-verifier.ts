import { execFileSync, spawn } from 'node:child_process'
import type { PlanDraft } from '@projectos/contracts'
import type { SqliteStore } from '@projectos/persistence'

/**
 * ADR-0030 — `mergedAt` proves a merge happened, not that quality was verified.
 *
 * Delivery therefore has two distinct facts to persist:
 *   - the real merge commit (Git fact),
 *   - the post-merge verification result (the same commands that had to pass before).
 *
 * If the merge succeeds but the verification fails, the state must say exactly that
 * (`merged_verification_failed`) instead of either claiming success or pretending nothing merged.
 */

const VERIFICATION_PATTERN =
  /^(npm|pnpm|yarn)\s+(run\s+)?(test|build|typecheck|lint)\b|^(npx\s+)?(vitest|jest|mocha)\b|^node\s+--test\b|^(npx\s+)?tsc\b/i

/** Commands this plan really executed and that reported a real exit code. */
export function recordedVerificationCommands(store: SqliteStore, plan: PlanDraft): string[] {
  const runs = store.db
    .prepare("SELECT id FROM agent_runs WHERE task_id IN (SELECT value FROM json_each(?)) ORDER BY created_at ASC")
    .all(JSON.stringify(plan.createdTaskIds)) as Array<{ id: string }>
  const seen = new Map<string, { command: string; exitCode: number | null }>()
  for (const run of runs) {
    for (const call of store.read.getToolCalls(run.id)) {
      if (call.status !== 'completed') continue
      if (call.toolName !== 'run_tests' && call.toolName !== 'run_command') continue
      const command = typeof call.args?.command === 'string' ? call.args.command.trim() : ''
      if (!command) continue
      // The tool *name* is not proof: a run_tests call can carry any command. Only a real test/
      // build/typecheck/lint command may be re-run as delivery verification.
      const isVerification = VERIFICATION_PATTERN.test(command)
      if (!isVerification) continue
      const result = (call.result ?? {}) as Record<string, unknown>
      const exitCode = typeof result.exitCode === 'number' ? result.exitCode : typeof result.code === 'number' ? result.code : null
      seen.set(command, { command, exitCode })
    }
  }
  return [...seen.values()].filter((item) => item.exitCode === 0).map((item) => item.command)
}

export interface PostMergeCheck {
  command: string
  exitCode: number | null
  durationMs: number
  outputTail: string
}

export interface PostMergeVerification {
  passed: boolean
  checks: PostMergeCheck[]
  /** True when the plan never recorded a passing verification to re-run. */
  notApplicable: boolean
  reason: string
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      /* best effort */
    }
    return
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    /* best effort */
  }
}

async function runCommand(root: string, command: string, timeoutMs: number): Promise<PostMergeCheck> {
  const startedAt = Date.now()
  return await new Promise<PostMergeCheck>((resolve) => {
    const child = spawn(command, {
      cwd: root,
      shell: true,
      windowsHide: true,
      detached: process.platform !== 'win32',
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    })
    let output = ''
    let settled = false
    const finish = (exitCode: number | null, extra = ''): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        command,
        exitCode,
        durationMs: Date.now() - startedAt,
        outputTail: `${output}${extra}`.slice(-4000),
      })
    }
    const timer = setTimeout(() => {
      killTree(child.pid)
      setTimeout(() => finish(null, '\n[delivery] 超时终止'), 3_000)
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => {
      if (output.length < 60_000) output += chunk.toString('utf8')
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      if (output.length < 60_000) output += chunk.toString('utf8')
    })
    child.on('error', (error) => finish(null, `\n[delivery] ${error.message}`))
    child.on('close', (code) => finish(code))
  })
}

/** Re-runs the plan's own passing verification commands against the merged workspace. */
export async function verifyAfterMerge(input: {
  rootPath: string
  commands: string[]
  timeoutMs?: number
}): Promise<PostMergeVerification> {
  if (input.commands.length === 0) {
    return { passed: false, checks: [], notApplicable: true, reason: '计划没有记录任何已通过的验证命令，无法进行合并后验证' }
  }
  const checks: PostMergeCheck[] = []
  for (const command of input.commands.slice(0, 6)) {
    checks.push(await runCommand(input.rootPath, command, input.timeoutMs ?? 300_000))
  }
  const failed = checks.filter((check) => check.exitCode !== 0)
  return {
    passed: failed.length === 0,
    checks,
    notApplicable: false,
    reason:
      failed.length === 0
        ? `合并后 ${checks.length} 条验证命令全部通过`
        : `合并后验证失败：${failed.map((check) => `${check.command}（exit ${check.exitCode ?? 'timeout'}）`).join('；')}`,
  }
}

/** Merge dry-run: does this branch merge cleanly into the current target HEAD? */
export function mergeWouldConflict(repoRoot: string, branch: string): { clean: boolean; detail: string } {
  const run = (args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return { code: 0, out: out.trim() }
    } catch (error) {
      const typed = error as { status?: number; stdout?: string; stderr?: string }
      return { code: typed.status ?? 1, out: `${typed.stdout ?? ''}${typed.stderr ?? ''}`.trim() }
    }
  }
  const head = run(['rev-parse', 'HEAD'])
  if (head.code !== 0) return { clean: false, detail: '无法读取目标分支 HEAD' }
  // `git merge-tree --write-tree` needs Git >= 2.38; older versions report a usage error, in which
  // case the real merge keeps its own abort-on-conflict protection.
  const dry = run(['merge-tree', '--write-tree', 'HEAD', branch])
  if (dry.code === 0) return { clean: true, detail: 'git merge-tree 预演无冲突' }
  if (/unknown option|usage:|not a git command/i.test(dry.out)) {
    return { clean: true, detail: '当前 Git 不支持 merge-tree 预演，改为在合并时 abort-on-conflict 保护' }
  }
  return { clean: false, detail: `合并预演发现冲突：${dry.out.split('\n').slice(0, 6).join(' / ').slice(0, 600)}` }
}

/** Is the recorded base commit still an ancestor of the target branch (no history rewrite)? */
export function baseCommitIsAncestor(repoRoot: string, baseCommit: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', baseCommit, 'HEAD'], {
      cwd: repoRoot,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}
