# ProjectOS V1.7 — 组件收口与项目扫描修复

日期：2026-10-20

## 1. 组件样式收口

新增全局约束：

- 按钮文字禁止换行
- Button 最小高度统一
- Tag / Badge / Form Label 禁止断行
- Card 标题、Select 选中项、Table 单元格省略与垂直居中
- 输入框、TextArea 统一高度与行高
- Message / Notification 文本与背景对比
- 页面 Header、Session 行、Agent 行最小宽度与省略
- 知识库元信息不再挤断时间
- Primary Button 强制白色文字，避免浅色背景下文字消失

同时重做知识库项目索引卡：

- 语言 / 包管理 / Git HEAD 三栏摘要
- 框架、模块、关键依赖使用标签
- 扫描警告独立提示条
- 不再直接显示一大段原始文本

截图：`docs/v1.7/knowledge-scanned.png`

## 2. 知识库扫描失败的原因

旧扫描器只读取项目根目录的 `package.json`：

- 项目实际是 monorepo 或父目录，`package.json` 在 `frontend/`、`service/` 等子目录
- 根目录没有清单时，旧逻辑仍写“package.json 解析失败”
- 没有递归语言/框架/包管理器检测
- 扫描结果已存在时直接 return，重新扫描不会更新知识库
- 知识库没有重新扫描入口

因此出现：

```text
语言：未知
包管理器：未知
框架：未知
模块：未知
警告：package.json 解析失败
```

## 3. 新扫描器

- 递归扫描最多 4 层
- 支持嵌套：
  - `package.json`
  - `pom.xml`
  - `build.gradle`
  - `pyproject.toml` / `requirements.txt`
  - `go.mod`
  - `Cargo.toml`
  - `composer.json`
  - `Gemfile`
  - `*.csproj`
- 语言按扩展名统计：
  - TypeScript / JavaScript / Vue / Svelte
  - Java / Kotlin / Scala / Python / Go / Rust
  - C# / PHP / Ruby / Swift / C / C++
- 包管理器检测：
  - pnpm / yarn / npm / bun
  - maven / gradle / go modules / cargo / pip / composer / bundler / nuget
- 嵌套 lockfile 也参与检测
- 框架识别：
  - React / Vue / Angular / Svelte / Next.js / Nuxt
  - Vite / Electron / Ant Design / Express / NestJS
  - Maven / Gradle / Spring / Go Modules / Cargo / .NET
- 根目录没有 `package.json` 时不再伪造“解析失败”
- 只有真正损坏的清单才记录解析错误和路径

## 4. 重新扫描与知识更新

- 知识库新增“重新扫描项目”
- `indexSnapshot` 现在会更新已有索引，而不是直接 return
- 重新扫描后：
  - 语言、框架、模块、依赖、警告都刷新
  - 不会产生重复的项目索引卡

## 5. 验证

```text
tests/project-analyzer.test.ts
  ✓ scans nested frontend/backend projects
  ✓ does not report a missing manifest as a parse failure
  ✓ reports a genuinely malformed package.json with its path

Test Files  26 passed
Tests       121 passed
```

实际 E2E：

```text
languages   [ Java, TypeScript, JavaScript ]
frameworks  [ Java / Maven, Spring, React, Vite, TypeScript ]
manager     npm
warnings    []
rescan      snapshots=1, body contains Ant Design
PROJECT SCAN REFRESH PASS
```

打包：

```text
x64 / ia32 package  → PASS
package smoke x2    → PASS
```

## 6. 产物哈希

```text
3F0BF6DFCEA50B211A9493F6600FF97414264D17336944169B058C623A20A88B  ProjectOS-1.7.0-win-x64-portable.exe
818AED7D19B6EE7B0EEA1CC626FEBA7E9E628033F0B3D2F2BE85D37FCCDB76C5  ProjectOS-1.7.0-win-x64-setup.exe
734C2E8E6FB57FA73FBC0BFDDAA73BB6028F632193D819EB3D223BFA99210F37  ProjectOS-1.7.0-win-ia32-portable.exe
C4BDD2F4F4C8D844ACD426BC720FD9E279F55E451327C5898A4DD19D2131A044  ProjectOS-1.7.0-win-ia32-setup.exe
ECBB59E9261E3A257A63DA455158676A6200E5F05C0BD27CD9F7DF5BDE09E283  ProjectOS-1.7.0-linux-x86_64.AppImage
```
