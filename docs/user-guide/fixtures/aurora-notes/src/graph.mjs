/**
 * Aurora Notes — 双向链接图谱投影。
 * 图谱只是笔记链接的投影，不作为事实源；布局与渲染由 UI 负责。
 */

export function buildGraph(notes) {
  const byTitle = new Map(notes.map((note) => [note.title, note]))
  const edges = []
  for (const note of notes) {
    for (const link of note.links) {
      const target = byTitle.get(link)
      if (target) edges.push({ source: note.id, target: target.id })
    }
  }
  const degree = new Map()
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  return {
    nodes: notes.map((note) => ({ id: note.id, label: note.title, degree: degree.get(note.id) ?? 0 })),
    edges,
  }
}
