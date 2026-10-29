# 想法池

## 已排期

- 标签过滤：`searchNotes(notes, query, { tags })`，多标签取交集。
- 命中高亮：新增 `summarizeHits(hit, { before, after })`，返回 `<mark>` 包裹的片段。

## 待评估

- 中文分词（当前为子串匹配）。
- 增量索引与后台重建。
- 导出为静态站点。
