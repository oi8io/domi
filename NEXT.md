在做: 2026-09-24 M13 运行中对话完成（TASK-M13-000…007），typecheck / lint / 全部 guard / test（1514 pass）/ eval 全绿：
      - 补充：跑着时回车 = 补充，进 daemon 队列，loop 在安全点（每步开头 / 收场前）落 user.note，下一步生效；
        可撤回；异常收场退回输入框；正常收场后才到的补充直接开下一轮（user.input.noteIds）
      - 中断：Web「停止」/ TUI Esc → session.interrupt；已输出保留、工具中止、未跑的补 interrupted；
        挂着的询问按 channel=interrupt 结掉；子 agent 一起停；不自动续跑（交给「计划还剩 N 步 · 继续」）
      - 协议：SCHEMA_VERSION 15（user.note；error.stopReason/by；user.input.noteIds），3 个 RPC + 2 个通知
      2026-09-23 M12 第二轮完成（TASK-M12-006…009），`pnpm check` 全绿（1419 pass / 0 fail）：
      - 问题框 ask.user：多 tab、a–d + 其他、核对后提交（参考 Claude Code 的 AskUserQuestion）；Web / TUI 同一个状态机
      - 计划必须：任务里动手前先 plan.update，没计划被拦（这一轮不结束）；计划常驻上下文、重开还在
      - 审批跟确认模式走：每次都问要批准；按需只在「先别动 / 先给方案」时要；全部放行不审批；可转长任务
      - 续跑：「计划还剩 N 步 · 继续」（Web 按钮 / TUI /continue），被打断时突出
      - 状态栏常驻显示确认模式；ReviewMode 改名收尾；项目页删了「计划审阅策略」
      - 协议：SCHEMA_VERSION 14（plan.update），MetricsSchema 加可选 plan
      2026-09-24 修 BUG-M12-002（TASK-M12-011）：会话首屏没撑满屏时拉不到更早历史
      - 根因：daemon 先推事件再回窗口边界（hasOlder 晚到）+ 尾部窗口只有 1 行 → 无滚动条、onScroll 永不触发
      - 修法：hasOlder 翻转重评估顶部取更早（自动补拉）+ 顶部占位可点击兜底（AC-2）+ shouldFetchOlder 纯函数

下一步: 0. 用户手测 M13 DoD（docs/tasks/M13.md 顶部）；**daemon 要重启**才有 session.note / session.interrupt
        1. 用户手测 M12 DoD（重点：TUI 问题框的按键手感、任务先写计划、每次都问档的审批、关掉再开的续跑）
        2. M12 进 AC 覆盖强制范围（总 PRD 的 M11 条目先补逐条 AC）；TASK-M11-007 收口
        3. 历史欠账：M10-007 / M4–M6 验证补齐、各里程碑 DoD
        4. 等拍板：desktop 自启（ADR-021 冲突 + 需要 Rust）（TUI 中断已由 M13-002 做掉）

规矩: 做完 = `pnpm check` 全绿（CI 为准）；改协议必须升 SCHEMA_VERSION + legacy fixture + 重新生成文档；
      改已交付功能走回写门，在总 PRD 顶部记一条；任务状态以 docs/tasks 为准，提交里引用的 TASK 编号必须在任务文件里存在。

卡在: 无。daemon 需要重启才能跑新代码；老会话里如果是任务，下一次动手前会被要求先写计划（预期行为）。
