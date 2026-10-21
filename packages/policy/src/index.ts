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
