import { AppError } from '@projectos/contracts'
import { resolveWorkspacePath } from '@projectos/workspace'

export type ToolRisk = 'read' | 'workspace-write' | 'process' | 'git-write' | 'external'
export type PolicyDecision = 'allow' | 'require_approval' | 'deny'

export interface ToolPolicyResult {
  decision: PolicyDecision
  risk: ToolRisk
  reason: string
  redactedArgs?: Record<string, unknown>
}

const READ_TOOLS = new Set([
  'list_directory',
  'read_file',
  'git_status',
  'git_diff',
  'search_knowledge',
  'list_tasks',
  'list_collaborators',
])

const WORKSPACE_WRITE_TOOLS = new Set(['write_file'])
const COORDINATION_TOOLS = new Set([
  'create_task',
  'update_task_status',
  'create_requirement',
  'create_milestone',
  'create_artifact',
  'record_decision',
  'send_agent_message',
  'handoff_task',
])
const PROCESS_TOOLS = new Set(['run_command', 'run_tests'])
const GIT_WRITE_TOOLS = new Set(['git_commit', 'prepare_task_workspace', 'integrate_requirement_task', 'git_delivery'])

const PROTECTED_PATH_PATTERNS = [
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)id_rsa(\.|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)credentials(\.|$)/i,
  /(^|\/)secrets?(\/|\.|$)/i,
]

export function isProtectedPath(relativePath: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(relativePath.replace(/\\/g, '/')))
}

export interface ToolCallContext {
  rootPath: string
  toolName: string
  args: Record<string, unknown>
}

export function evaluateToolPolicy(context: ToolCallContext): ToolPolicyResult {
  const { toolName, args, rootPath } = context
  if (toolName === 'submit_organization_knowledge') return { decision: 'require_approval', risk: 'external', reason: '分享固定内容到组织需要本次人工确认', redactedArgs: args }
  if (toolName === 'organization_assignment_command') return { decision: 'require_approval', risk: 'external', reason: '组织分配操作需要本次人工确认', redactedArgs: args }
  if (READ_TOOLS.has(toolName)) {
    const filePath = typeof args.path === 'string' ? args.path : null
    if (filePath) {
      if (isProtectedPath(filePath)) {
        return { decision: 'deny', risk: 'read', reason: '受保护路径（密钥或 Git 内部文件）不允许读取' }
      }
      try {
        resolveWorkspacePath(rootPath, filePath)
      } catch (error) {
        return {
          decision: 'deny',
          risk: 'read',
          reason: error instanceof Error ? error.message : '路径超出工作区',
        }
      }
    }
    return { decision: 'allow', risk: 'read', reason: '只读操作，直接允许' }
  }
  if (COORDINATION_TOOLS.has(toolName)) {
    return { decision: 'allow', risk: 'external', reason: '项目内协调操作，写入审计事件' }
  }
  if (WORKSPACE_WRITE_TOOLS.has(toolName)) {
    const filePath = typeof args.path === 'string' ? args.path : null
    if (filePath) {
      if (isProtectedPath(filePath)) {
        return { decision: 'deny', risk: 'workspace-write', reason: '受保护路径不允许自动写入' }
      }
      try {
        resolveWorkspacePath(rootPath, filePath, { forWrite: true })
      } catch (error) {
        return {
          decision: 'deny',
          risk: 'workspace-write',
          reason: error instanceof Error ? error.message : '路径超出工作区',
        }
      }
    }
    return {
      decision: 'require_approval',
      risk: 'workspace-write',
      reason: '修改项目文件需要人工授权',
      redactedArgs: args,
    }
  }
  if (PROCESS_TOOLS.has(toolName)) {
    return {
      decision: 'require_approval',
      risk: 'process',
      reason: '执行进程需要人工授权',
      redactedArgs: args,
    }
  }
  if (GIT_WRITE_TOOLS.has(toolName)) {
    return {
      decision: 'require_approval',
      risk: 'git-write',
      reason: '修改 Git 历史需要人工授权',
      redactedArgs: args,
    }
  }
  return { decision: 'deny', risk: 'external', reason: `未知工具 «${toolName}» 不在策略白名单内` }
}

export function assertAllowed(result: ToolPolicyResult): void {
  if (result.decision === 'deny') {
    throw new AppError('POLICY_DENIED', result.reason)
  }
}

const SECRET_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /(sk-[A-Za-z0-9_-]{12,})/g, replacement: 'sk-••••••••' },
  { pattern: /(Bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, replacement: '$1••••••••' },
  { pattern: /(api[_-]?key\s*[=:]\s*)[^\s"']+/gi, replacement: '$1••••••••' },
  { pattern: /(authorization\s*[=:]\s*)[^\s"']+/gi, replacement: '$1••••••••' },
]

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((text, entry) => text.replace(entry.pattern, entry.replacement), value)
}

export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth-limit]'
  if (typeof value === 'string') return redactSecrets(value)
  if (Array.isArray(value)) return value.map((entry) => redactObject(entry, depth + 1))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/key|token|secret|password|authorization/i.test(key)) {
        result[key] = '••••••••'
      } else {
        result[key] = redactObject(entry, depth + 1)
      }
    }
    return result
  }
  return value
}

/**
 * ADR-0089 — verification command families for isolated-worktree auto-allow.
 *
 * A family is a *narrow* set of build/verification commands. A command only belongs to a family
 * when it is a single invocation (no chaining, redirection or substitution) and matches one of the
 * exact shapes below. Anything else — arbitrary shell, git writes, package installs, network tools —
 * returns null and stays on the per-call approval path.
 */
