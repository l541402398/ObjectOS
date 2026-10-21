import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { App as AntApp, Button, Input, Tag } from 'antd'
import { ReadOutlined, SearchOutlined } from '@ant-design/icons'
import { EmptyState, ErrorState, LoadingBlock } from '@projectos/ui'
import { useQueryClient } from '@tanstack/react-query'
import { qk, useKnowledge, useKnowledgeSearch } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'


function splitField(body: string, label: string, separator = ' / '): string[] {
  const line = body.split('\n').find((item) => item.startsWith(`${label}：`))
  if (!line) return []
  return line.slice(label.length + 1).split(separator).map((item) => item.trim()).filter(Boolean)
}

function SnapshotCard({ entry }: { entry: { title: string; body: string; status: string; sourceUri: string | null; updatedAt: number } }) {
  const languages = splitField(entry.body, '语言')
  const frameworks = splitField(entry.body, '框架', '、')
  const modules = splitField(entry.body, '模块', '、')
  const dependencies = splitField(entry.body, '关键依赖', '、')
  const manager = splitField(entry.body, '包管理器')[0]
  const git = splitField(entry.body, 'Git HEAD')[0]
  const warnings = splitField(entry.body, '警告')
  return (
    <article className="po-knowledge-card v17-kb-index">
      <div className="po-knowledge-card-head">
        <strong>{entry.title}</strong>
        <Tag>{entry.status}</Tag>
      </div>
      <div className="v17-kb-summary">
        <div><span>语言</span><strong>{languages.join(' · ') || '未识别'}</strong></div>
        <div><span>包管理</span><strong>{manager || '未识别'}</strong></div>
        <div><span>Git HEAD</span><strong className="is-mono">{git || '—'}</strong></div>
      </div>
      <div className="v17-kb-section">
        <span>框架</span>
        <div className="v17-kb-tags">{frameworks.length ? frameworks.map((item) => <Tag key={item}>{item}</Tag>) : <em>未识别</em>}</div>
      </div>
      <div className="v17-kb-section">
        <span>模块</span>
        <div className="v17-kb-tags">{modules.length ? modules.slice(0, 12).map((item) => <Tag key={item}>{item.replace(' (directory)', '')}</Tag>) : <em>未识别</em>}</div>
      </div>
      <div className="v17-kb-section">
        <span>关键依赖</span>
        <div className="v17-kb-tags">{dependencies.length ? dependencies.slice(0, 12).map((item) => <Tag key={item}>{item}</Tag>) : <em>无</em>}</div>
      </div>
      {warnings.length ? <div className="v17-kb-warning">扫描提示：{warnings.join(' / ')}</div> : null}
      <div className="po-knowledge-meta">
        <span>{entry.sourceUri ?? 'projectos'}</span>
        <span>{formatRelative(entry.updatedAt)}</span>
      </div>
    </article>
  )
}

export default function KnowledgePage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const { message } = AntApp.useApp()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [scanning, setScanning] = useState(false)
  const all = useKnowledge(projectId)
  const search = useKnowledgeSearch(projectId, query)
  const entries = useMemo(
    () => (query.trim() ? search.data?.entries ?? [] : all.data?.entries ?? []),
    [all.data, query, search.data],
  )
  const loading = query.trim() ? search.isLoading : all.isLoading
  const error = query.trim() ? search.error : all.error

  const scan = async (): Promise<void> => {
    setScanning(true)
    try {
      const snapshot = await window.projectos.projectAnalysis.scan(projectId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.knowledge(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.snapshot(projectId) }),
        queryClient.invalidateQueries({ queryKey: qk.bootstrap }),
      ])
      message.success(
        snapshot.warnings.length
          ? `扫描完成，${snapshot.warnings.length} 条提示`
          : `扫描完成：${snapshot.languages.join(' / ') || '未识别语言'}`,
      )
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      setScanning(false)
    }
  }

  return (
    <div className="po-page po-page-wide">
      <header className="po-page-header">
        <div>
          <div className="po-eyebrow"><ReadOutlined /> 项目记忆</div>
          <h1>知识库</h1>
          <p className="po-page-sub">扫描索引、决策与项目记忆的全文检索。</p>
        </div>
        <div className="po-page-header-actions">
          <Button onClick={() => void scan()} loading={scanning}>重新扫描项目</Button>
        </div>
      </header>
      <div className="po-knowledge-search">
        <Input
          allowClear
          size="large"
          prefix={<SearchOutlined />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索技术栈、模块、决策、验收记录…"
        />
      </div>
      {loading ? <LoadingBlock rows={6} label="正在检索" /> : null}
      {error ? <ErrorState title="检索失败" message={errorMessage(error)} onRetry={() => void (query ? search.refetch() : all.refetch())} /> : null}
      {!loading && !error && entries.length === 0 ? (
        <EmptyState title={query ? '没有匹配结果' : '暂无知识条目'} description={query ? '换一个关键词。' : '扫描项目后会生成索引。'} />
      ) : null}
      <div className="po-knowledge-list">
        {entries.map((entry) => (
          entry.sourceUri?.startsWith('projectos://snapshot/') ? (
            <SnapshotCard entry={entry} key={entry.id} />
          ) : (
            <article className="po-knowledge-card" key={entry.id}>
              <div className="po-knowledge-card-head">
                <strong>{entry.title}</strong>
                <Tag>{entry.status}</Tag>
              </div>
              <p>{entry.body.slice(0, 480)}</p>
              <div className="po-knowledge-meta">
                <span>{entry.sourceUri ?? 'projectos'}</span>
                <span>{formatRelative(entry.updatedAt)}</span>
              </div>
            </article>
          )
        ))}
      </div>
    </div>
  )
}

