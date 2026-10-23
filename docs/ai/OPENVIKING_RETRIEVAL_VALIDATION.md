# OpenViking 检索与跨会话验证

日期：2026-10-23
项目：ProjectOS
分支：`chore/ai-tool-routing`
验证者：DSH 主会话 + 两个独立子会话

> 本文只记录**实际工具返回**。未返回的结果不写成事实；仓库文件仍是权威。

## 1. 环境

```text
mcp__openviking__health → {"ok":true,"storage":"VikingFS"}
插件：@openviking/dsh-memory-plugin@0.5.29
端点：https://ov.afann.xyz
用户：bruce
项目 peer：github.com-l541402398-objectos
```

## 2. 导入前后状态

导入前：

- `viking://~/skills`：空
- `viking://agent/skills`：空
- `viking://resources`：仅 `ov-smoke`
- 项目 peer 下已有性能/设计/修复事件记忆，但没有完整技术路由注册表

导入后：

- `viking://resources/projectos/`：
  - `AI_TOOL_ROUTING`
  - `AI_EXPERIENCE_LOG`
  - `PERFORMANCE_AUDIT`
  - `VISUAL_BASELINE`
  - `PLAN_INSPECTOR_FIX`
  - `PROJECTOS_UI_CONTRACT`
  - `DESIGN`
  - `AGENTS`
- `viking://~/skills/`：
  - `projectos-glass-ui`
  - `projectos-workflow-design`
  - `projectos-ux-audit`
  - `projectos-performance`
  - `projectos-visual-regression`

## 3. 直接检索证据

查询 A：

```text
find("ProjectOS workflow DAG React Flow ELK plan review skill",
     context_type=["skill","resource"])
```

实际命中（节选）：

- `viking://resources/projectos/PLAN_INSPECTOR_FIX/.abstract.md`
- `viking://resources/projectos/AGENTS/ProjectOS_AI_Development_Rules/...`
- `viking://resources/projectos/AI_TOOL_ROUTING/.../R-01...`
- `viking://resources/projectos/PERFORMANCE_AUDIT/...`
- `viking://user/bruce/skills/projectos-workflow-design/SKILL.md`（82%）

查询 B：

```text
find("ProjectOS 光学玻璃 已批准视觉基线 0686c41 性能约束",
     context_type=["skill","resource"])
```

实际命中（节选）：

- `viking://resources/projectos/AI_TOOL_ROUTING/.../R-01_光学玻璃_UI...`
- `viking://resources/projectos/VISUAL_BASELINE/VISUAL_BASELINE.md`
- `viking://resources/projectos/AI_TOOL_ROUTING/.../5._已尝试失败...`
- `viking://user/bruce/skills/projectos-glass-ui/SKILL.md`（81%）

## 4. 检索范围 / peer 隔离

| 数据 | URI 根 | 范围 | 实际观察 |
|---|---|---|---|
| 项目记忆 | `viking://user/bruce/peers/github.com-l541402398-objectos/memories` | 同一 git remote 的所有 worktree/克隆 | 项目 peer 下已有 18 个记忆文件 |
| 资源 | `viking://resources/projectos` | 账户共享资源根 | 导入后 8 个文档目录 |
| Skills | `viking://user/bruce/skills` | 当前用户 | 5 个 ProjectOS skill |
| 共享 Skills | `viking://agent/skills` | 整个账户 | 未导入（未获账户级授权） |

结论：**资源与 Skills 不是 peer 私有的**；它们按账户/用户范围共享。项目事实记忆按 peer 隔离。
不要把私密项目文档放进 `viking://resources` 而不确认共享范围；不要把账户级 skill 当项目私有。

## 5. 独立新会话验证

### 会话 A — DAG（独立子会话 4a2c7eab-ca24-4d52-8099-cab6165e52c0）

实际结果：

- 根 `AGENTS.md` 被 workspace instructions 注入，子会话又实读全文；确认强制 8 步路由。
- `search` 查询“ProjectOS 工作流 DAG React Flow ELK Plan Review 性能 设计基线”返回 9 条。
- 完整读取：
  - `viking://user/bruce/skills/projectos-workflow-design/SKILL.md`（82%）
  - `viking://resources/projectos/AI_TOOL_ROUTING/.../R-01_光学玻璃_UI...md`（含 R-04 全段）
