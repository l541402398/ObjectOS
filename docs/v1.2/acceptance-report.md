# V1.2 验收报告

日期：2026-10-19  
范围：`ProjectOS_V1.2.1_Design.md` 的 P0 核心增量；**不是完整 V1.2 全部交付**。  
基线：V1.1 项目、任务、Agent 原生循环、审批、跨会话与工作区能力保持通过。

## 1. 结论

本期完成：

- 多 AI 连接档案（SQLite）与 Main SecretVault
- 连接创建/编辑/启停/测试/默认/删除
- 连接测试 L1–L3 与错误分类
- 模型目录：手动录入、OpenAI-compatible `/models` 发现、默认模型
- 默认连接同步到既有 ProviderManager，真实 Agent 运行闭环
- 旧单 Provider 配置幂等迁移
- 设置改为全局弹层（AI 连接 / 模型目录 / 通用 / 运行时 / 外部 Agent / 关于）
- Claude Code / Codex 安装与版本检测（仅检测）
- 显式侧栏折叠错位修复、页面文案精简、34 张截图

本期**未完成**：

- 角色/项目/任务路由与执行后端绑定
- Claude Code / Codex 任务执行、授权状态探测
- 费用表、预算、用量明细聚合 UI
- Anthropic Messages / OpenAI Responses 原生协议
- 代理配置档案与完整 SSRF 策略
- 全量 V1.2 验收与发布级故障注入

因此只能声明“V1.2 P0 核心子集完成”，不能声明 V1.2 全量完成。

## 2. 验收用例

| ID | 结果 | 证据 / 限制 |
|---|---|---|
| AI-001 从 V1.1 升级 | 通过（核心） | 环境变量旧配置启动后生成默认连接；Key 无明文；旧 `settings.*` 回归通过 |
| AI-002 保存两个 Provider | 通过 | 单元测试两个连接、默认唯一、默认切换；UI 创建/重启持久化 |
| AI-003 错误 API Key | 通过（分类） | 单元测试真实 401 响应 → `INVALID_KEY`；消息不含 Key |
| AI-004 错误模型 ID | 部分 | 分类器覆盖 404 → `MODEL_NOT_FOUND`；未做真实供应商调用 |
| AI-005 流式回答 | 通过 | Agent E2E / V1.2 E2E 收到流式文本 |
| AI-006 工具调用 | 通过 | Agent E2E（write_file）与 Command E2E（run_command）审批→执行→回传→完成 |
| AI-007 取消运行 | 部分 | V1.1 取消路径保留；本期未新增取消 E2E |
| AI-008 运行中崩溃 | 通过（逻辑） | `tests/recovery.test.ts`：未知副作用进入待核对，不自动重放 |
| AI-009 外部 CLI 不存在 | 通过（检测） | 外部 Agent 面板显示未安装；不崩溃；不执行 CLI |
| AI-010 Agent 角色路由 | 未实现 | 当前所有 Agent 使用默认连接；无角色绑定 |
| AI-011 预算与用量 | 部分 | Run 记录输入/输出 Token；无 usage 明细、费用与“未知”展示 |
| AI-012 UI 验收 | 通过（截图） | 1440×900 / 1024×768，Light/Dark，设置弹层与折叠侧栏 |
| AI-013 无网络 | 部分 | 分类器覆盖 NETWORK_UNREACHABLE；无离线回放 E2E |
| AI-014 跨会话交接 | 通过 | V1.1 单元/手动 wake 验证保留；未在本期重做 UI 交接 E2E |

## 3. 实际命令

```text
pnpm lint        → 0 errors, 0 warnings
pnpm typecheck   → pass
pnpm test        → 11 files / 51 tests passed（新增 ai-connections 7）
pnpm test:e2e    → PASS
pnpm test:agent  → PASS
pnpm test:command → PASS
pnpm test:v12    → PASS
node scripts/package-smoke.mjs → 打包版 PASS（最终构建后已复跑）
```

`v12-e2e` 覆盖：

- 点击侧栏设置不改变路由，打开弹层
- UI 创建连接、测试 L1/L2/L3、同步模型、切换默认模型
- 关闭弹层，发送 Agent 消息，真实流式运行完成
- 重启后连接、密钥、默认模型、运行历史恢复
- 外部 Agent 检测返回 Claude Code 与 Codex 两项
- 1440 显式折叠侧栏宽度 76px、项目文字隐藏、无横向溢出

## 4. 截图

新增/更新：

- `docs/screenshots/1440x900-light-settings.png`
- `docs/screenshots/1440x900-dark-settings.png`
- `docs/screenshots/1440x900-light-settings-models.png`
- `docs/screenshots/1024x768-light-settings.png`
- `docs/screenshots/1024x768-dark-settings.png`
- `docs/screenshots/1440x900-light-sidebar-collapsed.png`
- `docs/screenshots/1024x768-dark-sidebar-collapsed.png`

共 34 张，覆盖原有页面 + 设置弹层 + 折叠侧栏。

## 5. 已知限制

- 连接测试 L4 未自动执行；模型能力显示“未知”，不宣称工具调用。
- 外部 Agent 只检测可执行文件与 `--version`，不读取授权、不执行任务。
- `settings.*` 旧 API 与新的默认连接同步为兼容层；新 UI 不再使用旧设置页。
- 旧连接迁移由 Main 的 `provider.json` 标记 + 连接表是否为空共同保证；删除全部连接后不会自动重建。
- 打包版需在最终构建后重新生成，旧 portable EXE 不包含本期代码。
