---
name: projectos-performance
description: "ProjectOS Electron 桌面端性能审计与优化规范。用于应用卡顿、FPS 低、启动慢、内存增长、IPC/查询慢、DAG 或玻璃 UI 性能问题；必须测打包应用、先取证据、保留已批准视觉，不得用删功能或全局关硬件加速解决。"
tags: [projectos, electron, performance, fps, ipc, profiling]
metadata:
  version: "1.0.0"
  owner: projectos
  source: docs/AI_TOOL_ROUTING.md
---

# ProjectOS Performance

## 何时使用

- 用户报告“卡/不流畅/掉帧/启动慢/内存涨”。
- 改大面积 blur、动画、React Flow、列表、IPC、查询。
- 发布前性能验收。

## 必读

1. `AGENTS.md`
2. `docs/AI_TOOL_ROUTING.md` R-08
3. `docs/performance/PERFORMANCE_AUDIT.md`
4. `scripts/perf-benchmark.mjs`
5. 目标页面源码/查询 hooks

## 输入

- 打包产物路径（必须真实 EXE，不是 dev server）。
- 复现场景（页面/交互/窗口尺寸）。
- 基线数据（FPS/长任务/CPU/内存/IPC）。
- 视觉基线约束。

## 执行步骤

1. **环境**：记录 GPU 状态（`app.getGPUFeatureStatus()`）；软件合成是常见最坏情况。
2. **基线**：用 `perf-benchmark.mjs` 测冷启动、页面切换、看板、DAG、Plan、Settings、Runs、resize、idle。
3. **定位**：
   - 大面积 `backdrop-filter` / 模糊层；
   - React 重复提交/无意义 setState/未 memo 的大计算；
   - 关闭仍挂载的组件/hooks；
   - runtime 事件导致查询风暴；
   - IPC 单次 1–2s 的重查询；
   - ELK/React Flow 高频布局。
4. **优先修复**：最大静态 blur、事件风暴、关闭仍挂载、明显无意义更新；每项单独测量。
5. **保留视觉**：只降低大面静态表面的 blur/层数；保留渐变、边缘、阴影、布局、交互。
6. **验证**：优化前后同场景 JSON；FPS/长任务/CPU/内存；视觉截图；E2E。
7. **记录**：更新 `PERFORMANCE_AUDIT.md` 和 `AI_EXPERIENCE_LOG.md`；不要把大日志塞进长期记忆。

## 已知基线（本机软件合成）

- DAG 35.1 → 49.5 FPS
- Plan Review 25.5 → 40.8 FPS
- Task Board 46.3 → 53.0 FPS
- Sidebar 40.2 → 45.5 FPS
- 30s idle heap 18.4MB 稳定，CPU≈0
- `project.overview`/`workspace.snapshot` 约 1.7s（后端查询成本，未改契约）
- Run Audit/Resize 有未复现回退，不得宣称已优化

## 工具依赖

- `scripts/perf-benchmark.mjs`
- Chromium CDP `Performance.getMetrics`
- `app.getAppMetrics()` / GPU feature status
- Playwright-core `_electron.launch`
- Phase5 / Plan E2E

## 禁止事项

- 只测 Vite dev；用模拟数据代替真实业务。
- 默认关闭硬件加速/删除全部 blur/阴影/透明来“提速”。
- 无 profiling 就大规模 memo/虚拟化/重写。
- 改 IPC/DB/Planner 契约来绕过慢查询。
- 虚报 60 FPS 或隐瞒回退。

## 验收标准

- [ ] 打包 EXE 优化前后同场景数据。
- [ ] 关键场景 FPS 提升或无回退；长任务下降。
- [ ] 视觉/业务 E2E 通过；截图无退化。
- [ ] 30s idle CPU/内存无异常增长。
- [ ] 未解决瓶颈和回退明确列出。
- [ ] 原始 JSON 已保存，报告可复现。
