# NEXT.md

现状: **M15 进行中**——001…010/012 已提交，009（60828d1）、011 项目级记忆随本提交落地，`pnpm check` 全量 exit=0（1856 测）。M14 全部完成；三个 Chrome 问题已修。
缺陷: BUG-M14-001 已修；RECON S8/S9 已按 007 修复。daemon checkpoint/revert-to 全量并行下 SQLITE_IOERR_VNODE：测试 afterEach 在 close 后等事件循环一轮再 rmSync，已缓解（009 提交含）。
下一步: TASK-M15-013 收口与对账（M15 最后一个；对账清单见 docs/tasks/M15.md 013 节；012AC-2 保持 P2 不做；007 AC-6 真机复测缺 DeepSeek key 归 DoD）。
里程碑: **M15 PRD COMMITTED**（12 条全册；SPEC docs/spec/M15.md 28 条取舍 + 事件契约；ADR-029 INV-12 两款；RECON-CONTEXT 基线）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
