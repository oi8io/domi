# NEXT.md

现状: TASK-M14-004 进度 tab（PRD-M14-004）已完成：planView/stepIntervals/subagentTree/turnSummary 纯投影（client-core 10 测）+ progressTab.tsx + Inspector 接线 + 改动 tab {step} 范围（进度步 → 某一步改动）；pnpm check 全绿 1615 pass / eval 1/1。

下一步: TASK-M14-005 双向联动（= PRD-M14-002，locateInTranscript 纯函数 + needOlder 补拉 + flash 高亮；工具卡片 → 右侧栏）。
        其后：006 上下文 → 007 产物 → 008 diff 行评论 → 009 TUI 右侧栏 → 010 回到这一步 → 011 收口。
        M14 DoD 最终手测需用户验收（10 个任务完成后）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
