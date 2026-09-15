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
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { DomiSession, RefError, type SessionOptions } from '@domi/runtime'
import { SqliteEventLog } from '@domi/store'
import { AUDIT_SESSION_ID } from './auth.ts'
import {
  BranchPointError,
  type DaemonHost,
  type HostAsk,
  type HostMetrics,
  InvalidRefError,
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
  /** 外部工具（MCP hub），每轮现取 */
  extraTools?: SessionOptions['extraTools']
  /** 进程级提示（MCP server 连不上之类），每个会话各落一次 */
  notices?: SessionOptions['notices']
  newId?: () => string
}

export interface RuntimeHost extends DaemonHost {
  /** daemon 自己的审计事件（被拒的连接等）。写进 AUDIT_SESSION_ID，不出现在会话列表里 */
  audit(ev: DomiEvent): Promise<void>
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
        ...(opts.extraTools === undefined ? {} : { extraTools: opts.extraTools }),
        ...(opts.notices === undefined ? {} : { notices: opts.notices }),
      })
      // 上一个 domid 可能是被 kill -9 的：先把这个会话补到一致点，再交出去（TASK-M3-010）。
      // 这时还没有订阅者，补的事件由之后的订阅补发带过去
      await s.recover()
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
          detail: ask.form ? ask.form.message : (JSON.stringify(ask.args, null, 2) ?? String(ask.args)),
          ...(ask.form === undefined ? {} : { form: ask.form }),
          answer: (allowed, content) => ask.answer(allowed, content),
        })
      })

      let head = 0
      return {
        id: sessionId,
        submit: (text, refs) => s.submit(text, refs === undefined ? {} : { refs }),
        async checkRefs(refs) {
          try {
            return await s.checkRefs(refs)
          } catch (e) {
            throw e instanceof RefError ? new InvalidRefError(e.message) : e
          }
        },
        switchModel: (model, provider) => s.switchModel(model, provider === undefined ? {} : { provider }),
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

    async list({ includeDeleted }): Promise<SessionSummary[]> {
      // 下划线开头的是 daemon 自己的会话（审计），不是用户的对话
      return index.sessions
        .list({ includeDeleted })
        .filter((r) => !r.id.startsWith('_'))
        .map((r) => ({
          id: r.id,
          title: r.title,
          model: r.model,
          updatedAt: r.updatedAt,
          eventCount: r.eventCount,
          deleted: r.deletedAt !== null,
          ...(r.parentSessionId === null ? {} : { parentId: r.parentSessionId }),
        }))
    },

    /**
     * atSeq 是客户端看到的**视图** seq。它可能落在祖先那一段里——那就从祖先分：
     * 「从这条消息分支」的意思是「回到这条消息之后」，和它当初属于哪一段无关
     */
    async branch(sessionId, atSeq) {
      if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
      const at = index.resolveViewSeq(sessionId, atSeq)
      if (!at) {
        const head = index.viewOffset(sessionId) + (await index.head(sessionId))
        throw new BranchPointError(sessionId, atSeq, head)
      }
      const id = newId()
      await index.fork(at.sessionId, at.seq, id)
      return id
    },

    async remove(sessionId) {
      if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
      index.sessions.softDelete(sessionId, Date.now())
    },

    async restore(sessionId) {
      if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
      index.sessions.restore(sessionId)
    },

    async audit(ev) {
      await index.append(AUDIT_SESSION_ID, [ev])
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
