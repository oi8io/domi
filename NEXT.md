在做: 2026-09-23 M12 第二轮完成（TASK-M12-006…009），`pnpm check` 全绿（1419 pass / 0 fail）：
      - 问题框 ask.user：多 tab、a–d + 其他、核对后提交（参考 Claude Code 的 AskUserQuestion）；Web / TUI 同一个状态机
      - 计划必须：任务里动手前先 plan.update，没计划被拦（这一轮不结束）；计划常驻上下文、重开还在
      - 审批跟确认模式走：每次都问要批准；按需只在「先别动 / 先给方案」时要；全部放行不审批；可转长任务
      - 续跑：「计划还剩 N 步 · 继续」（Web 按钮 / TUI /continue），被打断时突出
      - 状态栏常驻显示确认模式；ReviewMode 改名收尾；项目页删了「计划审阅策略」
      - 协议：SCHEMA_VERSION 14（plan.update），MetricsSchema 加可选 plan

下一步: 1. 用户手测 M12 DoD（重点：TUI 问题框的按键手感、任务先写计划、每次都问档的审批、关掉再开的续跑）
        2. M12 进 AC 覆盖强制范围（总 PRD 的 M11 条目先补逐条 AC）；TASK-M11-007 收口
        3. 历史欠账：M10-007 / M4–M6 验证补齐、各里程碑 DoD
        4. 等拍板：TUI 中断（终止方案 S1–S4）、desktop 自启（ADR-021 冲突 + 需要 Rust）

规矩: 做完 = `pnpm check` 全绿（CI 为准）；改协议必须升 SCHEMA_VERSION + legacy fixture + 重新生成文档；
      改已交付功能走回写门，在总 PRD 顶部记一条；任务状态以 docs/tasks 为准，提交里引用的 TASK 编号必须在任务文件里存在。

卡在: 无。daemon 需要重启才能跑新代码；老会话里如果是任务，下一次动手前会被要求先写计划（预期行为）。
