# NEXT.md

现状: TASK-M14-007 产物 tab（= PRD-M14-007）已完成：client-core artifactsView 6 测（net diff added/renamed、附件分组、降级推断、产生 seq+约）+ session.artifact RPC（runtime 读 cwd 内文件、文本/二进制截断、防穿越）+ Web artifactsTab + preview（Markdown/图片/代码高亮/CSV 前 50 行/PDF/HTML 无同源沙箱 iframe + CSP，4 测）+「未带回」+ 复制路径。
        006（上下文 tab）也已提交：ctx? + contextView 8 测 + contextTab + session.context RPC。

下一步: TASK-M14-008 diff 行评论 + 审查发现锚行（= PRD-M14-008，ctx.fileref 001 已落：评论攒批 → PendingRef 文件行引用 → kernel buildContext 渲染 + review.findings 锚行）。
        其后：009 TUI 右侧栏 → 010 回到这一步 → 011 收口。
        M14 DoD 最终手测需用户验收（10 个任务完成后）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
