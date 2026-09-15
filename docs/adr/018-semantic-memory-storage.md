# 018 L3 语义记忆的存储与检索：SQLite 投影 + 可选 embedding，暴力余弦

- 日期：2026-09-15
- 状态：已采纳（兑现 `docs/adr/010` 表里「向量检索」一行；PRD-M4-001）

**Context**：M4-001 要抽取事实 / 偏好 / 实体，可溯源、可按关键词与语义检索、可单条删除。
ADR-010 把向量方案押后到这里，理由是「没有语料就选，纯属抛硬币」——到了这里语料**仍然没有**（见 `docs/prd/M4.md` §1）。

**Decision**：
- **事件是真相，表是投影（INV-01）**。每次新增 / 删除一条 L3 条目都先落 `memory.write{layer:'L3'}` 事件，
  写进 daemon 自己的记忆会话 `_memory`；`semantic_items` 表只是它的投影，删掉可以重放事件重建。
  删除 = 追加一条 `op:'delete'`，投影里置 `deleted_at`，检索不再返回；事件一条不删。
- **关键词检索**：FTS5（与 L2 同一套，`trigram` 分词器，中文可用）。
- **语义检索：可选的 embedding，默认关**。`config.yaml` 的 `memory.embedding` 配了 provider 与模型才开
  （走 AI SDK 的 `embedMany`，只用用户配置的端点，INV-11）。向量以 Float32 BLOB 存进同一个 SQLite，
  查询时**暴力余弦**，不引 sqlite-vec。没配 embedding 时「语义检索」退化为关键词检索，并在结果里说明。
- **不引 sqlite-vec 的理由**：它是原生扩展，`bun build --compile` 的单二进制要为每个平台带一份 .so/.dylib；
  而 L3 条目的量级是「一个人几个月的偏好」——几百到几千条，暴力余弦在毫秒级。

**触发重新评估的条件**：L3 条目超过 2 万条，或一次语义查询超过 50ms；
或真实语料证明关键词检索已经够用（那就把 embedding 这一半删掉）。

**Consequences**：多一个可选配置项；不配 embedding 的用户拿到的是关键词检索，结果里会标明，
不假装自己做了语义匹配。换一种向量方案只需要改 `packages/memory/src/semantic.ts` 里的检索函数。
