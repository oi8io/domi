/**
 * 真正的宿主：把 runtime 的 DomiSession 接到 daemon core 上 —— PRD-M3-002 AC-1
 *
 * core 只认 `DaemonHost` 接口（测试注入假的）。这里是生产那一份：
 * 每个会话一个 DomiSession，共用同一个 SQLite 文件；会话列表由宿主自己的一条连接读。
 *
 * 骨架边界：权限询问还没接到协议上（session.ask / session.answer 下一轮），
 * 所以这里**不给 DomiSession 挂 onAsk**——没人能回答时 runtime 的立场是拒绝（INV-03），
 * 这比假装有人回答安全。
 */
import type { DomiConfig } from '@domi/config'
import type { EventEnvelope } from '@domi/protocol'
import { DomiSession, type SessionOptions } from '@domi/runtime'
import { SqliteEventLog } from '@domi/store'
import { type DaemonHost, type SessionHandle, SessionNotFoundError, type SessionSummary } from './core.ts'

export interface RuntimeHostOptions {
  config: DomiConfig
  dbPath: string
  /** 新建会话没给 cwd 时用这个 */
  defaultCwd: string
  /** 测试注入模型替身 */
  provider?: SessionOptions['provider']
  newId?: () => string
}

export interface RuntimeHost extends DaemonHost {
  close(): void
}

export function createRuntimeHost(opts: RuntimeHostOptions): RuntimeHost {
  const index = new SqliteEventLog({ path: opts.dbPath, cwd: opts.defaultCwd })
  let emit: ((sessionId: string, events: EventEnvelope[]) => void) | null = null
  let busy: ((sessionId: string, b: boolean) => void) | null = null
  const newId = opts.newId ?? (() => `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  return {
    async open(sessionId: string): Promise<SessionHandle> {
      const row = index.sessions.get(sessionId)
      if (!row) throw new SessionNotFoundError(sessionId)
      const s = new DomiSession({
        config: opts.config,
        sessionId,
        cwd: row.cwd,
        dbPath: opts.dbPath,
        ...(opts.provider === undefined ? {} : { provider: opts.provider }),
      })
      s.on('onEvents', (envs) => emit?.(sessionId, envs))
      s.on('onBusy', (b) => busy?.(sessionId, b))

      let head = 0
      return {
        id: sessionId,
        submit: (text) => s.submit(text),
        compactNow: (trigger) => s.compactNow(trigger),
        async readEvents(fromSeq) {
          const all = await s.pumpAll()
          head = all[all.length - 1]?.seq ?? head
          return all.filter((e) => e.seq > fromSeq)
        },
        async head() {
          const all = await s.pumpAll()
          head = all[all.length - 1]?.seq ?? 0
          return head
        },
        close: () => s.flushAndClose(),
      }
    },

    async create(cwd?: string): Promise<string> {
      const id = newId()
      index.sessions.upsert({ id, cwd: cwd ?? opts.defaultCwd, model: opts.config.model.name })
      return id
    },

    async list(): Promise<SessionSummary[]> {
      return index.sessions.list().map((r) => ({
        id: r.id,
        title: r.title,
        model: r.model,
        updatedAt: r.updatedAt,
        eventCount: r.eventCount,
      }))
    },

    onEvents(cb) {
      emit = cb
    },
    onBusy(cb) {
      busy = cb
    },
    close() {
      index.close()
    },
  }
}
