# A0 服务端方案与 Electron 登录 PoC（隔离验证）

> 结论先行：better-auth 1.7.14 + Fastify 5.12.7 在本机 Node 24 / Electron 43 环境下**真实可运行**；
> 组织作用域拒绝与 loopback+PKCE 登录已由 14 项真实 HTTP 测试证明。
> 但**没有 PostgreSQL、没有部署、没有接入 Electron IPC/preload**，不得对外宣称“多用户平台已完成”。

## 1. 版本与兼容核验（实际安装）

| 组件 | 版本 | 许可证 | 核验方式 |
|---|---|---|---|
| Node | 24.22.0 | — | `node -v`（仓库 engines `>=22.14.0`） |
| Electron | 43.8.2 | MIT | `apps/desktop/package.json` |
| React | 19.3.1 | MIT | 同上 |
| better-auth | 1.7.14 | MIT | `apps/server/node_modules/better-auth/package.json` |
| Fastify | 5.12.7 | MIT | 同上 |
| Zod | 4.6.7 | MIT | 仓库既有依赖 |

- better-auth 的 memory adapter（`better-auth/adapters/memory`）可在无数据库时运行完整 HTTP 流程；
  A0 用它隔离验证，**生产目标仍是 PostgreSQL**（A1 迁移）。
- 未发现 Node/Electron 版本阻塞；Electron 的 Renderer 不参与登录（见 §3）。
- 新增目录 `apps/server` 与 `packages/organization-contracts` 已被 pnpm workspace、根 tsconfig、
  Vitest alias 与 `scripts/check-boundaries.mjs` 识别（本轮补齐边界规则）。

## 2. 已实现（PoC 范围）

| 文件 | 内容 |
|---|---|
| `packages/organization-contracts/src/index.ts` | 组织/成员/项目/成员关系/资产版本/需求工作区/流程模板与实例/Worker 租约/桌面登录的 Zod 契约；组织与项目权限矩阵；`assertProjectAccess` |
| `apps/server/src/app.ts` | `buildServer()`：Fastify + better-auth（organization 插件）+ 内存库；`/api/auth/*` Fastify↔Web Request 桥；组织/项目作用域路由 |
| `apps/server/src/store.ts` | 内存版组织项目/需求/项目成员存储（明确标注 A1 由 PostgreSQL 替换） |
| `apps/server/src/desktop-auth.ts` | 登录页/授权页（无 JS、CSP 锁定）、一次性 consent id、一次性 code（120s）、PKCE 校验、8h 不透明 Bearer token、`/v1/me` |
| `apps/server/src/index.ts` | `127.0.0.1:PORT` 启动，默认 4310 |
| `apps/desktop/src/main/auth/desktop-login-core.ts` | Main 侧可测试核心：真实 `127.0.0.1:0` 回调监听、state、PKCE、Host/端口校验、超时、单次回调、必然关闭 |
| `tests/org-server-poc.test.ts` | 8 项真实 HTTP 集成测试 |
| `tests/org-desktop-login.test.ts` | 6 项 loopback 登录测试 |
| `tests/org-contracts.test.ts` | 17 项权限/契约单元测试 |

服务端路由（PoC）：

```
GET  /health
GET  /v1/me                                   Bearer token
GET  /v1/organizations/:orgId/projects        需该组织成员
POST /v1/organizations/:orgId/projects        需 org.create_project
GET  /v1/projects/:projectId/requirements     需该项目 project.view
POST /v1/projects/:projectId/requirements     需 project.write_requirement
GET  /api/auth/*                              better-auth（注册/登录/组织/邀请）
GET/POST /v1/desktop/authorize                登录页 + 授权确认
POST /v1/desktop/consent                      一次性授权码
POST /v1/desktop/token                        code + verifier → 8h token
```

## 3. 登录安全模型

