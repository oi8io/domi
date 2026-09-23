/**
 * 轨迹树 —— PRD-M2-005 AC-1 / AC-2 / AC-3
 *
 * **轨迹完全由事件流渲染，没有一处独立埋点**（AC-4）。
 * 判据是机器化的：删掉 `packages/trace` 之后 kernel 与 store 的测试仍然全绿。
 * 这和 `packages/eval` 是同一条规矩——旁观者不许让主干为自己改形状（INV-13 的同源要求）。
 *
 * 为什么要有轨迹：**看得懂每一步在想什么，是信任的来源。**
 * 一个你看不见内部的 agent，人只会用它做无关紧要的事。
 */
import { tr } from '@domi/i18n'
import { type AnyEvent, type EventEnvelope, isKnownEvent } from '@domi/protocol'

/** AC-2：超过这个字节数的结果默认折叠 */
export const COLLAPSE_BYTES = 2048
/** AC-2：折叠态显示前多少个字符 */
export const PREVIEW_CHARS = 200

export type NodeKind =
  | 'input'
  | 'think'
  | 'tool'
  | 'permission'
  | 'cleanup'
  | 'compact'
  | 'error'
  | 'answer'
  | 'task'
  | 'other'

export interface TraceNode {
  seq: number
  kind: NodeKind
  /** 一行标题，树上永远可见 */
  title: string
  /** 详情。可能很长——是否默认折叠看 collapsed */
  detail: string
  /** AC-2：详情超过 COLLAPSE_BYTES 就默认折叠 */
  collapsed: boolean
  /** 折叠态显示的内容：前 200 字符 + 总字节数 */
  preview: string
  bytes: number
  /** 工具节点才有：耗时 */
  ms: number | null
  /** AC-3：这一步的 token 消耗（只有 model.usage 携带）与累计花费 */
  tokens: { input: number; output: number; cacheRead: number } | null
  costUsdCumulative: number | null
  children: TraceNode[]
}

export interface TraceTree {
  sessionId: string
  nodes: TraceNode[]
  /** 整条轨迹的累计花费；null 表示没有任何一次用量能定价（与状态栏同口径） */
  totalCostUsd: number | null
  unpricedModels: string[]
}

function bytesOf(s: string): number {
  return new TextEncoder().encode(s).length
}

function previewOf(s: string): string {
  const head = [...s].slice(0, PREVIEW_CHARS).join('')
  return head.length < s.length ? `${head}…` : head
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
}

function node(seq: number, kind: NodeKind, title: string, detail: string, extra: Partial<TraceNode> = {}): TraceNode {
  const bytes = bytesOf(detail)
  return {
    seq,
    kind,
    title,
    detail,
    bytes,
    collapsed: bytes > COLLAPSE_BYTES,
    preview: previewOf(detail),
    ms: null,
    tokens: null,
    costUsdCumulative: null,
    children: [],
    ...extra,
  }
}

export interface BuildOptions {
  pricing?: Record<string, { inputPer1M: number; outputPer1M: number; cacheReadPer1M?: number }>
  /**
   * 子会话的事件（子 agent、编排节点），按会话 id 给。有的话嵌套在派生它的那一步下面（PRD-M5-001 AC-4）；
   * 没给就只显示一行「子会话 xxx」，不去读库——buildTrace 是纯函数
   */
  children?: ReadonlyMap<string, readonly EventEnvelope[]>
}

/** 从事件里找出子会话 id（调用方据此去读子会话，再交回 children） */
export function childSessionIds(events: readonly EventEnvelope[]): string[] {
  const out: string[] = []
  for (const { ev } of events) {
    if (!isKnownEvent(ev)) continue
    if (ev.t === 'task.spawn') out.push(ev.childSessionId)
    else if (ev.t === 'task.node' && ev.sessionId !== undefined && !out.includes(ev.sessionId)) out.push(ev.sessionId)
  }
  return out
}

