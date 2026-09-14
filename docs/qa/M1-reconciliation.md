# M1 对账表

> 2026-09-14 · TASK-M1-023 · 由实现会话产出
> **这不是 QA 报告。** QA 必须在独立会话里做（`AGENTS.md` 硬规则）：
> 只加载 `PRD-VISION.md` + `docs/prd/` + 代码，不加载实现过程的对话历史，目标是证伪。
> 本表只回答一个问题：**可追溯链上有没有空格。**

## 四列对账

| PRD-ID | SPEC-ID | TASK-ID | 测试 | 状态 |
|---|---|---|---|---|
| M1-001 多模型接入 | SPEC-M1-001 / 002 | TASK-M1-001/002/003 | `model/capability.spec.ts` · `model/retry.spec.ts` · `scripts/check-provider-isolation.ts` | ✅ |
| M1-002 中途切换模型 | SPEC-M1-003 | TASK-M1-012 | `runtime/model-switch.spec.ts` | ✅ |
| M1-003 分层提示词 | SPEC-M1-004 | TASK-M1-005/006/007 | `prompt/layering.spec.ts` · `cli/run.spec.ts` | ✅ |
| M1-004 prompt cache 命中 | SPEC-M1-004 | TASK-M1-006 | `prompt/layering.spec.ts`（AC-3 前缀 byte 级稳定） | ⚠️ 见下 |
| M1-005 结构化输出 | SPEC-M1-005 | TASK-M1-004 | `model/structured-output.spec.ts`（四类 fixture 齐） | ✅ |
| M1-006 会话管理 | SPEC-M1-006 | TASK-M1-013/014/015 | `store/sessions.spec.ts` · `runtime/title-gen.spec.ts` | ✅ |
| M1-007 实时状态栏 | SPEC-M1-007 | TASK-M1-016/017 | `kernel/metrics.spec.ts` · `kernel/metrics-independence.spec.ts` · `tui/statusbar.spec.tsx` | ✅ |
| M1-008 分发与首次运行 | SPEC-M1-008 | TASK-M1-022 | `cli/cli.spec.ts` · `cli/run.spec.ts` | ⚠️ 见下 |
| M1-009 日志与故障排查 | SPEC-M1-009 | TASK-M1-018/019 | `observability/logging.spec.ts` | ✅ |
| M1-010 卸载与数据清理 | SPEC-M1-010 | TASK-M1-020/021 | `cli/cli.spec.ts` · `cli/write-paths-guard.spec.ts` | ✅ |
| M1-011 步级快照与回滚 | SPEC-M1-011 | TASK-M1-008/009/010/011 | `checkpoint/shadow.spec.ts` · `checkpoint/revert.spec.ts` · `tui/revert-dialog.spec.tsx` | ✅ |

**没有空格。** 每条 PRD 都有 SPEC、有 TASK、有指名道姓的测试文件。

## 两处 ⚠️ 的实话

**M1-004 AC-1/AC-2 没有真实数据。**
AC-3（前缀 byte 级稳定）是 CI 门禁部分，已绿。但 AC-1（第二轮起 `cache_read_tokens` > 0）
与 AC-2（10 轮会话命中率写入 `bench/cache-hit.jsonl`）依赖**真实 provider 调用**，
按 INV-08 不进 CI，需要 nightly 跑。**目前没有 nightly，所以这两条是空的。**
不是做了没测，是**没做**——`scripts/measure-cache.ts` 与 `bench/` 都不存在。

**M1-008 AC-1/AC-2 没有产物。**
`bunx domi` 与四平台单二进制需要 CI 构建与干净容器冒烟，本轮只做到「命令面跑通」。
`scripts/smoke-binary.sh` 不存在。

这两处在进入 M2 的再批准门上必须处理：要么补，要么正式降级并记 ADR。
**不要因为对账表上有 ✅ 就以为 M1 全做完了。**

## M1 DoD 的状态

> 原文：连续 5 个工作日用 domi 完成自己的真实开发任务且不切回其他工具；
> 其中至少发生 1 次真实的步级回滚；产出一段 30 秒 GIF。

**未达成，且我完成不了。** 这条 DoD 的判据是「你愿不愿意每天用它」，
只能由你用五天来回答。代码侧我能做的已经做完；那五天是 M1 真正的验收。

在此之前，M1 的正确状态是 **「代码就绪，等 dogfooding」**，不是「完成」。

## 数字

- 测试：**331 个，全绿**
- 守卫：**10 道**（biome / depcruise / kernel 纯度 / append-only / 契约快照 / 任务 lint / ADR 字段 / 凭据扫描 / provider 隔离 / 写入路径）
- 每一道都造过违规 fixture 验证它会红——没被证伪过的守卫等于没有守卫

## 12 条不变量逐条对照

| INV | 状态 | 守它的东西 |
|---|---|---|
| INV-01 事件只增不改、永远可解析 | ✅ | 契约快照 + `schema-compat.spec` + `check-append-only` |
| INV-02 架构边界 | ✅ | depcruise 四条规则，含 `no-logic-in-apps` / `no-react-in-client-core` |
| INV-03 权限默认拒绝 | ✅ | `permission.spec` 默认值断言；回滚确认框同样默认取消 |
| INV-05 Tool 唯一执行原语 | ✅ | 编译期（Tool 必含 capability）；AI SDK 的 tool 故意不给 execute |
| INV-07 main 可跑 | ✅ | CI + `pnpm check` |
| INV-08 真实 LLM 不进 CI | ✅ | 全程 StubProvider / MockLanguageModelV4 |
| INV-10 任务反查 PRD | ✅ | `lint-tasks`，两个任务文件 45 条全部可反查 |
| INV-11 数据不出本机 | ✅ | `scan-secrets` + `check-write-paths` + 日志脱敏 |
| INV-12 压缩不销毁原始事件 | ✅ | revert 标 dead 不删除，`revert.spec` 守 |
| INV-13 评估以回放为唯一数据源 | ⚠️ | M1 未触及；但 M1 没有新增任何旁路埋点，指标是纯投影 |
| INV-06 / INV-09 | — | M1 无 MCP、无 Soul |
