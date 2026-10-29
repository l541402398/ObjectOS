# A0 验收报告｜组织架构基线 + 商业级 UI/UX 设计母版

> 本文只记录实际执行结果。原型、模拟、单元、集成、真实 Electron 分别标注；未运行的测试写 SKIP，不写“预计 PASS”。

## 0. 判定与 GitHub

- 阶段：A0（唯一执行轮次；A1–A5 未开始）
- 结论：**PASS（工程与 UI 范围内）**；组织平台本身未交付，A1 入口条件见 §6
- 仓库：`l541402398/ObjectOS`
- 分支：`v2.0-org-a0`
- 基线：`v2.0-phase2.9` / `9e2f82ab0564cea7dabfdbaf0a620c191d7afc49`
- 实现提交：`524259e5501ecf9292f575534f9610e952cb227f`（已推送并核对远端 HEAD）
- 远端 HEAD：`524259e5501ecf9292f575534f9610e952cb227f`；`git ls-remote origin refs/heads/v2.0-org-a0` 与本实现提交一致，
  记录见 `evidence/A0/remote-verification.json`。其后的元数据回填提交只更新 SHA/证据索引，不改变实现内容，最终 HEAD 见交付消息。
- 工作树：A0 开始前上一轮未提交的 settings 暗色修复与重生成截图已完整保存到本地分支
  `wip/phase2.9-settings-dark`（commit `4d44ddd`），未覆盖、未丢弃
- 保护：未 reset、未强推、未删除任何 Worktree；未提交密钥、数据库、个人路径或真实账号

### 1.0 资料阅读

已完整阅读资料包：`README.md`、`prompts/00_总控执行提示词.md`、`prompts/A0_架构基线与UI设计系统.md`、
`architecture/01`–`03`、`design/01`–`02`、`contracts/示例接口与领域契约.md`、`evidence/*`，
以及 `reference-ui/precision-workspace.html` 全文与 5 张参考 PNG。A1–A5 的提示词只用于确认边界，未据其开发。

## 1. 本轮实现与验收

| 能力 | 生产代码 | 验收类型 | 证据 | 结果 |
|---|---|---|---|---|
| 组织/项目/需求/流程/资产/Worker 领域契约 + 权限矩阵 | `packages/organization-contracts/src/index.ts` | UNIT | `tests/org-contracts.test.ts`（17） | PASS |
| Fastify + better-auth 组织服务 PoC（内存库） | `apps/server/src/{app,store,index}.ts` | INTEGRATION（真实 TCP/HTTP） | `tests/org-server-poc.test.ts`（8） | PASS |
| 组织作用域拒绝（跨组织读写 403） | `apps/server/src/app.ts` | INTEGRATION | 同上：`ORG_FORBIDDEN` / `PROJECT_FORBIDDEN` 断言 | PASS |
| 邀请 → 接受 → 只读成员，仍无项目权限 | `apps/server/src/app.ts` + better-auth organization | INTEGRATION | 同上 | PASS |
| 桌面 loopback + PKCE 登录核心 | `apps/desktop/src/main/auth/desktop-login-core.ts` | INTEGRATION（真实 loopback 监听） | `tests/org-desktop-login.test.ts`（6） | PASS |
| 桌面 token 不进 URL、一次性 code、超时/伪造 Host 拒绝 | 同上 + `apps/server/src/desktop-auth.ts` | INTEGRATION | 同上 + server 8 项 | PASS |
| Precision token 层 | `packages/design-tokens/src/precision.css` | REAL Electron 视觉 | 截图矩阵 + `scripts/a0-contrast.mjs` | PASS |
| 三张 UI 母版（总览/需求/流程） | `apps/desktop/src/renderer/src/features/precision/` | REAL Electron + 交互 | `electron-ui-checks.json` 45 PASS | PASS |
| 真实 React Flow + ELK DAG（9 节点/10 连线） | `features/precision/workflow/` | REAL Electron | 检查项 + `a0-workflow-*.png` | PASS |
| 审批、命令面板、创建需求、发布流程等真实交互 | 同上 | REAL Electron | 检查项 + 截图 | PASS |
| 空态/错误态/1024/125%/暗色 | 同上 | REAL Electron | 截图矩阵 | PASS |
| 边界检查覆盖新包/新 app | `scripts/check-boundaries.mjs` | 命令 | `pnpm lint` → `Dependency boundaries OK (...server)` | PASS |
| 能力审计与数据权威/迁移文档 | `docs/org-upgrade/A0-*.md` | 文档审计（只读） | 225 + 252 行，附路径行号 | PASS |

