# Aurora Notes

本地优先的 Markdown 笔记应用。演示项目，用于在 ProjectOS 中走完「需求 → 计划 → 授权 → 自主研发 → 验收」的完整链路。

## 开发

```bash
node --version        # >= 22
npm test              # node --test tests/*.test.mjs
npm run check         # 语法检查
```

## 目录

- `src/` 领域逻辑（笔记、搜索、图谱）
- `tests/` 单元测试（node:test）
- `docs/` 产品需求、想法池与架构决策

## 设计原则

1. 本地数据优先，默认不联网。
2. 编辑器与存储解耦，SQLite 作为本地索引。
3. 所有变更可审计、可恢复。
