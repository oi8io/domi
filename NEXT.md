# NEXT.md

现状: TASK-M14-005 双向联动（= PRD-M14-002）已完成：locateInTranscript/changeFileSeq 纯投影（client-core 5 测）+ Transcript 工具卡/计划卡/路径文本可点 → 改动/进度 tab（记手动打开）+ 右侧栏条目 ◎ 定位（needOlder 循环补拉 + 滚动 + flash 1.2s）；pnpm check 全绿 1624 pass / eval 1/1。

下一步: TASK-M14-006 上下文 tab（= PRD-M14-006，model.request.ctx? + kernel 纯计算分段 + 压缩区间起点/读过的文件 seq 映射复用 changeFileSeq）。
        其后：007 产物 → 008 diff 行评论 → 009 TUI 右侧栏 → 010 回到这一步 → 011 收口。
        M14 DoD 最终手测需用户验收（10 个任务完成后）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