### 明确是 DEMO / 原型的部分

- `#/precision-lab` 全部数据来自 `features/precision/data.ts`；页面持续标注 `DESIGN PROTOTYPE`。
- 创建需求只写入当前前端会话；审批只改前端门禁状态；流程发布只改前端版本徽标；均明确提示“不写入服务器”。
- 没有真实登录按钮、没有伪造组织成员、没有启动 Agent、没有创建 Worktree。
- 服务器 PoC 使用内存库；重启即失，不能作为生产部署。

## 2. UI/UX 截图与交互

截图目录：`docs/org-upgrade/evidence/A0/screenshots/`（33 张真实 Electron content-area 截图，1440×900 / 1024×768 / 125%）。

| 页面 | 条件 | 截图 | 交互验证 |
|---|---|---|---|
| 组织/项目总览 | Light 1440×900 / 1024×768 / 125% / Dark | `a0-overview-1440-light.png`、`a0-overview-1024-light.png`、`a0-overview-1440-light-125.png`、`a0-overview-1440-dark.png` | 组织切换、筛选、行打开、待办打开 |
| 需求工作台 | Light 1440/1024、Dark、概览/文档/执行/证据、已批准 | `a0-requirement-*.png` | 选择需求、切换 tab、批准门禁、证据复制 |
| 流程设计器 | Light 1440/1024、Dark、检查器、适配、发布 | `a0-workflow-*.png` | 选节点、改标题、加节点、校验、删节点、发布 |
| 审批抽屉 | Light 1440 | `a0-approval-drawer-1440-light.png` | 要求修改必填、批准后状态/事件更新 |
| 命令面板 | Light/Dark 1440 | `a0-command-palette-1440-*.png` | Ctrl+K、输入过滤、Enter 导航 |
| 弹窗/表单 | Light 1440 | `a0-create-requirement-1440-light.png` | 校验、标题输入、提交进入新需求（仅会话） |
| 空态/异常 | Light 1440 | `a0-overview-empty-1440-light.png`、`a0-requirement-error-1440-light.png`、`a0-requirements-error-1440-light.png` | 空态 CTA、重试恢复 |
| 次级视图 | Light 1440 | `a0-projects/agents/members/runs/requirements-list-*.png` | 导航与页面标题 |

- 功能真实后端映射：**无**（A0 原型不接后端）；真实服务端能力由 PoC 测试单独证明，二者不混用。
- 应用 shell 与设计母版差异：生产 shell 仍为 Liquid Glass；原型独立路由、独立 token 作用域。
- 键盘：Tab 焦点实测（2px outline）、命令面板 ↑↓/Enter、弹窗 Esc、Tabs 方向键（实现 + 手动）。
- 字号：内容区 12px 下限，45 项检查中 tiny=0；对比度见设计文档（正文/辅助均 ≥4.5:1）。

## 3. 业务安全与数据

- 组织作用域：服务端对跨组织读/写返回 403；项目需求需要项目成员身份，组织成员不自动获得项目权限。
- 本机执行权：Worker/本机路径与组织角色分离；契约中 `allowedPaths`、`permittedToolIds`、budget、fencing 全部由 Worker 本地校验。
- 登录：Renderer 不持有秘密；loopback 仅 127.0.0.1、state + PKCE S256、一次性 code、token 不入 URL；登录页 CSP/XFO/no-store 实测。
- 组织切换：原型按组织过滤数据；真实实现必须重新校验服务端会话（A1）。
- 版本升级与回滚：只做设计与 PoC；真实迁移从 schema 37 起 additive，备份与回滚见 `A0-data-authority-and-migration.md`。
- 敏感字段扫描：未提交 `.env`、数据库、真实账号、Cookie、token；演示邮箱使用 `demo.invalid`；截图不含真实本机路径。
- 依赖许可证：Radix MIT、React Flow MIT、ELK EPL-2.0 OR GPL-3.0+（未修改源码）、Lucide ISC、better-auth MIT、Fastify MIT；见设计文档 §10。

## 4. 测试（实际命令与结果）

