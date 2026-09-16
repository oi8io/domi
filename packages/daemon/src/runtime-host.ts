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

import { dirname, join } from 'node:path'
import { SkillRegistry } from '@domi/capability'
import { type DomiConfig, pricingOf } from '@domi/config'
import { Notifier } from '@domi/notify'
import { DagSpecError } from '@domi/orchestrator'
import type { PluginHost } from '@domi/plugin'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import {
  applyWorktree,
  createWorktree,
  DomiSession,
  discardFile,
  ensureWorktree,
  MemoryService,
  officialSkillsPlugin,
  RefError,
  removeWorktree,
  restoreDiscard,
  type SessionOptions,
  TaskService,
  WorktreeError,
  type WorktreeInfo,
  worktreeDiff,
  worktreeFromEvents,
} from '@domi/runtime'
import { SqliteEventLog } from '@domi/store'
import { AUDIT_SESSION_ID } from './auth.ts'

const RUN_PREFIX = 'run-'

import {
  BranchPointError,
  type DaemonHost,
  type HostAsk,
  type HostMetrics,
  HostRequestError,
  InvalidRefError,
  InvalidTaskError,
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
  /** Soul 与 Skill 所在的目录。默认是 dbPath 旁边的 soul/ 与 skills/（即 ~/.domi 下） */
  soulDir?: string
  skillsDir?: string
  /** 已加载的插件（PRD-M6）：skill 进 Skill 清单，UI 面板经协议给客户端 */
  plugins?: PluginHost
  /** 测试注入：记忆抽取用的模型。不给就用 provider（再不给就按配置建） */
  memoryProvider?: SessionOptions['provider']
}

export interface RuntimeHost extends DaemonHost {
  /** daemon 启动后调：没结束的编排运行接着跑（M5-003）。返回恢复了哪些 */
  resumeTasks(): Promise<string[]>
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
  const home = dirname(opts.dbPath)
  const memoryProvider = opts.memoryProvider ?? opts.provider
  const memory = new MemoryService({
    config: opts.config,
    dbPath: opts.dbPath,
    soulDir: opts.soulDir ?? join(home, 'soul'),
    ...(memoryProvider === undefined ? {} : { provider: memoryProvider }),
  })
  const skills = opts.config.skills.enabled
    ? new SkillRegistry({
        dir: opts.skillsDir ?? join(home, 'skills'),
        // 官方 Skill 以插件形态提供（PRD-M6-001 AC-3）
        official: officialSkillsPlugin.skills?.() ?? [],
        watch: true,
        ...(opts.plugins ? { extraFiles: () => opts.plugins?.skillFiles() ?? [] } : {}),
      })
    : undefined

  const notifier = new Notifier(opts.config.notify, { log: (l) => process.stderr.write(`${l}\n`) })
  /** 同一个会话只有一个 DomiSession：core、编排、子 agent 共用，推送才不会重复 */
  const sessions = new Map<string, Promise<DomiSession>>()
  const pushChild = (id: string, envs: EventEnvelope[]): void => emit?.(id, envs)

  /** 这个会话的隔离工作区（从事件流里找；不是隔离会话 → null） */
  async function worktreeOf(sessionId: string): Promise<WorktreeInfo | null> {
    if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
    return worktreeFromEvents(await index.read(sessionId))
  }