- `skill` 工具加载 `projectos-workflow-design` **成功**，base dir 为项目 `.agents/skills/projectos-workflow-design`，未走 fallback。
- 实读源码/依赖：`@xyflow/react 12.12.0`、`elkjs 0.12.0`、React Flow `onMove` 仅切换 class（无 setState）、ELK 仅 `[tasks]` 变化重算、草稿审批真实 props。
- 未运行构建/E2E/性能；其会话的 node_modules 不完整，明确标记为“无法验证”，未编造数据。
- 发现并已修复：skill 中 `docs/perf/...` 路径错误（实际 `docs/performance/...`）。

### 会话 B — 光学玻璃（独立子会话 49641a1c-9494-4f6a-be37-e6514ce6ea98）

实际结果：

- 根 `AGENTS.md` 被实际读取；确认 UI 源、`0686c41` 基线、截图优先、R1 Modal 拒绝。
- `find` 查询光学玻璃/基线/性能返回 9 条。
- 完整读取：
  - `viking://resources/projectos/AI_TOOL_ROUTING/.../R-01_光学玻璃_UI...md`
  - `viking://resources/projectos/VISUAL_BASELINE/VISUAL_BASELINE.md`
- `skill` 工具加载 `projectos-glass-ui` **成功**，base dir 为项目 `.agents/skills/projectos-glass-ui`。
- 实测基线 commit/tag：`0686c41` 与 `visual-baseline-approved-0686c41` 指向同一 SHA。
- 实测 `design-lab.css` 12 处 `backdrop-filter`、20 个 `--pdl-*` 变量族、2 个 keyframes、3 处 reduced-motion。
- 发现：AGENTS 原引用的 `.jpeg` 不在仓库；仓库实际为 `APPROVED-design-lab-dag.png`。已把 AGENTS 的引用改为仓库 PNG，并注明源 JPEG 未提交。
- 发现冲突：UI_CONTRACT five-fix #3 要求正文 14px，但已批准截图为紧凑 8.5–11.5px。按“截图优先”未自行放大；已在路由 R-01 标注为“未裁决冲突”。
- 未运行构建/E2E/截图；历史 FPS 仅引用文档，未伪造。

## 5.1 验证结论

| 项目 | 结果 |
|---|---|
| DSH 读取 AGENTS.md | **是**（两个独立会话均确认） |
| 项目 Skill 自动发现 | **是**（`skill` 工具直接加载 `.agents/skills/...`，未 fallback） |
| OpenViking 资源召回 | **是**（两个查询均命中 R-01/性能/视觉基线/AGENTS） |
| OpenViking Skill 召回 | **是**（workflow 82%、glass 85%/81%） |
| 真实代码/基线 | **是**（commit/tag、版本、CSS 实测） |
| 真实运行/E2E/FPS | **本验证会话未执行**；需主会话 `pnpm install`/build 后跑验收 |
| 自动路由可靠性 | 不能只靠 OpenViking；`AGENTS.md` 强制步骤 + skill 工具 + `pnpm ai:route-check` 是执行检查 |
| `pnpm ai:route-check` | **60/60 PASS**（主会话扩展静态回归检测后） |

> 重要：两个子会话都只有项目源码与符号链接 node_modules，未安装完整依赖，因此
> **没有运行构建/E2E/截图**。不得把本文件当作性能或视觉通过证据；那些由主会话另行执行。

## 6. 失败/限制

- OpenViking `find` 的 `context_type` 必须使用单数 `skill/resource/memory`；复数会 `INVALID_ARGUMENT`。
- 本机 `add_resource` 返回 `http://` 上传地址，实际需 `https://` + `-L`；已记录。
- Skill 目录上传需要 zip；单 SKILL.md 可用 `data=`。
- 自动 Skill 选择不能仅依赖 OpenViking：项目用 `AGENTS.md` 强制步骤 + `.agents/skills` 显式加载 + `pnpm ai:route-check` 预检兜底。
