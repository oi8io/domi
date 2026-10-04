# 记忆分层与 Soul

> `packages/memory`（纯函数）+ `packages/runtime/src/memory-service.ts`（IO 与编排）+ `packages/store/src/semantic.ts`（投影）
> PRD-M4-001…004 · docs/adr/018 / 019 · INV-09。这是 domi 的记忆点——「会积累人格」的实现处。

## 记忆分层模型 L0–L4

| 层 | 是什么 | 存活期 |
|---|---|---|
| L0 | 工作记忆：当前上下文窗口 | 易失 |
| L1 | 会话摘要：`ctx.compact` 结构化摘要 | 随会话 |
| L2 | 情节记忆：可检索的历史事件片段（FTS + 向量） | 跨会话 |
| L3 | 语义记忆：抽取出的事实 / 偏好 / 实体 | 跨会话 |
| L4 | **Soul**：从 L3 蒸馏的稳定人格层 | 长期 |

## 真相与投影的边界

- **所有写入先落事件**（`_memory` 会话，`MEMORY_SESSION_ID = '_memory'`，下划线开头不出现在会话列表里）：`memory.write{layer:'L3'}` 是 L3 的真相。
- `semantic_items` 表是 `memory.write` 事件的**投影**，`SqliteEventLog.append` 在同一个事务里投影（和 FTS 同一个做法）。embedding 是唯一不来自事件的列——它是算出来的缓存，丢了重算即可。
- `MemoryService` 一个 daemon 一个实例，写操作**串行**（soul.md 是全局的，两个会话同时更新会互相覆盖）。
- 记忆抽取用结构化输出（`ExtractionSchema`），来源注释与 `sourceRefs` 指回支撑它的原始事件（AC-2）。

## Soul：人类可读、可 diff、可否决

`soul.md` 是**人类可读的 Markdown**（INV-09，格式测试 + 无二进制存储守卫）：

- 六个固定区：`工作习惯` / `技术偏好` / `沟通风格` / `领域知识` / `对用户的模型` / `失败教训`；人的其它二级标题原样保留在 `extra` 里。
- 每条 domi 写过的行带 `<!-- src: ... -->` 来源注释。**一条规矩贯穿整个文件：只动 domi 写过、且没被人改过的行。**「domi 写过什么」由 L4 事件算出来（`ownedLines`），不存在 soul 目录里。
- 改动以 `SoulChange`（add / update / remove，带 before / after / sources）呈现给用户审阅（`soul.changes`），**逐条可否决**；否决 = 删除。单次更新最多 10 个操作（diff 里 20 行，M4-002 AC-3）。
- 导出（`soul.export`）单文件可分享；导入（`soul.import`）先返回预览再应用，导入的文字**只作参考资料，不当指令**（INV-06），带来源标注。
- 手改保护：`soul.write` 带 `mtime`，文件在那之后被改过 → `INVALID_PARAMS (data.reason = CONFLICT)`，不覆盖。

## 记忆检索

- `memory.search` RPC + 会话内的 `memory.recall` 工具（`runtime/src/memory-service.ts` 的 `makeMemoryRecallTool`）：语义向量检索 + FTS 情节检索。
- `packages/memory/src/search-tool.ts` 与 `semantic.ts`：`searchSemantic` / `itemDiff` / `normalizeText`（归一化用于比较）。
- L2 情节：`episodic.ts`——可检索的历史事件片段（事件流按语义分段，FTS + 向量双路）。

## 相关

- 语义表的表结构与投影：[会话存储与事件流](session-storage.md)。
- 压缩（L1）与记忆的关系：[压缩与 prompt cache](context-compression.md)。
- Soul 协议方法：`soul.*` 见 [Domi Protocol](protocol.md)。
- 测试：`packages/memory/test/`（soul 解析 / 应用 / 回退 / 导出扫描、语义归一化）；`packages/store/test/`（semantic 投影）。