  /** WorktreeError → INVALID_PARAMS */
  async function wt<T>(fn: () => T | Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      throw e instanceof WorktreeError ? new HostRequestError(e.message) : e
    }
  }

  function live(sessionId: string, init?: { cwd: string; title: string; spawnedBy?: string }): Promise<DomiSession> {
    const cached = sessions.get(sessionId)
    if (cached) return cached
    const made = (async () => {
      if (init && !index.sessions.get(sessionId)) {
        index.sessions.upsert({
          id: sessionId,
          cwd: init.cwd,
          title: init.title,
          model: opts.config.model.name,
          ...(init.spawnedBy === undefined ? {} : { spawnedBy: init.spawnedBy }),
        })
      }
      const row = index.sessions.get(sessionId)
      if (!row) throw new SessionNotFoundError(sessionId)
      // 隔离会话被删过又恢复时 worktree 目录已经清掉了：按分支重新挂上（M7-006）
      const tree = await worktreeOf(sessionId)
      if (tree) await wt(() => ensureWorktree(tree))
      const s = new DomiSession({
        config: opts.config,
        sessionId,
        cwd: row.cwd,
        dbPath: opts.dbPath,
        ...(opts.provider === undefined ? {} : { provider: opts.provider }),
        ...(opts.extraTools === undefined ? {} : { extraTools: opts.extraTools }),
        ...(opts.notices === undefined ? {} : { notices: opts.notices }),
        memory,
        ...(skills === undefined ? {} : { skills }),
        childEvents: pushChild,
        // 花费与预算的金额上限（M7-009）
        pricing: pricingOf(opts.config),
        // 计划批准后转长任务（M7-005）：同一个 TaskService
        startTask: async (spec, cwd) => (await tasks.start(JSON.stringify(spec), cwd)).runId,
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
        const detail = ask.form ? ask.form.message : (JSON.stringify(ask.args, null, 2) ?? String(ask.args))
        asked?.(sessionId, {
          askId: `${sessionId}#${askSeq}`,
          capabilityId: ask.capabilityId,
          // 完整内容，不截断（PRD-M0-003 AC-1）：确认框是用户做决定的地方
          detail,
          ...(ask.form === undefined ? {} : { form: ask.form }),
          answer: (allowed, content, channel) => ask.answer(allowed, content, channel),
        })
        // 长任务在等人（M5-004 AC-1）。通知里只说「在等什么能力」，不带参数内容
        if (sessionId.startsWith(RUN_PREFIX) && notifier.enabled) {
          void notifier.send({
            kind: 'approval',
            title: '任务在等你确认',
            detail: `${ask.capabilityId} 需要确认`,
            runId: sessionId,
          })
        }
      })
      return s
    })()
    sessions.set(sessionId, made)
    made.catch(() => sessions.delete(sessionId))
    return made
  }

  const tasks = new TaskService({
    dbPath: opts.dbPath,
    defaultCwd: opts.defaultCwd,
    openSession: (id, init) => live(id, init),
    onEvent: (runId, evs, st) => {
      const end = evs.find((e) => e.t === 'task.end') as { status?: string } | undefined
      if (!end || end.status === 'cancelled' || !notifier.enabled) return
      const failed = Object.values(st.nodes)
        .filter((n) => n.status === 'failed')
        .map((n) => n.id)
      void notifier.send({
        kind: end.status === 'done' ? 'done' : 'failed',
        title: `任务${end.status === 'done' ? '完成' : '失败'}：${st.name}`,
        detail:
          end.status === 'done' ? `${Object.keys(st.nodes).length} 个节点全部完成` : `失败的节点：${failed.join('、')}`,
        runId,
      })
    },
  })

  return {
    async open(sessionId: string): Promise<SessionHandle> {
      const s = await live(sessionId)
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
        setMode: (mode) => s.setMode(mode),
        setBudget: (b) => s.setBudget(b),
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
        async close() {
          sessions.delete(sessionId)
          await s.flushAndClose()
        },
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
      // 隔离会话：worktree 里有没提交的改动就不删（PRD-M7-006 AC-4）；删目录不删分支
      const tree = await worktreeOf(sessionId)
      if (tree) await wt(() => removeWorktree(tree))
      index.sessions.softDelete(sessionId, Date.now())
    },

    worktrees: {
      async create(cwd) {
        const id = newId()
        const { info, cwd: inTree } = await wt(() => createWorktree(cwd ?? opts.defaultCwd, id, home))
        index.sessions.upsert({ id, cwd: inTree, model: opts.config.model.name })
        await index.append(id, [{ t: 'worktree.create', ...info }])
        return { sessionId: id, worktree: { path: info.path, branch: info.branch } }
      },
      async diff(sessionId) {
        const tree = await worktreeOf(sessionId)
        if (!tree) throw new HostRequestError(`${sessionId} 不是隔离会话`)
        const files = await wt(() => worktreeDiff(tree))
        return { repo: tree.repo, branch: tree.branch, base: tree.base, files }
      },
      async discard(sessionId, path) {
        const tree = await worktreeOf(sessionId)
        if (!tree) throw new HostRequestError(`${sessionId} 不是隔离会话`)
        const trash = await wt(() => discardFile(tree, path, home))
        await (await live(sessionId)).appendEvents([{ t: 'worktree.discard', path, trash }])
        return trash
      },
      async restore(sessionId, trash) {
        const tree = await worktreeOf(sessionId)
        if (!tree) throw new HostRequestError(`${sessionId} 不是隔离会话`)
        const path = await wt(() => restoreDiscard(tree, trash, home))
        await (await live(sessionId)).appendEvents([{ t: 'worktree.restore', path, trash }])
        return path
      },
      async apply(sessionId, mode, message) {
        const tree = await worktreeOf(sessionId)
        if (!tree) throw new HostRequestError(`${sessionId} 不是隔离会话`)
        const s = await live(sessionId)
        const title = index.sessions.get(sessionId)?.title ?? ''
        const msg = message ?? (title === '' ? `domi 会话 ${sessionId} 的改动` : title)
        const target =
          mode === 'branch'
            ? `只留在分支 ${tree.branch}`
            : `${mode === 'squash' ? '压成一个提交' : '合并'}到 ${tree.repo} 当前分支`
        // 人工批准（AC-3）：没批准，原仓库一个字节不动
        const { allowed } = await s.askApproval(
          `把隔离工作区的改动${target}？`,
          { message: msg, repo: tree.repo, mode },
          'worktree.apply',
        )
        if (!allowed) {
          const r = { ok: false, message: '没有批准，原仓库没有改动' }
          await s.appendEvents([{ t: 'worktree.apply', mode, ...r }])
          return r
        }
        const r = await wt(() => applyWorktree(tree, mode, msg))
        await s.appendEvents([{ t: 'worktree.apply', mode, ...r }])
        return r
      },
    },

    async restore(sessionId) {
      if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
      index.sessions.restore(sessionId)
    },

    tasks: {
      async start(spec, cwd) {
        try {
          const r = await tasks.start(spec, cwd)
          return { runId: r.runId, name: r.spec.name, nodes: r.spec.nodes.map((n) => n.id) }
        } catch (e) {
          throw e instanceof DagSpecError ? new InvalidTaskError(e.message) : e
        }
      },
      list: () => tasks.list(),
      async get(runId) {
        const st = await tasks.state(runId)
        if (!st) throw new SessionNotFoundError(runId)
        return {
          runId,
          name: st.name,
          status: st.status,
          active: tasks.isRunning(runId),
          nodes: (st.spec?.nodes ?? []).map((n) => {
            const ns = st.nodes[n.id]
            return {
              id: n.id,
              type: n.type,
              ...(n.title === undefined ? {} : { title: n.title }),
              needs: n.needs,
              status: ns?.status ?? 'pending',
              attempt: ns?.attempt ?? 0,
              ...(ns?.output === undefined ? {} : { output: ns.output }),
              ...(ns?.error === undefined ? {} : { error: ns.error }),
              ...(ns?.sessionId === undefined ? {} : { sessionId: ns.sessionId }),
              ...(ns?.ms === undefined ? {} : { ms: ns.ms }),
            }
          }),
        }
      },
      async retry(runId, nodeId) {
        try {
          await tasks.retry(runId, nodeId)
        } catch (e) {
          throw e instanceof DagSpecError ? new InvalidTaskError(e.message) : e
        }
      },
      cancel: (runId) => tasks.cancel(runId),
    },

    async auditRecord(kind, detail, client) {
      await index.append(AUDIT_SESSION_ID, [
        { t: 'error', scope: `audit.${kind}`, message: `[${client}] ${detail}`, recoverable: true },
      ])
    },

    resumeTasks: () => tasks.resumeAll(),

    ...(opts.plugins === undefined
      ? {}
      : {
          plugins: {
            async list() {
              const ph = opts.plugins as PluginHost
              return {
                sandbox: ph.backend,
                plugins: ph.plugins.map((p) => ({
                  name: p.manifest.name,
                  version: p.manifest.version,
                  description: p.manifest.description,
                  tools: p.manifest.contributes.tools.map((t) => `plugin.${p.manifest.name}.${t.name}`),
                  skills: p.manifest.contributes.skills.length,
                  mcp: p.manifest.contributes.mcp.map((s) => s.name),
                  ui: p.manifest.contributes.ui.map((u) => ({ id: u.id, title: u.title })),
                })),
                problems: [...ph.problems()],
              }
            },
            async ui(plugin: string, id: string) {
              return (opts.plugins as PluginHost).uiHtml(plugin, id)
            },
          },
        }),

    memory: {
      async list(includeDeleted) {
        return memory.list({ includeDeleted }).map((i) => ({
          id: i.id,
          kind: i.kind,
          text: i.text,
          sourceRefs: i.sourceRefs,
          createdAt: i.createdAt,
          deleted: i.deletedAt !== null,
        }))
      },
      async search(query, limit) {
        const r = await memory.search(query, limit)
        return {
          mode: r.mode,
          items: r.items.map((i) => ({
            id: i.id,
            kind: i.kind,
            text: i.text,
            sourceRefs: i.sourceRefs,
            createdAt: i.createdAt,
            deleted: false,
            score: i.score,
          })),
        }
      },
      remove: (id) => memory.remove(id),
      async extract(sessionId) {
        if (!index.sessions.get(sessionId)) throw new SessionNotFoundError(sessionId)
        const r = await memory.extract(sessionId)
        return { added: r.added, soulChanges: r.soul }
      },
      async soul() {
        const { readFileSync, existsSync } = await import('node:fs')
        return { path: memory.soulPath, text: existsSync(memory.soulPath) ? readFileSync(memory.soulPath, 'utf8') : '' }
      },
      changes: () => memory.pendingChanges(),
      review: (id, decision) => memory.review(id, decision),
      update: () => memory.updateSoul(),
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
      tasks.close()
      skills?.close()
      memory.close()
      index.close()
    },
  }
}
