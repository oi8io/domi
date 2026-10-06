# NEXT.md

现状: **M14 全部完成**——TASK-M14-000…011 全 done。10 条需求（PRD-M14-001…010）11 个提交 `[TASK-M14-000…010]`（e64fc2f…df2a1cc，git log 可查）：右侧栏四 tab Web + TUI、双向定位、步级快照接线、改动 tab 范围切换与丢弃、上下文 tab、产物 tab 预览、diff 行评论进输入框、回到这一步三选一回滚。`pnpm check` 全绿 1689 pass / 0 fail / eval 1/1。降级已回写 docs/prd/M14.md §8（005 AC-9 / 007 AC-5 的默认程序打开 / 访达未做，替代为复制路径 + 定位 + 预览；006 AC-7 记忆撤销 P1 不做）。
下一步: **M14 DoD 最终手测需用户验收**（10 个任务完成后；DoD 见 docs/prd/M14.md §7）。验收前无开发任务。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
