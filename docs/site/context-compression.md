# 压缩与 prompt cache

> `packages/memory/src/{mask,compact,cleanup,strategy}.ts` + `packages/runtime/src/degrade.ts` —— PRD-M2-002 / 003 · INV-12 · SPEC-M15-002/003/004/005
> 对应 hermes 的 context-compression-and-caching。M15 起：遮蔽先于压缩，两者都是**投影**，由预算器降级链驱动。

## 一条核心约束

**prompt cache 按前缀匹配**：前缀里任何一个 byte 变了，整个前缀缓存失效。所以 domi 的全部上下文治理动作都遵守两条纪律：

- **不改写历史**（INV-12）：压缩 / 遮蔽只追加 `ctx.compact` / `ctx.mask` 事件，原始事件一条不动——回放与审计看到的永远是真的。
- **保稳定前缀**：system / identity / 工具 schema / Soul 这类层级内容不压不遮（钉住层，见下）；只对**冷区**动手（早期 tool.result 大文本）。

## 预算器：一个数字驱动三档

占用 = 最近 `model.usage` 输入真值 + 本步增量估算 ÷ 有效窗口。`evaluate(used, effective)`（`kernel/src/budget.ts`）给出档位，与状态栏 / 守卫 / 上下文 tab **同源**（SPEC-M15-002 取舍-16）：

| 档位 | 均衡 | 节省 | 动作 |
|---|---|---|---|
| mask（遮蔽） | ≥60% | ≥45% | 遮蔽一批冷区（≥8k token），落 `ctx.mask` |
| compact（压缩） | ≥80% | ≥70% | `compactNow('threshold')`，可轮中 |
| hard（硬顶） | ≥92%（任何档不降） | 同左 | 本轮停：`error{scope:'context', recoverable:true}` |

`strategy.ts` 注册两个策略名：`balanced`（均衡，默认）/ `economical`（节省）。旧配置 `full` / `clean` / `compact` 读到时映射到 balanced + doctor 警告。**策略是投影逻辑不是前缀内容**，切换即时生效；切换若触发遮蔽 / 压缩，付一次缓存代价。

## 降级链（degrade）

请求前预检（`session.ts` ~1336 注释：「请求前预检（PRD-M15-002 AC-3 · SPEC-M15-002 取舍-17）」）——**遮蔽 → 压缩 → 硬顶，逐级降**：

1. 估占用 → 判档。
2. mask 档：遮蔽动作（注入，见下），腾出就落 `ctx.mask`；**腾不出（freed=0）视为未生效**。
3. 重估 → 仍超：compact 档：压缩动作，失败或腾不出 → 继续往下。
4. 重估 → 仍超 hard：**本轮停**，落 `error{scope:'context', recoverable:true}` + 可执行出路。

每级动作后重估占用，不猜、不跳级。遮蔽 / 压缩动作失败**不阻断**——最终由硬顶收口（不会「压缩失败还把请求发出去」）。

## 遮蔽（mask，M15 · SPEC-M15-004）

`memory/src/mask.ts`：

- **只遮冷区 `tool.result`**：热区（最近几步的 tool 结果、未完成的 tool-call）不遮；`ctx.pin` 钉住的跳过；**已遮蔽的 seq 不再变**（INV-12(b)——遮蔽后事件流继续追加，投影读的是最终状态）。
- 一批的阈值 `maskBatchMinTokens = 8000`：单批落一条 `ctx.mask{seqs, reason, freedTokens}`——遮蔽按「批」记账，不逐条刷屏。
- 投影时（strategy 的 masked 投影）：被遮 seq 的 tool.result 换成**指针**（「已遮蔽，见 ctx.mask」），内容不渲染进模型消息；但事件流里原文还在（INV-12）。

## 压缩（compact，M15 · SPEC-M15-005）

`compactNow`（`session.ts` / `memory/src/compact.ts`）：

1. **先冲刷记忆**（`memory.flush`）——记忆先落盘，压缩才敢动上下文。
2. **保边**（`compactBoundary`）：**最近 `keepSteps=8` 步 且 tokens ≤ `keepTokens=24000`，满足其一即保留**——单轮长任务多步也压得动，且 system 前缀与最近交互永远逐字保留。
3. 被覆盖区间（`fromSeq..toSeq`）换成**结构化摘要**（`SummarySchemaV2` 固定字段：目标 / 动作 / 决策 / 证据 / 未完成，纯文本分隔符）——不拼进提示词，是**模板里的占位**，模型在生成时才填充（不引导模型去模仿 JSON 格式）。
4. **摘要请求复用主前缀**：摘要请求 = 主前缀（buildContext + prompt()）+ 末尾摘要指令——buildContext 和 prompt() 都吃主前缀缓存（E7），摘要请求只多付一点点输出 token。
5. 落一条 `ctx.compact{fromSeq, toSeq, summary, keepSteps, keepTokens}`。原始事件一条不动（INV-12）。
6. **失败熔断**：`COMPACT_FAIL_MAX` 次失败后自动不再触发（不空转）。

投影（strategy 的 compacted 投影）：读最近一条 `ctx.compact`，覆盖区间换成摘要块，区间之外逐字保留；随后再来一次请求时，`refillData(events) + loadedSkillBodies` 回补被压缩的上下文（补水投影，取舍-9 / AC-5）——压过之后新请求能拿回关键材料。

## 钉住（pin，M15 · SPEC-M15-004）

`ctx.pin` 钉住某条事件：遮蔽与压缩都跳过它。典型用途：用户显式引用的文件（`ctx.fileref` 指向的行）、`verify.required` 的待验证内容——「这条不能丢」。

## 为什么遮蔽先于压缩

| | 遮蔽（mask） | 压缩（compact） |
|---|---|---|
| 代价 | 只付一次缓存重写（一批） | 一次 LLM 摘要请求（额外 token + 延迟） |
| 保真 | 指针，信息零丢失（事件流原文在） | 摘要，信息有损 |
| 触发 | 轻（60%） | 重（80%） |

降级链把「便宜且有损为零」的动作排在前面；只有遮蔽腾不出才上压缩。两者都是**投影**（`strategy.ts` 里读 `ctx.mask` / `ctx.compact` 决定渲染什么），原始事件不变——所以任何一步都能被审计复现。

## 相关

- 降级链在 turn 里的位置：[Agent Loop 内部机制](agent-loop.md)。
- 稳定前缀为什么不可动、Soul 为什么在稳定前缀里：[提示词分层与 cache 边界](prompt-assembly.md)。
- 测试：`packages/memory/test/{mask,compact,strategy}.spec.ts`。
