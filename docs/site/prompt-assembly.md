# 提示词分层与 cache 边界

> `packages/prompt` —— 分层可组合的提示词结构体（PRD-M1-003 / 004 · SPEC-M1-004）
> 对应 hermes 的 prompt-assembly。domi 的核心约束只有一条：**prompt cache 按前缀匹配**。

## 为什么是分层而不是字符串模板

提示词是**分层可组合的结构体**，不是 Handlebars 拼字符串。一个 `PromptLayer`：

```ts
interface PromptLayer {
  id: string
  role: 'system' | 'user'
  priority: number        // 拼装顺序只由它决定，与注册顺序无关
  cacheable: boolean      // 内容会变的层必须 false
  render(ctx: PromptCtx): string
}
```

`cacheable` 是这条设计里最重要的字段：**所有 cacheable 层必须在前、且 byte 级稳定**，动态内容（时间戳、状态、本轮消息）一律放最后。这直接决定 prompt cache 命中率，进而决定成本与延迟。很多项目是在成本爆炸后才回头改这个，改起来要动整个提示词系统。

`PromptCtx`：`cwd` / `model` / `dynamic`（会变的东西一律从 ctx 进来，且只允许出现在非 cacheable 层）。

## 拼装与两道编译期错误

`assemble(layers, ctx)`（`layer.ts`）：

1. 校验 `DuplicateLayerError`：id 重复会让「覆盖哪一层」变成运气。
2. 按 `priority` 排序（同优先级按 id）。
3. **`CacheBoundaryError`：cacheable 层排在非 cacheable 层之后直接抛错，不是警告**——警告会被忽略，而这个错误的代价是每一轮都多花几倍的钱：

```
error.cache_boundary: 层 "X"(cacheable) 排在 "Y"(非 cacheable) 之后。
prompt cache 按前缀匹配——前面一旦有会变的内容，后面所有 cacheable 层的缓存都作废。
```

4. 产出 `AssembledPrompt`：`messages`、`layers`（每层字符数与粗估 token，字符数 / 4，ADR-008 决定不引 tokenizer）、**`prefixText`（所有 cacheable 层拼起来的稳定前缀——cache 能不能打中，看的就是它稳不稳）**、`prefixLayerCount`（给 `domi prompt dump` 标前缀边界用）。

内置层在 `builtin.ts`：identity / soul / env / capability / skill / task / guardrail 等；`layersFromConfig` 从配置合并用户自定义层；`mergeLayers` 支持按 id 覆盖（id 是覆盖的依据）。`domi prompt dump` 命令输出拼装结果与每层统计。

## 缓存命中率是可测的

- 状态栏「缓存命中」指标来自 `model.usage` 的原始字段（`@domi/model` 原样透传，ADR-004 逃生口）。
- 压缩时**整段保留 system 前缀**（`memory/compact.ts`）——cache 前缀动一下全场失效，这是「保边」的一头（见[压缩与 prompt cache](context-compression.md)）。
- `bench:cache`（`scripts/measure-cache.ts`）实测缓存命中率，不看文档看账单。

## 相关

- 分层进上下文的组装点：`kernel/src/preamble.ts`（`withPrompt`）与 `runtime/session.ts`。
- 压缩与缓存的关系：[压缩与 prompt cache](context-compression.md)。
- 测试：`packages/prompt/test/`（cache 边界、覆盖、dump 稳定性）。
