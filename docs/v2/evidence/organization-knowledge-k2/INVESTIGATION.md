# K2 实施中发现与修正

2026-11-07，基准 HEAD `168c9ba963d5b17ab62a615f10bcdab44a2c8fba`。

- 首轮定向命令：`pnpm exec vitest run tests/requirement-organization-knowledge.test.ts tests/org-knowledge.test.ts tests/org-connection.test.ts --maxWorkers=1`。
  49 PASS／1 FAIL。失败为“第一工具后撤权，禁止下一次模型请求”的测试等待 failed 超时。
- 单例诊断保留原断言和超时，实际结果为 `run=completed, model calls=2, read_file=denied, approvals=[]`。
  测试夹具以第 3 次授权检查模拟撤权，但读取工具被现有策略提前拒绝，根本没有走实际工具执行前的第 2 次检查。
  第二次模型请求时只有第 2 次检查，因此尚未达到夹具的撤权点。
- 将该夹具改为真实完成的 `create_artifact` 工具，验证其实际完成后，再在下一次模型请求前拒绝权限。
  断言仍要求 Run failed、工具真实完成和模型仅调用一次；没有放宽超时或移除权限检查。
- 文件写入审批后撤权的独立用例已在首轮通过；此次修正不替代它。

最终检查、桌面证据和剩余边界在 REPORT.md 汇总；历史失败不改写为通过。

## 桌面流程

- `desktop-first.log` 使用了折叠侧栏内不可见的文字节点；改为点击实际可见的组织导航按钮。
- `desktop-second.log` 在异步列表读取完成前断言空状态；改为等待该状态出现，未伪造接口结果。
- `desktop-third.log` 发现真实时序问题：输入后立即按 Esc，设置草稿保护尚未由 effect 同步。
  `desktop-fourth.log` 等待导航禁用后可稳定触发保护，证明是同步时机；产品改为 layout effect，在绘制前更新关闭保护。
  `desktop-fifth.log` 不等待导航状态、立即按 Esc，编辑内容保留；最终完整桌面验收再次覆盖同一路径。
- 第四轮在已通过 40 个主题／尺寸／缩放检查后，使用了不在当前组织资料标签内的“AI 拆分任务”定位。
  纠正测试为先切回现有“任务 0”标签；产品不为此新增重复按钮。第五轮完整链路通过。
- 增加编辑器首屏／底部截图，核对窄屏与缩放后可滚动到保存操作。修正资料复选框标题的样式优先级，沿用原有令牌。
- 正式验收启动后移除一处未使用的新增导入，停止首个尚未完成的 lint 运行并重新启动全部验收。
  `preflight-lint.log` 的 46 个 warning 含该导入；最终 lint 为 45 个既有 warning，0 error。

辅助像素比较原计划用 Pillow，当前 Python 未安装 Pillow；未安装依赖或虚构像素结果。
原有 Design Lab 前后 PNG 的实际 SHA256 完全相同，因此使用文件哈希验证逐字节一致，并保留原图人工检查。

## 过时视觉入口与验收编排修正

- 正式运行的旧 `scripts/design-lab-e2e.mjs` 在默认 DAG 查找阶段专属元素时报空元素错误；其后还要求已被用户拒绝的正式审批 Modal。
  `scripts/design-lab-contrast.mjs` 同样在默认 DAG 等待旧阶段任务定位后超时。两次 FAIL 原样保留在 checks.json 与日志。
- 按当前恢复文档选择既有 `scripts/premium-lab-e2e.mjs`，32/32 PASS。证据包装器只重定向输出、修正 data-URL 导入基址；原断言未更改，原脚本 SHA256 对照首轮清单。
  原有基线目录未被覆盖。该脚本的像素诊断另发现既有浅色“待批准”徽标 4.46:1；它不包含在 32 个功能／axe 断言内，不能随功能 PASS 宣称对比度全部通过。
- 40 个 K2 axe 状态均将玻璃对比度标为 incomplete。使用仓库既有 native-compositor 采样器补测新界面，保留全部原有 K2 断言，新增每状态 4.5:1 断言，结果见独立目录。
- 修正新增 K2 验收编排入口，改用当前批准 DAG 与补充对比度入口，并保留每轮源码清单。唯一变化是
  `scripts/org-knowledge-checks.mjs`；产品、契约、功能测试及两个原始 UI 脚本均未变化。
  首轮编排原文保存在 acceptance-coordinator-before.txt。编排脚本定向 lint 已通过；首轮 676 项测试仍对应其原始清单，后续命令对应新的具名清单。
