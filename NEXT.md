# NEXT.md

现状: TASK-M14-010 回到这一步（session.revertTo 三选一 = PRD-M14-010）已完成并提交：runtime session.revertTo（scope≠conversation 时 stepStartSnapshot 取步起点快照 → ShadowRepo.restore 打 undo 快照 + read-tree，conversation 只落 revert 事件；INV-01/12 不删事件）；daemon host.revertTo + core case（busy 守卫 error.busy.revert；CheckpointError → INVALID_PARAMS）；client-core store.$dead（revert 事件 → dead seq 集合）+ DomiClient.revertTo；Web 端 RevertDialog（三选一 files/conversation/both + REVERT_SIDE_EFFECT_NOTICE 文案 + busy 禁用）、进度 tab 步骤「回到这一步之前」入口 + 已回滚标注、改动 tab step 范围条入口 + dead 徽标、Transcript data-dead（标已回滚但可读）。check 全绿 1689 pass / 0 fail / eval 1/1。
下一步: TASK-M14-011 收口对账（对账 007 清单「访达/默认程序打开/引用到输入框」实际未实现；AC 编号点名；PRD.md M14 行改现状 + NEXT + 任务文件全 done）。M14 DoD 最终手测需用户验收（10 个任务完成后）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
