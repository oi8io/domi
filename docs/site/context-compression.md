# 压缩与 prompt cache

> `packages/memory/src/{compact,cleanup,strategy}.ts` + `packages/kernel` 的注册点 —— PRD-M2-002 / 003 · INV-12
> 对应 hermes 的 context-compression-and-caching。

## 第一条原则：压缩不删历史

**压缩不是删历史，是换一种方式把中间那段讲给模型听。** 原始事件一条没动、一个字节没改（INV-12）——`ctx.compact` 只是又一条**追加**的事件。AC-5 的「压缩后从原始事件流重放仍然等价」因此是**免费**得到的：不需要另写一套还原逻辑，因为压根没有东西被改掉。

## 两步走：确定性清理在前，LLM 压缩在后

业界已验证的做法按优先级（`strategy.ts` 注册点，kernel 只提供注册口、永远不知道有哪些策略——PRD-M2-003 AC-6「切换压缩策略实现，packages/kernel diff 为 0」的兑现处）：

1. **结构化清理**（`cleanup.ts`，零成本、确定性）：去重工具结果、规范化冗长输出、清除已解决的错误、截断堆栈。能省 15–30% 上下文且**零信息损失**。必须做在任何 LLM 压缩之前——很多项目直接上 LLM 摘要，白烧钱。
2. **保边压中**（`compact.ts`）：system prompt + 最近 N 轮逐字保留，中间历史换成结构化摘要。**system prompt 整段保留**——它是 prompt cache 的前缀，动一下全场失效；最近 N 轮逐字保留——正在做的事最需要细节。

## 触发与摘要格式

- 阈值给的是**区间**不是点（`TRIGGER_LOW = 0.7` / `TRIGGER_HIGH = 0.75`）：正好卡在 70% 抖动的会话会反复触发压缩，而每次压缩都是一次真实模型调用。所以到 70% 就压，别等 75%——75% 是「最晚也该压了」的上限。`shouldCompact(usedTokens, maxTokens, trigger)`。
- 摘要是**固定字段**而不是自由文本（`SummarySchema`，zod 校验）：`intent`（用户到底想干成什么——丢了它压缩之后模型就开始做别的事）/ `filesModified` / `keyDecisions` / `openQuestions` / `nextSteps`。自由文本摘要有三个问题：没法断言、没法比较、下一次压缩还得把它再压一遍。
- 摘要生成器由外面注入（`Summarizer`）——`packages/memory` 不依赖 `@domi/model`（INV-02）。

## 会话外记忆：L2 情节 / L3 语义

压缩是会话内的投影；跨会话的记忆是另一套投影（`memory.write` 事件 → L3 表），见[记忆分层与 Soul](memory-and-soul.md)。

## 相关

- 分层提示词与 `prefixText`：[提示词分层](prompt-assembly.md)。
- 什么时候触发、谁调用：`runtime/session.ts`（每轮结束算用量，`shouldCompact` 决定要不要压）；状态栏的「上下文占用百分比」是同一份用量投影。
- 测试：`packages/memory/test/`（cleanup 幂等、compact 触发边界、压缩后可重放断言——CI 里有一条「压缩后从原始事件流重放仍然等价」）。