/**
 * 事件流 → 轨迹树。
 *
 * 结构是两层：**工具调用是父节点，权限决策与结果挂在它下面**。
 * 扁平列表也能看，但「这次写文件是谁批准的」要靠上下扫视去对——
 * 而那恰恰是最需要一眼看清的关系。
 */
export function buildTrace(events: readonly EventEnvelope[], opts: BuildOptions = {}): TraceTree {
  const pricing = opts.pricing ?? {}
  const nodes: TraceNode[] = []
  const byCallId = new Map<string, TraceNode>()
  /** 最近一个还没配上结果的工具节点——权限事件挂给它 */
  let pendingTool: TraceNode | null = null

  let model = ''
  let cost = 0
  let priced = false
  const unpriced = new Set<string>()

  for (const env of events) {
    const ev: AnyEvent = env.ev
    if (!isKnownEvent(ev)) {
      nodes.push(node(env.seq, 'other', tr('trace.unknownEvent', { t: ev.t }), JSON.stringify(ev.__unparsed, null, 2)))
      continue
    }

    switch (ev.t) {
      case 'user.input':
        nodes.push(node(env.seq, 'input', tr('trace.youSaid'), ev.text))
        break

      case 'model.request':
        model = ev.model
        break

      case 'model.reason':
        nodes.push(node(env.seq, 'think', tr('core.timeline.thinking'), ev.text))
        break

      case 'model.delta': {
        // 连续的 delta 合成一个「回答」节点，否则轨迹会被几百个碎片淹掉
        const last = nodes[nodes.length - 1]
        if (last && last.kind === 'answer') {
          last.detail += ev.text
          last.bytes = bytesOf(last.detail)
          last.collapsed = last.bytes > COLLAPSE_BYTES
          last.preview = previewOf(last.detail)
        } else {
          nodes.push(node(env.seq, 'answer', tr('core.timeline.answer'), ev.text))
        }
        break
      }

      case 'tool.call': {
        const n = node(env.seq, 'tool', `${ev.name}`, textOf(ev.args))
        byCallId.set(ev.id, n)
        pendingTool = n
        nodes.push(n)
        break
      }

      case 'permission': {
        const line = tr('trace.permission', {
          capabilityId: ev.capabilityId,
          decision: ev.decision,
          source: ev.source,
          v: ev.matchedRule ? tr('trace.rule', { matchedRule: ev.matchedRule }) : '',
        })
        const n = node(env.seq, 'permission', tr('web.transcript.permission'), line)
        if (pendingTool) pendingTool.children.push(n)
        else nodes.push(n)
        break
      }

      case 'tool.result': {
        const parent = byCallId.get(ev.id)
        const detail = textOf(ev.payload)
        const n = node(env.seq, 'tool', ev.ok ? tr('trace.result') : tr('common.failed'), detail, { ms: ev.ms })
        if (parent) {
          parent.ms = ev.ms
          parent.children.push(n)
        } else {
          nodes.push(n)
        }
        if (pendingTool === parent) pendingTool = null
        break
      }

      case 'model.usage': {
        const raw = ev.raw
        const num = (...keys: string[]): number => {
          for (const k of keys) {
            const v = raw[k]
            if (typeof v === 'number' && Number.isFinite(v)) return v
          }
          return 0
        }
        const tokens = {
          input: num('input_tokens', 'inputTokens', 'prompt_tokens'),
          output: num('output_tokens', 'outputTokens', 'completion_tokens'),
          cacheRead: num('cache_read_input_tokens', 'cacheReadInputTokens', 'cached_tokens'),
        }
        const price = pricing[model]
        if (price) {
          const rate = price.cacheReadPer1M ?? price.inputPer1M
          cost += (tokens.input * price.inputPer1M + tokens.output * price.outputPer1M + tokens.cacheRead * rate) / 1e6
          priced = true
        } else if (model !== '') {
          unpriced.add(model)
        }
        // 用量挂在最近一个节点上，而不是自成一行：它描述的是刚才那一步
        const host = nodes[nodes.length - 1]
        const info = { ...tokens }
        const cumulative = priced ? cost : null
        if (host) {
          host.tokens = info
          host.costUsdCumulative = cumulative
        } else {
          nodes.push(
            node(env.seq, 'other', tr('trace.usage'), JSON.stringify(raw), {
              tokens: info,
              costUsdCumulative: cumulative,
            }),
          )
        }
        break
      }

      case 'error':
        nodes.push(
          node(
            env.seq,
            'error',
            ev.recoverable ? tr('trace.errorRecoverable') : tr('trace.error'),
            `${ev.scope}: ${ev.message}`,
          ),
        )
        break

      case 'ctx.cleanup':
        nodes.push(
          node(
            env.seq,
            'cleanup',
            tr('core.ev.cleanup', { tokensBefore: ev.tokensBefore, tokensAfter: ev.tokensAfter }),
            tr('core.ev.cleanupDetail', {
              dedupe: ev.saved.dedupe,
              verbose: ev.saved.verbose,
              resolvedError: ev.saved.resolvedError,
              stack: ev.saved.stack,
            }) + (ev.preserved.length > 0 ? tr('trace.preserved', { join: ev.preserved.join(', ') }) : ''),
          ),
        )
        break

      case 'task.spawn': {
        // 子 agent：挂在派生它的那次工具调用下面，子会话的整棵树再挂在它下面
        const n = node(
          env.seq,
          'task',
          tr('trace.subAgent', { goal: ev.goal }),
          tr('trace.childSession', {
            childSessionId: ev.childSessionId,
            v: ev.tools ? tr('trace.tools', { join: ev.tools.join(tr('common.listSep')) }) : '',
          }),
        )
        const sub = opts.children?.get(ev.childSessionId)
        if (sub) n.children = buildTrace(sub, opts).nodes
        if (pendingTool) pendingTool.children.push(n)
        else nodes.push(n)
        break
      }

      case 'task.run':
        nodes.push(node(env.seq, 'task', tr('trace.task', { name: ev.name }), JSON.stringify(ev.spec, null, 2)))
        break

      case 'task.node': {
        if (ev.status === 'started') {
          nodes.push(node(env.seq, 'task', tr('trace.nodeStart', { nodeId: ev.nodeId, attempt: ev.attempt }), ''))
          break
        }
        const n = node(
          env.seq,
          ev.status === 'done' ? 'task' : 'error',
          tr('trace.nodeEnd', {
            nodeId: ev.nodeId,
            v: ev.status === 'done' ? tr('core.ev.nodeDone') : tr('core.ev.nodeFailed'),
          }),
          ev.error ?? ev.output ?? '',
          { ms: ev.ms ?? null },
        )
        const sub = ev.sessionId === undefined ? undefined : opts.children?.get(ev.sessionId)
        if (sub) n.children = buildTrace(sub, opts).nodes
        nodes.push(n)
        break
      }

      case 'task.resume':
        nodes.push(
          node(
            env.seq,
            'task',
            tr('trace.resume'),
            tr('trace.resumeDetail', {
              v: ev.completed.join(tr('common.listSep')) || tr('common.none'),
              v2: ev.rerun.join(tr('common.listSep')) || tr('common.none'),
            }),
          ),
        )
        break

      case 'plugin.error':
        nodes.push(
          node(
            env.seq,
            'error',
            tr('trace.pluginError', { plugin: ev.plugin }),
            `${ev.tool ? `${ev.tool}: ` : ''}${ev.message}`,
          ),
        )
        break

      // ── M7 ──
      case 'hook.run': {
        const state = ev.timedOut
          ? tr('trace.timeout')
          : ev.blocked
            ? tr('trace.blocked')
            : tr('trace.exitCode', { exitCode: String(ev.exitCode) })
        const n = node(
          env.seq,
          'permission',
          tr('trace.hook', { name: ev.name, on: ev.on }),
          `${state} · ${ev.ms}ms${ev.output ? `\n${ev.output}` : ''}`,
        )
        if (pendingTool && ev.on !== 'stop') pendingTool.children.push(n)
        else nodes.push(n)
        break
      }
      case 'workspace.trust':
        nodes.push(
          node(
            env.seq,
            'permission',
            ev.trusted ? tr('trace.trusted') : tr('trace.untrusted'),
            tr('trace.rootSource', { root: ev.root, source: ev.source }),
          ),
        )
        break
      case 'verify.required':
        nodes.push(
          node(
            env.seq,
            'other',
            ev.final ? tr('core.ev.unverifiedEnd') : tr('trace.verifyNudge', { attempt: ev.attempt }),
            ev.message,
          ),
        )
        break
      case 'mode.switch':
        nodes.push(

        )
        break
      case 'plan.proposed':
        nodes.push(node(env.seq, 'task', tr('trace.planProposed'), ev.plan))
        break
      case 'plan.decided':
        nodes.push(
          node(
            env.seq,
            'task',
            ev.approved ? tr('trace.planApproved') : tr('core.ev.planRejected'),
            `${ev.comment ?? ''}${ev.runId ? tr('trace.longRun', { runId: ev.runId }) : ''}`,
          ),
        )
        break
      case 'worktree.create':
        nodes.push(
          node(
            env.seq,
            'other',
            tr('trace.worktree'),
            tr('trace.worktreeDetail', { path: ev.path, branch: ev.branch, slice: ev.base.slice(0, 8) }),
          ),
        )
        break
      case 'worktree.discard':
        nodes.push(node(env.seq, 'other', tr('trace.discard', { path: ev.path }), ''))
        break
      case 'worktree.restore':
        nodes.push(node(env.seq, 'other', tr('trace.undo', { path: ev.path }), ''))
        break
      case 'worktree.apply':
        nodes.push(
          node(
            env.seq,
            ev.ok ? 'other' : 'error',
            tr('trace.apply', { mode: ev.mode, v: ev.ok ? '' : tr('trace.failedSuffix') }),
            ev.message ?? ev.commit ?? '',
          ),
        )
        break
      case 'budget.warn':
        nodes.push(node(env.seq, 'other', tr('trace.budgetWarn', { kind: ev.kind }), `${ev.used} / ${ev.limit}`))
        break
      case 'budget.decided':
        nodes.push(
          node(
            env.seq,
            'other',
            tr('trace.budgetDecided', { action: ev.action }),
            ev.limit === undefined ? '' : tr('trace.newLimit', { limit: ev.limit }),
          ),
        )
        break
      case 'review.findings':
        nodes.push(
          node(
            env.seq,
            'task',
            tr('trace.findings', { length: ev.findings.length }),
            ev.findings.map((f) => `[${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} ${f.problem}`).join('\n'),
          ),
        )
        break

      case 'task.retry':
        nodes.push(node(env.seq, 'task', tr('trace.retry', { nodeId: ev.nodeId }), ''))
        break

      case 'task.end':
        nodes.push(
          node(env.seq, ev.status === 'done' ? 'task' : 'error', tr('trace.runEnd', { status: ev.status }), ''),
        )
        break

      case 'snapshot':
      case 'revert':
      case 'model.switch':
      case 'fs.snapshot':
        nodes.push(node(env.seq, 'other', ev.t, JSON.stringify(ev, null, 2)))
        break

      default:
        break
    }
  }

  return {
    sessionId: events[0]?.sessionId ?? '',
    nodes,
    totalCostUsd: priced ? cost : null,
    unpricedModels: [...unpriced].sort(),
  }
}

/** 按 seq 找节点 —— L1 回放的差异报告给的就是 seq（PRD-M2-008 AC-4 的另一半） */
export function findBySeq(tree: TraceTree, seq: number): TraceNode | null {
  const walk = (ns: readonly TraceNode[]): TraceNode | null => {
    for (const n of ns) {
      if (n.seq === seq) return n
      const hit = walk(n.children)
      if (hit) return hit
    }
    return null
  }
  return walk(tree.nodes)
}
