/**
 * Aurora Notes — 全文搜索。
 * 当前实现：标题命中加权、正文片段截取。标签过滤与高亮摘要尚未实现（见 docs/IDEAS.md）。
 */

export function searchNotes(notes, query) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return []
  const hits = []
  for (const note of notes) {
    const haystack = `${note.title}\n${note.body}`.toLowerCase()
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
