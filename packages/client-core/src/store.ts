/**
 * 三端共享的状态投影 —— docs/adr/009
 *
 * **本包不 import react**（由 depcruise 规则 `no-react-in-client-core` 守）。
 * 理由见 ADR-009：消费方有四类，Telegram 桥接与 L1 回放评估都不是 React。
 *
 * 这里做的是**投影**，不是存储：事件流是唯一真相，atom 里的东西随时可以从
 * 事件流重算出来。所以任何"只在 atom 里、事件流里没有"的状态都是 bug。
 */
import { type AnyEvent, type EventEnvelope, isKnownEvent } from '@domi/protocol'
import { atom, computed } from 'nanostores'

export interface TranscriptItem {
  seq: number
  kind: 'user' | 'assistant' | 'reason' | 'tool-call' | 'tool-result' | 'permission' | 'error' | 'context' | 'task'
  text: string
  ok?: boolean
  /** 工具调用的参数摘要：JSON 序列化后前 80 字符 + …（PRD-M0-005 AC-1 写死的规则） */
  summary?: string
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
  /** 计划模式（M7-005） */
  mode?: 'plan' | 'act' | undefined
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
}

export interface AskSnapshot {
  /** 经 daemon 转来的询问才有；回答时要带上它（session.answer） */
  askId?: string
  capabilityId: string
  /** 完整的待执行内容，确认框必须显示它（PRD-M0-003 AC-1） */
  detail: string
  /** 工具要输入时的表单（JSON Schema）。有它就画表单，回答时带内容 */
  form?: { message: string; schema: unknown }
}

/** 状态栏的「本轮」段。一分钟以内到 0.1 秒，以上到秒 */
/** 验证状态的显示文字（TUI 与 Web 共用） */
export const VERIFY_LABEL = { unverified: '已改未验', verified: '已验证', failed: '验证失败' } as const

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

