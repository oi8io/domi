---
name: git-workflow
description: 开分支、整理提交、变基到最新主干、准备合并请求时用
requires_tools: [shell.exec]
---

# Git 工作流

1. **开工前**：`git status` 确认工作区干净；`git fetch` 后从最新的主干开分支，分支名写清在做什么（`fix/login-timeout`）。
2. **提交**：一次提交一件事。先 `git diff --staged` 看清楚再提交；提交信息的写法见 commit-message Skill。
3. **跟上主干**：`git fetch && git rebase origin/<主干>`。有冲突时逐个文件解决，解决后跑一遍测试再 `git rebase --continue`；拿不准就 `git rebase --abort` 并告诉用户。
4. **推送**：变基过的分支用 `git push --force-with-lease`，绝不用 `--force`。
5. **合并请求**：标题一句话说清改了什么；描述写为什么改、怎么验证的、有什么风险。
6. **停下来问用户**：要改写已经推送到共享分支的历史、要删分支、冲突涉及看不懂的代码时。
