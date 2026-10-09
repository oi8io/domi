# NEXT.md

现状: **M15 进行中**——001…007 已提交（尺子/前缀/厂商适配/超窗不崩/遮蔽清理/压缩 v2/记忆可靠；007 拆 3 笔 73291a7/42ae657/af33ca9，覆盖 AC-1…AC-6，S8/S9 状态更新待提交 RECON）。M14 全部完成；三个 Chrome 问题已修。`pnpm check` 全绿（exit=0）。
缺陷: BUG-M14-001 已修；RECON S8/S9 已按 007 修复（内部会话拒绝+迁移、结构化 submit_items 降级+数组偏差）。
下一步: TASK-M15-012 上下文 tab 补全 AC-1（order 001→003→006→002→004→005→008→012AC-1→007→010→009→011→012AC-2；预算与砍价链见 docs/tasks/M15.md）。
里程碑: **M15 PRD COMMITTED**（12 条全册；SPEC docs/spec/M15.md 28 条取舍 + 事件契约；ADR-029 INV-12 两款；RECON-CONTEXT 基线）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
