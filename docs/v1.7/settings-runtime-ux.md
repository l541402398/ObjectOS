# ProjectOS V1.7 — 设置运行时 UX 与菜单合并

日期：2026-10-20

## 1. 运行时页重做

- 顶部健康信息收为一行状态条：
  - 运行中 / ready
  - PID、运行时长、活跃运行、待审批、协议版本
- Agent Runtime 标题与操作按钮压缩为一段
- 计数改为工具栏内联摘要：
  - 可用 / 登记 / 待安装
- Runtime 改为玻璃卡片：
  - 名称、协议、来源、状态
  - 可执行文件路径单行省略，悬停显示完整路径
  - 版本、来源
  - 能力标签
  - 测试结果独立区域
  - 操作按钮横向排列，不再纵向堆叠
- 新增筛选：
  - 全部 / 可用 / 未安装
- 安装不完整 / ENOENT 信息放到卡片警告区，不再挤在右侧

截图：`docs/v1.7/runtime-settings.png`、`docs/v1.7/runtime-settings-cards.png`

## 2. 设置菜单调整

- 移除“团队与权限”
- “外观与快捷键”“系统与外观”“通用”合并为“偏好设置”
- 偏好设置包含：
  - 主题
  - 减少透明度
  - 减少动效
  - 侧边栏
  - 数据目录
  - 应用版本 / 平台
  - 快捷键
  - API Key 存储说明
- 设置概览快捷入口同步更新
- 切换设置页时滚动位置重置

截图：`docs/v1.7/preferences-settings.png`

## 3. 验证

```text
settings nav → 无“团队与权限”
settings nav → 单一“偏好设置”
runtime cards → 9
runtime filter → 全部/可用/未安装
switch visible → PASS
pnpm typecheck → PASS
pnpm lint → PASS
pnpm test → 26 files / 121 tests passed
package x64/ia32 → PASS
package smoke x2 → PASS
```

## 4. 产物哈希

```text
CD5A8957CDFC6B420608CD359A90D4AECA63F1340B9F6C1ED9AFE0BF55F0685F  ProjectOS-1.7.0-win-x64-portable.exe
8FEF6036C83EE0DFD3148F9275C742E7BA69B8DA402B3813C28F97DF8AD2C544  ProjectOS-1.7.0-win-x64-setup.exe
0A645F80D7CFD15A139AAE994D3C56C16F0FE0F76ECA8395BE09C2E2296A73C5  ProjectOS-1.7.0-win-ia32-portable.exe
76C732592F82670BEA90A1DEA708860E84DDD2857F231FEED89EAEE2C46E142D  ProjectOS-1.7.0-win-ia32-setup.exe
DBE3C21D47CD691A52D407757C8ED805310299C1CA5DC3F71116BB754B8B0CBB  ProjectOS-1.7.0-linux-x86_64.AppImage
```
