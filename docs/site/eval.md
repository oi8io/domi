# 评估体系 L1 / L2

> `packages/eval` —— PRD-M2-008 / M6-005 · docs/adr-020 的一部分 · INV-13
> 对应 hermes 的 eval 体系。domi 的立场：**评估以事件流回放为唯一数据源，不新增埋点**；L1 是 CI 门禁，L2 只进 nightly / 手动。

## L1：确定性回放（可进 CI）

`eval/src/replay.ts`：

- **回放的是模型与工具，跑的是真的 kernel**：真的 `buildContext`、真的 `runTurn`、真的终止条件、真的事件流——能抓到「改了 prompt 之后工具调用顺序变了」这类回归。
- **不花钱、不联网**（INV-08）：回放期间任何出站调用都让测试失败（`assertNoNetwork`）；fixture 存模型的原始 SSE 响应流，不是最终结果。
- 判据：工具调用序列 + 事件流等价；从第几次开始对不上给出 `Divergence{index, expected, actual, seq}`。
- 命令：`domi eval run`（CI 里 `pnpm eval`）；`domi eval record <sessionId>` 录制（数据只有事件流，INV-13）。
- **删除测试**：删掉 `packages/eval` 后 kernel / store 测试仍全绿（INV-13 的守卫方式，`check-eval-isolation.ts`）。

## L2：端到端（真模型，不进 CI）

`eval/src/l2.ts`：L1 证明「没改坏」，L2 证明「真能干活」。

- 一题 = 一个目录：`task.yaml`（提示与允许的能力）+ `workspace/`（初始文件）+ `check.ts`（判据，退出码 0 = 通过）。题在 `eval/l2/`。
- 每次都复制到新的临时目录跑，题与题、次与次之间没有残留（AC-2）。
- harness 不认识模型：怎么跑一轮由调用方注入（CLI 用真实的 runtime，测试用替身）。
- `mine.ts`：从 git 历史挖题（PRD-M7-008，M7 会写代码的评估源）。

## 三层测试金字塔（ENGINEERING.md）

| 层 | 占比 | 确定性 | 进 CI？ |
|---|---|---|---|
| 纯函数单测 | ~70% | 完全确定 | ✅ |
| 录制回放（ReplayProvider / L1） | ~25% | 确定 | ✅ |
| 真实 eval（L2） | ~5% | 非确定 | ❌（nightly / 手动，看趋势文件） |

## 相关

- 轨迹与回放的关系：[轨迹与回放](trajectory-and-replay.md)。
- 修 bug 的流程：先写能复现的失败测试 → 再修（ENGINEERING.md 硬规则）。
- `check-ac-coverage.ts`：PRD AC ↔ 测试点名对照，`ACTIVE` 正则决定哪些里程碑强制（M0 / M1 / M7 / M8 / M9 / M10 已强制，236 条 AC）；补完哪个里程碑的验证就把它加进 `ACTIVE`——这是唯一防回退的机制。
