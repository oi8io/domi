# 添加模型供应商

> 给 domi 接入新的模型厂商。AC-4 判据：**新增 provider 只需实现接口 + 注册，kernel 与 model/core 的 diff 为 0**。
> 对应 hermes 的 adding-providers + model-provider-plugin。

## 三档做法（从易到难）

| 场景 | 做法 | 要不要写代码 |
|---|---|---|
| 厂商 API 兼容 OpenAI / Anthropic 协议 | 配置里声明一家 `custom`（或复用模板）即可 | 不用。见[配置与厂商](config.md) |
| 常用厂商，走 OpenAI 兼容 | 在 `vendors.ts` 加一个模板条目 | 一处纯数据 |
| 协议不兼容的厂商 | 实现 `ModelProvider` + 在 `factory.ts` 注册适配器 | 两个文件 |

## 第一档：配置声明（零代码）

```yaml
model: { provider: my-llm, name: my-model }
providers:
  my-llm:
    vendor: custom          # 或直接填 openai / anthropic / deepseek / gemini
    protocol: openai        # custom 要自己选协议
    base_url: https://llm.example.com/v1
    api_key: ...            # 或写进 ~/.domi/secrets.yaml
    capabilities: { toolCall: true, vision: false }   # 显式覆盖能力矩阵
```

模型清单会按 `/v1/models` 自动探测（`model/src/probe.ts`）；探测失败用 `models:` 清单兜底。

## 第二档：加厂商模板（vendors.ts）

`packages/config/src/vendors.ts` 加一个 `Vendor` 条目：`{ id, label, protocol, adapter, defaultBaseUrl?, capabilities, envNames, keyHint }`。

- **能力矩阵必须如实填**（toolCall / vision / reasoning / promptCache / structuredOutput）——调用未声明的能力会在发请求前抛错。
- `envNames`：惯用 key 环境变量（`DOMI_<ID>_API_KEY` 之外再认的）。
- Web 的「新增 provider」表单、模型层的适配器选择、doctor 的检查全都从这份模板来——**别的地方都不再写厂商名单**（`guard:providers` 扫全仓）。

## 第三档：实现 ModelProvider（factory.ts）

1. 实现 `ModelProvider` 接口（`packages/model/src/provider.ts`）：

   ```ts
   interface ModelProvider {
     readonly id: string
     readonly capabilities: ModelCapabilities
     generate(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
   }
   ```

   `ModelEvent` 只有六种：`delta` / `reason` / `tool-call` / `usage` / `error`。**`usage` 必须是原始字段**——缓存命中率与压缩的 cache 前缀判断都靠它，适配层不做字段归一、不丢字段（ADR-004 逃生口）。

2. 在 `factory.ts` 的 `createProvider` 里注册：连接形状由 `connectionShape(cfg)` 解析（vendor + protocol + adapter），选对的构造器（多数情况用 AI SDK 的 `createOpenAICompatible` / `createAnthropic`，见 `ai-sdk-provider.ts`，不用自己写 SDK）。
3. 需要嵌入向量做语义记忆：`createEmbedder`（`embedding.ts`），不支持就抛 `EmbeddingUnsupportedError`（语义检索自动降级 FTS）。

## 测试

- 用 `StubProvider`（`stub-provider.ts`）——真实 LLM 调用不进 CI 门禁（INV-08）。
- 结构化输出：统一走 `generateStructured`（JSON Schema；不支持的模型用「提示词约束 + 解析重试」兜底）。
- 重试：`retry.ts` 处理可恢复错误（流式中断等）。

## 相关

- 模型层机制：[模型运行时](model-runtime.md)。
- 配置与 secrets：[配置与厂商](config.md)。
- 有 PRD 依据（INV-10），改动登记在任务文件里。
