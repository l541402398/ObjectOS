# ProjectOS V1.6 — AgentDefinition 与任务 / DAG 打通

日期：2026-10-20  
分支：`feature/v1.6-ux`

## 完成内容

### 1. 自定义 Agent 进入项目 Agent 列表

Agent Studio 保存的 `AgentDefinition` 与项目 Agent 使用同一 `agents` 表：

- 自定义 Agent 出现在 `project.overview().agents`
- 可被任务看板选择为 `assigneeAgentId`
- 会进入编排图投影
- E2E 已实际创建并分配任务：

```text
AGENT STUDIO CREATE PASS agt_...
orchestration-visible=idle
capabilities=plan,analyze,implement,review,test,research,coordinate
task=tsk_...
```

### 2. Persona 同步到 DAG 执行上下文

保存 AgentDefinition 时，同时把结构化 Persona 编译为 legacy Agent 的 `system_prompt`：

- 角色
- 专业背景
- 核心职责
- 工作原则
- 沟通风格
- 行为限制
- 自定义 System Prompt

这样任务通过原 AgentRunner 执行时能读取完整人设。

### 3. 分类 → 能力映射

保存时按分类同步 capabilities：

| 分类 | Capabilities |
|---|---|
| code | implement, review, test, analyze |
| architecture | architect, plan, analyze |
| quality | test, review, analyze |
| product | plan, coordinate, analyze |
| design | analyze, plan, review |
| data | analyze, research |
| ops | implement, test, analyze |
| general | 全部 |

AgentRunner 据此生成真实工具目录。

### 4. Skills 生效

AgentRunner 新增：

- 自动技能选择
- AgentDefinition 绑定的 Skills 合并
- 去重
- 真实 Skill 内容进入上下文

### 5. 权限生效

AgentRunner 工具目录按 AgentDefinition 权限过滤：

- `files=false` → 移除 `write_file`
- `shell=false` → 移除 `run_command`、`run_tests`

未授权工具不会出现在模型工具目录中，后端 policy/approval 仍保留。

## 验证

```text
pnpm typecheck  → PASS
pnpm lint       → PASS
pnpm test       → 24 files / 113 tests passed
Agent Studio E2E→ 自定义 Agent 创建 + 任务分配 PASS
package:win     → PASS
package-smoke   → PASS
```

## 仍未完成

- AgentDefinition 的 `primaryRuntimeProfileId` 尚未被 legacy AgentRunner 用于任务执行；任务仍走 Provider 原生 Agent Loop。
- 独立 AgentRun 已支持 DSH / OpenCode 真实 Runtime。
- DAG 的 Agent 节点绑定自定义 Agent 已可见、可分配，但“节点使用其绑定 Runtime 执行”仍需在调度器层切换执行器。

## 产物

- Windows：`release/ProjectOS-1.6.0-portable.exe`
  `554C9121348C7E8969D1E1C08A70DC5561D9C20715130FD6E9A0F77F48014C62`
- Linux：`release/ProjectOS-1.6.0-linux-x86_64.AppImage`
  `94D7E963CE598309FE005AE0313EB5A7643A5A8D86BC72D4DE7251202289C7BD`
