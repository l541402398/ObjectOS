import type { AgentCapability } from '@projectos/contracts'
import type { JsonSchema, LlmToolDefinition } from '@projectos/provider-interfaces'

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
  /** True when the tool only reads state and never needs approval. */
  readOnly: boolean
  riskLabel: '只读' | '写入' | '进程' | '协调'
  capabilities: AgentCapability[]
}

const object = (properties: Record<string, unknown>, required: string[] = [], additionalProperties = false): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties,
})

const string = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'string',
  description,
  ...extra,
})

const integer = (description: string, extra: Record<string, unknown> = {}) => ({
  type: 'integer',
  description,
  ...extra,
})

const stringArray = (description: string, maxItems = 20) => ({
  type: 'array',
  description,
  items: { type: 'string' },
  maxItems,
})

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'list_directory',
    description: '列出项目工作区中的文件与目录（自动忽略 node_modules/.git/dist 等）。用于了解代码结构。',
    parameters: object({ path: string('相对项目根目录的目录路径，留空表示根目录') }),
    readOnly: true,
    riskLabel: '只读',
    capabilities: ['plan', 'analyze', 'architect', 'implement', 'review', 'test', 'research', 'coordinate'],
  },
  {
    name: 'read_file',
    description: '读取项目工作区内的文本文件。路径必须是相对项目根目录的安全路径，单文件最大 512KB。',
    parameters: object({ path: string('相对项目根目录的文件路径') }, ['path']),
    readOnly: true,
    riskLabel: '只读',
    capabilities: ['plan', 'analyze', 'architect', 'implement', 'review', 'test', 'research', 'coordinate'],
  },
  {
    name: 'write_file',
    description:
      '写入或覆盖项目工作区内的文本文件。该操作需要人工审批，审批通过后才会真正写盘。写入前应先 read_file 了解现有内容。',
    parameters: object(
      {
        path: string('相对项目根目录的文件路径'),
        content: string('完整文件内容（UTF-8 文本）'),
      },
      ['path', 'content'],
    ),
    readOnly: false,
    riskLabel: '写入',
    capabilities: ['implement'],
  },
  {
    name: 'git_status',
    description: '查看当前项目的 Git 分支、变更文件和最近提交。只读。',
    parameters: object({}),
    readOnly: true,
    riskLabel: '只读',
    capabilities: ['analyze', 'architect', 'implement', 'review', 'test', 'coordinate'],
  },
  {
    name: 'git_diff',
    description: '查看当前 Git 差异（HEAD 与工作区）。可指定单个文件。只读。',
    parameters: object({ path: string('可选：只看某个相对路径的差异') }),
    readOnly: true,
    riskLabel: '只读',
    capabilities: ['analyze', 'architect', 'implement', 'review', 'test'],
  },
  {
    name: 'run_command',
    description:
      '在项目工作区执行 shell 命令。需要人工审批，并且有超时、输出上限和环境变量白名单。不要用于破坏性操作。',
    parameters: object(
      {
        command: string('要执行的命令（不经过 shell，禁止管道/重定向）'),
        timeoutMs: integer('超时毫秒，默认 30000，最大 120000', { minimum: 1000, maximum: 120000 }),
      },
      ['command'],
    ),
    readOnly: false,
    riskLabel: '进程',
    capabilities: ['implement', 'test'],
  },
  {
    name: 'run_tests',
    description: '运行项目测试命令（例如 pnpm test）。需要人工审批，记录真实退出码与输出。',
    parameters: object({ command: string('测试命令，默认 pnpm test', { default: 'pnpm test' }) }),
    readOnly: false,
    riskLabel: '进程',
    capabilities: ['implement', 'test'],
  },
  {
    name: 'list_tasks',
    description: '列出当前项目的任务及状态、依赖。用于规划或确认执行范围。只读。',
    parameters: object({ status: string('可选：按任务状态过滤') }),
    readOnly: true,
    riskLabel: '只读',
    capabilities: ['plan', 'analyze', 'architect', 'implement', 'review', 'test', 'coordinate'],
  },
  {
    name: 'create_task',
    description: '在当前项目创建任务，必须提供可验收的验收标准。写入项目数据库并记录审计事件。',
    parameters: object(
      {
        title: string('任务标题'),
        description: string('任务背景与范围'),
        acceptanceCriteria: stringArray('验收标准列表，至少一项', 20),
        priority: integer('优先级：1 紧急，2 高，3 中，4 低', { minimum: 1, maximum: 4 }),
        assigneeAgentId: string('可选：指派给某个 Agent id'),
        dependsOn: stringArray('可选：依赖的任务 id 列表', 20),
      },
      ['title', 'acceptanceCriteria'],
    ),
    readOnly: false,
    riskLabel: '协调',
    capabilities: ['plan', 'coordinate', 'architect'],
  },
  {
    name: 'update_task_status',
    description:
      '更新当前任务或指定任务的状态。只能使用合法状态（backlog/ready/running/review/done/blocked/cancelled）；标记 done 需要验收标准且依赖已完成。',
    parameters: object(
      {
        taskId: string('任务 id，省略时使用当前任务'),
        status: string('目标状态', {
          enum: ['backlog', 'ready', 'running', 'review', 'done', 'blocked', 'cancelled'],
        }),
        note: string('变更说明，会写入审计事件'),
      },
      ['status'],
    ),
    readOnly: false,
    riskLabel: '协调',
    capabilities: ['implement', 'review', 'test', 'coordinate'],
  },
  {
    name: 'create_requirement',
    description: '在当前项目中创建需求条目，包含验收标准。用于把讨论沉淀为可追踪需求。',
    parameters: object(
      {
        title: string('需求标题'),
        body: string('需求正文'),
        acceptanceCriteria: stringArray('验收标准列表', 20),
      },
      ['title', 'body'],
    ),
    readOnly: false,
    riskLabel: '协调',
    capabilities: ['plan', 'coordinate', 'analyze'],
  },
  {
    name: 'create_milestone',
    description: '在当前项目中创建里程碑。',
    parameters: object(
      {
        title: string('里程碑标题'),
        description: string('说明'),
        dueAt: integer('可选：截止时间（Unix 毫秒）'),
      },
      ['title'],
    ),
    readOnly: false,
    riskLabel: '协调',
    capabilities: ['plan', 'coordinate'],
  },
  {
    name: 'record_decision',
    description: '记录一条架构/产品决策（ADR），可标记为 accepted。用于持久化关键取舍。',
    parameters: object(
      {
        title: string('决策标题'),
        body: string('背景、备选方案、结论与影响'),
        status: string('决策状态', { enum: ['proposed', 'accepted'] }),
      },
      ['title', 'body'],
    ),
    readOnly: false,
    riskLabel: '协调',
    capabilities: ['architect', 'plan', 'coordinate'],
  },
  {
    name: 'create_artifact',
    description: '记录一个交付物（设计、代码说明、测试报告、审查结论等）。必须描述真实产物，不得伪造结果。',
    parameters: object(
      {
        title: string('交付物标题'),
        kind: string('交付物类型', {
          enum: ['document', 'code', 'test-report', 'diff', 'design', 'release-note', 'other'],
        }),
        body: string('交付物正文或摘要'),
        uri: string('可选：关联文件路径或外部地址'),
      },
      ['title', 'body'],
    ),
    readOnly: false,
    riskLabel: '协调',
    capabilities: ['plan', 'analyze', 'architect', 'implement', 'review', 'test', 'coordinate'],
  },
  {
    name: 'search_knowledge',
    description: '在项目知识库中检索与查询相关的条目。只读。',
    parameters: object({ query: string('检索关键词') }, ['query']),
    readOnly: true,
    riskLabel: '只读',
    capabilities: ['plan', 'analyze', 'architect', 'implement', 'review', 'test', 'research', 'coordinate'],
  },
  {
    name: 'send_agent_message',
    description:
      '向同一项目中的另一个 Agent 会话发送持久化消息（可唤醒对方）。消息是至少一次投递，使用幂等键去重。',
    parameters: object(
      {
        toSessionId: string('接收方会话 id'),
        body: string('消息正文'),
        type: string('消息类型', { enum: ['agent.message', 'task.delegate', 'task.result', 'agent.wake'] }),
      },
      ['toSessionId', 'body'],
    ),
    readOnly: false,
    riskLabel: '协调',
    capabilities: ['plan', 'analyze', 'architect', 'implement', 'review', 'test', 'coordinate'],
  },
  {
    name: 'handoff_task',
    description: '把当前任务结构化交接给另一个 Agent。接收方接受后才视为交接完成。',
    parameters: object(
      {
        toAgentId: string('接收方 Agent id'),
        summary: string('交接摘要：已完成、未完成、风险、下一步'),
        taskId: string('可选：任务 id，省略时使用当前任务'),
      },
      ['toAgentId', 'summary'],
    ),
    readOnly: false,
    riskLabel: '协调',
    capabilities: ['plan', 'analyze', 'architect', 'implement', 'review', 'test', 'coordinate'],
  },
]

const BY_NAME = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]))

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return BY_NAME.get(name)
}

export function toolsForCapabilities(capabilities: AgentCapability[]): ToolDefinition[] {
  return TOOL_DEFINITIONS.filter((tool) =>
    tool.capabilities.some((capability) => capabilities.includes(capability)),
  )
}

export function toolCatalogForAgent(capabilities: AgentCapability[]): LlmToolDefinition[] {
  return toolsForCapabilities(capabilities).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

export function toolCatalogPrompt(capabilities: AgentCapability[]): string {
  return toolsForCapabilities(capabilities)
    .map((tool) => `- ${tool.name}（${tool.riskLabel}）：${tool.description}`)
    .join('\n')
}
