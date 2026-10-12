# 提示词分层与 cache 边界

> `packages/prompt` —— 分层可组合的提示词结构体（PRD-M1-003 / 004 · SPEC-M1-004），M15 层排序与 Soul 动态注入见 SPEC-M15-001
> 对应 hermes 的 prompt-assembly。domi 的核心约束只有一条：**prompt cache 按前缀匹配**。

## 层（Layer）

提示词是一串**有序、可缓存标记**的层：`{id, role, priority, cacheable, render}`。

- 分层让「哪一段会变」可见：`cacheable:true` 的层全在稳定前缀里，会变层靠后。
- **`builtin.soul` 是运行时动态注入的层**：它不在 `packages/prompt/src/builtin.ts` 里——`DomiSession.prompt()` 在 turn 开始时从定格快照取 Soul 文本（`memory.promptText(projectKey)`），**非空才 `extra.push({ id:'builtin.soul', role:'system', priority:400, cacheable:true })`**（ADR-019：Soul 极少变，放稳定前缀里）。这就是在源码里找不到 `soul` 层的原因。
- `role` 只有 system / user 两档。同一 role 的层按 priority 排序拼接，靠前更「系统」。

## 优先级排序（PRIORITY，builtin.ts）

| priority | 层 | 内容 | cacheable |
|---|---|---|---|
| 100 | `builtin.identity` | 我是谁（mode 分段：chat / task / subagent） | ✅ |
| 150 | `builtin.guardrail` | 注入防护——先立规矩，再说有哪些能力（PRD-M2-006 AC-1） | ✅ |
| 200 | capabilities | 工具能力声明 | ✅ |
| 300 | `builtin.conventions` | 会话惯例 / 输出约定 | ✅ |
| 400 | `builtin.soul` | **动态注入**（非空才放，ADR-019） | ✅ |
| 450 | `builtin.skills` | 技能清单（catalog，只列不装） | ✅ |
| 500 | userStatic | 用户自定义层的默认落点——仍在稳定前缀内 | ✅ |
| 800 | workspace | 工作区 / 项目上下文 | ❌ 会变 |
| 900 | dynamic | 计划 / 轮级动态内容 | ❌ 会变 |

> 500 以下（含）都是稳定前缀；800 / 900 是会变层。**会变层不能进入 cacheable 层区间**——`CacheBoundaryError` 在构建期抛错，不是运行期才发现。

## 模式分段（M15）

identity 层按 `mode` 分段（`chat` / `task` / `subagent`）——不同模式的「我是谁」不同：普通会话、任务会话（带计划）、子代理（继承主会话意图但角色不同）。分段只影响 identity 层，其余层不变。

## 定格与动态内容（M15）

- **定格（freeze）**：turn 开始时 soul / 仓库规矩 / 技能清单 / 计划 / 环境一次取齐（`session.freeze()`），turn 内不现读（SPEC-M15-003 · INV-12(b)）。来源变化 → 下一 turn 或显式刷新（`ctx.refresh`）生效。
- **动态内容走 notes，不走改写**：计划提示变化 / 环境变化等由 `prompt()` 放进 `PromptParts.notes`（`reason: plan | env | verify | supplement | model_switch`），`withPrompt` 渲染成**追加的 user 块**（不改已发出的消息，前缀 byte 级稳定），loop 再落一条 `ctx.note` 事件让后续轮次也可见（追加送达，允许重复）。

## withPrompt（kernel/preamble.ts）

`withPrompt(history, prompt)` 把 `buildContext` 的**事件投影**（左轨）与 `prompt()` 的**层拼装**（右轨）汇合成一次模型请求：

1. notes 渲染成新的 user 块，push 到 history（追加，不修改旧消息）。
2. system 块（layers 拼出来的文本）unshift 到最前。
3. 稳定 user 块（身份 / 项目信息等，M12 起）splice 到 index 1——紧跟在 system 之后、动态历史之前。

> `PromptParts.dynamic` 字段 M15 起 `@deprecated`：不再拼进最后一条 user 消息，动态内容一律走 notes 追加。

## 层清单与指纹（M15）

- `PromptParts.layers` / `layerHashes`：每一层的内容清单与哈希，runtime 落进 `model.request.ctx.layers`——右侧栏上下文 tab 按层分段展示（M14）。
- **前缀指纹（fingerprint）**：工具 schema / 层 / 每条消息各算一个 FNV-1a 哈希，只记哈希不记内容，落 `model.request.fingerprint`（M15）。下一轮生成前 `fingerprintOf` 对比、`locateBreak` 定位断裂点——前缀变化要么是「预期」（新事件追加），要么是**非预期断裂**（落 `ctx.prefix.break` 观测事件，SPEC-M15-001）。这是「prompt cache 到底有没有被击穿」的运行时证据。

## 系统提示词缓存（上下文管理）

系统提示词 / 工具 schema / 稳定前缀**不是**每次都重新渲染：`packages/prompt/src/cache.ts` 按（projectKey, 层 id）缓存；projectKey 变了缓存失效。改动生效路径只有三条：新 turn / 新项目 / `ctx.refresh`。

## 为什么会这样设计

- **前缀稳定 = 命中率**：domi 把「会变的」全部赶到稳定前缀之后（workspace 800 / dynamic 900），把 Soul 这种低频内容放进稳定前缀（400），把轮级变化用追加（notes）而不是改写——每一条都在为一个目标服务：**稳定前缀 byte 级不变，prompt cache 命中**。
- **层是纯数据**：同样的层拼出同样的文本 → 指纹可复算 → 前缀断裂可观测。
- **Soul 不进事件流**：它是提示词层的产物，不是轨迹——这就是「什么时候放 Soul」的答案：freeze 定格 → prompt() 注入 → withPrompt 汇合，每轮都进，且每轮内容相同（直到定格刷新）。

## 相关

- 两条轨道如何汇合：[Agent Loop 内部机制](agent-loop.md)。
- 遮蔽 / 压缩会替换哪一段、为什么不动前缀：[压缩与 prompt cache](context-compression.md)。
- 测试：`packages/prompt/test/layer.spec.ts`（分层 / 边界 / 缓存失效）。
