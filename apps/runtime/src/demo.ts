import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  newId,
  now,
  STAGE_KEYS,
  type Artifact,
  type Decision,
  type Milestone,
  type Project,
  type ProjectStage,
  type Requirement,
  type Run,
  type RunStepKind,
  type Session,
  type Task,
  type TaskStatus,
} from '@projectos/contracts'
import { buildEnvelope } from '@projectos/collaboration'
import { PROJECT_EVENT_TYPES } from '@projectos/domain'
import type { SqliteStore } from '@projectos/persistence'
import {
  ensureProjectRoot,
  initGitRepository,
  writeTextFile,
} from '@projectos/workspace'

const DAY = 86_400_000
const HOUR = 3_600_000
const execFileAsync = promisify(execFile)

const DEMO_NAME = 'Aurora Notes · 示例项目'

const FILES: Record<string, string> = {
  'README.md': `# Aurora Notes

本地优先的 Markdown 笔记应用。这个项目由 ProjectOS 示例数据创建，用于展示完整生命周期：需求、架构决策、任务、Agent 会话、交付物与交接。

## 开发

\`\`\`bash
node --version
git status
\`\`\`

## 设计原则

1. 本地数据优先，默认不联网。
2. 编辑器与存储解耦，SQLite 作为本地索引。
3. 所有变更可审计、可恢复。
`,
  'AGENTS.md': `# Aurora Notes 项目规则

- 修改代码前先阅读对应模块与测试。
- 不引入未经评估的网络依赖。
- 索引变更必须附带可重复的测试。
- 架构取舍记录在 docs/adr/。
- 不在客户端存储明文凭据。
`,
  'package.json': JSON.stringify(
    {
      name: 'aurora-notes',
      version: '0.3.0',
      private: true,
      type: 'module',
      scripts: {
        test: 'node --test tests/*.test.ts',
        typecheck: 'tsc --noEmit',
      },
    },
    null,
    2,
  ),
  'src/notes.ts': `export interface Note {
  id: string
  title: string
  body: string
  updatedAt: number
  links: string[]
}

export function createNote(title: string, body: string): Note {
  return {
    id: crypto.randomUUID(),
    title,
    body,
    updatedAt: Date.now(),
    links: extractWikiLinks(body),
  }
}

export function extractWikiLinks(body: string): string[] {
  return [...body.matchAll(/\\[\\[([^\\]]+)\\]\\]/g)].map((match) => match[1]!.trim())
}
`,
  'src/search.ts': `import type { Note } from './notes.ts'

export interface SearchHit {
  noteId: string
  score: number
  excerpt: string
}

export function searchNotes(notes: Note[], query: string): SearchHit[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const hits: SearchHit[] = []
  for (const note of notes) {
    const haystack = \`\${note.title}\\n\${note.body}\`.toLowerCase()
    const index = haystack.indexOf(normalized)
    if (index < 0) continue
    const titleBoost = note.title.toLowerCase().includes(normalized) ? 2 : 0
    hits.push({
      noteId: note.id,
      score: titleBoost + (index === 0 ? 1 : 0.5),
      excerpt: note.body.slice(Math.max(0, index - 40), index + normalized.length + 80),
    })
  }
  return hits.sort((a, b) => b.score - a.score)
}
`,
  'src/graph.ts': `import type { Note } from './notes.ts'

export interface GraphNode {
  id: string
  label: string
  degree: number
}

export interface GraphEdge {
  source: string
  target: string
}

export function buildGraph(notes: Note[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const byTitle = new Map(notes.map((note) => [note.title, note]))
  const edges: GraphEdge[] = []
  for (const note of notes) {
    for (const link of note.links) {
      const target = byTitle.get(link)
      if (target) edges.push({ source: note.id, target: target.id })
    }
  }
  const degree = new Map<string, number>()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  return {
    nodes: notes.map((note) => ({ id: note.id, label: note.title, degree: degree.get(note.id) ?? 0 })),
    edges,
  }
}
`,
  'tests/search.test.ts': `import assert from 'node:assert/strict'
import test from 'node:test'
import { createNote } from '../src/notes.ts'
import { searchNotes } from '../src/search.ts'

test('search ranks title matches above body matches', () => {
  const notes = [
    createNote('SQLite 索引', '本地存储与恢复'),
    createNote('同步设计', 'SQLite 索引的增量更新'),
  ]
  const hits = searchNotes(notes, 'sqlite')
  assert.equal(hits.length, 2)
  assert.equal(hits[0]?.noteId, notes[0]?.id)
})

test('blank query returns no hits', () => {
  assert.deepEqual(searchNotes([createNote('a', 'b')], '   '), [])
})
`,
  'docs/PRD.md': `# 产品需求：Aurora Notes

## 目标

为个人知识工作者提供一款离线可用、可追溯、可扩展的 Markdown 笔记工具。

## 核心场景

1. 快速记录与全文检索。
2. 通过双向链接形成知识图谱。
3. 在多设备之间安全同步，不泄露明文。

## 非目标

- 多人实时协同编辑。
- 插件市场。
- 移动端原生应用（M3 前不投入）。

## 验收基线

- 冷启动 500ms 内可编辑。
- 10,000 篇笔记的全文搜索 P95 < 150ms。
- 崩溃后最近 30 秒内的编辑不丢失。
`,
  'docs/adr/ADR-001-local-first.md': `# ADR-001：本地优先与 SQLite 索引

- 状态：已接受
- 日期：示例数据

## 背景

笔记数据属于用户，网络不可用是常态。云端数据库会引入账户、隐私与离线冲突问题。

## 决策

使用本地文件保存 Markdown 正文，SQLite 保存索引、元数据与恢复日志。默认不上传任何内容；未来同步作为可选能力。

## 影响

- 需要设计索引重建与迁移机制。
- 多设备同步必须单独解决冲突，不阻塞本地编辑。
- 备份即复制工作区，降低数据锁定风险。
`,
  '.gitignore': `node_modules/
dist/
*.log
.DS_Store
`,
}

