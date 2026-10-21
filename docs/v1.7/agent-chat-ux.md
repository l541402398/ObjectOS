# ProjectOS V1.7 — Agent 聊天体验

日期：2026-10-20

## 1. 聊天区玻璃拟态

- 会话主面板改为半透明玻璃材质
- 顶部会话头、任务上下文条、消息区、Composer 统一玻璃层级
- Composer 输入框使用内高光玻璃表面，聚焦时蓝色描边
- 浅色与深色主题分别适配

截图：`docs/v1.7/agent-chat-glass.png`

## 2. 任务上下文改为只读

- 移除“当前任务”下拉框
- 不再要求用户先固定任务才能对话
- 当前 Agent 有任务时显示任务名与状态
- 无任务时显示“空闲”
- 提示文案：可直接对话，让 Agent 按需接取或交接任务
- 发送消息不再注入固定 taskId；Agent 通过工具与上下文自行决定接取或交接

## 3. 只保留一个新建入口

- 移除会话切换条里的“新建”
- 保留右上角“新建会话”

## 4. 消息展示统一

- 用户消息统一右侧蓝色渐变气泡
- Agent 消息统一左侧玻璃卡片
- 系统消息居中胶囊
- 用户气泡设置最小宽度，避免短消息被压成一字一行
- Prompt 建议改为横向胶囊，不再纵向堆叠
- 消息间距统一

## 5. 验证

```text
task select count → 0
current task → Kai 显示“笔记图谱视图与反向链接索引 · 进行中”
idle agent → Nova 显示“空闲”
new buttons → 仅“新建会话”
bubble min-width → 64px
pnpm typecheck → PASS
pnpm lint → PASS
pnpm test → 26 files / 121 tests passed
package x64/ia32 → PASS
package smoke x2 → PASS
```

## 6. 产物哈希

```text
9342A0FF873D225D8D7B647FD1A94638709E8AC48939114998448E628C79E110  ProjectOS-1.7.0-win-x64-portable.exe
0882BD27F0E03249D191AF680E5A34EB921C5EE789F3BA2F5D6889CFB5AC05FC  ProjectOS-1.7.0-win-x64-setup.exe
19EF4F77EDFE0160629F8982178A1360342FC4889987EED6223AAAF94A062077  ProjectOS-1.7.0-win-ia32-portable.exe
1B5AF2C367DEC35CA0D270E3A82170EF9FEEB90ECA2D068A13B16C1753A004DF  ProjectOS-1.7.0-win-ia32-setup.exe
0E7513765C6E6778C3A0B088F1A411E8BC06A00B4B637ED94B12B6DE200FD2FF  ProjectOS-1.7.0-linux-x86_64.AppImage
```
