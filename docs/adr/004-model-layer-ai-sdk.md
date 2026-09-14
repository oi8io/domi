# 004 模型层选 Vercel AI SDK + providerOptions 逃生口

- 日期：2026-09-14
- 状态：已采纳

> 编号说明：001/002 由 `PRD-M0-007` 预留给两个 spike（runtime-choice / buildcontext-perf），故本决策顺延至 004。

**Context**：M0 原定"只接 Anthropic，硬编码"，但 ADR-001 把「自定义模型与 API KEY」提为一等需求。自写薄客户端（每 provider 约 300 行）掌控力最强，却要为每个 provider 重复一次；AI SDK 白送多 provider、自定义 base URL 与 key，但会把 prompt cache 控制、reasoning block、provider 特有 usage 字段抽象掉——而这几项恰是后续「压缩 × prompt cache 交叉」（生态零覆盖，见 RECON §2-C）的输入。

**Decision**：用 Vercel AI SDK 打底（**2026-09-14 事实更正**：本 ADR 原文写的是 v5，实际 latest 为 `ai@7.0.99` / `@ai-sdk/anthropic@4.0.53`，按 7.x 落地。大版本号不影响本决策的实质——要守的是"kernel 不直接 import 它"这条边界），但 **kernel 不直接 import AI SDK**——中间隔一层 `packages/model` 的窄接口（`generate(req): AsyncIterable<ModelEvent>`），并从第一天起把 `providerOptions` 与原始 usage 字段**透传到事件流**，不在适配层丢弃。

**Consequences**：多 provider 与自定义 key 白送，M0 省 2–3 天；代价是多一层薄适配。**触发重新决策的条件**：做 PRD-M2-003（cache 感知压缩点选择）时，若 AI SDK 无法读写 cache breakpoint 或拿不到 `cache_read_input_tokens`，则为 Anthropic + OpenAI-compatible 各写一个裸客户端替换该层实现——因为窄接口在，替换是局部的，反悔成本低。
