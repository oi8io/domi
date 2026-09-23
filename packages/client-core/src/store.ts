/**
 * 三端共享的状态投影 —— docs/adr/009
 *
 * **本包不 import react**（由 depcruise 规则 `no-react-in-client-core` 守）。
 * 理由见 ADR-009：消费方有四类，Telegram 桥接与 L1 回放评估都不是 React。
 *
 * 这里做的是**投影**，不是存储：事件流是唯一真相，atom 里的东西随时可以从
 * 事件流重算出来。所以任何"只在 atom 里、事件流里没有"的状态都是 bug。
 */
import { tr } from '@domi/i18n'
import { type AnyEvent, type EventEnvelope, isKnownEvent } from '@domi/protocol'
import { atom, computed } from 'nanostores'

export interface TranscriptItem {
  seq: number
  kind: 'user' | 'assistant' | 'reason' | 'tool-call' | 'tool-result' | 'permission' | 'error' | 'context' | 'task'
  text: string
  ok?: boolean
  /** 工具调用的参数摘要：JSON 序列化后前 80 字符 + …（PRD-M0-005 AC-1 写死的规则） */
  summary?: string
  /**
   * 展开后的完整原文（PRD-M11-002）：tool.call=JSON(完整 args)，tool.result=JSON(完整 payload)。
   * 纯投影——事件流里本来就有，回放现算，不是新事件（INV-01/INV-13）
   */
  detail?: string
  /**
   * 耗时（毫秒）：工具结果来自 `tool.result` 事件；思考段是这一段流式增量的跨度（M8-008 AC-1）
   */
  ms?: number
  /** 事件时间戳（流式段是第一条的）。轨迹时间线用（M8-008 AC-3） */
  ts?: number
}

export interface MetricsSnapshot {
  tokens: { input: number; output: number; cacheRead: number }
  /** 已格式化的花费字符串；未知模型是 `—`，不是 $0（PRD-M1-007 AC-4） */
  cost: string
  contextPercent: number
  contextLevel: 'ok' | 'warn' | 'danger'
  unpricedModels: string[]
  /** 最近一轮用了多久。老 daemon 不推这个 */
  turnMs?: number | undefined
  /** 本轮验证状态（M7-004）。老 daemon 不推 */
  verify?: 'clean' | 'unverified' | 'verified' | 'failed' | undefined
  /** PRD-M12-002：会话确认模式（always-ask/on-demand/allow-all） */
  permissionsMode?: 'always-ask' | 'on-demand' | 'allow-all' | undefined
  /** M8-008：轮数、模型请求次数、最近一轮输出速度、缓存命中率。老 daemon 不推 */
  turns?: number | undefined
  steps?: number | undefined
  tokPerSec?: number | null | undefined
  cacheHitPercent?: number | null | undefined
}

export interface StatusSnapshot {
  model: string
  provider: string
  busy: boolean
  toolCalls: number
  /** provider 返回的原始 usage，不做归一（ADR-004）。状态栏只挑它认识的字段显示 */
  lastUsage: Record<string, unknown> | null
  /**
   * 聚合指标。**由 runtime 算好推过来**，client-core 不自己算——
   * 算法在 packages/kernel/src/metrics.ts，三端共用同一份。
   */
  metrics: MetricsSnapshot | null
  /** 隔离会话的工作区（M7-006）。从 worktree.create 事件投影 */
  worktree?: { path: string; branch: string; repo: string } | undefined
}

/** 审阅发现（M7-010），按事件投影 */
export interface ReviewFindingSnapshot {
  file: string
  line?: number | undefined
  severity: 'high' | 'medium' | 'low'
  problem: string
  basis: string
}

export interface AskSnapshot {
  /** 经 daemon 转来的询问才有；回答时要带上它（session.answer） */
  askId?: string
  capabilityId: string
  /** 完整的待执行内容，确认框必须显示它（PRD-M0-003 AC-1） */
  detail: string
  /** 工具要输入时的表单（JSON Schema）。有它就画表单，回答时带内容 */
  form?: { message: string; schema: unknown }
  /** 可以答「本会话始终允许」（M8-016） */
  grantable?: boolean
}

