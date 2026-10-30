# 本轮 UI 交付索引

产品与同版验证证据提交：`631efd639b4c37eec998b293f3f92c36326478f6`。
分支：`codex/premium-system`；基础：`7746a49b53875ce33107f99623da0409dc1137f5`。

上述产品提交包含所有 88 个产品源码文件的核对记录与 705 个证据文件（645 张截图，含明确
标注的历史/诊断），并在提交前逐一确认清单中的源码 Git blob 与暂存内容一致、证据无缺失。
本索引只在提交 id 确定后补记；不修改产品实现。

- [实施与真实验证结果](2026-10-30-premium-system.md)
- [详细对照、字体来源和限制](../../design/system-premium/REPORT.md)
- [证据清单](../../design/system-premium/evidence-manifest.json)
- [实际交互录屏](../../design/system-premium/walkthrough/product-ui.webm)

本地可运行构建：`release/win-unpacked/ProjectOS.exe`，与相邻 resources 一起使用。
该目录由 `pnpm package:dir` 生成，EXE 的创建/恢复检查已通过；没有创建 GitHub Release。

最后结果按时间合并检查日志；历史类型检查失败保留，修正测试参数后的类型检查及八项专项
测试通过。产品源码的空白检查通过。原始许可与测试原始日志保留上游/命令输出的行尾空白，
对整个证据目录执行 `git diff --check` 会报告这些空白，不将其解释为产品代码检查失败。

用户提供的 A0 压缩包/解压目录、`scripts/p29-settings-probe.mjs` 和临时 probe 截图目录未纳入
产品提交。Runtime、Main、Server、契约与持久化代码未改变。本轮在审查分支交付，不自动合并。
