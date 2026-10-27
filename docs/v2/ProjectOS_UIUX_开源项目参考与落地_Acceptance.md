# ProjectOS UI/UX 开源参考与落地验收

**日期**：2026-10-27  
**分支**：`v2.0-phase2.3-resources`  
**基线**：`b4ff18d`（资源与连接完成）  
**本轮实现提交**：`d047d80`  
**报告提交**：本文件提交后的 HEAD  
**结论**：**四页已统一为工作台/资产目录结构；审批中心接入真实文件 Diff；发布与资源列表完成 100 条密度实测。未做 125% 资源页实拍。**

---

## 1. 基线

- 最新功能 HEAD 包含：
  - V31 资源/凭据/SSH 测试；
  - 发布工作台、部署控制台、审批工作台；
  - 资源与连接页面。
- 本轮不覆盖、不回退资源分支；在其最新 HEAD 上集成。
- 未修改 V27/V28/V29/V30/V31 已发布迁移。

---

## 2. 开源参考：实际查看的路径

| 参考 | 许可证 | 实际查看路径 | 采用模式 | 不采用 |
|---|---|---|---|---|
| Coolify | Apache-2.0 | `app/Livewire/Server/Show.php`、`Create.php`、`ValidateAndInstall.php`、`PrivateKey/` | 主机资产详情、连接向导、按资源类型分组 | 不复制 Livewire/PHP；不执行服务器安装 |
| Argo CD | Apache-2.0 | `ui/src/app/applications/components/applications-list/`、`application-details/`、`application-deployment-history/`、`application-resources-diff/` | 应用列表→详情→部署历史；Diff 作为审阅主体 | 不复制 Angular 资源树；不伪造 K8s 拓扑 |
| Infisical | MIT（开源主体；企业功能另授权） | `frontend/src/views/PermissionAuditSheet/` | 凭据/权限审计视图、操作者与时间线 | 不复制企业 RBAC/审计代码 |
| Bytebase | MIT（企业及权限部分有例外） | `frontend/src/routes/`、`frontend/src/components/` | 变更审阅入口、批准前集中查看 | 不复制 SQL 审阅工作流 |
| VS Code | MIT | `src/vs/workbench/browser/parts/sidebar/`、`panel/`、`auxiliarybar/` | 侧栏/主区/辅助 Inspector 的桌面布局 | 不复制 workbench 源码 |
| Ant Design | MIT | 现有依赖 | 表格/下拉/弹窗基础控件 | 不新增 UI 框架 |

补充：Trigger.dev 未在本轮引入；没有为“参考过”而安装它。

---

## 3. ProjectOS 问题 → 模式 → 落点

| 现有问题 | 参考模式 | 落点 |
|---|---|---|
| 发布页单条 Release 占满页面 | Argo 列表 + 详情 + 部署历史 | `ReleaseWorkbench`：左侧候选/变更/历史列表，中央详情，右侧就绪 Inspector |
| 发布页无筛选、记录多时难找 | Argo applications 列表过滤 | 新增列表筛选框；100 条变更实测 |
| 部署页不知道“部署到哪/哪个版本/是否健康” | Argo deployment history + VS Code 主/辅区 | `DeploymentConsole`：目标导航、执行轨迹、健康/回执 Inspector |
| 审批页只有摘要，不能判断文件写入 | Argo resources diff + Bytebase 审阅 | `ApprovalsPage`：读取当前工作区文件，生成真实行级 Diff |
| 资源页主机卡片堆叠 | Coolify Server 详情/创建向导 + VS Code 辅助栏 | `ResourceCenter`：资产列表 + 资源 Inspector + 渐进表单 |
| 凭据暴露风险 | Infisical 权限审计 + 遮罩 | 凭据只显示元信息；Diff/详情不出现秘密 |

---

## 4. 本轮代码改动

### 4.1 审批中心真实 Diff

文件：`apps/desktop/src/renderer/src/pages/ApprovalsPage.tsx`

- 从 `approval.request.args` 读取：
  - `path`
  - `content`
- 通过正式 `workspace.readFile` API 读取当前工作区基线；
- 实现行级 LCS Diff：
  - 新增/删除/上下文行；
  - 旧/新行号；
  - 400 行上限；
  - 超大文件降级为前后片段，避免阻塞 UI。
