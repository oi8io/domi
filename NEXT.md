# NEXT.md

现状: **M15 进行中**——TASK-M15-000 done；001（尺子：前缀指纹/metrics/doctor --context）已提交。M14 全部完成（TASK-M14-000…011，11 提交）；三个 Chrome 问题已修（crypto/revert 子路径、summary 规范、分钟单位）。`pnpm check` 全绿。
缺陷: BUG-M14-001 已修（token 估算中文低估 → `estimateTextTokens`）。
下一步: TASK-M15-002 前缀只增不改（order 001→003→006→002→004→005→008→012AC-1→007→010→009→011→012AC-2；预算与砍价链见 docs/tasks/M15.md）。
里程碑: **M15 PRD COMMITTED**（12 条全册；SPEC docs/spec/M15.md 28 条取舍 + 事件契约；ADR-029 INV-12 两款；RECON-CONTEXT 基线）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