1. Renderer 不接触任何秘密；Main 生成 verifier/challenge/state，绑定 `127.0.0.1:0` 随机端口。
2. 系统浏览器打开授权页；回调只接受 `Host=127.0.0.1:<该端口>` 与 `/callback`。
3. 授权码一次性、120 秒过期，绑定 account、challenge、redirect_uri 与 state；token **不出现在任何 URL**。
4. code 在 PKCE 校验前即被消费，重放/错误 verifier 都会失败。
5. 授权页/登录页：`CSP default-src 'none'; style-src 'unsafe-inline'; form-action 'self'`、`X-Frame-Options: DENY`、
   `Cache-Control: no-store`、无脚本；密码不回显、错误不泄露账号存在性。
6. token 设计为不透明随机值（当前内存存储、未哈希），A1 必须改为哈希存储 + 刷新/撤销 + 设备绑定 + 审计。

## 4. 测试证据（可复跑）

```text
pnpm test:org
→ 3 files / 31 tests passed（contracts 17, server 8, desktop 6）

pnpm vitest run tests/org-server-poc.test.ts tests/org-desktop-login.test.ts
→ 14 passed, ~6s，连续 3 次稳定
```

测试实际证明：

- 用户 A/B 各自注册并创建组织；A 读取/写入 B 的组织项目 → `403 ORG_FORBIDDEN`；A 自己的 token 仍可用。
- A 创建项目与需求；B 读取该项目需求 → `403 PROJECT_FORBIDDEN`；组织成员身份不会自动变成项目权限。
- A 邀请 B 邮箱，B 接受邀请后成为只读 member：能列组织项目、不能创建项目、仍无项目需求访问权。
- 完整 authorize → 登录 → consent → callback → token → `/v1/me`：token 43 字符、TTL 7.5–8h、回调 query 只有 code+state。
- PKCE 不匹配、code 重放、未知 code、非法请求、state 不匹配、超时、Host 伪造均被拒绝且监听器关闭。
- `/v1/me` 无 token / 伪造 token → 401。

日志中的 `WARN [Better Auth]: Invalid password` 是“错误密码”负向用例的预期输出。

## 5. 与规范的偏差（已记录，不隐藏）

- `buildServer()` 为 async（返回 Promise<FastifyInstance>）。
- 额外增加 `POST /v1/projects/:id/requirements` 与 `/health`，用于写作用域证明与测试播种。
- 测试先占用临时端口再以其为 `baseURL` 构建服务，因为 better-auth 的 `trustedOrigins` 必须与真实 Origin 一致
  （不一致时实测 403 `INVALID_ORIGIN`）。
- 为确定性测试关闭 rateLimit 与 telemetry；A1 必须恢复限流。
- 错误信封：领域失败用契约错误码；传输/认证失败使用 `invalid_request(400)` / `invalid_grant(400)` / `UNAUTHENTICATED(401)`。

## 6. 已知缺口（A1 必须处理）

| 级别 | 缺口 | 计划 |
|---|---|---|
| P0 | 无 PostgreSQL / Drizzle / 迁移；内存数据重启即失 | A1.1 建 schema 37+、RLS 评估、备份/回滚演练 |
| P0 | 无 Electron IPC/preload 接线，`runDesktopLogin` 未被 Main 调用 | A1.2 接线、safeStorage 持久化、会话失效/切换组织 |
| P0 | token/code 内存明文、无刷新/撤销/设备绑定/审计 | A1.2 安全存储 + 审计事件 |
| P1 | 无邮箱验证、无邀请过期策略 | A1.1 开启验证与邀请 TTL |
| P1 | 无速率限制、dev secret fallback | A1.1 强制生产 secret、限流、CSP/HSTS |
| P1 | `apps/server` 构建 externalize TS-source workspace 包 | 打包前改为构建产物引用 |
| P2 | 无多实例/事件流/WebSocket | A2 再评估，不在 A0 假装完成 |

## 7. A1 实施顺序建议

1. PostgreSQL schema + 迁移 + RLS 评估（仍然 additive，从 37 起）。
2. better-auth 生产 adapter + 邮箱验证 + 限流 + 审计。
3. Main/preload 登录接线与安全存储；Renderer 只拿脱敏会话摘要。
4. 用户/组织/成员/项目 CRUD 与权限负向测试。
5. 组织模式与个人模式的显式导入/关联流程（A3 前置）。
