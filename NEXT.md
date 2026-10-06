# NEXT.md

现状: TASK-M14-008 diff 行评论 + 审查发现锚行（= PRD-M14-008）已完成并提交：评论攒批 $comments（点/拖选 diff 行号、待交条数、切范围保留、关会话提示）→「交给 domi」= commentsToRefs 转 FileRef 挂输入框不自动发；kernel buildContext case ctx.fileref 渲染 `[引用文件] path:l1-l2（新侧）` + 代码块 + 评论文字、paginate 计行；runtime checkRefs/submit 扩 SubmitRef；review.findings 锚行（severity 配色、locate-finding、不在当前改动中、「修这一条」）。007 产物 tab 已在上一提交。check 全绿 1665 pass / eval 1/1。
下一步: TASK-M14-009 TUI 右侧栏（= PRD-M14-009）。其后：010 回到这一步（session.revertTo 三选一）→ 011 收口对账。M14 DoD 最终手测需用户验收（10 个任务完成后）。 TASK-M14-008 diff 行评论 + 审查发现锚行（= PRD-M14-008，ctx.fileref 001 已落：评论攒批 → PendingRef 文件行引用 → kernel buildContext 渲染 + review.findings 锚行）。
        其后：009 TUI 右侧栏 → 010 回到这一步 → 011 收口。
        M14 DoD 最终手测需用户验收（10 个任务完成后）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
