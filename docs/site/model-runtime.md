# 模型运行时

> `packages/model` —— ModelProvider 接口、AI SDK 适配、能力矩阵、结构化输出、重试（PRD-M1-001/002 · docs/adr/004）
> 对应 hermes 的 provider-runtime + model-provider-plugin。domi 的模型层只有一层：**所有厂商都归约成同一个 `ModelProvider`**。

## ModelProvider：kernel 认识的唯一接口

```ts
interface ModelProvider {
  readonly id: string
  readonly capabilities: ModelCapabilities   // 静态声明的能力矩阵
  generate(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
}
```

`ModelEvent` 只有六种：`delta` / `reason`（思维链）/ `tool-call` / `usage` / `error`。kernel 不 import 任何 provider SDK（INV-02），只 import 这里的类型。

两个关键设计：

- **能力矩阵静态声明**（`capability.ts`：toolCall / vision / reasoning / promptCache / structuredOutput）。调用未声明的能力会在发请求前抛错——不靠运行时碰运气。
- **ADR-004 逃生口**：`providerOptions` 与原始 `usage` **原样透传**，适配层不做字段归一、不丢字段。缓存命中率（状态栏）与压缩时保住 prompt cache 前缀的判断都靠这份原始 usage——丢了就没有输入。

## 工厂与厂商模板

`factory.ts` 是**唯一知道「有哪些 provider」的地方**（AC-4 判据：新增 provider 只需实现接口 + 注册，kernel 与 model/core 的 diff 为 0）。实现经 AI SDK（`ai-sdk-provider.ts`）：`createOpenAI` / `createAnthropic` / `createOpenAICompatible`。

厂商知识在 `packages/config/src/vendors.ts`（`guard:providers` 扫全仓，SDK 包名只允许出现在 factory.ts）：`openai`（官方 Responses API）/ `anthropic` / `deepseek`（openai 兼容）/ `gemini` / `custom`（自选协议）。每个模板是纯数据：协议、默认地址、默认能力、惯用环境变量名、用哪种适配器。见[配置与厂商](config.md)。

- `connectionShape(cfg)`：vendor + protocol + adapter 三者的解析（PRD-M9-002 AC-3）。
- `createProvider(conn, name)`：配置 → Provider 实例；`providerConfigOf` 把 `providerConnection` 变成工厂参数。
- 自定义 `fetch` 的注入点：企业代理 / mTLS / 测试截流（不能靠改 `globalThis.fetch`——AI SDK 在模块加载时就把它抓走了）。

## 结构化输出与重试

- `structured.ts`：统一走 JSON Schema；对不支持 structured output 的模型用 `Zod schema → 提示词约束 + 解析重试` 兜底，接口对上层一致（`generateStructured` / `StructuredOutputError`）。
- `retry.ts`：可恢复错误的有限重试（流式中断等）。
- `probe.ts`：`/v1/models` 探测（PRD-M9-001，模型清单自动发现；探测失败用配置里的 `models` 清单兜底）。
- `embedding.ts`：L3 语义记忆的向量嵌入（`createEmbedder` / `embedMany`，嵌入不支持 → `EmbeddingUnsupportedError`，语义检索降级 FTS）。
- `stub-provider.ts`：CI 里的模型替身（INV-08：真实 LLM 调用不进 CI 门禁）。

## 相关

- 谁消费：kernel 的 loop（`ProviderLike` 结构同构）与 runtime 的 `model-resolve.ts` / `model-catalog.ts`（模型清单、按 provider 分组）。
- 加一家新厂商：[添加模型供应商](adding-providers.md)。
- 测试：`packages/model/test/`（能力矩阵、结构化输出、重试、factory 注册表；全部打桩）。
