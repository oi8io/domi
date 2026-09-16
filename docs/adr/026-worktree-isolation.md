# 026 隔离会话用 git worktree，放在 ~/.domi/worktrees/

- 日期：2026-09-16
- 状态：已采纳（PRD-M7-006 · NFR-06）

**Context**：让 domi 在真实仓库里干活时，不能和用户正在改的工作区互相踩。

**Decision**：
- 隔离会话 = 一个 git worktree + 分支 `domi/<会话>`，基于创建时的 HEAD，目录在 `~/.domi/worktrees/<仓库哈希>/<会话>`（用户拍板）。
- 改动审阅以 base 为基准（含未跟踪文件）；逐文件丢弃先把内容存进 `.trash` 再恢复，所以可以撤销。
- 带回原仓库是人工批准动作：squash（默认）/ merge / 只留分支；原仓库相关文件有未提交改动时拒绝，不做冲突处理。
- 删除会话时 worktree 有未提交改动就拒绝；删 worktree 不删分支。

**不选的**：仓库内 `.domi/worktrees/`（要改用户的 .gitignore，且与「数据都在 ~/.domi」冲突）；
整目录复制（大仓库慢、node_modules 等依赖要重装一遍——worktree 同样要装，但不复制 .git）；
直接在用户工作区改 + 步级快照（能回滚，但会和用户同时改的文件冲突）。

**Consequences**：隔离会话里第一次跑测试前通常要装依赖（worktree 不带 node_modules）；验证命令要把这一步算进去。