export function createSessionStore(initial: Partial<StatusSnapshot> = {}) {
  const $items = atom<TranscriptItem[]>([])
  const $status = atom<StatusSnapshot>({
    model: initial.model ?? '',
    provider: initial.provider ?? '',
    busy: false,
    toolCalls: 0,
    lastUsage: null,
    metrics: null,
  })
  const $ask = atom<AskSnapshot | null>(null)

  /** 最后一条 assistant 文本，流式增量往它上面拼 */
  const $streaming = computed($items, (items) => {
    const last = items[items.length - 1]
    return last?.kind === 'assistant' ? last.text : ''
  })

  function push(item: TranscriptItem): void {
    $items.set([...$items.get(), item])
  }

  function appendText(kind: 'assistant' | 'reason', seq: number, text: string): void {
    const items = $items.get()
    const last = items[items.length - 1]
    if (last?.kind === kind) {
      $items.set([...items.slice(0, -1), { ...last, text: last.text + text }])
    } else {
      push({ seq, kind, text })
    }
  }

  function applyEvent(env: EventEnvelope): void {
    const ev: AnyEvent = env.ev
    if (!isKnownEvent(ev)) return
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
        push({ seq: env.seq, kind: 'tool-call', text: ev.name, summary: summarizeArgs(ev.args) })
        $status.set({ ...$status.get(), toolCalls: $status.get().toolCalls + 1 })
        break
      case 'tool.result':
        push({
          seq: env.seq,
          kind: 'tool-result',
          text: ev.reason ?? (ev.ok ? 'ok' : 'failed'),
          ok: ev.ok,
          summary: summarizeArgs(ev.payload),
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
          text: `上下文清理 ${ev.tokensBefore} → ${ev.tokensAfter} tokens`,
          summary: `去重 ${ev.saved.dedupe} · 截断 ${ev.saved.verbose} · 已解决错误 ${ev.saved.resolvedError} · 堆栈 ${ev.saved.stack}`,
        })
        break
      case 'ctx.compact':
        push({
          seq: env.seq,
          kind: 'context',
          text: `上下文已压缩 ${ev.tokensBefore} → ${ev.tokensAfter} tokens（保留最近 ${ev.keptTurns} 轮）`,
          summary: ev.summary.intent,
        })
        break
      // 编排（M5）：运行与节点的进展都是事件，投影成对话里的一行
      case 'task.spawn':
        push({ seq: env.seq, kind: 'task', text: `派出子 agent：${ev.goal}`, summary: ev.childSessionId, ok: true })
        break
      case 'task.run':
        push({ seq: env.seq, kind: 'task', text: `任务开始：${ev.name}` })
        break
      case 'task.node': {
        const label = { started: '开始', done: '完成', failed: '失败' }[ev.status]
        const ms = ev.ms === undefined ? '' : `（${formatElapsed(ev.ms)}）`
        push({
          seq: env.seq,
          kind: 'task',
          text: `节点 ${ev.nodeId} ${label}${ev.attempt > 1 ? `（第 ${ev.attempt} 次）` : ''}${ms}`,
          ...(ev.status === 'started' ? {} : { ok: ev.status === 'done' }),
          ...((ev.error ?? ev.output) === undefined ? {} : { summary: (ev.error ?? ev.output ?? '').slice(0, 200) }),
        })
        break
      }
      case 'task.resume':
        push({
          seq: env.seq,
          kind: 'task',
          text: `任务恢复：已完成 ${ev.completed.length} 个节点${ev.rerun.length > 0 ? `，重跑 ${ev.rerun.join('、')}` : ''}`,
        })
        break
      case 'hook.run':
        if (ev.blocked || ev.on !== 'pre')
          push({
            seq: env.seq,
            kind: 'permission',
            text: `钩子 ${ev.name}${ev.timedOut ? ' 超时' : ev.blocked ? ' 拦下了调用' : `（${ev.on}，退出码 ${ev.exitCode}）`}`,
            ok: !ev.blocked,
            ...(ev.output ? { summary: ev.output.slice(0, 200) } : {}),
          })
        break
      case 'workspace.trust':
        push({
          seq: env.seq,
          kind: 'permission',
          text: ev.trusted ? `信任这个仓库：${ev.root}` : `没有加载这个仓库的规矩文件（未信任）：${ev.root}`,
          ok: ev.trusted,
        })
        break
      case 'verify.required':
        push({
          seq: env.seq,
          kind: 'context',
          text: ev.final ? '没有通过验证就结束了' : '提醒模型先验证再结束',
          summary: ev.message,
        })
        break
      case 'mode.switch':
        push({ seq: env.seq, kind: 'context', text: ev.to === 'plan' ? '进入计划模式（只读）' : '进入执行模式' })
        break
      case 'plan.proposed':
        push({ seq: env.seq, kind: 'task', text: '提交了计划，等你审批', summary: ev.plan.slice(0, 400) })
        break
      case 'plan.decided':
        push({
          seq: env.seq,
          kind: 'task',
          text: ev.approved ? `计划已批准${ev.runId ? `，转成长任务 ${ev.runId}` : ''}` : '计划被驳回',
          ok: ev.approved,
          ...(ev.comment ? { summary: ev.comment } : {}),
        })
        break
      case 'worktree.create':
        push({ seq: env.seq, kind: 'context', text: `在隔离工作区里干活：${ev.branch}`, summary: ev.path })
        break
      case 'worktree.apply':
        push({
          seq: env.seq,
          kind: 'task',
          text: `改动${ev.ok ? '已' : '没能'}带回原仓库（${ev.mode}）`,
          ok: ev.ok,
          ...(ev.message ? { summary: ev.message } : {}),
        })
        break
      case 'budget.warn':
        push({ seq: env.seq, kind: 'context', text: `用量到了上限的 80%（${ev.kind}：${ev.used} / ${ev.limit}）` })
        break
      case 'budget.decided':
        push({
          seq: env.seq,
          kind: 'context',
          text: `用量到顶，你选择了：${{ continue: '继续', stop: '停止', raise: '提高上限' }[ev.action]}`,
        })
        break
      case 'review.findings':
        push({
          seq: env.seq,
          kind: 'task',
          text: `审阅发现 ${ev.findings.length} 条问题`,
          summary: ev.findings
            .slice(0, 5)
            .map((f) => `${f.file}${f.line ? `:${f.line}` : ''} ${f.problem}`)
            .join('；'),
        })
        break
      case 'plugin.error':
        push({
          seq: env.seq,
          kind: 'error',
          text: `插件 ${ev.plugin}${ev.tool ? ` 的 ${ev.tool}` : ''} 出错：${ev.message}`,
          ok: false,
        })
        break
      case 'task.retry':
        push({ seq: env.seq, kind: 'task', text: `重试节点 ${ev.nodeId}` })
        break
      case 'task.end': {
        const label = { done: '完成', failed: '失败', cancelled: '已取消' }[ev.status]
        push({ seq: env.seq, kind: 'task', text: `任务${label}`, ok: ev.status === 'done' })
        break
      }
      // 引用了哪段别的会话，要在对话里看得见（PRD-M3-005 AC-3）
      case 'ctx.ref':
        push({ seq: env.seq, kind: 'context', text: `引用了会话 ${ev.sessionId} 的第 ${ev.fromSeq}–${ev.toSeq} 条` })
        break
      // 切换模型要在对话里看得见：之后的回答换了人答（parity 第 10 项）
      case 'model.switch': {
        const lost = ev.lostCapabilities ?? []
        push({
          seq: env.seq,
          kind: 'context',
          text: `模型切换 ${ev.from} → ${ev.to}`,
          ...(lost.length > 0 ? { summary: `新模型不支持：${lost.join('、')}` } : {}),
        })
        break
      }
      case 'model.usage':
        $status.set({ ...$status.get(), lastUsage: ev.raw })
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
    $streaming,
    applyEvents(envelopes: EventEnvelope[]): void {
      for (const e of envelopes) applyEvent(e)
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