| 命令 | 退出码 | 实际结果 | 证据 | 判定 |
|---|---:|---|---|---|
| `pnpm lint` | 0 | 0 errors / 29 warnings（warnings 为仓库既有）；边界检查含 server | 终端输出 | PASS |
| `pnpm typecheck` | 0 | 无错误 | 终端输出 | PASS |
| `pnpm test`（第 1 次全量） | 1 | **1 failed / 491 passed / 4 skipped**；失败为 `tests/r1-budgets.test.ts` 计时用例（baseline 同样失败） | 终端输出 | FAIL（既有/计时敏感） |
| `pnpm test:org` | 0 | 3 files / **31 passed**（contracts 17、server 8、desktop 6） | `tests/org-*.test.ts` | PASS |
| `pnpm vitest run tests/r1-budgets.test.ts` | 0 | 5 passed（单独运行） | 终端输出 | PASS（说明为并发负载下的计时 flake） |
| `pnpm test`（第 2 次全量） | 1 | 同一用例再次失败：1 failed / 491 passed / 4 skipped；单独运行 PASS | 终端输出 | FAIL（既有计时 flake） |
| `pnpm build` | 0 | runtime + desktop 构建成功（18.9s） | `apps/desktop/out`、`apps/runtime/dist` | PASS |
| `node scripts/a0-precision-shots.mjs` | 0 | **45 PASS / 0 FAIL / 1 SKIP** | `electron-ui-checks.json` | PASS |
| `pnpm package:dir` | 0 | electron-builder 26.15.3 生成 `release/win-unpacked/ProjectOS.exe` | 终端输出 | PASS |
| `pnpm test:package` | 0 | `PACKAGE SMOKE PASS`：打包 EXE 创建项目、写入起始文件、重启恢复 | 终端输出 | PASS |

**SKIP 明细**：`prefers-reduced-motion` 仅检测系统媒体查询（当前系统未开启），未做开启后的截图；CSS 已实现减少动效。

## 5. 已知缺陷/风险

| 优先级 | 现象 | 根因/证据 | 当前处理 | 阻断下轮 |
|---|---|---|---|---|
| P0 | 无 PostgreSQL/迁移，PoC 数据重启即失 | `apps/server/src/store.ts` 注释与 README | A1.1 首项任务 | 是（对生产） |
| P0 | Electron Main/preload 未接登录 | `desktop-login-core.ts` 无调用方 | A1.2 | 是（对组织模式） |
| P1 | `r1-budgets` 全量并发时偶发失败 | 计时敏感；单独运行 PASS；baseline 同样失败 | 保留失败记录，未修改断言 | 否 |
| P1 | `apps/server` 构建 externalize TS 源码包 | 产物依赖 Node 类型剥离 | 打包前修复 | 否（A0 PoC） |
| P1 | 1024 流程检查器为覆盖抽屉，未自动断言开关 | 截图在未选中状态 | 记录为未验证 | 否 |
| P2 | 拖拽连线未做 E2E | 仅实现 + 手动 | 记录 | 否 |
| P2 | 全量 axe/WCAG、屏幕阅读器、200% 缩放未做 | — | 记录 | 否 |

### 过程中发现并修复的真实缺陷

1. **Light 主题 Portal token 丢失**：token 选择器仍作用于 `.pw-root`，Radix Portal 挂在 body，弹层无背景/遮罩。
   已改为 `.pw-theme` 作用域并用真实 Electron 计算样式复测（背景 `rgb(255,255,255)`、令牌 `#ffffff`）。
2. **创建需求输入被重置**：`projects` 数组每次渲染新引用，`useEffect` 反复清空标题，提交恒禁用。
   已用 `useMemo([orgId])` 稳定，并实测可输入、可提交、进入新需求。
3. **1024 旅程标签重叠**：窄屏未隐藏非当前阶段文字；已改为点 + 当前阶段，实测 `overflow=0`。
4. **1024 流程提示被基础规则覆盖**：媒体查询选择器特异性不足；已提升为 `.pw-flow-stage .pw-flow-hint`。

## 6. 下一步建议及停止点

- 已通过的退出条件：架构边界与 ADR、能力审计、数据权威/迁移、技术 PoC、三屏真实 UI、截图矩阵、自动化检查、GitHub 证据。
- 未通过的退出条件：无（A0 范围内）；A1 的 PostgreSQL、部署、IPC 接线明确不在本轮。
- 是否请求用户批准下阶段：**是**。A0 到此停止，不开始 A1。
- 本轮停止点：UI 母版与架构基线可评审；真实组织平台尚未交付。

**签字式声明**：我没有把演示数据冒充生产数据，没有为了通过测试绕过真实权限/门禁，没有伪造 GitHub 提交或截图，
也没有在未授权情况下开始 A1–A5。