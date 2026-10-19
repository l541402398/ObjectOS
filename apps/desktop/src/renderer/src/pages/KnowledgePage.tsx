import { useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Input, Tag } from 'antd'
import { ReadOutlined, SearchOutlined } from '@ant-design/icons'
import { EmptyState, ErrorState, LoadingBlock } from '@projectos/ui'
import { useKnowledge, useKnowledgeSearch } from '../lib/queries'
import { errorMessage } from '../lib/errors'
import { formatRelative } from '../lib/format'

export default function KnowledgePage() {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [query, setQuery] = useState('')
  const all = useKnowledge(projectId)
  const search = useKnowledgeSearch(projectId, query)
  const entries = useMemo(
    () => (query.trim() ? search.data?.entries ?? [] : all.data?.entries ?? []),
    [all.data, query, search.data],
  )
  const loading = query.trim() ? search.isLoading : all.isLoading
  const error = query.trim() ? search.error : all.error

  return (
    <div className="po-page po-page-wide">
      <header className="po-page-header">
        <div>
          <div className="po-eyebrow"><ReadOutlined /> 项目记忆</div>
          <h1>知识库</h1>
          <p className="po-page-sub">扫描索引、决策与项目记忆的全文检索。</p>
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
        ))}
      </div>
    </div>
  )
}