export type VerifyCommandFamily = 'test' | 'lint' | 'typecheck' | 'build'

export const VERIFY_COMMAND_FAMILIES: readonly VerifyCommandFamily[] = ['test', 'lint', 'typecheck', 'build']

export const VERIFY_FAMILY_LABEL: Record<VerifyCommandFamily, string> = {
  test: '测试',
  lint: 'Lint',
  typecheck: '类型检查',
  build: '构建',
}

const VERIFY_SHELL_METACHARACTERS = /[;&|`$<>()\n\r\\]|\$\(/
const PM = '(?:npm|pnpm|yarn|bun)'
const VERIFY_DENY_TOKENS = new Set(['--fix', '--watch', '-w', '--ui', 'install', 'i', 'add', 'remove', 'publish', 'dlx', '-g', '--global', '-u', '--update', '--updateSnapshot'])
const VERIFY_PATTERNS: Array<{ family: VerifyCommandFamily; pattern: RegExp }> = [
  { family: 'test', pattern: new RegExp(`^${PM}\\s+(?:run\\s+)?test(?::[\\w:.-]+)?(?:\\s+[\\w@/.:=,-]+)*$`) },
  { family: 'test', pattern: /^(?:npx\s+|pnpm\s+exec\s+)?vitest\s+run(?:\s+[\w@/.:=,-]+)*$/ },
  { family: 'test', pattern: /^(?:npx\s+|pnpm\s+exec\s+)?jest(?:\s+[\w@/.:=,-]+)*$/ },
  { family: 'test', pattern: /^node\s+--test(?:\s+[\w@/.:=,-]+)*$/ },
  { family: 'test', pattern: /^(?:pytest|go\s+test|cargo\s+test)(?:\s+[\w@/.:=,-]+)*$/ },
  { family: 'lint', pattern: new RegExp(`^${PM}\\s+(?:run\\s+)?lint(?::[\\w:.-]+)?(?:\\s+[\\w@/.:=,-]+)*$`) },
  { family: 'lint', pattern: /^(?:npx\s+|pnpm\s+exec\s+)?eslint(?:\s+[\w@/.:=,*-]+)*$/ },
  { family: 'typecheck', pattern: new RegExp(`^${PM}\\s+(?:run\\s+)?(?:typecheck|type-check|check-types|tsc)(?::[\\w:.-]+)?(?:\\s+[\\w@/.:=,-]+)*$`) },
  { family: 'typecheck', pattern: /^(?:npx\s+|pnpm\s+exec\s+)?tsc(?:\s+(?:--noEmit|-p|--project|--pretty|false|true|[\w@/.-]+\.json))*$/ },
  { family: 'build', pattern: new RegExp(`^${PM}\\s+(?:run\\s+)?build(?::[\\w:.-]+)?(?:\\s+[\\w@/.:=,-]+)*$`) },
]

/** Family of a verification command, or null when it may do anything else. */
export function verifyCommandFamily(rawCommand: string): VerifyCommandFamily | null {
  const command = rawCommand.trim().replace(/\s+/g, ' ')
  if (!command || command.length > 400) return null
  if (VERIFY_SHELL_METACHARACTERS.test(command)) return null
  // Tokens that turn a verification run into a mutation, install, publish or long-lived process.
  const tokens = command.split(' ')
  if (tokens.some((token) => VERIFY_DENY_TOKENS.has(token) || token.startsWith('--registry'))) return null
  return VERIFY_PATTERNS.find((entry) => entry.pattern.test(command))?.family ?? null
}

/**
 * Stable "kind" of a tool approval, used for batch decisions ("approve the rest of this kind in
 * this Run"). Only kinds that are safe to decide together are `batchable`; git writes, external
 * runtime actions, protected paths and arbitrary shell are always decided one by one.
 */
export interface ApprovalKind {
  key: string
  label: string
  batchable: boolean
  reason: string
}

export function approvalKindOf(toolName: string, args: Record<string, unknown>): ApprovalKind {
  if (toolName === 'write_file') {
    const path = typeof args.path === 'string' ? args.path : ''
    if (path && isProtectedPath(path)) {
      return { key: `write_file:protected`, label: '写入受保护文件', batchable: false, reason: '受保护路径必须逐次决定' }
    }
    return { key: 'write_file', label: '写入文件', batchable: true, reason: '同一 Run 内的普通文件写入' }
  }
  if (toolName === 'run_tests' || toolName === 'run_command') {
    const command = typeof args.command === 'string' ? args.command : ''
    const family = verifyCommandFamily(command)
    if (family) {
      return { key: `command:${family}`, label: `${VERIFY_FAMILY_LABEL[family]}命令`, batchable: true, reason: `同一 Run 内的${VERIFY_FAMILY_LABEL[family]}命令` }
    }
    return { key: `command:exact`, label: '任意命令', batchable: false, reason: '任意 Shell 命令必须逐次决定' }
  }
  if (GIT_WRITE_TOOLS.has(toolName)) {
    return { key: `git:${toolName}`, label: 'Git 写操作', batchable: false, reason: 'Git 写入、提交与交付必须逐次决定' }
  }
  return { key: `other:${toolName}`, label: toolName, batchable: false, reason: '该类请求必须逐次决定' }
}
