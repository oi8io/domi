# NEXT.md

现状: TASK-M14-009 TUI 右侧栏（= PRD-M14-009）已完成并提交：`i` 开 / 关（输入框空、无弹层）、数字 1–4 切 tab、≥140 列右侧分栏（主区 = 列数 − 40）/ 否则全屏覆盖层（Esc 关）；Inspector.tsx 四个 tab 全部复用 client-core 投影（planView / changesView / artifactsView / contextView，数据源 $events 镜像），改动 tab 用 highlightLines 的 diff 语法着色，产物 tab Markdown 内联；默认 chat 关 / task 开不持久化；parity-checklist.md 新增「右侧栏」节全勾。check 全绿 1676 pass / eval 1/1。
下一步: TASK-M14-010 回到这一步（session.revertTo 三选一 = PRD-M14-010）。其后：011 收口对账。M14 DoD 最终手测需用户验收（10 个任务完成后）。 TASK-M14-009 TUI 右侧栏（= PRD-M14-009）。其后：010 回到这一步（session.revertTo 三选一）→ 011 收口对账。M14 DoD 最终手测需用户验收（10 个任务完成后）。 TASK-M14-008 diff 行评论 + 审查发现锚行（= PRD-M14-008，ctx.fileref 001 已落：评论攒批 → PendingRef 文件行引用 → kernel buildContext 渲染 + review.findings 锚行）。
        其后：009 TUI 右侧栏 → 010 回到这一步 → 011 收口。
        M14 DoD 最终手测需用户验收（10 个任务完成后）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
