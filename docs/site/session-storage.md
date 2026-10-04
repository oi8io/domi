# 会话存储与事件流

> `packages/store` —— SQLite 事件流（`bun:sqlite`），daemon 是唯一写入者。
> 对应 hermes 的 session-storage；domi 的存储哲学更极端：**磁盘上只有事件流，其余全是投影**。

## 文件与打开

- 生产路径：`~/.domi/events.db`（`SqliteEventLog({path})`）。`:memory:` 仅供不需要跨进程持久化的用例。
- 首次运行时父目录由 store 自己建——「第一次跑就崩」是最劝退的失败方式（SQLite 只会给一句 `SQLITE_CANTOPEN`）。
- PRAGMAS 与 DDL 无条件跑（`IF NOT EXISTS` 幂等）；磁盘版本高于代码版本时置位 `readOnlyFuture`：**只读打开并告警，不拒绝启动**（INV-01 的兑现）。

## 事件表与 seq

```sql
CREATE TABLE events (
  session_id TEXT, seq INTEGER, parent_seq INTEGER, ts INTEGER,
  schema_version INTEGER, type TEXT, payload TEXT
)  -- 主键 (session_id, seq)
```

三个不显然的地方（`sqlite-event-log.ts` 文件头，改之前先读）：

1. **seq 在同一事务内分配**（`SELECT MAX+1 → INSERT`），靠主键兜底。够用是因为只有一个写入者；哪天多进程同时写同一个库才需要换成真正的并发仲裁。
2. **序列化放在事务内部**——一批事件里任意一条序列化失败，整批回滚，磁盘上不会留半条（PRD-M0-001 AC-4）。
3. **read 走 `parseEvent` 的降级路径**，永不抛「无法解析」（INV-01）。

会话元数据在 `sessions` 表（`id` / `created_at` / `cwd`，STRICT 表）。分支记 `parent_seq` 指针，不复制事件。

## 迁移

`migrate.ts` + `schema.ts` 的 `MIGRATIONS`（现有 14 条）。规则：**迁移只能加列 / 加表 / 加索引**，不能改旧行的含义。`guard:migrations` 检查迁移是否幂等、是否只做加法。`domi migrate` 命令封装（`cli` 的 `migrateDatabase`）。

## 派生数据：投影表（可以删掉重建）

真相只有 `events` 表。以下全部在 `SqliteEventLog.append` 的**同一个事务里**投影：

| 表 / 索引 | 是什么 | 实现 |
|---|---|---|
| `events_fts`（FTS5） | 全文检索 | `store/search.ts`；**trigram 分词器**（默认的 unicode61 不切中文，「数据库迁移」整条会被当成一个词）。代价：查询串至少要三个字符，两个字的中文词匹配不到——那条路径由调用方降级成 LIKE 扫描 |
| `semantic_items` | L3 语义记忆 | `store/semantic.ts`：`_memory` 会话里 `memory.write{layer:'L3'}` 事件的投影；embedding 是唯一不来自事件的列（算出来的缓存，丢了重算） |
| `memory_progress` / `fts_progress` | 各投影到第几条 | 可重建 |
| `read_marks` | 已读标记 | `store/read-marks.ts`（「保留」只是浏览器本地的已看过标记） |
| `projects` | 项目 | `store/projects.ts` |
| `schedules` / `schedule_runs` | 定时任务 | `store/schedules.ts` |

## 隐私与脱敏

`redact.ts`：`serializeRedacted`——事件落盘前按 `~/.domi/secrets.yaml` 里的凭据做脱敏，界面 / 导出 / 轨迹任何接口都不回吐凭据（HANDOFF 硬规矩 2：凭据不进仓库、不回吐给界面）。`guard:secrets` 扫 `fixtures` 与 `docs`。

## 搜索

`store/search.ts`：`INDEXED_TYPES` 决定哪些事件类型进 FTS；`user.note`（M13）也在列。查询串 < 3 字符走 LIKE 降级。

## 为什么只有事件流

- 压缩：`ctx.compact` 只是又一条事件（INV-12，「压缩后可重放等价」免费得到）。
- 分支 / 回放：从某 seq 重放即 fork / time-travel。
- 状态栏 / 轨迹 / 记忆：全是投影，不用另做埋点（INV-13）。
- 整库可审计：权限决策、模型调用、工具执行都在事件里。

## 相关

- 事件契约与版本规则：[Domi Protocol](protocol.md)
- 记忆与 Soul 的投影关系：[记忆分层与 Soul](memory-and-soul.md)
- 测试：`packages/store/test/`（append 原子性、迁移、搜索、脱敏）。
