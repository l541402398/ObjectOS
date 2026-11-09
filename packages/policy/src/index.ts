import { AppError } from '@projectos/contracts'
import { resolveWorkspacePath } from '@projectos/workspace'

export type ToolRisk = 'read' | 'workspace-write' | 'process' | 'git-write' | 'external'
export type PolicyDecision = 'allow' | 'require_approval' | 'deny'

export interface ToolPolicyResult {
  decision: PolicyDecision
  risk: ToolRisk
  reason: string
  redactedArgs?: Record<string, unknown>
  autoAllowed?: boolean
}

const READ_TOOLS = new Set([
  'list_directory',
  'read_file',
  'git_status',
  'git_diff',
  'search_knowledge',
  'list_tasks',
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
const GIT_WRITE_TOOLS = new Set(['git_commit'])

const PROTECTED_PATH_PATTERNS = [
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.env(\.|$)/i,
  /(^|\/)id_rsa(\.|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)credentials(\.|$)/i,
  /(^|\/)secrets?(\/|\.|$)/i,
]

/** Default: Worktree 内写文件与白名单命令可在计划批准后自动放行。 */
export const DEFAULT_WORKTREE_AUTO_APPROVE = true

/**
 * Allowlisted process commands inside an isolated worktree.
 * Matching is case-insensitive against the full command string.
 * Override via PolicyOptions.commandAllowlist.
 */
export const DEFAULT_COMMAND_ALLOWLIST: readonly RegExp[] = [
  /\b(pnpm|npm|yarn|bun)\s+(test|lint|typecheck|build|run\s+(test|lint|typecheck|build))\b/i,
  /\b(vitest|jest|mocha|pytest|phpunit)\b/i,
  /\btsc(\s|$)/i,
  /\beslint\b/i,
  /\bprettier\b/i,
  /\bnode\s+--version\b/i,
  /^(test|lint|typecheck|build)$/i,
]

export interface PolicyOptions {
  /** Feature toggle; default true. When false, Worktree runs behave like main workspace. */
  worktreeAutoApprove?: boolean
  /** Extra or replacement command allowlist patterns. */
  commandAllowlist?: readonly RegExp[]
}

export interface ToolCallContext {
  rootPath: string
  /** Project main working tree. When set and different from rootPath, rootPath is treated as an isolated worktree. */
  projectRootPath?: string
  toolName: string
  args: Record<string, unknown>
  /** Explicit isolation hint; inferred from paths when omitted. */
  isolation?: {
    kind: 'worktree' | 'main'
    /** Plan must be approved for Worktree auto-allow. Default true when kind=worktree. */
    planApproved?: boolean
  }
  options?: PolicyOptions
}

export function isProtectedPath(relativePath: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((pattern) => pattern.test(relativePath.replace(/\\/g, '/')))
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function isIsolatedWorktree(rootPath: string, projectRootPath?: string): boolean {
  if (!projectRootPath) return false
  return normalizePath(rootPath) !== normalizePath(projectRootPath)
}

export function commandMatchesAllowlist(command: string, allowlist: readonly RegExp[] = DEFAULT_COMMAND_ALLOWLIST): boolean {
  const text = command.trim()
  if (!text) return false
  return allowlist.some((pattern) => pattern.test(text))
}

function resolveIsolation(context: ToolCallContext): { kind: 'worktree' | 'main'; planApproved: boolean } {
  if (context.isolation) {
    return {
      kind: context.isolation.kind,
      planApproved: context.isolation.planApproved ?? context.isolation.kind === 'worktree',
    }
  }
  const worktree = isIsolatedWorktree(context.rootPath, context.projectRootPath)
  return { kind: worktree ? 'worktree' : 'main', planApproved: worktree }
}

export function evaluateToolPolicy(context: ToolCallContext): ToolPolicyResult {
  const { toolName, args, rootPath } = context
  const options = context.options ?? {}
  const worktreeAutoApprove = options.worktreeAutoApprove ?? DEFAULT_WORKTREE_AUTO_APPROVE
  const allowlist = options.commandAllowlist ?? DEFAULT_COMMAND_ALLOWLIST
  const isolation = resolveIsolation(context)
  const canAutoAllow =
    worktreeAutoApprove && isolation.kind === 'worktree' && isolation.planApproved

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
    if (canAutoAllow) {
      return {
        decision: 'allow',
        risk: 'workspace-write',
        reason: '隔离 Worktree 内写文件已随计划批准自动放行（仍写入审计）',
        autoAllowed: true,
        redactedArgs: args,
      }
    }
    return {
      decision: 'require_approval',
      risk: 'workspace-write',
      reason: isolation.kind === 'main' ? '主工作区修改项目文件需要人工授权' : '修改项目文件需要人工授权',
      redactedArgs: args,
    }
  }

  if (PROCESS_TOOLS.has(toolName)) {
    const command =
      typeof args.command === 'string'
        ? args.command
        : toolName === 'run_tests'
          ? 'test'
          : ''
    if (canAutoAllow && commandMatchesAllowlist(command, allowlist)) {
      return {
        decision: 'allow',
        risk: 'process',
        reason: '隔离 Worktree 内白名单命令已随计划批准自动放行（仍写入审计）',
        autoAllowed: true,
        redactedArgs: args,
      }
    }
    return {
      decision: 'require_approval',
      risk: 'process',
      reason:
        canAutoAllow && command
          ? '该命令不在 Worktree 白名单内，需要人工授权'
          : '执行进程需要人工授权',
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
