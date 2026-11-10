# UX Refactor Consolidation Fixes — Evidence Report (ADR-0094)

- **Branch**: `feature/ux-refactor-fixes`
- **Base HEAD**: `0c223c0` (`feature/ux-polish-5`, ADR-0093)
- **ADR**: [`docs/adr/0094-ux-refactor-consolidation-fixes.md`](../../../adr/0094-ux-refactor-consolidation-fixes.md)
- **Design Changelog**: [`docs/design/DESIGN_CHANGELOG.md`](../../../design/DESIGN_CHANGELOG.md)

## 1. Scope Fixed in This Pass

1. **审阅室上下文深链与来源返回（消除来回跳转）**
   - 工作台待审批列表（`StudioProjectHome.tsx`）、运行审计横幅及运行操作按钮（`RunsPage.tsx`）、项目态势 KPI 待授权项（`ProjectOverviewPage.tsx`）进入审阅室时自动附带 `?approval=<id>` 以及 `return=runs&run=<id>` / `return=overview`。
   - `StudioReviewRoom.tsx` 返回链接与清空态主操作准确回到来源页（需求工作台 / Agent 协作 / 运行审计 / 项目态势 / 工作台）；首次读取未落定时保留 URL 深链选中的 `approvalId`。
2. **消除半成品状态与数据陈旧**
   - 审阅室三个视图（工具请求 / 交付审批 / 记录）统一补充 `role="alert"` 读取失败提示与「重试」按钮（修复「记录」失败误展示空态）。
   - `AppLayout.tsx` 在项目事件中同步失效 `['release-approvals', eventProjectId]` 与 `['release-overview']`，并使用 `event.projectId` 修复待授权通知按钮闭包陈旧问题；`StudioReviewRoom` 对交付审批启用 5s 兜底刷新。
   - 抽取共享 `lib/action-kinds.ts`，消除 `NextStepPanel` 将 `plan_review` / `replan_scope` / `plan_delivery` 误回退为「处理对账」的问题。
   - `RunsPage ?run=` 深链不在前 100 条列表或被筛选隐藏时回退读取 `runDetail.data.run`。
   - `apps/runtime/src/journey.ts` 不再发出已退役的 `/projects/:id/work`（无需求时发 `/projects/:id?intent=requirement`，已有需求时发 `/projects/:id/requirements`）；`action-center.ts` 交付审批路由对齐为 `&lens=delivery`。
3. **键盘导航、焦点管理与无障碍**
   - 新增 `lib/list-keys.ts`：`j`/`k` 保持页面级快捷上下切换，`ArrowUp`/`ArrowDown` 仅在队列容器内或自由焦点时生效，不劫持 `.rv-diff` 代码区、标签栏与输入控件的原生方向键。
   - 批量审批确认栏进入时自动聚焦备注输入框，取消/提交/Esc 后将焦点归还至队列项。
   - `KpiRail.tsx` 可点击指标项改为原生 `<button type="button">`，向辅助技术完整暴露数值与状态说明；移除轮询阶段条上的 `aria-live="polite"`；`ResourceCenter.tsx` 取消创建或轮换凭据弹窗时清空内存中的私钥/口令草稿；`KnowledgePage.tsx` 快照行改用索引安全 key。
4. **去嵌套矩形框、设计 Token 收敛与深色模式修复**
   - 展平审阅单内层 `.rv-evidence`、需求工作台 `.rq-criteria-matrix` / `.rq-gov-pill`、版本页 `.lc-disclosure` 的框套框结构为细分割线段落；清理无引用的 `.lc-relationship` / `.lc-scope-*` 死样式。
   - 补齐 `unified.css` 的 `--ui-shadow-brand(-hover)`、`--ui-knob`、`--ui-shadow-knob`；替换 `review.css`、`action-center.css`、`task-board.css`、`runs-audit.css`、`resource-hub.css`、`view-tabs.css`、`deployment-console.css`、`release-workbench.css` 中的硬编码色值、阴影与圆角；修正 `.rv-primary`（改用 `--studio-accent` + `--ui-inverse`）与 `.rv-diff-num`（改用 `--studio-muted`）在深浅主题下的对比度。
   - 修复 `requirement-flow.css` 中 `.rq-dl-*` 阶段账本及状态文字在深色模式下的浅色底块与状态色被 `:root[data-theme='dark'] :is(.rq-dl-stage-code…)` 覆盖的问题。
   - 将 `type-scale.css` 页面级通用规则收敛到 `.po-shell` 作用域，确保受保护的 `#/design-lab` 不受全局规则影响；修正 `--ui-type-badge`（11px）仅用于数字徽标。
5. **E2E 与截图脚本全量对齐**
   - 更新 18 个 `scripts/*.mjs` 中指向已移除 `.po-work-center` / `.po-run-detail-panel` / `审批工作台` 的选择器至合并后的 `.studio-workbench` / `.ra-page` / `.rv-room`（`审阅与决策`）与 `FormDialog`（`DialogShell`）。

## 2. Mandatory Design Sources & Limitations

