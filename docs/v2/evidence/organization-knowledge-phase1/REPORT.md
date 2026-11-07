# K1 组织技术与业务知识底座验收

开始日期：2026-11-06，验收日期：2026-11-07（America/Los_Angeles）。
基准 HEAD：`0a7f7f28e4fba62a6b909a88f59ccd03e186f5aa`；实施分支：`codex/organization-knowledge-phase1`。
最终实现由包含本报告的提交标识；不在提交内部伪造自引用哈希。每次命令的开始／结束时间、实际 HEAD、源码摘要、退出码和原始输出路径保存在 `checks.json`。

## 已实现的范围

- 组织技术／业务知识是独立资源，支持有界文本／Markdown、标签、组织／项目可见范围和 semver 历史。
- PostgreSQL 迁移 5 追加文档／版本表和数据库保护触发器。原迁移 1–4 不变，真实升级测试保留旧账号、项目和全部校验和。
- 草稿采用修订号比较更新；显式发布后正文、标题、标签与 SHA256 不可改写；后续修改创建新版本。废弃、撤销及发布分别保留审计事实。
- 每次请求在组织锁内重查成员；项目私有知识要求独立项目权限，组织管理员不隐式拥有项目访问权。普通成员不能读取草稿或已撤销正文。
- 检索限定当前可访问的活跃项目，只包含组织公共知识和该项目私有的已发布版本。支持中文／英文的字面子串和标签，保留具体文档／版本／校验值，摘要最多 1200 字符。草稿不遮蔽已有发布，历史版本不会被重写。
- 七个具名桌面接口接入现有 Main／preload。Main 持有凭据，校验输入输出、响应体上限，并在组织／账号改变后丢弃旧请求结果。Renderer、个人 SQLite、规划上下文和 AgentRunner 未修改。

实现决策见 [ADR-0084](../../../adr/0084-organization-knowledge-foundation.md)，后续阶段见 [实施方案](../../../org-upgrade/KNOWLEDGE_AND_ASSIGNMENT_PLAN.md)。

## 验证方式

`tests/org-knowledge.test.ts` 使用真实独立 PostgreSQL 与真实 HTTP，对旧迁移保留、草稿隐藏、并发更新、数据库不可变保护、精确版本历史、租户／项目隔离、项目权限与组织权限分离、中文／字面通配符检索、废弃／撤销、锁等待后撤权，以及服务重启进行验证。

`tests/org-connection.test.ts` 使用原有真实浏览器授权协议／HTTP 登录夹具，并为新增知识路由提供受控 HTTP 返回，验证七个具名方法的路由、请求体、输入／输出校验、响应大小和组织切换失效。此部分是 Main 适配测试，不宣称从产品知识界面连接 PostgreSQL 的端到端操作。

完整检查由 `node scripts/org-knowledge-checks.mjs` 顺序运行，保留所有尝试，不放宽测试超时。本轮完整验收全部首次通过。

## 检查结果

| 命令 | 结果 | 原始输出 |
| --- | --- | --- |
| `pnpm lint` | PASS，0 error／45 个既有 warning，依赖边界通过 | `lint-1.log` |
| `pnpm typecheck` | PASS | `typecheck-1.log` |
| `pnpm run test --maxWorkers=2` | PASS，666 passed／4 skipped；112 文件通过、2 文件跳过；587.74s | `test-1.log` |
| `pnpm build` | PASS，Runtime／Desktop／Server | `build-1.log` |
| `node scripts/e2e.mjs` | PASS，桌面创建与重启恢复 | `desktop-e2e-1.log` |
| `node scripts/agent-e2e.mjs` | PASS，审批暂停、写入与恢复 | `agent-e2e-1.log` |
| `node scripts/v12-e2e.mjs` | PASS，设置、连接与 Native 路径 | `v12-e2e-1.log` |
| `node scripts/v13-e2e.mjs` | PASS，扫描、计划审批、DAG、布局及恢复 | `v13-e2e-1.log` |
| `pnpm package:dir` | PASS，实际 Windows 解包程序 | `package-dir-1.log` |
| `pnpm test:package` | PASS，实际 EXE 创建项目并重启恢复 | `package-smoke-1.log` |

4 项跳过为既有 OpenCode／DeepSeek 外部 Harness 的 3 项，以及未启用 SSH/VPS 环境的 1 项。
没有把跳过计为通过，也没有宣称本轮测试调用真实外部模型或执行生产部署。

各次检查对应的源码 SHA256 为 `a25c7167a6ed192acf205ea04f48d3a8a2d8cc4ab9f07a624901401ece4edb0f`。
验收期间补充了摘要范围内的 `apps/server/README.md`，因此最终原始字节摘要为
`ad9d1374cc0afc89d9fe7c76a454f5406c6baffb67ee363334e5fad71748f6f4`。
提交前只将该 README 在内存中替换为原始字节，即精确重现所有检查的摘要，证明其余 728 个源文件均未变化；
核对结果见 `source-verification.json`。首次核对未处理该旧文档末尾 CRLF 而未匹配，已核对原始换行并修正验证，未改动受测代码。
构建文件、独立组织服务、EXE、app.asar 与打包 Runtime 的实际 SHA256／字节数见 `artifact-hashes.json`。
已核对打包 Runtime 与此次构建的 Runtime 校验值一致。最终程序为 `release/win-unpacked/ProjectOS.exe`。

## 交付与未验证项

- K1 仅完成知识服务与桌面接口。K2 的知识管理界面／需求上下文引用、K3 的审核回写、K4 的按成员派发，以及 K5 双桌面完整闭环尚未实现。
- 本阶段没有 Renderer UI 差异，因此新视觉截图、主题／缩放／布局及可访问性验收不适用；没有将代码或接口测试声称为视觉验收。
- 检索为参数化字面子串，无向量检索、附件上传、外部连接器、网页抓取、知识缓存或离线组织检索。上限为每文档 100 个版本、列表 100 条、检索最多 30 条；没有无限分页或大规模知识库性能结论。
- 既有组织服务必须先显式升级到迁移 5 再使用相应构建；本轮只迁移隔离测试数据库，不更改用户组织数据库或部署生产服务。
- 可识别凭据格式会被拒绝，但任意自然语言正文不能被认证为无敏感信息。审计只保存身份、动作、版本与校验值，不记录正文。
- 用户原有未跟踪的私人邮箱截图和 `pelican-bicycle-2d.html` 不纳入此交付。
