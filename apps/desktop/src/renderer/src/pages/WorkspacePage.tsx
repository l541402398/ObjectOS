import { useEffect, useMemo, useState } from 'react'
import { GitDeliveryDialog } from './GitDeliveryDialog'
import { CodeReviewDialog } from './CodeReviewDialog'
import { useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Input, Tree, type TreeDataNode } from 'antd'
import {
  CodeOutlined,
  FileOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  ReloadOutlined,
  SearchOutlined,
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
    <div className="po-diff" tabIndex={0} aria-label="文件差异">
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
  const [deliveryOpen,setDeliveryOpen]=useState(false),[codeOpen,setCodeOpen]=useState(false)
  const { projectId = '' } = useParams<{ projectId: string }>()
  const queryClient = useQueryClient()
  const workspace = useWorkspace(projectId)
  const theme = useResolvedTheme()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [diffPath, setDiffPath] = useState<string | null>(null)
  const file = useFileContent(projectId, selectedPath)
  const diff = useGitDiff(projectId, diffPath, true)

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

  const git = workspace.data?.git
  const entries = workspace.data?.entries ?? []

  return (
    <div className="po-page po-workspace-page">
      {codeOpen&&<CodeReviewDialog subject={{projectId,planId:null,taskId:null}} onClose={()=>setCodeOpen(false)}/>}
      {deliveryOpen&&<GitDeliveryDialog subject={{projectId,planId:null,taskId:null}} onClose={()=>setDeliveryOpen(false)} onRefresh={refresh}/>}
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
            <Button onClick={()=>setCodeOpen(true)}>查看代码变更</Button><Button onClick={()=>setDeliveryOpen(true)}>代码同步与合入</Button>
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
                  <div
                    key={tab}
                    className={`po-editor-tab ${tab === selectedPath ? 'is-active' : ''}`.trim()}
                  >
                    <button type="button" className="po-editor-tab-select" onClick={() => setSelectedPath(tab)} aria-pressed={tab === selectedPath} title={tab}>
                      <FileOutlined aria-hidden /><span>{tab.split('/').pop()}</span>
                    </button>
                    <button
                      type="button"
                      className="po-editor-tab-close"
                      aria-label={`关闭 ${tab.split('/').pop()}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        closeTab(tab)
                      }}
                    >
                      ×
                    </button>
                  </div>
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

          <section className="po-bottom-pane" aria-label="文件改动">
            <div className="po-bottom-tabs">
              <span><CodeOutlined /> 文件改动 {git&&!git.clean?`· ${git.changes.length} 个文件`:''}</span><span className="po-grow" />
              {git&&!git.clean&&<select aria-label="查看文件差异" className="po-diff-select" value={diffPath??''} onChange={event=>setDiffPath(event.target.value||null)}><option value="">全部变更</option>{git.changes.map(change=><option key={change.path} value={change.path}>{change.status} · {change.path}</option>)}</select>}
            </div>
            <div className="po-bottom-content">{diff.isLoading?<LoadingBlock rows={5}/>:diff.isError?<ErrorState compact message={errorMessage(diff.error)} onRetry={()=>void diff.refetch()}/>:diff.data?<DiffView patch={diff.data.patch} truncated={diff.data.truncated}/>:<EmptyState compact title="没有改动"/>}</div>
          </section>
        </div>
      )}
    </div>
  )
}



