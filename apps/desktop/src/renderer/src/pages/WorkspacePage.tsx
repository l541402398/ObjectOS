import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App as AntApp, Button, Input, Tree, type TreeDataNode } from 'antd'
import {
  CodeOutlined,
  FileOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  ReloadOutlined,
  RightOutlined,
  SearchOutlined,
  CodeOutlined as TerminalOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import type { WorkspaceEntry } from '@projectos/contracts'
import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  PageHeader,
  StatusPill,
} from '@projectos/ui'
import { useFileContent, useGitDiff, useWorkspace } from '../lib/queries'
import { formatBytes } from '../lib/format'
import { errorMessage } from '../lib/errors'
import { useResolvedTheme } from '../stores/ui'
import '../lib/monaco'

interface TerminalEntry {
  command: string
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

function buildTree(entries: WorkspaceEntry[]): TreeDataNode[] {
  const map = new Map<string, TreeDataNode & { children: TreeDataNode[] }>()
  const roots: TreeDataNode[] = []
  const sorted = [...entries].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  for (const entry of sorted) {
    const parentPath = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : null
    const node: TreeDataNode & { children: TreeDataNode[] } = {
      key: entry.path,
      title: (
        <span className="po-tree-label">
          <span className={`po-tree-icon is-${entry.type}`}>
            {entry.type === 'directory' ? <FolderOutlined /> : <FileOutlined />}
          </span>
          <span>{entry.name}</span>
          {entry.type === 'file' && entry.size > 0 ? (
            <span className="po-tree-size">{formatBytes(entry.size)}</span>
          ) : null}
        </span>
      ),
      isLeaf: entry.type === 'file',
      children: [],
    }
    map.set(entry.path, node)
    if (parentPath && map.has(parentPath)) {
      map.get(parentPath)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  const strip = (nodes: TreeDataNode[]): TreeDataNode[] =>
    nodes.map((node) => {
      const children = (node as TreeDataNode & { children?: TreeDataNode[] }).children ?? []
      return {
        ...node,
        children: children.length > 0 ? strip(children) : undefined,
      }
    })
  return strip(roots)
}

function DiffView({ patch, truncated }: { patch: string; truncated: boolean }) {
  if (!patch.trim()) {
    return (
      <EmptyState
        compact
        icon={<SearchOutlined />}
        title="没有可显示的差异"
        description="工作区可能没有 Git 仓库，或所有变更都已提交。未跟踪文件不会出现在 git diff 中。"
      />
    )
  }
  const lines = patch.split('\n')
  return (
    <div className="po-diff">
      {truncated ? <div className="po-diff-note">差异过大，仅显示前 400KB。</div> : null}
      <pre>
        {lines.map((line, index) => (
          <span
            key={index}
            className={
              line.startsWith('+') && !line.startsWith('+++')
                ? 'is-add'
                : line.startsWith('-') && !line.startsWith('---')
                  ? 'is-remove'
                  : line.startsWith('@@')
                    ? 'is-hunk'
                    : line.startsWith('diff ') || line.startsWith('index ')
                      ? 'is-meta'
                      : ''
            }
          >
            {line || ' '}
            {'\n'}
          </span>
        ))}
      </pre>
    </div>
  )
}

export default function WorkspacePage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const queryClient = useQueryClient()
  const { message } = AntApp.useApp()
  const workspace = useWorkspace(projectId)
  const theme = useResolvedTheme()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const [bottomTab, setBottomTab] = useState<'diff' | 'terminal'>('diff')
  const [command, setCommand] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([])
  const terminalOutputRef = useRef<HTMLDivElement | null>(null)

  const file = useFileContent(projectId, selectedPath)
  const diff = useGitDiff(projectId, diffPath, bottomTab === 'diff')

  const treeData = useMemo(() => buildTree(workspace.data?.entries ?? []), [workspace.data?.entries])

  useEffect(() => {
    if (selectedPath || openTabs.length > 0) return
    const entries = workspace.data?.entries ?? []
    const readme = entries.find((entry) => entry.path === 'README.md')
    const firstFile = entries.find((entry) => entry.type === 'file')
    const target = readme ?? firstFile
    if (target) {
      setSelectedPath(target.path)
      setOpenTabs([target.path])
    }
  }, [workspace.data, openTabs.length, selectedPath])

  useEffect(() => {
    if (terminalOutputRef.current) {
      terminalOutputRef.current.scrollTop = terminalOutputRef.current.scrollHeight
    }
  }, [terminalEntries])

  const openFile = (path: string): void => {
    setSelectedPath(path)
    setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]))
  }

  const closeTab = (path: string): void => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== path)
      if (selectedPath === path) {
        setSelectedPath(next[next.length - 1] ?? null)
      }
      return next
    })
  }

  const refresh = async (): Promise<void> => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workspace', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['diff', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['file', projectId] }),
    ])
  }

  const runCommand = useMutation({
    mutationFn: (value: string) => window.projectos.workspace.runReadonly(projectId, value),
    onSuccess: (result) => {
      setTerminalEntries((entries) => [...entries, result])
      setHistory((items) => [...items.filter((item) => item !== result.command), result.command].slice(-30))
      setHistoryIndex(-1)
      setCommand('')
    },
    onError: (error) => {
      message.error(errorMessage(error))
      setTerminalEntries((entries) => [
        ...entries,
        {
          command,
          stdout: '',
          stderr: errorMessage(error),
          exitCode: 1,
          durationMs: 0,
        },
      ])
    },
  })

  const execute = (): void => {
    const trimmed = command.trim()
    if (!trimmed || runCommand.isPending) return
    runCommand.mutate(trimmed)
  }

  const suggestions = ['git status', 'git diff', 'git log --oneline -5', 'ls', 'pwd']
  const git = workspace.data?.git
  const entries = workspace.data?.entries ?? []

  return (
    <div className="po-page po-workspace-page">
      <PageHeader
        compact
        eyebrow={
          <>
            <CodeOutlined /> 工作区
          </>
        }
        title={workspace.data?.rootPath.split(/[\\/]/).pop() ?? '项目工作区'}
        actions={
          <>
            <Button icon={<FolderOpenOutlined />} onClick={() => void window.projectos.projects.reveal(projectId)}>
              打开目录
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={workspace.isRefetching}>
              刷新
            </Button>
          </>
        }
        meta={
          <>
            <span className="po-mono">{workspace.data?.rootPath ?? '—'}</span>
            {git ? (
              <>
                <span>⑂ {git.branch}</span>
                <StatusPill tone={git.clean ? 'success' : 'warning'}>
                  {git.clean ? '工作区干净' : `${git.changes.length} 个变更`}
                </StatusPill>
              </>
            ) : (
              <StatusPill tone="neutral">未初始化 Git</StatusPill>
            )}
            <span>{entries.length} 个条目</span>
          </>
        }
      />

      {workspace.isLoading ? (
        <LoadingBlock rows={8} label="正在读取工作区" />
      ) : workspace.isError || !workspace.data ? (
        <ErrorState message={workspace.error ? errorMessage(workspace.error) : '工作区不存在'} onRetry={() => void workspace.refetch()} />
      ) : (
        <div className="po-workspace">
          <aside className="po-file-pane">
            <div className="po-pane-head">
              <div>
                <div className="po-pane-title">文件</div>
                <div className="po-pane-subtitle">只读 · 已忽略依赖目录</div>
              </div>
            </div>
            <div className="po-file-tree">
              <Tree
                treeData={treeData}
                showIcon={false}
                blockNode
                defaultExpandAll
                selectedKeys={selectedPath ? [selectedPath] : []}
                onSelect={(keys) => {
                  const key = keys[0]
                  if (typeof key !== 'string') return
                  const entry = entries.find((item) => item.path === key)
                  if (entry?.type === 'file') openFile(key)
                }}
              />
            </div>
          </aside>

          <section className="po-editor-pane">
            <div className="po-editor-tabs">
              <div className="po-editor-tab-scroll">
                {openTabs.map((tab) => (
                  <button
                    type="button"
                    key={tab}
                    className={`po-editor-tab ${tab === selectedPath ? 'is-active' : ''}`.trim()}
                    onClick={() => setSelectedPath(tab)}
                  >
                    <FileOutlined />
                    <span>{tab.split('/').pop()}</span>
                    <span
                      className="po-editor-tab-close"
                      role="button"
                      tabIndex={-1}
                      onClick={(event) => {
                        event.stopPropagation()
                        closeTab(tab)
                      }}
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
              {file.data ? (
                <div className="po-editor-meta">
                  <span>{file.data.language}</span>
                  <span>{formatBytes(file.data.size)}</span>
                  {file.data.truncated ? <span className="po-warning-text">已截断</span> : null}
                </div>
              ) : null}
            </div>
            <div className="po-editor-surface">
              {!selectedPath ? (
                <EmptyState compact icon={<FileOutlined />} title="选择文件开始阅读" description="左侧文件树来自真实项目目录。" />
              ) : file.isLoading ? (
                <LoadingBlock rows={6} />
              ) : file.isError || !file.data ? (
                <ErrorState compact message={file.error ? errorMessage(file.error) : '文件不存在'} />
              ) : (
                <Editor
                  height="100%"
                  path={file.data.path}
                  language={file.data.language}
                  value={file.data.content}
                  theme={theme === 'dark' ? 'projectos-dark' : 'projectos-light'}
                  loading={<LoadingBlock rows={5} label="正在加载 Monaco" />}
                  options={{
                    readOnly: true,
                    domReadOnly: true,
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineHeight: 20,
                    fontFamily: 'var(--font-mono)',
                    padding: { top: 14, bottom: 18 },
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    cursorBlinking: 'smooth',
                    renderLineHighlight: 'none',
                    overviewRulerLanes: 0,
                    hideCursorInOverviewRuler: true,
                    overviewRulerBorder: false,
                    lineNumbersMinChars: 4,
                    folding: true,
                    wordWrap: 'on',
                    automaticLayout: true,
                    contextmenu: false,
                    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
                  }}
                />
              )}
            </div>
          </section>

          <section className="po-bottom-pane">
            <div className="po-bottom-tabs">
              <button
                type="button"
                className={bottomTab === 'diff' ? 'is-active' : ''}
                onClick={() => setBottomTab('diff')}
              >
                <CodeOutlined /> Git 差异
                {git && !git.clean ? <span className="po-tab-badge">{git.changes.length}</span> : null}
              </button>
              <button
                type="button"
                className={bottomTab === 'terminal' ? 'is-active' : ''}
                onClick={() => setBottomTab('terminal')}
              >
                <TerminalOutlined /> 只读终端
              </button>
              <span className="po-grow" />
              {bottomTab === 'diff' && git && !git.clean ? (
                <select
                  className="po-diff-select"
                  value={diffPath ?? ''}
                  onChange={(event) => setDiffPath(event.target.value || null)}
                >
                  <option value="">全部变更</option>
                  {git.changes.map((change) => (
                    <option key={change.path} value={change.path}>
                      {change.status} · {change.path}
                    </option>
                  ))}
                </select>
              ) : null}
              {bottomTab === 'terminal' ? (
                <span className="po-terminal-warning">
                  <WarningOutlined /> 仅允许只读白名单命令
                </span>
              ) : null}
            </div>
            <div className="po-bottom-content">
              {bottomTab === 'diff' ? (
                diff.isLoading ? (
                  <LoadingBlock rows={5} />
                ) : diff.isError ? (
                  <ErrorState compact message={errorMessage(diff.error)} onRetry={() => void diff.refetch()} />
                ) : diff.data ? (
                  <DiffView patch={diff.data.patch} truncated={diff.data.truncated} />
                ) : (
                  <EmptyState compact title="没有差异" />
                )
              ) : (
                <div className="po-terminal">
                  <div className="po-terminal-output" ref={terminalOutputRef}>
                    {terminalEntries.length === 0 ? (
                      <div className="po-terminal-placeholder">
                        <div>只读终端 · 命令在同一项目目录中执行</div>
                        <div className="po-terminal-suggestions">
                          {suggestions.map((suggestion) => (
                            <button
                              type="button"
                              key={suggestion}
                              onClick={() => {
                                setCommand(suggestion)
                                runCommand.mutate(suggestion)
                              }}
                            >
                              {suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      terminalEntries.map((entry, index) => (
                        <div className="po-terminal-entry" key={index}>
                          <div className="po-terminal-command">
                            <RightOutlined /> {entry.command}
                            <span className={`po-terminal-exit ${entry.exitCode === 0 ? 'is-ok' : 'is-error'}`}>
                              exit {entry.exitCode} · {entry.durationMs}ms
                            </span>
                          </div>
                          {entry.stdout ? <pre>{entry.stdout}</pre> : null}
                          {entry.stderr ? <pre className="is-error">{entry.stderr}</pre> : null}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="po-terminal-input">
                    <span className="po-terminal-prompt">$</span>
                    <Input
                      variant="borderless"
                      value={command}
                      placeholder="输入只读命令，例如 git status"
                      disabled={runCommand.isPending}
                      onChange={(event) => setCommand(event.target.value)}
                      onPressEnter={execute}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          const next = Math.min(history.length - 1, historyIndex + 1)
                          if (next >= 0) {
                            setHistoryIndex(next)
                            setCommand(history[history.length - 1 - next] ?? '')
                          }
                        } else if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          const next = Math.max(-1, historyIndex - 1)
                          setHistoryIndex(next)
                          setCommand(next === -1 ? '' : (history[history.length - 1 - next] ?? ''))
                        }
                      }}
                    />
                    <Button size="small" type="primary" onClick={execute} loading={runCommand.isPending}>
                      运行
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}



