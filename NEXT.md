# NEXT.md

现状: **M15 进行中**——001/002/003/004/005/006/007/008/010/012 已提交（008=4e28c35、012=1be4e78、010=c008580），009 工具输出预算随本提交落地，`pnpm check` 全量 exit=0（1847 测）。M14 全部完成；三个 Chrome 问题已修。
缺陷: BUG-M14-001 已修；RECON S8/S9 已按 007 修复。daemon checkpoint/revert-to 全量并行下 SQLITE_IOERR_VNODE：测试 afterEach 在 close 后等事件循环一轮再 rmSync，已缓解（009 提交含）。
下一步: TASK-M15-011 项目级记忆（order 剩余 009→011→013；012AC-2 保持 P2 不做；SPEC-M15-009 取舍-23：~/.domi/projects/<id>/memory/、rules.md 风格、id=git remote slug 优先 / 无 remote 用 cwd 稳定 hash、索引上限 4k token 每条一行、类型分流偏好→Soul 其余→项目）。
里程碑: **M15 PRD COMMITTED**（12 条全册；SPEC docs/spec/M15.md 28 条取舍 + 事件契约；ADR-029 INV-12 两款；RECON-CONTEXT 基线）。

待清: apps/web/src/session/.ChangesBar.removed-m14.tsx（备份文件，用户确认后删）。
