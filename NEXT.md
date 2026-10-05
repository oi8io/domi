在做: 2026-10-05 Web 状态栏瘦身（TASK-M13-011，PRD v1.19）：最多一行（只截断节奏段）；模型与确认模式不进状态栏（输入框上已有，
      「全部放行」警示色搬到模式选择）；主题切换搬到侧栏「设置」右边。TUI 不动。
      2026-10-05 修 BUG-M13-002…005（TASK-M13-010）：状态栏统计口径——ctx% 改为最近一次请求的提示词 ÷ 窗口（原来是全会话累计，
      2572.9k/150k 被截成 100%），自动压缩同步改口径；usage 归一认 AI SDK 7 / DeepSeek 等的缓存读（原来命中率恒 0%）；
      model.request 开流前单独落盘，tok/s 不再含工具时间；工具次数以 daemon 全量聚合为准。
      2026-10-05 修 BUG-M13-001（TASK-M13-009）：`data purge` 目录统计改 `lstatSync` 防符号链接环（ELOOP，
      根源是隔离会话 node_modules 里 pnpm 为 dev 依赖互链建的目录环）；purge 测试隔离 HOME。
      `pnpm check` 全绿（1512 pass / 0 fail，eval 1/1）
      2026-10-04 desktop：加 `pnpm desktop`（scripts/build-desktop.ts）——构建（只打 .app）→ 关旧 app → 替换 /Applications/domi.app → 确保 domid → 重启。本机 Rust 已就位（cargo 1.98.1），macOS 构建+替换验证跑通；README 补用法。
      2026-09-24 过时信息清理 + 删 TOML（TASK-M13-008）：全仓「将来时」里程碑注释 / 报错 / 测试名刷成现状；
      ADR-014 过渡期结束，config.toml 不再读取、`domi init --from-toml` 删除，doctor 只提示残留文件（PRD v1.18）；
      README / HANDOFF / good-first-issues / quickstart 跟上。`pnpm check` 全绿（1511 pass）
      2026-09-24 M13 运行中对话完成（TASK-M13-000…007），typecheck / lint / 全部 guard / test（1514 pass）/ eval 全绿：
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
        4. 等拍板：desktop 自启（ADR-021 冲突；Rust 已就位）（TUI 中断已由 M13-002 做掉）

规矩: 做完 = `pnpm check` 全绿（CI 为准）；改协议必须升 SCHEMA_VERSION + legacy fixture + 重新生成文档；
      改已交付功能走回写门，在总 PRD 顶部记一条；任务状态以 docs/tasks 为准，提交里引用的 TASK 编号必须在任务文件里存在。

卡在: 无。daemon 需要重启才能跑新代码；老会话里如果是任务，下一次动手前会被要求先写计划（预期行为）。
