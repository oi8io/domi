# NEXT.md

现状: **M15 已完成（DoD 前）**——001–013 全落地并提交（001-004 早期、005-007 中段、008=4e28c35、009=60828d1、010=c008580、011=46a1911、012=1be4e78、013=本次提交含 AC 对账 docs/qa/M15-ac-audit.md）。全仓 `pnpm check` exit=0（1856 测 / 205 文件）。M14 全部完成；三个 Chrome 问题已修。
缺陷: BUG-M14-001 已修；RECON S8/S9 已按 007 修复。daemon checkpoint/revert-to 全量并行下 SQLITE_IOERR_VNODE：测试 afterEach 在 close 后等事件循环一轮再 rmSync，已缓解（009 提交含）。
下一步: **M16 准备**——等待用户：① DoD 真机复测（003 AC-7 缓存损失 ≤64 token / 008 AC-6 记忆成功率 ≥90%，可试 MINIMAX/ZAI/OPEN_ROUTER key，结果写回 RECON）；② DoD 用例（good-first-issues 最小编号一条 ≥40 步）；③ `.ChangesBar.removed-m14.tsx` 备份文件确认删除。
里程碑: **M15 交付（DoD 前）**（12 条全册；SPEC 28 条取舍；012 AC-2 按决策记录 §7 保持 P2；AC 对账 docs/qa/M15-ac-audit.md；RECON S8/S9 🟢）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
