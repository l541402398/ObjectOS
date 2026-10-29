/**
 * ADR-0056 — `run-tests` grant action.
 *
 * A plan grant only covered writes (`workspace-write`), so every `node --test`, `node --version` and
 * `git status` inside a run asked the user again. Exact-command reuse helps only for the *same* command,
 * which a real agent never repeats verbatim. The user therefore had to babysit the whole run.
 *
 * This action is deliberately narrow: it authorizes only test runners and read-only inspections inside
 * the granted workspace. Anything that can write, download, spawn an arbitrary program or chain shell
 * commands still needs a per-call human decision.
 */

const ALLOWED_PREFIXES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /^node\s+--test(\s|$)/, label: 'node --test' },
  { pattern: /^node\s+--version$/, label: 'node --version' },
  { pattern: /^npm\s+(run\s+)?test(:[\w:.-]+)?(\s|$)/, label: 'npm test' },
  { pattern: /^pnpm\s+(run\s+)?test(:[\w:.-]+)?(\s|$)/, label: 'pnpm test' },
  { pattern: /^yarn\s+(run\s+)?test(:[\w:.-]+)?(\s|$)/, label: 'yarn test' },
  { pattern: /^(npx\s+)?vitest\s+run(\s|$)/, label: 'vitest run' },
  { pattern: /^(npx\s+)?jest(\s|$)/, label: 'jest' },
  { pattern: /^pytest(\s|$)/, label: 'pytest' },
  { pattern: /^go\s+test(\s|$)/, label: 'go test' },
  { pattern: /^cargo\s+test(\s|$)/, label: 'cargo test' },
  { pattern: /^git\s+(status|diff|log|rev-parse|ls-files)(\s|$)/, label: 'git 只读检查' },
]

/** Shell syntax that can turn an innocent-looking command into something else. */
const SHELL_METACHARACTERS = /[;&|`$<>()\n\r]|\$\(/

export interface GrantedCommandVerdict {
  allowed: boolean
  /** Why it was allowed, or which construct blocked it. */
  reason: string
  label: string | null
}

export function classifyGrantedCommand(rawCommand: string): GrantedCommandVerdict {
  const command = rawCommand.trim().replace(/\s+/g, ' ')
  if (!command) return { allowed: false, reason: '命令为空', label: null }
  if (SHELL_METACHARACTERS.test(command)) {
    return { allowed: false, reason: '包含 shell 连接符/重定向/子命令，不能由 run-tests 授权覆盖', label: null }
  }
  for (const entry of ALLOWED_PREFIXES) {
    if (entry.pattern.test(command)) {
      return { allowed: true, reason: `命中测试/只读白名单（${entry.label}）`, label: entry.label }
    }
  }
  return { allowed: false, reason: '不在测试/只读白名单内，仍需逐次审批', label: null }
}
