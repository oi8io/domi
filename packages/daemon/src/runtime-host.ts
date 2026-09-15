/**
 * 真正的宿主：把 runtime 的 DomiSession 接到 daemon core 上 —— PRD-M3-002 AC-1
 *
 * core 只认 `DaemonHost` 接口（测试注入假的）。这里是生产那一份：
 * 每个会话一个 DomiSession，共用同一个 SQLite 文件；会话列表由宿主自己的一条连接读。
 *
 * 权限询问经 core 推给客户端（session.ask），由任一客户端回答（session.answer）。
 * 没有客户端在线时，任务就停在询问上等——这和「断开不影响任务」不矛盾：
 * 执行一个需要确认的操作，本来就该等人，而不是替人答。
 */
import type { DomiConfig } from '@domi/config'
import type { EventEnvelope } from '@domi/protocol'
import { DomiSession, type SessionOptions } from '@domi/runtime'
import { SqliteEventLog } from '@domi/store'
import {
  type DaemonHost,
  type HostAsk,
  type HostMetrics,
  type SessionHandle,
  SessionNotFoundError,
  type SessionSummary,
} from './core.ts'

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
  let asked: ((sessionId: string, ask: HostAsk) => void) | null = null
  let measured: ((sessionId: string, m: HostMetrics) => void) | null = null
  let askSeq = 0
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
      s.on('onMetrics', (m) => measured?.(sessionId, { ...s.modelInfo(), ...m }))
      s.on('onAsk', (ask) => {
        // null = 这次询问已经答完，core 那边在 answer 时已经清掉了
        if (!ask) return
        askSeq++
        asked?.(sessionId, {
          askId: `${sessionId}#${askSeq}`,
          capabilityId: ask.capabilityId,
          // 完整内容，不截断（PRD-M0-003 AC-1）：确认框是用户做决定的地方
          detail: JSON.stringify(ask.args, null, 2) ?? String(ask.args),
          answer: (allowed) => ask.answer(allowed),
        })
      })

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
    onAsk(cb) {
      asked = cb
    },
    onMetrics(cb) {
      measured = cb
    },
    close() {
      index.close()
    },
  }
}
