在做: 2026-10-06 M14 会话右侧栏 Inspector（docs/tasks/M14.md，PRD v1.20）：TASK-M14-000/001/002 已提交。
      - 002 checkpoint 接线（PRD-M14-003）完成：ShadowRepo.clean/diffFiles/restorePath（git 影子仓库，不动工作目录 .git）；
        runtime CheckpointController（fs.write/fs.edit/shell.exec 成功才 after；无变化跳过；git 缺失/超时 5s 降级 ok:false）
        + 区间规则纯函数（本轮/全会话/某一步）；daemon 三 RPC（checkpoint.diff/discard/discard.undo，busy 拒绝）；
        事件落盘顺序 = 基线 → 原有 → 快照 → tool.result；bench/shadow-snapshot.ts（中位数 140ms · P95 716ms）。
        新增测试 31 全绿（checkpoint 6 + runtime 19 + daemon 3 + eval 3），回归 76 pass 0 fail，typecheck + 5 守卫绿。
      - 001 协议（SCHEMA_VERSION 16）：fs.checkpoint/ctx.fileref/fs.discard + 5 个新 RPC + model.request.ctx 可选 + refs 文件行引用。
      - 000 SPEC+任务拆分：10 条 PRD 全覆盖取舍 + 接口契约 + 不变量映射。
      - 下一步 TASK-M14-003 改动 tab（checkpoint.diff 已接通，client-core changesView/wordDiff → apps/web/src）。
      - M13 状态栏/补充中断/计划等（见下），`pnpm check` 基线 1536 pass（M14-001 前测得）。

下一步: 0. TASK-M14-003 改动 tab（client-core changesView/wordDiff → Web 组件；数据走 checkpoint.diff RPC，已接通）
        1. 其后按 docs/tasks/M14.md 顺序：004 进度 → 005 双向联动 → 006 上下文 → 007 产物 → 008 diff 行评论 → 009 TUI → 010 回到这一步 → 011 收口
        2. M14 DoD 最终手测需用户验收（10 个任务完成后）
        3. M12 进 AC 覆盖强制范围（总 PRD 的 M11 条目先补逐条 AC）；TASK-M11-007 收口
        4. 历史欠账：M10-007 / M4–M6 验证补齐、各里程碑 DoD
        5. 等拍板：desktop 自启（ADR-021 冲突；Rust 已就位）（TUI 中断已由 M13-002 做掉）

规矩: 做完 = `pnpm check` 全绿（CI 为准）；改协议必须升 SCHEMA_VERSION + legacy fixture + 重新生成文档；
      改已交付功能走回写门，在总 PRD 顶部记一条；任务状态以 docs/tasks 为准，提交里引用的 TASK 编号必须在任务文件里存在。

卡在: 无。daemon 需要重启才能跑新代码；老会话里如果是任务，下一次动手前会被要求先写计划（预期行为）。
