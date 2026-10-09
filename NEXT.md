# NEXT.md

现状: **M15 进行中**——001/002/003/004/005/006/007/008/010/012 已提交（012 AC-1=008、012 AC-2 保持 P2；008 提交 4e28c35+c5adff5、012 提交 1be4e78+907e83d、010 提交 c008580）。M14 全部完成；三个 Chrome 问题已修。`pnpm check` 全量偶发 SQLite disk I/O error（并行负载，daemon 单跑 146 测全绿），代码判据 exit=0。
缺陷: BUG-M14-001 已修；RECON S8/S9 已按 007 修复（内部会话拒绝+迁移、结构化 submit_items 降级+数组偏差，状态 🟢 随本提交落 RECON）。
下一步: TASK-M15-009 工具输出预算（order 001→003→006→002→004→005→008→012AC-1→007→010→009→011→012AC-2；012AC-2 保持 P2 不做；预算与砍价链见 docs/tasks/M15.md）。
里程碑: **M15 PRD COMMITTED**（12 条全册；SPEC docs/spec/M15.md 28 条取舍 + 事件契约；ADR-029 INV-12 两款；RECON-CONTEXT 基线）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
