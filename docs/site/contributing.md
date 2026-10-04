# 贡献指南

> 站点版；仓库规矩以根目录 [`CONTRIBUTING.md`](../../CONTRIBUTING.md) 为准。本页把「从哪里下手、要守什么」浓缩成一张图。

## 开始之前

```sh
pnpm install
pnpm check        # typecheck + 全部守卫 + 测试 + L1 回放；必须全绿（CI 为准）
```

读这三份再动手：`PRD-VISION.md`（不变量）、`docs/PRD.md` 里你要做的那一条、对应的 `docs/tasks/M*.md`。

## 规矩（每一条都有 CI 守卫）

1. **每个改动都对应一条 PRD 条目**：任务文件里写 `prd: PRD-Mx-yyy`，`guard:tasks` 会查（INV-10）。
2. **测试先行**：新行为先写一个会失败的测试，再让它通过；修 bug 同理，先红后绿。
3. **守卫要先证明会红**：新增的检查脚本要带 `--inject` 之类的开关，能造出违规并看到它失败。
4. **改 PRD 的验收标准要走回写门**：在 `docs/PRD.md` 顶部记一条回写，写清理由；commit 前缀 `docs(writeback):`。
5. **事件只增不改**（INV-01）：新增事件类型要升 `SCHEMA_VERSION`，并在 `fixtures/events/` 补一份历史 fixture；迁移只能加列 / 加表 / 加索引（`guard:migrations`）。
6. **端上没有业务逻辑**（INV-02）：`apps/*` 只经 client-core 与 Domi Protocol 和 daemon 通信。
7. **CI 里不调用真实模型**（INV-08）：需要模型的测试用 `StubProvider` 或假网关。
8. **commit message 带任务 id**：`feat(kernel): 权限引擎默认拒绝 [TASK-M0-007]`；不要出现任何 AI 作者 / 协作信息。

## 从哪下手

- 最自包含、最不碰核心的两个贡献点：**新增一个 ModelProvider**（[添加模型供应商](adding-providers.md)）与**新增一个 Skill**（[Skill 编写](skill-writing.md)）。
- 边界清楚的小任务：`docs/good-first-issues.md`。
- 想加工具：[添加工具](adding-tools.md)；想写插件：[插件开发](plugin-dev.md)。

## 修 bug 的正确姿势

1. 写一个能复现的失败测试（fixture 优先——很多 bug 是「某种事件序列下的状态错乱」，不落成 fixture 就会反复回归）。
2. 确认它红（守卫同理：先证明会红）。
3. 修，让测试绿。
4. 登记：按 BUG-Mx-yyy 编号写进对应任务文件的「缺陷与待优化登记」。

## 提交

- 一次提交一件事；提交信息写**为什么**，改了什么 diff 里看得到。
- 格式：`<类型>(<范围>): <做了什么>`，类型用 feat / fix / docs / refactor / test / chore。
- 提交前跑 `pnpm check`。
- **凭据不进仓库**：`guard:secrets` 扫 `fixtures` 与 `docs`。