- **Consulted files**:
  - Protected Design Lab: `apps/desktop/src/renderer/src/features/design-lab/{DesignLabPage.tsx,OpticalGlass.tsx,Aurora.jsx,design-lab.css}` and `docs/next-ui/visual-regression/APPROVED-design-lab-dag.png`.
  - Local skills read directly (current runtime exposes no `skill` loader tool for external directories): `ui-ux-pro-max` (`623a9a9`, executed `search.py` for `focus not obscured keyboard`, `error summary retry state`, `dark mode semantic tokens contrast`), `impeccable` (`e07dc01`, `SKILL.md` + `reference/craft-floor.md`), `vercel-composition-patterns` & `vercel-react-best-practices` (`063bee9`).
  - Rejected `ui-ux-pro-max` colour palette candidates (`#0F172A`/`#EF4444` and pure black `#000000`) because the frozen ProjectOS Premium Liquid Glass dark navy (`#111b30`) and cool blue-violet/cyan tokens take precedence.
  - User-referenced libraries (BoardUI, Bencho, HeroUI Pro, beUI Pro, Libraries.dev, Watermelon UI) inform only structural de-carding and single-focal-point hierarchy; no third-party assets or alien palettes were imported.
  - Sim Studio (`simstudioai/sim`) canvas source was not re-queried in this pass because no React Flow / DAG graph topology or edge rendering was modified.

## 3. Real Command & E2E Verification Results

| Check | Command | Result | Detail |
|---|---|---|---|
| Lint & boundaries | `pnpm lint` | **PASS** | 0 errors, 50 warnings (base 51; 0 warnings in touched files); boundaries OK |
| Typecheck | `pnpm typecheck` | **PASS** | `tsc -p tsconfig.json --noEmit` exit 0 |
| Unit & integration tests | `pnpm test` | **PASS** | **119/119 active files, 729 passed, 4 skipped** (live harness / SSH opt-in), 0 failed |
| Full build | `pnpm build` | **PASS** | `runtime` + `desktop` + `server` built cleanly |
| Desktop create & recovery | `node scripts/e2e.mjs` | **PASS** | Create project + starter README + restart recovery (16.1s) |
| Agent approval pause loop | `node scripts/agent-e2e.mjs` | **PASS** | Real approval pause + tool execution loop (13.6s) |
| Settings & native run | `node scripts/v12-e2e.mjs` | **PASS** | Global settings modal + AI connections + native run (20.4s) |
| Scan + Plan DAG + layout | `node scripts/v13-e2e.mjs` | **PASS** | Scan + plan DAG + real graph + saved layout (16.1s) |
| 125% scaling check | `node scripts/scale125-e2e.mjs` | **PASS** | `dpr=1.25`, zero horizontal overflow on consolidated home (8.3s) |
| Protected Design Lab DAG | `node scripts/premium-lab-e2e.mjs` | **PASS** | All checks PASS across 1440 / 1024, light / dark, and 125% zoom (45.6s) |
| Phase 2 delivery UI loop | `node scripts/phase2-ui-e2e.mjs` | **PASS** | Versions → Evidence → Release → Review Room 交付审批 → Candidate → Deployment → Review Room 交付审批 → Verified local delivery |
| Multi-viewport visual & a11y | `node docs/v2/evidence/ux-refactor-fixes/tools/capture-and-audit.mjs` | **PASS** | 56/56 checks PASS, 8/8 axe WCAG AA audits = 0 violations, 0 console/page errors |
| Packaged EXE smoke | `pnpm package:dir && pnpm test:package` | **PASS** | `release/win-unpacked/ProjectOS.exe` creates project, writes starter files, recovers after restart |

## 4. Committed Screenshots (`docs/v2/evidence/ux-refactor-fixes/screenshots/`)

40 real Electron captures (WebP) with zero horizontal overflow:
- **1440×900 Light & Dark (18 frames)**: `home`, `review-pending`, `review-history`, `requirements` (with unboxed acceptance matrix expanded), `overview`, `tasks`, `runs`, `versions`, `resources`.
- **1024×768 Light & Dark (10 frames)**: `home`, `review-pending`, `requirements`, `overview`, `versions`.
- **1440×900 @ 125% Zoom Light & Dark (10 frames)**: `home`, `review-pending`, `requirements`, `overview`, `versions`.
- **Protected Design Lab Baseline (`#/design-lab`) Light & Dark (2 frames)**: `1440-light-design-lab-dag.webp`, `1440-dark-design-lab-dag.webp`.

Machine-readable check & audit output: [`checks.json`](./checks.json).

## 5. Remaining Gaps / Explicitly Deferred Items

1. **Deferred per user sequencing (post-refactor security & diff pass)**:
   - **H1**: Harden `verifyCommandFamily` flag allow-list and `worktreeAutoAllowFamilies` defaults (`packages/policy/src/index.ts`, `apps/runtime/src/action-center.ts`).
   - **H2**: Replace 400-line / 250k-cell `lineDiff` truncation with prefix/suffix-stripped Myers hunk diff and explicit truncation gate (`apps/desktop/src/renderer/src/lib/line-diff.ts`).
   - **M1–M6**: Workspace-bind run-scoped allowances, atomic allowance insertion, `pendingApprovalId` guard in `decideApproval`, `approval.preview` secret redaction & `projectId` check, short-TTL cache on `verifyIsolatedWorktree`, and `assigneeAgentId` check on family grants.
2. **Diagnostic note**: Native compositor background sampling (`checks.json`) shows 0 axe violations across all 8 audited states and ≥4.70:1 minimum contrast on `versions` (light/dark) and `overview` (dark); `review-pending`, `requirements`, and light `overview` retain 4 small decorative/secondary samples at 3.78–4.21:1 (and 4 active-checkbox/kbd glyph edge samples in dark `review-pending`), tracked for visual review without altering the frozen palette.