/** 状态栏的「本轮」段。一分钟以内到 0.1 秒，以上到秒 */
/** 验证状态的显示文字（TUI 与 Web 共用） */
export const VERIFY_LABEL = {
  // 取值时才翻译（模块加载时界面语言可能还没定，PRD-M9-004）
  get unverified() {
    return tr('core.verify.unverified')
  },
  get verified() {
    return tr('core.verify.verified')
  },
  get failed() {
    return tr('core.verify.failed')
  },
}

export function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/** 状态栏的 token 段。TUI 与 Web 共用这一份，两端显示才会逐字一致 */
export function formatTokens(t: { input: number; output: number; cacheRead: number }): string {
  const k = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))
  return t.cacheRead > 0
    ? `${k(t.input)}/${k(t.output)} tok (cache ${k(t.cacheRead)})`
    : `${k(t.input)}/${k(t.output)} tok`
}

export const ARG_SUMMARY_LIMIT = 80

/** 思考折叠的单行摘要（PRD-M10-005 AC-4）：与 summarizeArgs 同一 80 字符截断口径，渲染层不二次截断 */
export function summarizeReason(text: string): string {
  return text.length <= ARG_SUMMARY_LIMIT ? text : `${text.slice(0, ARG_SUMMARY_LIMIT)}…`
}

/** 完整 JSON（PRD-M11-002 展开原文）：与 summarizeArgs 同口径的容错，但不截断 */
export function fullJson(args: unknown): string {
  try {
    return JSON.stringify(args) ?? String(args)
  } catch {
    return String(args)
  }
}

/** 与 summarizeArgs 同一 80 字符口径 */
const clip = (s: string): string => (s.length > 80 ? `${s.slice(0, 79)}…` : s)

/** 工具调用行的摘要。问用户（PRD-M12-004 AC-7）读成问题本身，而不是一坨 JSON */
export function toolCallSummary(name: string, args: unknown): string {
  if (name === 'ask.user') {
    const qs = (args as { questions?: Array<{ question?: unknown }> } | null)?.questions
    if (Array.isArray(qs)) return clip(qs.map((q) => String(q.question ?? '')).join(' / '))
  }
  return summarizeArgs(args)
}

/** 工具结果行的摘要。问用户的回答读成「标签：答案」 */
export function toolResultSummary(name: string | undefined, payload: unknown): string {
  if (name === 'ask.user') {
    const p = payload as { answered?: boolean; answers?: Array<{ header?: unknown; answer?: unknown }> } | null
    if (p?.answered === false) return tr('core.ask.unanswered')
    if (Array.isArray(p?.answers))
      return clip(p.answers.map((a) => `${String(a.header ?? '')}：${String(a.answer ?? '')}`).join('；'))
  }
  return summarizeArgs(payload)
}

export function summarizeArgs(args: unknown): string {
  const json = (() => {
    try {
      return JSON.stringify(args) ?? String(args)
    } catch {
      return String(args)
    }
  })()
  return json.length <= ARG_SUMMARY_LIMIT ? json : `${json.slice(0, ARG_SUMMARY_LIMIT)}…`
}

/** 确认模式三档的显示名（复用 Composer 下拉的文案，PRD-M12-002） */
const PERMISSIONS_MODE_LABEL = {
  'always-ask': 'web.composer.modeAlwaysAsk',
  'on-demand': 'web.composer.modeOnDemand',
  'allow-all': 'web.composer.modeAllowAll',
} as const

export type PermissionsModeName = keyof typeof PERMISSIONS_MODE_LABEL

/**
 * 状态栏上的确认模式（PRD-M12-002 AC-9）：两端同一个名字、同一个口径。
 * danger = 「全部放行」——这个会话什么都不问，状态栏要一眼看得出来
 */
