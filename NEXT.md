# NEXT.md

现状: TASK-M14-003 改动 tab（PRD-M14-005）已提交：右侧栏 Inspector 骨架 + 改动 tab + StatusBar +N −M pill + ChangesBar 迁移移除；pnpm check 全绿 1600 pass / eval 1/1。

下一步: TASK-M14-004 进度 tab（= PRD-M14-004，planView/stepIntervals/subagentTree/turnSummary → progressTab.tsx，复用 $inspector 默认 task 开 progress）。
        其后：005 双向联动 → 006 上下文 → 007 产物 → 008 diff 行评论 → 009 TUI 右侧栏 → 010 回到这一步 → 011 收口。
        M14 DoD 最终手测需用户验收（10 个任务完成后）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
