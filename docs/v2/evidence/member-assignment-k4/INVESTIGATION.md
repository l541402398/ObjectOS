# K4 验证记录

## 定向预检

- `server-initial.log`：10 项中 9 PASS／1 FAIL。列表 SQL 没有选择项目角色，输出验证拒绝。
  补齐实际角色列后 `server-second.log` 10 PASS；最终定向集合再次检查服务端、Main、本机。
- `main-initial.log`：39 PASS。`local-initial.log`：5 PASS。`focused-final.log`：54 PASS。
  之后增加独立 Native 撤权及人工关闭后 GET 核对测试，最终全量集合包含这些新增断言。
- `native-revocation.log`：5 PASS／1 FAIL。夹具直接启动了继承工作流的任务，被现有流程守卫正确拒绝。
  改用保存的单节点开发流程和正常流程启动，未绕过守卫；`native-revocation-second.log` 6 PASS。
  实际 Native 文件审批后撤权，文件不存在，且没有第二次模型请求。
- UI 预检之后补充固定回执入口、未提交回执操作的关闭保护，以及状态读取失败时禁用提交。
  保留每轮真实输出，不把较早源文件清单称为最终固定清单。最终报告区分产品更改与夹具修正的范围。
- `assignment-desktop-1.log`：回执丢失、重启不重发、GET 创建唯一需求及项目固定检查通过；模型夹具的
  rationale 只有 7 个字符，被现有“至少 8 字符”校验拒绝。90 秒等待随后超时；未降低校验或增加超时。
  修正夹具说明长度，同时补充可见拒绝／撤销／撤回操作。原 JSON、截图、DOM 和检测结果完整保留在
  `attempt-1/`，原日志仍在本目录。产品代码没有为此失败修改。
- `assignment-desktop-2.log`：分配正文与精确知识版本实际进入模型。夹具误以为旧拆分窗口在“放弃草稿”
  后会关闭；实际实现保留窗口以便再次生成。按实际实现等待拒绝完成，再点击窗口关闭，未更改产品行为。
  第二轮的完整 JSON／DOM／截图保留在 `attempt-2/`。不把需修正的夹具当作完整无人干预通过。
- `artifact-verification-1.log`：实际 EXE 冒烟已通过后，新增的 ASAR 字节比较把 POSIX 分隔符传给 Windows
  版 ASAR API，提示入口不存在。实际枚举归档确认入口存在；按本平台 `path.sep` 读取。只修正验证器，
  不修改／重打产品包，不跳过主程序／preload／界面文件的逐项比较。

## 收尾权限检查

发现旧 `plan.discuss` 不带需求任务来源，可能给已分配计划启动无分配约束的讨论 Run。先扩充 ADR-0087，
再明确拒绝分配需求使用此旧入口，保留现有按需求 Native 流程；个人计划讨论不变。
新增测试在有效与撤销分配时均确认零模型／零新会话，并实际验证个人计划讨论仍能完成。
`legacy-discussion-guard.log` 初次 9 PASS／1 FAIL：测试误以为个人计划无群会话；实际生成计划已建立会话，
因此能正常启动。改为等待真实个人讨论完成，不修改产品以迎合这个错误预期。
这次 Runtime 收尾修改触发新的完整 lint／typecheck／全量测试／构建、四条桌面回归和重打包；
原 197 桌面矩阵的 Renderer 未改变，通过原与新包 122 个桌面文件的逐项校验确认复用范围。

## 视觉来源

已实际查看用户确认的 `docs/design/baselines/2026-10-29-user-confirmed-DAG.png`，重读 UI／材质／Overlay／
恢复／回归文档和当前 Lab、OpticalGlass、Aurora 源码及设计令牌。延用同一会话 K2／K3 记录的实际
Sim Studio 菜单源码、Liquid Glass 安装包／许可证与 Electron 限制、React Bits 归属及 Motion 指南；
没有新的画布／效果接入，不声称重测了 GPU 效果。技能加载器在此运行时不可用，实际本地文件阅读
与查询结果代替虚构“已加载”；源查询及 Impeccable 的真实输出保存在本目录。