export function permissionsModeBadge(mode: PermissionsModeName): { label: string; danger: boolean } {
  return { label: tr(PERMISSIONS_MODE_LABEL[mode]), danger: mode === 'allow-all' }
}

export function createSessionStore(initial: Partial<StatusSnapshot> = {}) {
  const $items = atom<TranscriptItem[]>([])
  /** tool.result 只带 id：记下每次调用的工具名，结果行才知道怎么摘要 */
  const callNames = new Map<string, string>()
  const $status = atom<StatusSnapshot>({
    model: initial.model ?? '',
    provider: initial.provider ?? '',
    busy: false,
    toolCalls: 0,
    lastUsage: null,
    metrics: null,
  })
  const $ask = atom<AskSnapshot | null>(null)
  /** 最近一次提交的审阅发现；没有审阅过是 null */
  const $review = atom<ReviewFindingSnapshot[] | null>(null)
  /** PRD-M11-009：窗口化加载——当前窗口最老事件的 seq、是否还有更早 */
  const $oldestSeq = atom<number | null>(null)
  const $hasOlder = atom<boolean>(false)
  /** 正在向上翻页（防重复触发） */
  const $loadingOlder = atom<boolean>(false)

  /** 最后一条 assistant 文本，流式增量往它上面拼 */
  const $streaming = computed($items, (items) => {
    const last = items[items.length - 1]
    return last?.kind === 'assistant' ? last.text : ''
  })

  /** 正在处理的那条事件的时间戳：push 都带上它，轨迹时间线才有时间轴 */
  let at = 0

  function push(item: TranscriptItem): void {
    $items.set([...$items.get(), { ts: at, ...item }])
  }

  function appendText(kind: 'assistant' | 'reason', seq: number, text: string): void {
    const items = $items.get()
    const last = items[items.length - 1]
    if (last?.kind === kind) {
      // 思考 / 回答是逐 token 来的：耗时 = 这一段从第一条到最后一条的跨度
      const ms = last.ts === undefined ? undefined : Math.max(0, at - last.ts)
      $items.set([...items.slice(0, -1), { ...last, text: last.text + text, ...(ms === undefined ? {} : { ms }) }])
    } else {
      push({ seq, kind, text })
    }
  }

  function applyEvent(env: EventEnvelope): void {
    const ev: AnyEvent = env.ev
    if (!isKnownEvent(ev)) return
    at = env.ts
    switch (ev.t) {
      case 'user.input':
        push({ seq: env.seq, kind: 'user', text: ev.text })
        break
      // 思考与回答都是逐 token 推来的：紧挨着的同类片段拼成一段（BUG-M3-001）
      case 'model.reason':
        appendText('reason', env.seq, ev.text)
        break
      case 'model.delta':
        appendText('assistant', env.seq, ev.text)
        break
      case 'tool.call':
        callNames.set(ev.id, ev.name)
        push({
          seq: env.seq,
          kind: 'tool-call',
          text: ev.name,
          summary: toolCallSummary(ev.name, ev.args),
          detail: fullJson(ev.args),
        })
        $status.set({ ...$status.get(), toolCalls: $status.get().toolCalls + 1 })
        break
      case 'tool.result':
        push({
          seq: env.seq,
          kind: 'tool-result',
          text: ev.reason ?? (ev.ok ? 'ok' : 'failed'),
          ok: ev.ok,
          summary: toolResultSummary(callNames.get(ev.id), ev.payload),
          detail: fullJson(ev.payload),
          ms: ev.ms,
        })
        break
      case 'permission':
        push({
          seq: env.seq,
          kind: 'permission',
          text: `${ev.capabilityId} → ${ev.decision}`,
          ok: ev.decision === 'allow',
        })
        break
      // 上下文清理/压缩也要在对话里看得见（PRD-M2-002 AC-4 / M2-003 AC-4）。
      // 它们是**事件**，所以这里只是投影——不存在「只在 atom 里、事件流里没有」的状态
      case 'ctx.cleanup':
        push({
          seq: env.seq,
          kind: 'context',
          text: tr('core.ev.cleanup', { tokensBefore: ev.tokensBefore, tokensAfter: ev.tokensAfter }),
          summary: tr('core.ev.cleanupDetail', {
            dedupe: ev.saved.dedupe,
            verbose: ev.saved.verbose,
            resolvedError: ev.saved.resolvedError,
            stack: ev.saved.stack,
          }),
        })
        break
      case 'ctx.compact':
        push({
          seq: env.seq,
          kind: 'context',
          text: tr('core.ev.compact', {
            tokensBefore: ev.tokensBefore,
            tokensAfter: ev.tokensAfter,
            keptTurns: ev.keptTurns,
          }),
          summary: ev.summary.intent,
        })
        break
      // 编排（M5）：运行与节点的进展都是事件，投影成对话里的一行
      case 'task.spawn':
        push({
          seq: env.seq,
          kind: 'task',
          text: tr('core.ev.spawn', { goal: ev.goal }),
          summary: ev.childSessionId,
          ok: true,
        })
        break
      case 'task.run':
        push({ seq: env.seq, kind: 'task', text: tr('core.ev.runStart', { name: ev.name }) })
        break
      case 'task.node': {
        const label = {
          started: tr('core.ev.nodeStart'),
          done: tr('core.ev.nodeDone'),
          failed: tr('core.ev.nodeFailed'),
        }[ev.status]
        const ms = ev.ms === undefined ? '' : tr('core.ev.elapsed', { formatElapsed: formatElapsed(ev.ms) })
        push({
          seq: env.seq,
          kind: 'task',
          text: tr('core.ev.node', {
            nodeId: ev.nodeId,
            label,
            v: ev.attempt > 1 ? tr('core.ev.attempt', { attempt: ev.attempt }) : '',
            ms,
          }),
          ...(ev.status === 'started' ? {} : { ok: ev.status === 'done' }),
          ...((ev.error ?? ev.output) === undefined ? {} : { summary: (ev.error ?? ev.output ?? '').slice(0, 200) }),
        })
        break
      }
      case 'task.resume':
        push({
          seq: env.seq,
          kind: 'task',
          text: tr('core.ev.resume', {
            length: ev.completed.length,
            v: ev.rerun.length > 0 ? tr('core.ev.rerun', { join: ev.rerun.join(tr('common.listSep')) }) : '',
          }),
        })
        break
      case 'hook.run':
        if (ev.blocked || ev.on !== 'pre')
          push({
            seq: env.seq,
            kind: 'permission',
            text: tr('core.ev.hook', {
              name: ev.name,
              v: ev.timedOut
                ? tr('core.ev.hookTimeout')
                : ev.blocked
                  ? tr('core.ev.hookBlocked')
                  : tr('core.ev.hookExit', { on: ev.on, exitCode: String(ev.exitCode) }),
            }),
            ok: !ev.blocked,
            ...(ev.output ? { summary: ev.output.slice(0, 200) } : {}),
          })
        break
      case 'workspace.trust':
        push({
          seq: env.seq,
          kind: 'permission',
          text: ev.trusted ? tr('core.ev.trust', { root: ev.root }) : tr('core.ev.untrusted', { root: ev.root }),
          ok: ev.trusted,
        })
        break
      case 'verify.required':
        push({
          seq: env.seq,
          kind: 'context',
          text: ev.final ? tr('core.ev.unverifiedEnd') : tr('core.ev.verifyNudge'),
          summary: ev.message,
        })
        break
      // M12：确认模式切换进对话流；旧会话（v10–v12）里的 mode.switch 照旧显示
      case 'permissions.mode.switch':
        push({
          seq: env.seq,
          kind: 'context',
          text: tr('core.ev.permissionsMode', { mode: tr(PERMISSIONS_MODE_LABEL[ev.mode]) }),
        })
        break
      case 'mode.switch':
        push({ seq: env.seq, kind: 'context', text: ev.to === 'plan' ? tr('core.ev.planMode') : tr('core.ev.actMode') })
        break
      case 'plan.proposed':
        push({ seq: env.seq, kind: 'task', text: tr('core.ev.planProposed'), summary: ev.plan.slice(0, 400) })
        break
      case 'plan.decided':
        push({
          seq: env.seq,
          kind: 'task',
          text: ev.approved
            ? tr('core.ev.planApproved', { v: ev.runId ? tr('core.ev.toRun', { runId: ev.runId }) : '' })
            : tr('core.ev.planRejected'),
          ok: ev.approved,
          ...(ev.comment ? { summary: ev.comment } : {}),
        })
        break
      case 'worktree.create':
        $status.set({ ...$status.get(), worktree: { path: ev.path, branch: ev.branch, repo: ev.repo } })
        push({ seq: env.seq, kind: 'context', text: tr('core.ev.worktree', { branch: ev.branch }), summary: ev.path })
        break
      case 'worktree.apply':
        push({
          seq: env.seq,
          kind: 'task',
          text: tr('core.ev.applied', {
            v: ev.ok ? tr('core.ev.appliedOk') : tr('core.ev.appliedFail'),
            mode: ev.mode,
          }),
          ok: ev.ok,
          ...(ev.message ? { summary: ev.message } : {}),
        })
        break
      case 'budget.warn':
        push({
          seq: env.seq,
          kind: 'context',
          text: tr('core.ev.budgetWarn', { kind: ev.kind, used: ev.used, limit: ev.limit }),
        })
        break
      case 'budget.decided':
        push({
          seq: env.seq,
          kind: 'context',
          text: tr('core.ev.budgetDecided', {
            v: { continue: tr('core.ev.continue'), stop: tr('core.ev.stop'), raise: tr('core.ev.raise') }[ev.action],
          }),
        })
        break
      case 'review.findings':
        $review.set(ev.findings)
        push({
          seq: env.seq,
          kind: 'task',
          text: tr('core.ev.findings', { length: ev.findings.length }),
          summary: ev.findings
            .slice(0, 5)
            .map((f) => `${f.file}${f.line ? `:${f.line}` : ''} ${f.problem}`)
            .join(tr('core.listSepStrong')),
        })
        break
      case 'plugin.error':
        push({
          seq: env.seq,
          kind: 'error',
          text: tr('core.ev.pluginError', {
            plugin: ev.plugin,
            v: ev.tool ? tr('core.ev.pluginTool', { tool: ev.tool }) : '',
            message: ev.message,
          }),
          ok: false,
        })
        break
      case 'task.retry':
        push({ seq: env.seq, kind: 'task', text: tr('core.ev.retry', { nodeId: ev.nodeId }) })
        break
      case 'task.end': {
        const label = {
          done: tr('core.ev.runDone'),
          failed: tr('core.ev.runFailed'),
          cancelled: tr('core.ev.runCancelled'),
        }[ev.status]
        push({ seq: env.seq, kind: 'task', text: tr('core.ev.runEnd', { label }), ok: ev.status === 'done' })
        break
      }
      // 引用了哪段别的会话，要在对话里看得见（PRD-M3-005 AC-3）
      case 'ctx.ref':
        push({
          seq: env.seq,
          kind: 'context',
          text: tr('core.ev.ref', { sessionId: ev.sessionId, fromSeq: ev.fromSeq, toSeq: ev.toSeq }),
        })
        break
      // 切换模型要在对话里看得见：之后的回答换了人答（parity 第 10 项）
      case 'model.switch': {
        const lost = ev.lostCapabilities ?? []
        push({
          seq: env.seq,
          kind: 'context',
          text: tr('core.ev.modelSwitch', {
            from: ev.from,
            to: ev.to,
            v: ev.provider === undefined ? '' : tr('core.ev.provider', { provider: ev.provider }),
          }),
          ...(lost.length > 0
            ? { summary: tr('core.ev.lost', { join: lost.join(tr('common.listSep')) }) }
            : ev.reason === undefined
              ? {}
              : { summary: ev.reason }),
        })
        break
      }
      case 'model.usage':
        $status.set({ ...$status.get(), lastUsage: ev.raw })
        break
      case 'worktree.discard':
        push({
          seq: env.seq,
          kind: 'context',
          text: tr('core.ev.discard', { path: ev.path }),
          summary: tr('core.ev.undoHint', { trash: ev.trash }),
        })
        break
      case 'worktree.restore':
        push({ seq: env.seq, kind: 'context', text: tr('core.ev.undone', { path: ev.path }) })
        break
      case 'error':
        push({ seq: env.seq, kind: 'error', text: ev.message, ok: false })
        break
      default:
        break
    }
  }

  return {
    $items,
    $status,
    $ask,
    $review,
    $oldestSeq,
    $hasOlder,
    $loadingOlder,
    $streaming,
    applyEvents(envelopes: EventEnvelope[]): void {
      for (const e of envelopes) applyEvent(e)
    },
    /** PRD-M11-009：向上翻页拿到的更早事件，插到列表前面。 */
    prependEvents(envelopes: EventEnvelope[]): void {
      // 复用 applyEvent 的投影逻辑，但往头部插而不是尾部 push。
      // applyEvent 内部用 push/appendText——它们只往尾部拼。这里需要一个独立的头部投影。
      // 简化：envelopes 已经按 seq 升序，逐条"反向投影"——先把现有 items 存下，
      // 清空后先 applyEvent 新事件再 applyEvent 旧事件。开销 O(n)，翻页频次低可接受。
      const oldItems = $items.get()
      $items.set([])
      at = envelopes[0]?.ts ?? 0
      for (const e of envelopes) applyEvent(e)
      // 旧事件重新 apply 会再次走 push——直接把旧 items 拼回去（它们已经是投影好的 TranscriptItem）
      $items.set([...$items.get(), ...oldItems])
    },
    /** 首连 subscribe 回来后，服务端告诉我们窗口边界 */
    setWindowMeta(meta: { oldestSeq: number; hasOlder: boolean } | null): void {
      $oldestSeq.set(meta?.oldestSeq ?? null)
      $hasOlder.set(meta?.hasOlder ?? false)
    },
    setLoadingOlder(b: boolean): void {
      $loadingOlder.set(b)
    },
    setBusy(busy: boolean): void {
      $status.set({ ...$status.get(), busy })
    },
    setAsk(ask: AskSnapshot | null): void {
      $ask.set(ask)
    },
    setMetrics(metrics: MetricsSnapshot | null): void {
      $status.set({ ...$status.get(), metrics })
    },
    setModel(provider: string, model: string): void {
      const cur = $status.get()
      if (cur.provider === provider && cur.model === model) return
      $status.set({ ...cur, provider, model })
    },
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>

/**
 * 焦点归属 —— PRD-M0-005 AC-2 要断言「连续三次渲染后焦点仍在确认组件」。
 *
 * 做成**纯函数**而不是 Ink 的 useFocus，是为了能在没有 TTY 的地方断言它。
 * 真终端里键盘事件怎么送到组件是 apps/tui 的事；焦点归谁**是状态，不是交互**。
 */
export const FOCUS_INPUT = 'domi-input'
export const FOCUS_CONFIRM = 'domi-confirm'

export function focusIdOf(ask: AskSnapshot | null): string {
  return ask === null ? FOCUS_INPUT : FOCUS_CONFIRM
}

/**
 * 确认框的按键语义。返回 null 表示「这个键不是答案，忽略」——
 * **不能把未知按键当成同意**，这是 fail-closed 在交互层的延续（INV-03）。
 */
export function answerFromKey(input: string, key: { return?: boolean; escape?: boolean } = {}): boolean | null {
  if (key.escape) return false
  const c = input.trim().toLowerCase()
  if (c === 'y') return true
  if (c === 'n') return false
  // 回车不等于同意：默认拒绝
  if (key.return) return false
  return null
}
