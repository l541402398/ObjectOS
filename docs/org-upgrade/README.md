# ProjectOS 组织升级 · 实施索引

> A1 已完成并推送，见 [A1 报告](reports/A1-report.md)。用户已授权继续 A2，当前独立子阶段
> 是 [组织资产与版本绑定 A2.1](A2_IMPLEMENTATION.md)，结果见 [A2.1 报告](reports/A2.1-report.md)。
> 以下 A0 是历史审计和原型索引，不代表后续阶段已交付。

## 文档

| 文件 | 内容 |
|---|---|
| `ADR-ORG-0001-architecture.md` | 控制面/执行面、身份与权限、资产版本、需求工作单元、流程门禁、桌面登录、离线语义、UI 方向 |
| `A0-capability-audit.md` | 现有代码事实审计（schema 36 / 91 表 / rootPath / visibility / IPC / 复用点），附路径行号 |
| `A0-data-authority-and-migration.md` | 数据权威矩阵、迁移与回滚、失败场景、租户隔离清单、P0–P2 风险 |
| `A0-server-and-auth-poc.md` | Fastify + better-auth PoC、桌面 loopback+PKCE、版本核验、测试证明、缺口 |
| `design/PRECISION_DESIGN_SYSTEM.md` | Precision token/组件/三屏/响应式/可访问性/参考来源与限制 |
| `reports/A0-report.md` | 本轮验收报告（PASS/FAIL/SKIP/BLOCKED、真实命令与截图索引） |

## 代码

| 路径 | 说明 |
|---|---|
| `packages/organization-contracts/` | 组织领域 Zod 契约 + 权限矩阵（17 项单测） |
| `apps/server/` | 组织控制面 PoC（Fastify + better-auth 内存库；**非生产部署**） |
| `apps/desktop/src/main/auth/desktop-login-core.ts` | Main 侧 loopback+PKCE 登录核心（未接 IPC） |
| `apps/desktop/src/renderer/src/features/precision/` | Precision Workspace 设计母版（独立 `#/precision-lab` 路由） |
| `packages/design-tokens/src/precision.css` | 候选 token 层（仅 `.pw-theme` 作用域） |
| `tests/org-*.test.ts` | 契约、服务端、桌面登录共 31 项真实测试 |
| `scripts/a0-precision-shots.mjs` | 真实 Electron 截图 + 交互检查（45 PASS / 0 FAIL / 1 SKIP） |
| `scripts/a0-contrast.mjs` | token 对比度计算 |

## 复现

```bash
pnpm typecheck
pnpm lint
pnpm test:org                     # 31 tests
pnpm build
pnpm evidence:a0                  # 需要已构建的 Electron；输出到 evidence/A0
pnpm package:dir && pnpm test:package   # 打包冒烟（如环境允许）
```

原型入口（仅开发/评审）：`#/precision-lab?screen=overview|requirement|workflow&theme=light|dark&state=ready|empty|error&req=REQ-124`。

## 证据

- 截图：`evidence/A0/screenshots/`（1440×900 / 1024×768 / 125% / light / dark / 空态 / 错误 / 审批抽屉 / 命令面板 / 发布）
- 检查 JSON：`evidence/A0/electron-ui-checks.json`
- 构建清单：`evidence/A0/build-manifest.json`
- 远端核对：`evidence/A0/remote-verification.json`（分支、实现提交、`git ls-remote` 结果）

## 边界

- 原型使用演示数据，不读 SQLite、不写后端、不启动 Agent；不能作为生产功能验收。
- 服务端 PoC 使用内存库，重启即失；无 PostgreSQL、无部署、无 Electron IPC 接线。
- 生产视觉基线仍是 Premium Liquid Glass；Precision 仅在独立原型路由中评审，未经用户批准不迁移。