- 显示新增/删除行数与“基线来自当前工作区”；
- 无 content 时保留原摘要，不伪造 Diff。

E2E 截图：`1440x900-light-approval-tool-diff.png`。

### 4.2 发布列表筛选 + 100 条密度

文件：`apps/desktop/src/renderer/src/components/ReleaseWorkbench.tsx`

- 新增当前视图筛选输入；
- 候选/变更/历史共享筛选；
- 100 条变更实测：列表滚动，无水平溢出。

### 4.3 资源与连接页面（上轮实现，本轮整合验证）

- 资产目录 / 详情 / Inspector；
- 主机 + 凭据 + Profile + 连接测试；
- 部署目标引用 Resource/Profile；
- 100 条资源实测：163ms 渲染，无水平溢出。

### 4.4 部署控制台（上轮实现，本轮整合验证）

- 环境/目标导航 + 执行轨迹 + 健康/回执 Inspector；
- Local 文件交付与 SSH 外部确认语义区分；
- 中央操作区在 1024 下仍可用。

---

## 5. 真实 Electron E2E

### 5.1 发布/审批/部署

```text
accordion nav
→ 版本证据/门禁
→ 发布工作台：变更 → 审批中心真实 Diff → 候选 → Release
→ 部署控制台 → 审批 → Local 制品交付（健康未验证）
PHASE 2 UI E2E PASS
```

### 5.2 资源与连接

```text
资源中心 → 新建 Host → 私钥录入
→ 首次 SSH 指纹待确认 → 固定指纹 → 已连接
→ 篡改指纹 → 拒绝 → 恢复 → 重连
→ 部署目标选择 Resource/Profile
→ 停用凭据 → 连接失败
→ 重启恢复
→ UI/SQLite/vault 无明文私钥
RESOURCES UI E2E PASS
```

### 5.3 100 条密度

```text
fixture: 100 changes + 100 resources (仅测试临时数据)
release list: 100 rows, 558ms
resource list: 100 rows, 163ms
no horizontal overflow
UIUX DENSITY E2E PASS
```

---

## 6. 验证结果

| 项目 | 结果 |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS，0 errors |
| `pnpm test` | **287 passed / 4 skipped** |
| `pnpm build` | PASS |
| `pnpm package:dir` | PASS |
| `pnpm test:package` | **PACKAGE SMOKE PASS** |
| Phase2 UI E2E | PASS |
| Resources UI E2E | PASS |
| 100 条密度 E2E | PASS |
| 1440 / 1024 | PASS |
| DPR 1.25 | 交付三页已有截图；资源页未单独实拍 |
| 0 / 1 / 10 / 100 条 | 0/1/100 已覆盖；10 条包含于 100 条列表，无单独截图 |

---

## 7. 截图

- `docs/screenshots/1440x900-light-approval-tool-diff.png`（真实文件 Diff）
- `docs/screenshots/1440x900-light-release-center.png`
- `docs/screenshots/1440x900-light-deployment-center.png`
- `docs/screenshots/1440x900-light-resources.png`
- `docs/screenshots/1440x900-light-release-density-100.png`
- `docs/screenshots/1440x900-light-resources-density-100.png`
- `docs/screenshots/1024x768-light-resources.png`

---

## 8. 不适合 ProjectOS 的模式

- Argo 的资源树：ProjectOS 当前没有真实 K8s 拓扑数据，不能画假树。
- Coolify 的服务器安装向导：会修改服务器；ProjectOS 只登记和验证，不安装 Agent。
- Infisical 的企业 RBAC/审批矩阵：当前项目级可见性模型未实现，不能假装已有。
- Trigger.dev 的运行队列：ProjectOS 已有 Run/ToolCall 模型，不引入第二套执行队列。

---

## 9. 未完成

1. 资源页 DPR 1.25 单独截图。
2. 列表虚拟化（100 条可接受；1000 条未测）。
3. 审批 Diff 的语法高亮与并排视图。
4. 工具审批的允许路径/工作区范围尚未在 UI 中展开。
5. 资源/Profile 编辑与删除 UI。
6. K8s/Pipeline/GitOps 真实连接器。

---

## 10. 停止点

不进入 Phase 3；不修改生产资源；继续沿 Phase 2.3 真实部署主线推进时，需单独审批远程写操作。

**等待验收。**
