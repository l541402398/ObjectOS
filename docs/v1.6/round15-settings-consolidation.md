# ProjectOS V1.6 — 设置信息架构收敛与 Harness 测试修复

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 1. 移除 Agent 路由设置页

- 设置导航移除“Agent 路由”
- 删除 RoutingPanel 页面与设置入口
- 后端路由数据保留以兼容历史，但不再暴露 UI

## 2. Harness 测试改为系统自动执行

- 不再弹窗让用户输入测试 Prompt
- 点击“测试”直接由系统发送固定验证 Prompt：
  `Reply with exactly: PROJECTOS-HARNESS-OK`
- CLI 使用 Runtime.execute
- ACP 使用 Runtime.acpPrompt
- 结果以内联 `pre` 展示，含成功/失败状态
- 测试中按钮 loading

## 3. AI 连接已桥接到 Harness

根因：ProjectOS 的 AI Connection 与外部 Harness 的认证原本完全隔离。

修复：

- RuntimeExecutionService 读取当前 ProjectOS Provider 配置
- 根据 Base URL / Provider 注入对应环境变量：
  - `DEEPSEEK_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `GEMINI_API_KEY`
  - `DASHSCOPE_API_KEY`
  - `OPENAI_API_KEY` / `OPENAI_BASE_URL`
- 只传给被启动的 Runtime 子进程，不写 SQLite/日志

真实 UI 验证：

```text
inline [completed] PROJECTOS-HARNESS-OK
HARNESS AUTO TEST UI PASS
```

## 4. 移除外部 Agent 设置页

外部 Agent 与 Runtime Harness 功能重叠：

- Claude Code / Codex 已由 Runtime Harness 统一管理
- 删除 ExternalAgentsPanel 设置入口与页面
- 后端 externalAgents API 保留以兼容旧数据

## 5. 移除第三方连接页

- 该页只是设置跳转，没有独立功能
- 删除 Integrations 设置入口与页面

## 6. 新增 Skills 管理

设置中心新增：

- Skill 列表
- 导入 SKILL.md
- Front Matter 解析 name / version / description
- Skill 详情 Drawer
- 内容与来源展示

截图：`docs/v1.6/settings-skills.png`

## 7. 设置视觉层级增强

- 每个设置页增加渐变玻璃 Hero 头部
- 左侧渐变强调线
- 光照球、边框高光
- 标题字号提升至 24
- 表格/表单区域保持高对比不透明

截图：

- `docs/v1.6/settings-runtime-autotest.png`
- `docs/v1.6/settings-skills.png`
- `docs/v1.6/settings-runtime-redesign.png`

## 8. 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
Harness 自动测试→ PASS（真实 DSH）
真实安装 Qwen   → PASS
package:win     → PASS
package-smoke   → PASS
```

## 9. 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `36DD490F309896735A7DC34DF9C2834210801703C11AB6A16401FFA11B8CB330`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `17C7D21324C51D9B2F8E3FE75A1391B66516E520B53465314190672118265192`
