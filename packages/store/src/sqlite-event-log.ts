/**
 * SQLite 实现 —— TASK-M0-007 才写。本任务（TASK-M0-006）只立接口与红测试。
 * AGENTS.md 硬规则：先提交失败的测试，再提交实现。
 */
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { type AppendRange, type EventLog, NotImplementedError, type ReadOpts } from './event-log.ts'

export interface SqliteEventLogOptions {
  /** 数据库文件路径；':memory:' 仅供不需要跨进程持久化的用例 */
  path: string
}

export class SqliteEventLog implements EventLog {
  constructor(private readonly opts: SqliteEventLogOptions) {}

  append(_sessionId: string, _evs: DomiEvent[]): Promise<AppendRange> {
    throw new NotImplementedError('SqliteEventLog.append (TASK-M0-007)')
  }

  read(_sessionId: string, _opts?: ReadOpts): Promise<EventEnvelope[]> {
    throw new NotImplementedError('SqliteEventLog.read (TASK-M0-007)')
  }

  head(_sessionId: string): Promise<number> {
    throw new NotImplementedError('SqliteEventLog.head (TASK-M0-007)')
  }

  close(): void {}
}
