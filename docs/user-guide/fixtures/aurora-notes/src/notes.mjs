/**
 * Aurora Notes — 笔记领域模型。
 * 本地优先：所有数据结构都可序列化为纯 JSON，便于 SQLite 索引与崩溃恢复。
 */

export function createNote(title, body, tags = []) {
  return {
    id: randomId(),
    title,
    body,
    tags: normalizeTags(tags),
    updatedAt: Date.now(),
    links: extractWikiLinks(body),
  }
}

export function extractWikiLinks(body) {
  return [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].trim())
}

export function normalizeTags(tags) {
  return [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))]
}

function randomId() {
  return `note_${Math.random().toString(36).slice(2, 10)}`
}
