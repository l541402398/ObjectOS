# ProjectOS Next UI — 遗留问题清单

日期：2026-10-22  
分支：`feature/projectos-next-ui-full-migration`  
基线：`e58fbd2`  
本文对应提交：`ed231d5`（文档提交，不改变产品行为）  
状态：工程交付完成，**未合并 stable，未进行人工视觉签收**

本文只记录本轮全系统 UI 迁移后仍然存在、已验证的问题。已关闭问题见
`OPEN_ISSUES.md`，完整页面矩阵见 `MIGRATION_PROGRESS.md`。

## 0. 结论摘要

- 没有发现新的 P0 数据损坏、业务丢失或 IPC/持久化回归。
- 没有遗留的 Ant `<Modal>` / `<Drawer>` 业务调用点。
- 五项 Design Lab 契约修复均已落地。
- 15 个路由页面全部使用统一光学外壳，60 张跨尺寸/主题截图通过。
- 剩余问题集中在：Settings 的 Radix modal 取舍、Ant 原语残留、少量视觉细节、
  自动化测试缺口、打包签名/跨平台，以及人工视觉验收。
- **稳定分支合并仍应等待人工验收。**

## 1. 遗留问题总表

| ID | 级别 | 领域 | 问题 | 影响 | 建议 |
|---|---|---|---|---|---|
| R-01 | P1（已缓解） | Settings / 焦点 | Settings 仍使用 `DialogShell modal={false}`，依靠自定义 focus guard 阻止焦点逃逸 | 键盘聚焦可被守卫拉回，但 Radix 自身的 modal 语义、inert 背景和屏幕阅读器隔离没有启用 | 将剩余 Ant Select/Dropdown 替换为 Radix/原生控件后，切回 `modal={true}` |
| R-02 | P1（接受） | App shell | `AppLayout`、Command Palette 等仍使用 Ant Dropdown/Tooltip/Badge/Input 等原语 | 视觉外壳已迁移，但 Portal、焦点栈和 Ant 内部行为仍与 Ant 绑定 | 逐组件替换，不要一次性重写 shell |
| R-03 | P2 | 排版 | 图表微标签、编号、状态角标仍有 9–11px 字号 | 正文已满足 12.5–14px 下限，但极小的图表标签在 125% 下仍可能偏小 | 将非图表微标签提升到 11.5–12px；图表标签保持紧凑但要验证 125% |
| R-04 | P2 | Workspace | Monaco 在 1100px 下改为自动换行；字体对比度和滚动条视觉仍偏旧 | 长行不再被裁切，但编辑器观感与页面玻璃外壳不完全一致 | 统一 Monaco 主题 token、滚动条和 1100px 的字号/行高 |
| R-05 | P2 | Settings | 多个详情面板仍有重复的字段/卡片样式，和统一 Inspector 节奏不完全一致 | 功能正确，视觉上仍有“旧 Settings 内容”感 | 按 Models/Skills/Runtime/Tools 四个详情面板统一 section 间距和字段布局 |
| R-06 | P2 | 空数据页面 | Knowledge、Operations、Notifications、Project Center 在空/单条数据时留白较大 | 不是缺失内容，但商业展示时需要更有意图的空状态/上下文栏 | 只在有真实数据时补结构；不要用解释性文案填充 |
| R-07 | P2 | Task Board | 单卡片列中，短卡片叠在同色列背景上时容易被误读为“空白卡片” | DOM 和元素截图均正常，不是数据丢失 | 可给列 body 增加轻微色差或底部提示，降低误读 |
| R-08 | P2 | 页面级构图 | Collaboration、Runs、Resources、Project Settings 仍以全局皮肤 + 原有内容结构为主 | 可用、统一，但还不是逐页定制的最终构图 | 按真实使用频率安排下一轮页面级 polish |
| R-09 | P2 | 覆盖范围 | 60 张矩阵覆盖 15 个路由，但不覆盖 Settings 全局 modal 的暗色/1100、计划审核的全部状态 | 矩阵证明路由，不证明所有浮层状态 | 为 Settings、Plan Review、Task Inspector 单独补状态矩阵 |
| R-10 | P2 | 视频 | 最终 MP4 为 1440×900 浅色单一路径，未覆盖暗色、1100、125% | 不能作为所有主题/尺寸的动态证据 | 如需要，补暗色/窄屏短视频；当前截图矩阵已覆盖静态条件 |
| R-11 | P2 | 无障碍 | 没有 axe/a11y 自动扫描；焦点守卫是 40 次 Tab 的临时验证 | 不能证明所有控件、对比度、ARIA 都符合 WCAG | 引入 axe-core 或等价检查；保存为可重复脚本 |
| R-12 | P2 | 交互测试 | Task Board 拖拽改状态没有独立 E2E；当前覆盖创建/编辑/详情 | 拖拽回归只能靠人工 | 增加 drag/drop E2E 和失败回滚断言 |
| R-13 | P2 | 打包测试 | `test:package` 只验证打包 EXE 创建项目/重启恢复，不覆盖全部页面 | 打包后 UI 回归仍是抽样 | 保留 package smoke；发布前用打包 EXE 跑关键路由 |
| R-14 | P2 | 打包 | NSIS setup 构建失败：`allowOnlyOneInstallerInstance.nsh` 无法打开，疑似 Windows 长路径问题 | 本次只产出 portable EXE；无 setup.exe | 缩短 node_modules 路径/使用短路径构建机，或升级 electron-builder 修复模板路径 |
| R-15 | P2 | 签名 | `Get-AuthenticodeSignature` 确认 portable 与 `win-unpacked/ProjectOS.exe` 均为 **NotSigned**；electron-builder 日志里的 signtool 调用不代表已签名 | Windows SmartScreen 可能提示未知发布者 | 配置有效代码签名证书和时间戳，验证 `signtool verify /pa` |
| R-16 | P2 | 跨平台 | 本次只构建 Windows x64；ia32、arm64、Linux、macOS 未构建/未测试 | 其他平台不可直接交付 | 明确首发平台；其他平台单独出包 |
| R-17 | P3 | 旧样式 | 旧 `.po-*`、`v16.css`、`v17.css` 与 Ant 兼容样式仍然共存 | 选择器优先级和维护成本偏高 | 逐页确认无引用后清理，不要一次性删除 |
| R-18 | P3 | 图标 | 仍有 Ant Design outlined 图标与 Lucide 混用 | 图标线宽/圆角不完全一致 | 逐页替换为 Lucide，保留 Ant 控件必需图标 |
| R-19 | P3 | 文案 | 少量技术性英文仍保留（如 `AGENT TOPOLOGY`、`active`、`P1`） | 多数是技术标签，但与中文界面的统一性可再检查 | 区分“技术标识”与“用户标签”，只本地化后者 |
| R-20 | P3 | 原型路由 | `#/design-lab`、Agent Lab、Approval Lab 仍是 prototype/local-only | 不应被误认为生产流程 | 在导航/说明中保持明确标记，或发布构建隐藏 |
| R-21 | P3 | 仓库体积 | 60 张矩阵图 + 15 页清单 + GIF + MP4 增加仓库体积 | 克隆/PR 体积变大 | 后续可将矩阵图转为 CI artifact；当前保留以便验收 |
| R-22 | P3 | 发布资料 | 没有正式 release notes / 安装说明 / 校验和文档页面 | 拿到 EXE 的人缺少安装与校验上下文 | 随包附 `BUILD_INFO.txt`，补 release notes |`n| R-23 | P2 | 版本混淆 | 应用使用单实例锁；旧 ProjectOS 仍在运行时，启动新 portable 会聚焦旧窗口，看起来像“改版丢失” | 旧窗口内容不是当前 `app.asar`，会误导验收 | 比较版本前先完全退出所有 ProjectOS（含托盘），再启动新包；用 `app.asar` SHA256 校验 |

## 2. P1 详细说明

### R-01 Settings 的 `modal={false}`

**现状**

- Settings 顶层是共享 `DialogShell`，但显式传入 `modal={false}`。
- 原因：Settings 内仍有 Ant `Select` / `Dropdown` Portal；Radix FocusScope 与 Ant
  Portal 同时抢焦点时会递归。
- 已加自定义 focus guard：焦点离开 surface 且不在 Ant Portal 内时，拉回第一个控件。
- 已验证连续 40 次 Tab，0 次逃逸。
- `v12-e2e` 通过连接 CRUD、测试、发现、默认同步、重启。

**残余风险**

- 背景没有 Radix `aria-hidden` / inert 的完整 modal 语义。
- 自定义 guard 只识别已列出的 Ant portal 选择器；未来新增 Ant Portal 可能漏掉。
- 屏幕阅读器用户仍可能遍历到背景应用。

**建议**

1. 将 Settings 中最后一批 Ant Select/Dropdown 替换为 Radix Select/Popover 或原生控件。
2. 删除 `modal={false}`，恢复 Radix modal。
3. 重新跑 `v12` + 40 次 Tab + axe。

### R-02 Ant 原语残留

AppLayout、Command Palette、部分页面筛选器仍使用 Ant Dropdown/Tooltip/Input 等。
这不影响当前交付，但意味着：

- Ant 的 Portal 层级不经过新的 Overlay 栈；
- Tooltip 的焦点行为和 Lucide/Radix 组件不一致；
- 后续升级 Ant 仍可能影响 shell。

建议逐组件替换，不要在发布前做全量重写。

## 3. 视觉与页面级遗留

### R-03 微标签

当前正文/任务描述下限：

- 任务描述：12.5px
- 统计、活动、项目元数据：12px
- 图表柱标签、部分编号：9–11px

契约要求 body 14px、secondary 12–13px、label 12px。9–11px 只应保留给
非正文的图表刻度；如果被用作可读标签，应提升到 11.5–12px。

### R-04 Workspace

- 1100px 下文件树 200px、Diff 200px，Monaco 自动换行。
- 长行不再裁切。
- 仍需检查 Monaco 主题与玻璃外壳的对比度、滚动条、代码字体在 125% 下的观感。

### R-06 空状态

当前演示数据只有 1 个项目、少量任务，Knowledge/Operations/Notifications 的空白
是数据结果，不是渲染缺失。验收时应区分：

- “空状态设计不够” → 可补真实结构；
- “没有数据所以空” → 不应填假数据。

### R-09 / R-10 证据覆盖

已有：

- 15 路由 × 1440 浅色/暗色 × 1100 × 125% = 60 张；
- 15 页 1440 清单；
- Settings、Task Inspector、Run、Command Palette、Plan Workbench 的单张证据；
- 16.91s MP4，覆盖项目中心、任务、编排、Agent、计划审核。

未覆盖：

- Settings 全局 modal 的暗色/1100/125 矩阵；
- Plan Review 每个 Tab、每个风险展开状态；
- 全部 Inspector 的 1100/125；
- 暗色/窄屏视频。

这不阻塞当前工程交付，但属于验收完整性缺口。

## 4. 测试与打包缺口

### R-11 无障碍

没有持久化的 axe 扫描。焦点守卫是本次内联脚本验证，未成为仓库测试。
建议新增 `scripts/a11y-e2e.mjs`，覆盖：

- Settings 焦点循环；
- Dialog/Sheet/Inspector 的 Escape 和焦点恢复；
- 键盘可达的 Tab 顺序；
- 主要页面文本对比度（至少静态 token/合成色检查）。

### R-12 拖拽

Task Board 的拖拽改状态是核心交互，但没有独立 E2E。当前覆盖：

- 创建/编辑/验收；
- 详情 Inspector；
- 任务运行；
- 计划批准后任务生成。

建议补：拖拽到新列、失败回滚、刷新后持久化。

### R-13 打包 UI

`pnpm test:package` 通过：打包 EXE 能创建项目、写 starter files、重启恢复。
它不覆盖所有页面。发布前建议用打包 EXE 再跑一次关键路由 smoke：

- 项目中心 → 任务 → 编排 → Agent；
- Settings 打开/关闭；
- 计划审核 approve。

### R-14 NSIS setup 失败

最新打包命令：

```powershell
pnpm --filter @projectos/desktop package:win
```

结果：

- `win-unpacked`：成功
- portable EXE：成功
- NSIS setup：失败

错误：

```text
!include: could not open file:
...\node_modules\.pnpm\app-builder-lib@...\templates\nsis\include\allowOnlyOneInstallerInstance.nsh
```

该文件实际存在；失败更像 Windows 长路径/NSIS include 解析问题。已尝试从
`C:\p` 短路径 junction 构建，仍失败。当前可用交付物是 portable EXE。

**临时结论**：portable EXE 是可运行的最新编译包；setup.exe 需要单独修复
electron-builder/NSIS 路径后重打。

### R-15 签名

`Get-AuthenticodeSignature` 结果：`NotSigned`。构建日志虽然出现 `signtool.exe`，但没有有效签名。尚未验证：

- 是否有有效代码签名证书；
- 是否带可信时间戳；
- `signtool verify /pa` 是否通过。

不要把“日志里出现 signtool”当成已签名可信。

### R-16 平台

只产出 Windows x64。ia32/arm64/Linux/macOS 未构建、未做 packaged smoke。

## 5. 已接受的限制

1. **Liquid Glass SVG filter / 强制 Aurora 不使用**  
   既有性能证据显示 Electron 下不稳定；继续使用静态光学 fallback。  
2. **App shell 内部 Ant 原语**  
   视觉已迁移，内部原语保留；这是分阶段替换的取舍。  
3. **Design Lab 原型路由**  
   仍存在，但不作为生产流程。  
4. **stable 未合并**  
   这是任务要求，不是缺陷。

## 6. 最新编译包

目录：

```text
release/win-x64/
```

可用产物：

```text
ProjectOS-1.7.0-win-x64-portable.exe
win-unpacked/ProjectOS.exe
BUILD_INFO.txt
```

构建信息：

```text
Version: 1.7.0
Platform: Windows x64
Commit: 5bf195d
Size: 98,522,687 bytes
SHA256: 8808CE158B655976086FA99EAC7130C2DE83D4203FA7A9F5AD52F4E96F50A268
```

打包后 smoke：

```text
PACKAGE SMOKE PASS — packaged EXE creates a project, writes starter files
and recovers after restart.
```

说明：

- `ProjectOS-1.7.0-win-x64-portable.exe` 是最新可运行的便携包；
- NSIS `setup.exe` 因 R-14 未产出；
- `win-unpacked` 可用于调试和再次打包；
- `BUILD_INFO.txt` 记录提交、SHA256 和已知打包限制。

## 7. 建议的下一步顺序

1. **人工视觉验收**：查看 `docs/next-ui/screens/regression/` 60 张和 MP4。
2. **决定是否发布 portable**：若不发布 setup，就在 release notes 明确只提供 portable。
3. **修复 R-14**：短路径/升级 electron-builder，补 setup.exe。
4. **处理 R-01**：Settings 控件迁移后切回 Radix modal。
5. **补 R-11/R-12**：a11y 和拖拽 E2E。
6. **再决定 stable merge**：当前分支不合并。

## 8. 相关文件

- `docs/next-ui/MIGRATION_PROGRESS.md`
- `docs/next-ui/OPEN_ISSUES.md`
- `docs/next-ui/BASELINE_AND_RECOVERY.md`
- `docs/design/PROJECTOS_UI_CONTRACT.md`
- `docs/design/DESIGN_CHANGELOG.md`
- `docs/next-ui/screens/regression/`
- `docs/next-ui/screens/projectos-next-ui-walkthrough.mp4`
- `release/win-x64/BUILD_INFO.txt`



## 9. 本次截图核验（2026-10-22）

用户提供的旧计划草案截图包含 `计划草案` / `计划审核台` 文案，这两个字符串
不在当前 renderer 源码，也不在当前 `app.asar` 中。当前正式计划审核使用：

- `PLAN REVIEW · R1`
- 四个图标-only 阶段节点
- 独立选中阶段摘要
- 无横向阶段卡片

打包后 `release/win-x64/win-unpacked/ProjectOS.exe` 已实际生成计划并截图为
`docs/next-ui/screens/packaged-plan-review.png`。

运行中的 portable 解压目录 `%TEMP%\ProjectOS-1.7.0\resources\app.asar` 与
`release/win-x64/win-unpacked/resources/app.asar` 的 SHA256 均为：

```text
9313A3797C90EA4F7E69CD022F435E79E78FAC96EB83EE3EC2A63E073DC37A53
```

说明 portable 与已验收的 win-unpacked 是同一份代码。若仍看到旧界面，先完全退出
所有 ProjectOS 进程（单实例锁会聚焦旧窗口），再启动新包。

