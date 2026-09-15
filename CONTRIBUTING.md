# 参与 domi

谢谢愿意帮忙。先说清这个仓库的几条规矩——它们不是风格偏好，每一条都有 CI 守卫。

## 开始之前

```sh
pnpm install
pnpm check        # typecheck + 全部守卫 + 测试 + L1 回放；必须全绿
```

读这三份再动手：`PRD-VISION.md`（不变量）、`docs/PRD.md` 里你要做的那一条、对应的 `docs/tasks/M*.md`。

## 规矩

1. **每个改动都对应一条 PRD 条目**。任务文件里写 `prd: PRD-Mx-yyy`，`guard:tasks` 会查。
2. **测试先行**。新行为先写一个会失败的测试，再让它通过。修 bug 同理：先红后绿。
3. **守卫要先证明会红**。新增的检查脚本要带 `--inject` 之类的开关，能造出违规并看到它失败。
4. **改 PRD 的验收标准要走回写门**：在 `docs/PRD.md` 顶部记一条回写，写清理由。
5. **事件只增不改**。新增事件类型要升 `SCHEMA_VERSION`，并在 `fixtures/events/` 补一份历史 fixture。
6. **端上没有业务逻辑**。`apps/*` 只经 client-core 与 Domi Protocol 和 daemon 通信。
7. **CI 里不调用真实模型**。需要模型的测试用 `StubProvider` 或假网关。

## 写插件

不用改 domi 本身：`domi plugin scaffold <tool|skill|mcp> <目录>`，写法见 `docs/site/plugin-dev.md`。
官方示例在 `plugins/`。

## 提交

- 一次提交一件事；提交信息写**为什么**，改了什么 diff 里看得到
- 格式：`<类型>(<范围>): <做了什么>`，类型用 feat / fix / docs / refactor / test / chore
- 提交前跑 `pnpm check`

## 从哪里下手

`docs/good-first-issues.md` 里有几个边界清楚、不需要了解全局的任务。
