# good first issue 草稿

> PRD-M6-004 AC-4 要求仓库里开着 ≥5 个带 `good first issue` 标签的 issue。
> 下面五个是草稿，**需要维护者在 GitHub 上开出来**（`gh issue create --label "good first issue" …`）。

## 1. `domi trace` 读分支会话时带上父链（OPT-M3-007）

`packages/trace/src/cli.ts` 用 `log.read(sessionId)`，分支会话只显示自己那一段。改成 `readLineage`，
并在轨迹里标出「继承自父会话」的那一段。验收：`packages/trace` 加一个分支会话的测试。

## 2. 状态栏显示 prompt cache 命中率（PRD-M1-004 AC-4）

`packages/kernel/src/metrics.ts` 已经有 `cacheRead`。在 `session.metrics` 里加一个命中率字段，TUI 与 Web 的状态栏都显示。

## 3. `domi session list` 支持 `--json`

`packages/cli/src/run.ts` 的 `session` 分支。`--json` 已经在参数解析里了，只是这个命令没用上。

## 4. Web 端从 task.spawn 行跳进子 agent 会话

`apps/web/src/Transcript.tsx`：`kind: 'task'` 且 summary 是子会话 id 的行，加一个「看过程」按钮，调 `onOpenSession`。

## 5. word-count 插件支持 glob

`plugins/word-count/tools/count.ts` 现在只收具体路径。加一个 `pattern` 参数——注意插件拿不到文件列表，
需要先在插件 API 里加一个 `ctx.listFiles(glob)`（宿主按 manifest 的 read 权限过滤），这是一个小的 API 扩展，要走 ADR-022 的版本规则。