function hoursAgo(hours: number): number {
  return now() - hours * HOUR
}

function daysAgo(days: number): number {
  return now() - days * DAY
}

function daysFromNow(days: number): number {
  return now() + days * DAY
}

export interface SeedDemoOptions {
  store: SqliteStore
  dataDir: string
  force?: boolean
}

export interface SeedDemoResult {
  projectId: string
  projectName: string
  created: boolean
}

export async function seedDemo(options: SeedDemoOptions): Promise<SeedDemoResult> {
  const { store, dataDir } = options
  const existing = store.read.listProjects(true).find((project) => project.isDemo)
  if (existing && !options.force) {
    return { projectId: existing.id, projectName: existing.name, created: false }
  }
  if (existing && options.force) {
    store.deleteProject(existing.id)
  }

  const rootPath = ensureProjectRoot(join(dataDir, 'demo', 'aurora-notes'), true)
  for (const [path, content] of Object.entries(FILES)) {
    writeTextFile(rootPath, path, content)
  }
  try {
    await initGitRepository(rootPath)
    await execFileAsync('git', ['-C', rootPath, 'add', '-A'], { windowsHide: true })
    await execFileAsync(
      'git',
      [
        '-C',
        rootPath,
        '-c',
        'user.name=ProjectOS Demo',
        '-c',
        'user.email=demo@projectos.local',
        'commit',
        '-m',
        'chore: initial Aurora Notes demo',
      ],
      { windowsHide: true },
    )
    // Leave a real modification + untracked file so the workspace Git view has something to show.
    const searchSource = FILES['src/search.ts'] ?? ''
    writeTextFile(
      rootPath,
      'src/search.ts',
      `${searchSource}\n// TODO(M2): tune excerpt truncation for very long notes.\n`,
    )
    writeTextFile(
      rootPath,
      'docs/IDEAS.md',
      `# 待评估想法\n\n- 笔记标签自动聚类\n- 图谱按时间衰减\n- 搜索结果本地缓存\n`,
    )
  } catch {
    // A demo project does not require Git; the workspace view gracefully handles its absence.
  }

  const projectId = newId('prj')
  const createdAt = daysAgo(14)
  const project: Project = {
    id: projectId,
    name: DEMO_NAME,
    description:
      '本地优先的 Markdown 笔记应用。用真实工作区展示需求、架构、任务、Agent 会话、审批、交付物与跨会话交接的完整生命周期。',
    rootPath,
    status: 'active',
    currentStage: 'implementation',
    version: 4,
    isDemo: true,
    createdAt,
    updatedAt: hoursAgo(1),
  }
  const stageStatus: Record<string, 'completed' | 'active' | 'pending'> = {
    ideation: 'completed',
    requirements: 'completed',
    architecture: 'completed',
    planning: 'completed',
    implementation: 'active',
    testing: 'pending',
    release: 'pending',
    maintenance: 'pending',
  }
  const stages: ProjectStage[] = STAGE_KEYS.map((stage, index) => ({
    projectId,
    stage,
    status: stageStatus[stage] ?? 'pending',
    position: index,
    updatedAt: createdAt + index * 1000,
  }))

  const agentProduct = 'agt_product'
  const agentArchitect = 'agt_architect'
  const agentEngineer = 'agt_engineer'
  const agentReviewer = 'agt_reviewer'
  const agentQa = 'agt_qa'

  store.transaction(() => {
    store.createProject(project, stages)
    store.appendEvent(projectId, projectId, PROJECT_EVENT_TYPES.projectCreated, {
      title: project.name,
      actorName: '示例数据',
    })
    store.appendEvent(projectId, projectId, PROJECT_EVENT_TYPES.stageAdvanced, {
      stage: 'implementation',
      stageLabel: '实现',
      actorName: 'Avery',
    })

    const requirementA = newId('req')
    const requirementB = newId('req')
    const requirementC = newId('req')
    const requirements: Requirement[] = [
      {
        id: requirementA,
        projectId,
        title: '本地优先的 Markdown 编辑与自动保存',
        body: '用户可以在离线状态下创建、编辑、搜索笔记；关闭窗口后重新打开，内容与光标位置可恢复。',
        status: 'approved',
        source: '示例需求',
        acceptanceCriteria: [
          '断网状态下可创建与编辑笔记',
          '重启应用后最近编辑内容不丢失',
          '10,000 篇笔记下搜索 P95 小于 150ms',
        ],
        version: 3,
        createdAt: daysAgo(13),
        updatedAt: daysAgo(10),
      },
      {
        id: requirementB,
        projectId,
        title: '双向链接与知识图谱',
        body: '使用 [[笔记标题]] 建立链接，自动生成反向链接与局部图谱。',
        status: 'review',
        source: '示例需求',
        acceptanceCriteria: ['链接可点击跳转', '反向链接随正文更新', '图谱支持按度数过滤'],
        version: 1,
        createdAt: daysAgo(8),
        updatedAt: daysAgo(2),
      },
      {
        id: requirementC,
        projectId,
        title: '端到端加密的跨设备同步',
        body: '在不可信网络中同步笔记，服务端不可读取明文。',
        status: 'draft',
        source: '示例需求',
        acceptanceCriteria: ['密钥不离开设备', '冲突可人工合并', '同步失败可恢复'],
        version: 0,
        createdAt: daysAgo(3),
        updatedAt: daysAgo(3),
      },
    ]
    for (const requirement of requirements) {
      store.createRequirement(requirement)
      store.appendEvent(projectId, requirement.id, PROJECT_EVENT_TYPES.requirementCreated, {
        title: requirement.title,
        status: requirement.status,
        actorName: 'Avery',
      })
    }

    const milestoneA = newId('mil')
    const milestoneB = newId('mil')
    const milestoneC = newId('mil')
    const milestones: Milestone[] = [
      {
        id: milestoneA,
        projectId,
        title: 'M1 · 本地编辑核心',
        description: '编辑器、自动保存、SQLite 索引与恢复。',
        dueAt: daysAgo(4),
        status: 'completed',
        createdAt: daysAgo(14),
        updatedAt: daysAgo(4),
      },
      {
        id: milestoneB,
        projectId,
        title: 'M2 · 图谱与搜索',
        description: '全文搜索、反向链接、局部图谱与命令面板。',
        dueAt: daysFromNow(12),
        status: 'active',
        createdAt: daysAgo(9),
        updatedAt: daysAgo(1),
      },
      {
        id: milestoneC,
        projectId,
        title: 'M3 · 加密同步',
        description: '端到端加密、冲突合并与迁移指南。',
        dueAt: daysFromNow(40),
        status: 'planned',
        createdAt: daysAgo(5),
        updatedAt: daysAgo(5),
      },
    ]
    for (const milestone of milestones) {
      store.createMilestone(milestone)
      store.appendEvent(projectId, milestone.id, PROJECT_EVENT_TYPES.milestoneCreated, {
        title: milestone.title,
        actorName: 'Avery',
      })
    }

    const decisionA = newId('dec')
    const decisionB = newId('dec')
    const decisions: Decision[] = [
      {
        id: decisionA,
        projectId,
        title: 'ADR-001：本地优先与 SQLite 索引',
        body: '正文保存为本地 Markdown，SQLite 仅保存索引、元数据和恢复日志。同步是可选能力，不阻塞离线编辑。',
        status: 'accepted',
        supersedesId: null,
        createdAt: daysAgo(12),
        updatedAt: daysAgo(11),
      },
      {
        id: decisionB,
        projectId,
        title: 'ADR-002：同步采用密钥派生 + 冲突副本（提议）',
        body: '计划使用设备本地密钥派生加密密钥，冲突时不自动覆盖，而是生成可合并副本。等待安全评审。',
        status: 'proposed',
        supersedesId: null,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(2),
      },
    ]
    for (const decision of decisions) {
      store.createDecision(decision)
      store.appendEvent(projectId, decision.id, PROJECT_EVENT_TYPES.decisionCreated, {
        title: decision.title,
        status: decision.status,
        actorName: 'Sage',
      })
    }

    const taskIds: Record<string, string> = {}
    const makeTask = (input: {
      key: string
      title: string
      description: string
      status: TaskStatus
      priority: 1 | 2 | 3 | 4
      assignee: string
      acceptance: string[]
      labels: string[]
      milestoneId: string
      deps?: string[]
      createdDaysAgo: number
      updatedHoursAgo: number
      version: number
      dueInDays?: number
    }): Task => {
      const id = newId('tsk')
      taskIds[input.key] = id
      const task: Task = {
        id,
        projectId,
        parentId: null,
        milestoneId: input.milestoneId,
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        assigneeAgentId: input.assignee,
        acceptanceCriteria: input.acceptance,
        labels: input.labels,
        version: input.version,
        dueAt: input.dueInDays === undefined ? null : daysFromNow(input.dueInDays),
        createdAt: daysAgo(input.createdDaysAgo),
        updatedAt: hoursAgo(input.updatedHoursAgo),
      }
      store.createTask(
        task,
        (input.deps ?? []).map((key) => taskIds[key]!).filter(Boolean),
      )
      store.appendEvent(projectId, id, PROJECT_EVENT_TYPES.taskCreated, {
        title: task.title,
        taskTitle: task.title,
        status: task.status,
        priority: task.priority,
        actorName: 'Avery',
      })
      if (input.status !== 'backlog') {
        store.appendEvent(projectId, id, PROJECT_EVENT_TYPES.taskMoved, {
          taskTitle: task.title,
          status: task.status,
          actorName: task.assigneeAgentId === agentQa ? 'Iris' : 'Kai',
        })
      }
      return task
    }

    makeTask({
      key: 'scaffold',
      title: '搭建本地优先的编辑器与构建脚手架',
      description: '建立 TypeScript + Vite 工程，接入本地存储抽象与基础编辑器。',
      status: 'done',
      priority: 1,
      assignee: agentEngineer,
      acceptance: ['工程可启动', '编辑器可输入并保存到本地', 'CI 类型检查通过'],
      labels: ['infra'],
      milestoneId: milestoneA,
      createdDaysAgo: 14,
      updatedHoursAgo: 24 * 8,
      version: 4,
    })
    makeTask({
      key: 'editor',
      title: '实现 Markdown 编辑、自动保存与本地存储',
      description: '编辑体验、自动保存节流、崩溃恢复与本地文件结构。',
      status: 'done',
      priority: 1,
      assignee: agentEngineer,
      acceptance: ['输入 2 秒内自动保存', '异常退出后恢复未保存内容', '文件结构可人工阅读'],
      labels: ['core'],
      milestoneId: milestoneA,
      deps: ['scaffold'],
      createdDaysAgo: 13,
      updatedHoursAgo: 24 * 5,
      version: 6,
    })
    makeTask({
      key: 'index',
      title: '建立 SQLite 全文索引与启动恢复',
      description: '为笔记建立 FTS 索引，启动时校验并修复索引与正文的一致性。',
      status: 'done',
      priority: 1,
      assignee: agentEngineer,
      acceptance: ['10k 笔记索引可重建', '启动恢复不丢数据', '索引损坏时安全降级'],
      labels: ['storage'],
      milestoneId: milestoneA,
      deps: ['editor'],
      createdDaysAgo: 10,
      updatedHoursAgo: 24 * 4,
      version: 3,
    })
    makeTask({
      key: 'pwa',
      title: '移动端 PWA 原型',
      description: '探索移动端离线编辑的交互方式，不进入 M2 范围。',
      status: 'cancelled',
      priority: 4,
      assignee: agentProduct,
      acceptance: ['原型可在手机浏览器打开'],
      labels: ['explore'],
      milestoneId: milestoneA,
      createdDaysAgo: 9,
      updatedHoursAgo: 24 * 6,
      version: 1,
    })
    makeTask({
      key: 'search',
      title: '本地全文搜索与结果排序',
      description: '搜索标题与正文，标题命中加权，支持摘要高亮与空查询。',
      status: 'review',
      priority: 2,
      assignee: agentEngineer,
      acceptance: ['标题命中排在正文命中前', '空查询返回空结果', '搜索结果 50 条内可键盘导航'],
      labels: ['search'],
      milestoneId: milestoneB,
      deps: ['index'],
      createdDaysAgo: 6,
      updatedHoursAgo: 20,
      version: 5,
    })
    makeTask({
      key: 'graph',
      title: '笔记图谱视图与反向链接索引',
      description: '基于 [[标题]] 构建链接图，展示局部图谱和反向链接；需要写入新的图索引模块。',
      status: 'running',
      priority: 1,
      assignee: agentEngineer,
      acceptance: ['反向链接实时更新', '图谱节点可跳转', '1000 节点内交互流畅'],
      labels: ['graph'],
      milestoneId: milestoneB,
      deps: ['index'],
      createdDaysAgo: 5,
      updatedHoursAgo: 2,
      version: 2,
      dueInDays: 5,
    })
    makeTask({
      key: 'palette',
      title: '命令面板与快捷键体系',
      description: '统一搜索、跳转、创建笔记和切换主题的命令入口。',
      status: 'review',
      priority: 2,
      assignee: agentEngineer,
      acceptance: ['Cmd/Ctrl+K 打开命令面板', '键盘可完成跳转', '无焦点陷阱'],
      labels: ['ux'],
      milestoneId: milestoneB,
      deps: ['index'],
      createdDaysAgo: 4,
      updatedHoursAgo: 8,
      version: 3,
    })
    makeTask({
      key: 'search-tests',
      title: '补充搜索排序的边界测试',
      description: '覆盖空查询、特殊字符、超长查询和 Unicode 标题。',
      status: 'ready',
      priority: 2,
      assignee: agentQa,
      acceptance: ['覆盖 4 类边界', '失败时给出最小复现', '测试运行时间小于 30 秒'],
      labels: ['test'],
      milestoneId: milestoneB,
      deps: ['search'],
      createdDaysAgo: 2,
      updatedHoursAgo: 30,
      version: 0,
      dueInDays: 3,
    })
    makeTask({
      key: 'incremental',
      title: '反向链接索引的增量更新',
      description: '正文变更时只更新相关链接，避免全量重建。',
      status: 'ready',
      priority: 3,
      assignee: agentEngineer,
      acceptance: ['单次编辑只更新受影响节点', '索引与正文最终一致'],
      labels: ['graph', 'performance'],
      milestoneId: milestoneB,
      deps: ['graph', 'index'],
      createdDaysAgo: 1,
      updatedHoursAgo: 20,
      version: 0,
      dueInDays: 6,
    })
    makeTask({
      key: 'sync-design',
      title: '设计同步冲突合并策略',
      description: '评估 CRDT、操作日志与冲突副本三种方案，输出 ADR。',
      status: 'backlog',
      priority: 2,
      assignee: agentArchitect,
      acceptance: ['给出至少两种方案取舍', '记录失败与回滚策略', '安全评审通过'],
      labels: ['design', 'sync'],
      milestoneId: milestoneC,
      createdDaysAgo: 1,
      updatedHoursAgo: 24,
      version: 0,
    })
    makeTask({
      key: 'import-export',
      title: 'Markdown 批量导入导出',
      description: '支持目录导入、Front Matter 保留与导出冲突提示。',
      status: 'backlog',
      priority: 3,
      assignee: agentEngineer,
      acceptance: ['目录导入不覆盖已有笔记', 'Front Matter 往返一致'],
      labels: ['import'],
      milestoneId: milestoneC,
      createdDaysAgo: 1,
      updatedHoursAgo: 24,
      version: 0,
    })
    makeTask({
      key: 'sync-prototype',
      title: '跨设备同步原型（加密通道）',
      description: '验证设备配对与加密传输；测试在 Windows 上失败，等待安全评审。',
      status: 'blocked',
      priority: 2,
      assignee: agentEngineer,
      acceptance: ['两台设备可配对', '传输内容不可被服务端读取', '断线后可恢复'],
      labels: ['sync', 'security'],
      milestoneId: milestoneC,
      createdDaysAgo: 3,
      updatedHoursAgo: 24,
      version: 1,
    })
    makeTask({
      key: 'release-notes',
      title: '发布说明与迁移指南',
      description: '整理 M2 变更、已知问题与索引迁移步骤。',
      status: 'backlog',
      priority: 3,
      assignee: agentProduct,
      acceptance: ['覆盖全部变更', '包含回滚步骤'],
      labels: ['release'],
      milestoneId: milestoneB,
      createdDaysAgo: 1,
      updatedHoursAgo: 18,
      version: 0,
    })

    const artifactData: Array<{
      taskKey?: string
      kind: Artifact['kind']
      title: string
      body: string
      verified: boolean
      daysAgo: number
    }> = [
      {
        kind: 'document',
        title: '产品需求文档 · Aurora Notes',
        body: '目标、场景、非目标与验收基线。详见工作区 docs/PRD.md。',
        verified: true,
        daysAgo: 12,
      },
      {
        kind: 'design',
        title: 'ADR-001 · 本地优先与 SQLite 索引',
        body: '已接受：正文保存在本地 Markdown，SQLite 只保存索引与元数据。',
        verified: true,
        daysAgo: 11,
      },
      {
        taskKey: 'scaffold',
        kind: 'code',
        title: '工程脚手架与构建配置',
        body: 'TypeScript strict、Vite 构建、基础目录结构与测试脚本。',
        verified: true,
        daysAgo: 8,
      },
      {
        taskKey: 'search',
        kind: 'test-report',
        title: '全文搜索测试报告',
        body: '8 个用例通过，覆盖标题加权、空查询与 Unicode。命令：pnpm test（示例记录）。',
        verified: true,
        daysAgo: 2,
      },
      {
        taskKey: 'search',
        kind: 'document',
        title: '搜索实现审查报告',
        body: '阻塞项 0，建议项 2：补充超长查询测试；抽取 excerpt 截断工具。',
        verified: false,
        daysAgo: 1,
      },
      {
        taskKey: 'graph',
        kind: 'design',
        title: '图谱视图交互草图',
        body: '局部图谱以当前笔记为中心，两跳内展开；节点点击跳转，边显示链接方向。',
        verified: false,
        daysAgo: 1,
      },
    ]
    for (const artifact of artifactData) {
      const record: Artifact = {
        id: newId('art'),
        projectId,
        taskId: artifact.taskKey ? taskIds[artifact.taskKey]! : null,
        runId: null,
        kind: artifact.kind,
        title: artifact.title,
        uri: null,
        contentHash: null,
        gitCommit: null,
        verifiedAt: artifact.verified ? hoursAgo(artifact.daysAgo * 24) : null,
        body: artifact.body,
        isDemo: true,
        createdAt: hoursAgo(artifact.daysAgo * 24),
      }
      store.createArtifact(record)
      store.appendEvent(projectId, record.id, PROJECT_EVENT_TYPES.artifactCreated, {
        title: record.title,
        kind: record.kind,
        taskId: record.taskId,
        actorName: 'ProjectOS',
      })
    }

    const sessionProduct = newId('ses')
    const sessionEngineer = newId('ses')
    const sessionReviewer = newId('ses')
    const sessionQa = newId('ses')
    const sessionSync = newId('ses')
    const sessions: Session[] = [
      {
        id: sessionProduct,
        projectId,
        agentId: agentProduct,
        title: 'Avery · 项目启动与范围',
        status: 'active',
        createdAt: daysAgo(14),
        updatedAt: hoursAgo(20),
      },
      {
        id: sessionEngineer,
        projectId,
        agentId: agentEngineer,
        title: 'Kai · 图谱视图实现',
        status: 'active',
        createdAt: daysAgo(5),
        updatedAt: hoursAgo(1),
      },
      {
        id: sessionReviewer,
        projectId,
        agentId: agentReviewer,
        title: 'Nova · 搜索实现审查',
        status: 'idle',
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1),
      },
      {
        id: sessionQa,
        projectId,
        agentId: agentQa,
        title: 'Iris · 搜索验收测试',
        status: 'active',
        createdAt: daysAgo(2),
        updatedAt: hoursAgo(5),
      },
      {
        id: sessionSync,
        projectId,
        agentId: agentEngineer,
        title: 'Kai · 同步协议实验',
        status: 'idle',
        createdAt: daysAgo(3),
        updatedAt: daysAgo(2),
      },
    ]
    for (const session of sessions) {
      store.createSession(session)
      store.appendEvent(projectId, session.id, PROJECT_EVENT_TYPES.sessionCreated, {
        title: session.title,
        actorName: session.id === sessionProduct ? 'Avery' : 'Kai',
      })
    }

    const addMessage = (
      sessionId: string,
      role: 'user' | 'assistant' | 'system',
      content: string,
      createdAt: number,
      extra: Record<string, unknown> = {},
    ) => {
      store.appendMessage({
        sessionId,
        role,
        content,
        metadata: extra,
        createdAt,
      })
    }
    addMessage(
      sessionProduct,
      'system',
      '项目已创建。先描述目标与约束，Avery 会协助拆解需求、里程碑与任务。',
      daysAgo(14),
    )
    addMessage(
      sessionProduct,
      'user',
      '我们要做一个本地优先的 Markdown 笔记应用，先聚焦离线编辑、全文搜索和双向链接。同步放到后面，但数据模型要留出空间。',
      daysAgo(12),
    )
    addMessage(
      sessionProduct,
      'assistant',
      `已把目标拆成三个里程碑：\n\n1. **M1 本地编辑核心**：编辑器、自动保存、SQLite 索引与崩溃恢复。\n2. **M2 图谱与搜索**：全文搜索、反向链接、局部图谱、命令面板。\n3. **M3 加密同步**：设备配对、冲突副本与迁移指南。\n\nM1 验收基线是断网可编辑、重启不丢 30 秒内的编辑、10k 笔记搜索 P95 < 150ms。已创建需求与 9 个可验收任务；同步仅保留数据边界，不在本阶段实现。`,
      daysAgo(12),
    )
    addMessage(
      sessionEngineer,
      'user',
      '开始实现图谱视图。先检查现有索引与笔记链接解析，再决定是否复用 search 模块。',
      daysAgo(3),
    )
    addMessage(
      sessionEngineer,
      'assistant',
      '已阅读 src/notes.ts 与 src/search.ts。链接解析在 extractWikiLinks，索引目前是全文 FTS。图谱需要新增 src/graph.ts，并写入反向链接索引文件。写入前需要授权。',
      hoursAgo(2),
    )
    addMessage(
      sessionReviewer,
      'user',
      '请审查全文搜索实现，重点看排序稳定性、空查询与 Unicode 处理。',
      daysAgo(2),
    )
    addMessage(
      sessionReviewer,
      'assistant',
      '审查完成：阻塞项 0。标题加权逻辑正确；空查询已提前返回。建议补充：\n\n- 超长查询（> 512 字符）的截断策略；\n- 组合 emoji 的索引一致性；\n- excerpt 在超大正文下的性能。\n\n已生成审查报告交付物。',
      daysAgo(1),
    )
    addMessage(
      sessionQa,
      'user',
      '交接：请验收「本地全文搜索与结果排序」，重点覆盖 10k 笔记与慢磁盘场景。',
      daysAgo(2),
    )
    addMessage(
      sessionQa,
      'system',
      '已接受来自 Kai 的任务交接「本地全文搜索与结果排序」。',
      daysAgo(2),
    )
    addMessage(
      sessionSync,
      'user',
      '验证加密通道原型，先跑现有测试，再检查 Windows 路径处理。',
      daysAgo(3),
    )
    addMessage(
      sessionSync,
      'assistant',
      '测试失败：Windows 路径规范化用例期望 `notes\\a.md`，实际为 `notes/a.md`。已停止执行，等待人工确认是否统一为正斜杠。',
      daysAgo(2),
    )

    const addRun = (input: {
      taskId: string
      sessionId: string
      agentId: string
      attempt: number
      status: Run['status']
      summary?: string
      error?: string
      startedAt: number
      finishedAt?: number | null
      steps: Array<{ kind: RunStepKind; title: string; payload: Record<string, unknown>; status?: string }>
    }): Run => {
      const run: Run = {
        id: newId('run'),
        projectId,
        taskId: input.taskId,
        sessionId: input.sessionId,
        agentId: input.agentId,
        attempt: input.attempt,
        status: input.status,
        error: input.error ?? null,
        summary: input.summary ?? null,
        inputTokens: input.status === 'completed' ? 4820 : 2100,
        outputTokens: input.status === 'completed' ? 960 : 380,
        checkpointId: null,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt ?? null,
        createdAt: input.startedAt,
      }
      store.createRun(run)
      for (const step of input.steps) {
        store.appendRunStep({
          runId: run.id,
          kind: step.kind,
          title: step.title,
          payload: step.payload,
          status: step.status,
        })
      }
      store.appendEvent(projectId, run.id, PROJECT_EVENT_TYPES.runStarted, {
        title: input.summary?.slice(0, 80) ?? 'Agent 运行',
        status: input.status,
        runId: run.id,
        sessionId: input.sessionId,
        taskId: input.taskId,
        actorName: 'ProjectOS Demo',
      })
      return run
    }

    const completedRun = addRun({
      taskId: taskIds.search!,
      sessionId: sessionReviewer,
      agentId: agentReviewer,
      attempt: 1,
      status: 'completed',
      summary:
        '审查完成：没有阻塞项。标题加权排序正确，空查询已提前返回；建议补充超长查询与组合 emoji 的边界测试。',
      startedAt: daysAgo(1.2),
      finishedAt: daysAgo(1.1),
      steps: [
        { kind: 'status', title: '运行开始', payload: { status: 'running' } },
        { kind: 'context', title: '上下文组装完成', payload: { chars: 11840, sources: 6, truncated: false } },
        {
          kind: 'text',
          title: 'Agent 输出',
          payload: {
            content:
              '审查完成：没有阻塞项。标题加权排序正确，空查询已提前返回；建议补充超长查询与组合 emoji 的边界测试。',
            final: true,
            role: 'assistant',
          },
        },
        { kind: 'tool_request', title: '工具请求：git_diff', payload: { name: 'git_diff' } },
        { kind: 'tool_result', title: '工具结果：git_diff', payload: { name: 'git_diff', ok: true } },
        { kind: 'status', title: '状态：completed', payload: { status: 'completed' } },
      ],
    })
    store.appendEvent(projectId, completedRun.id, PROJECT_EVENT_TYPES.runCompleted, {
      status: 'completed',
      runId: completedRun.id,
      sessionId: sessionReviewer,
      taskId: taskIds.search,
    })

    const waitingRun = addRun({
      taskId: taskIds.graph!,
      sessionId: sessionEngineer,
      agentId: agentEngineer,
      attempt: 1,
      status: 'waiting_approval',
      startedAt: hoursAgo(2),
      steps: [
        { kind: 'status', title: '运行开始', payload: { status: 'running' } },
        {
          kind: 'context',
          title: '上下文组装完成',
          payload: { chars: 20140, sources: 9, truncated: false, skillIds: ['skill-developer'] },
        },
        {
          kind: 'text',
          title: 'Agent 输出',
          payload: {
            content:
              '已定位到 src/notes.ts 的链接解析与 src/search.ts 的索引写入路径。图谱视图需要新增 src/graph.ts，并在笔记保存时更新反向链接索引。下面创建文件；该操作需要你的授权。',
            final: true,
            role: 'assistant',
            toolCalls: [
              {
                id: 'call_graph_write',
                name: 'write_file',
                arguments: JSON.stringify({
                  path: 'src/graph.ts',
                  content:
                    "import type { Note } from './notes.ts'\\n\\nexport interface GraphNode { id: string; label: string }\\nexport function buildGraph(notes: Note[]) {\\n  const byTitle = new Map(notes.map((note) => [note.title, note])\\n  const edges = notes.flatMap((note) => note.links.flatMap((link) => {\\n    const target = byTitle.get(link)\\n    return target ? [{ source: note.id, target: target.id }] : []\\n  }))\\n  return { nodes: notes.map((note) => ({ id: note.id, label: note.title })), edges }\\n}\\n",
                }),
              },
            ],
          },
        },
        { kind: 'tool_request', title: '工具请求：write_file', payload: { name: 'write_file', risk: 'workspace-write', policy: 'require_approval' } },
        { kind: 'approval', title: '等待授权：write_file', status: 'waiting', payload: { toolName: 'write_file' } },
        { kind: 'status', title: '状态：waiting_approval', payload: { status: 'waiting_approval' } },
      ],
    })
    const waitingToolCall = store.createToolCall({
      runId: waitingRun.id,
      toolName: 'write_file',
      idempotencyKey: `${waitingRun.id}:call_graph_write`,
      status: 'waiting_approval',
      argsHash: 'demo',
      args: {
        path: 'src/graph.ts',
        content:
          "import type { Note } from './notes.ts'\n\nexport interface GraphNode { id: string; label: string }\nexport function buildGraph(notes: Note[]) {\n  const byTitle = new Map(notes.map((note) => [note.title, note])\n  const edges = notes.flatMap((note) => note.links.flatMap((link) => {\n    const target = byTitle.get(link)\n    return target ? [{ source: note.id, target: target.id }] : []\n  }))\n  return { nodes: notes.map((note) => ({ id: note.id, label: note.title })), edges }\n}\n",
      },
    })
    store.createApproval({
      projectId,
      runId: waitingRun.id,
      toolCallId: waitingToolCall.id,
      title: '授权 write_file',
      detail:
        'Agent 请求写入文件：src/graph.ts\n\n内容长度：约 420 字符\n\n任务：笔记图谱视图与反向链接索引',
      request: {
        toolName: 'write_file',
        args: { path: 'src/graph.ts' },
        risk: 'workspace-write',
        reason: '修改项目文件需要人工授权',
      },
      expiresAt: now() + 30 * 60 * 1000,
    })
    const pendingApproval = store.read.listApprovalViews(projectId).find(
      (approval) => approval.runId === waitingRun.id && approval.status === 'pending',
    )
    store.appendEvent(projectId, pendingApproval?.id ?? waitingRun.id, PROJECT_EVENT_TYPES.approvalRequested, {
      approvalId: pendingApproval?.id ?? null,
      runId: waitingRun.id,
      sessionId: sessionEngineer,
      toolName: 'write_file',
      taskId: taskIds.graph,
    })

    const failedRun = addRun({
      taskId: taskIds['sync-prototype']!,
      sessionId: sessionSync,
      agentId: agentEngineer,
      attempt: 2,
      status: 'failed',
      error: '测试失败：Windows 路径规范化用例不通过（expected notes\\\\a.md, got notes/a.md）',
      startedAt: daysAgo(2.1),
      finishedAt: daysAgo(2),
      steps: [
        { kind: 'status', title: '运行开始', payload: { status: 'running' } },
        { kind: 'text', title: 'Agent 输出', payload: { content: '先运行测试确认当前基线。', final: true, role: 'assistant' } },
        { kind: 'tool_request', title: '工具请求：run_tests', payload: { name: 'run_tests', policy: 'require_approval' } },
        { kind: 'tool_result', title: '工具结果：run_tests', payload: { ok: false } },
        { kind: 'error', title: '运行失败', payload: { error: '测试失败：Windows 路径规范化用例不通过' } },
        { kind: 'status', title: '状态：failed', payload: { status: 'failed' } },
      ],
    })
    store.appendEvent(projectId, failedRun.id, PROJECT_EVENT_TYPES.runFailed, {
      status: 'failed',
      error: failedRun.error,
      runId: failedRun.id,
      sessionId: sessionSync,
      taskId: taskIds['sync-prototype'],
    })

    const makeInbox = (
      fromSessionId: string,
      toSessionId: string,
      taskId: string,
      type: 'task.delegate' | 'task.result' | 'handoff.request' | 'agent.message',
      body: string,
      status: 'delivered' | 'accepted' | 'completed',
    ) => {
      const from = sessions.find((session) => session.id === fromSessionId)!
      const to = sessions.find((session) => session.id === toSessionId)!
      const envelope = buildEnvelope({
        projectId,
        taskId,
        sender: { agentId: from.agentId, sessionId: from.id },
        recipient: { agentId: to.agentId, sessionId: to.id },
        type,
        body,
      })
      const inserted = store.insertInboxWithMessage({
        projectId,
        envelope,
        recipientAgentId: to.agentId,
        recipientSessionId: to.id,
      })
      if (status !== 'delivered') store.updateInboxStatus(inserted.item.id, status)
      store.appendEvent(projectId, inserted.item.id, PROJECT_EVENT_TYPES.messageDelivered, {
        inboxId: inserted.item.id,
        type,
        actorName: from.agentId === agentEngineer ? 'Kai' : 'Avery',
      })
      return inserted.item
    }
    makeInbox(
      sessionEngineer,
      sessionQa,
      taskIds.search!,
      'task.delegate',
      '请验收全文搜索排序。重点：10k 笔记、超长查询、组合 emoji。测试通过后把任务移到完成，并生成测试报告。',
      'accepted',
    )
    makeInbox(
      sessionProduct,
      sessionEngineer,
      taskIds.graph!,
      'agent.message',
      'M2 的图谱视图优先级提升，请先完成最小可用交互；写入 src/graph.ts 前记得申请授权。',
      'completed',
    )
    makeInbox(
      sessionQa,
      sessionReviewer,
      taskIds.search!,
      'task.result',
      '测试报告已生成：8 个用例通过，边界测试还缺 2 个。请复核超长查询建议。',
      'delivered',
    )

    const handoffRequested = {
      id: newId('hnd'),
      projectId,
      taskId: taskIds.search!,
      fromAgentId: agentEngineer,
      fromSessionId: sessionEngineer,
      toAgentId: agentQa,
      toSessionId: sessionQa,
      status: 'accepted' as const,
      summary:
        '搜索实现已完成并通过审查。请按验收标准补充边界测试，运行 pnpm test，并生成测试报告。已知风险：超长查询截断与组合 emoji。',
      payload: { taskTitle: '本地全文搜索与结果排序' },
      requestedAt: daysAgo(2),
      decidedAt: daysAgo(2),
    }
    store.createHandoff(handoffRequested)
    store.appendEvent(projectId, handoffRequested.id, PROJECT_EVENT_TYPES.handoffRequested, {
      title: '本地全文搜索与结果排序',
      toAgentName: 'Iris',
      actorName: 'Kai',
    })
    store.appendEvent(projectId, handoffRequested.id, PROJECT_EVENT_TYPES.handoffAccepted, {
      title: '本地全文搜索与结果排序',
      actorName: 'Iris',
    })
    store.createHandoff({
      id: newId('hnd'),
      projectId,
      taskId: taskIds['search-tests']!,
      fromAgentId: agentReviewer,
      fromSessionId: sessionReviewer,
      toAgentId: agentQa,
      toSessionId: null,
      status: 'requested',
      summary:
        '搜索排序审查完成，边界测试缺口：超长查询（>512 字符）与组合 emoji。建议由 QA 在 M2 结束前补齐。',
      payload: { taskTitle: '补充搜索排序的边界测试' },
      requestedAt: hoursAgo(6),
      decidedAt: null,
    })
    store.appendEvent(projectId, projectId, PROJECT_EVENT_TYPES.handoffRequested, {
      title: '补充搜索排序的边界测试',
      toAgentName: 'Iris',
      actorName: 'Nova',
    })

    // Spread seeded events across the project's 14-day history so the activity
    // timeline reflects a plausible chronology instead of "just now" everywhere.
    const maxSeqRow = store.db
      .prepare('SELECT MAX(seq) AS value FROM project_events WHERE project_id = ?')
      .get(projectId) as { value: number | null } | undefined
    const maxSeq = Number(maxSeqRow?.value ?? 0)
    if (maxSeq > 1) {
      const step = Math.max(1, Math.floor((14 * DAY) / (maxSeq - 1)))
      store.db
        .prepare('UPDATE project_events SET created_at = ? - (? - seq) * ? WHERE project_id = ?')
        .run(now(), maxSeq, step, projectId)
    }
  })

  return { projectId, projectName: DEMO_NAME, created: true }
}

