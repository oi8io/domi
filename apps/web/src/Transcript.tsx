/**
 * Chat 流 —— PRD-M8-008 AC-1（样式按原型 docs/ui-redesign/index.html 的 .chat-view）。
 * 数据是 client-core 投影好的 TranscriptItem，这里只决定长什么样。
 *
 * 工具调用与它的结果配成一组，用原生 <details> 折叠——和 `domi trace --html` 同一个做法：
 * 折叠是展示状态，不是业务状态，不值得进 store。
 */
import { formatElapsed, type TranscriptItem } from '@domi/client-core'
import type { ReactNode } from 'react'
import { IconBranch, IconQuote } from './icons.tsx'
import { cn } from './lib/cn.ts'

type Row =
  | { kind: 'item'; item: TranscriptItem }
  | { kind: 'tool'; call: TranscriptItem; result: TranscriptItem | null }

/** 把相邻的 tool-call / tool-result 配成一组。纯排版，不改任何内容 */
export function groupRows(items: readonly TranscriptItem[]): Row[] {
  const rows: Row[] = []
  for (const item of items) {
    if (item.kind === 'tool-call') {
      rows.push({ kind: 'tool', call: item, result: null })
      continue
    }
    const last = rows[rows.length - 1]
    if (item.kind === 'tool-result' && last?.kind === 'tool' && last.result === null) {
      last.result = item
      continue
    }
    rows.push({ kind: 'item', item })
  }
  return rows
}

/** 每一轮的范围：从这一轮的用户输入，到下一轮用户输入之前。最后一轮的终点交给 daemon 截（PRD-M3-005） */
export function turnRanges(items: readonly TranscriptItem[]): Array<{ seq: number; fromSeq: number; toSeq: number }> {
  const users = items.filter((i) => i.kind === 'user')
  return users.map((u, i) => {
    const next = users[i + 1]
    return { seq: u.seq, fromSeq: u.seq, toSeq: next === undefined ? Number.MAX_SAFE_INTEGER : next.seq - 1 }
  })
}

export interface QuoteRequest {
  fromSeq: number
  toSeq: number
  label: string
}

const ACTION_BTN =
  'inline-flex items-center gap-1 rounded-sm border border-border bg-bg px-2 py-0.5 text-[11px] text-mut hover:text-ink2'

/** hover 出来的行操作（分支 / 引用这一轮） */
function RowActions({ children }: { children: ReactNode }) {
  return (
    <span className="absolute top-1.5 right-2 flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
      {children}
    </span>
  )
}

/** 「从这里分支」。分支点是这一行最后一条事件：工具行带上结果，免得分出去的会话里有调用没结果 */
function BranchButton({ seq, onBranch }: { seq: number; onBranch: (seq: number) => void }) {
  return (
    <button
      type="button"
      className={ACTION_BTN}
      data-action="branch"
      title={`从第 ${seq} 条分支出一个新会话`}
      onClick={() => onBranch(seq)}
    >
      <IconBranch size={11} />
      分支
    </button>
  )
}

const ROLE = 'mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em]'
const TEXT = 'whitespace-pre-wrap break-words text-sm leading-[1.65]'

function ToolStatus({ result }: { result: TranscriptItem | null }) {
  const [label, cls] =
    result === null
      ? ['运行中', 'bg-accent-d text-accent']
      : result.ok
        ? ['成功', 'bg-ok-d text-ok']
        : ['失败', 'bg-bad-d text-bad']
  return (
    <span className={cn('rounded-[10px] px-[7px] py-px text-[10.5px] font-semibold', cls)} data-status>
      {label}
    </span>
  )
}

function ItemBody({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="rounded-md border border-accent-b bg-accent-d px-3.5 py-2.5">
          <div className={cn(ROLE, 'text-accent')}>你</div>
          <div className={TEXT}>{item.text}</div>
        </div>
      )
    case 'assistant':
      return (
        <div className="px-3.5 py-2.5">
          <div className={cn(ROLE, 'text-ok')}>domi</div>
          <div className={TEXT}>{item.text}</div>
        </div>
      )
    case 'reason':
      return (
        <details open className="group/thought my-0.5 ml-2 border-l-2 border-border px-3.5 py-1.5">
          <summary className="cursor-pointer list-none text-xs text-mut2 select-none [&::-webkit-details-marker]:hidden">
            <span className="group-open/thought:hidden">▸ </span>
            <span className="hidden group-open/thought:inline">▾ </span>
            思考
            {item.ms !== undefined && item.ms > 0 && (
              <span className="ml-1.5 font-mono text-[11px] text-mut2">{formatElapsed(item.ms)}</span>
            )}
          </summary>
          <div className="pt-1.5 text-[13px] whitespace-pre-wrap text-mut italic">{item.text}</div>
        </details>
      )
    case 'error':
      return (
        <div className="my-1 rounded-md border border-bad bg-bad-d px-3.5 py-2 text-[13px] text-bad">
          <div className={TEXT}>{item.text}</div>
          {item.summary !== undefined && <div className="mt-1 text-xs opacity-80">{item.summary}</div>}
        </div>
      )
    case 'permission':
      return (
        <div className="flex items-center gap-2 px-3.5 py-1 text-xs text-mut">
          <span className={cn('rounded px-1.5 font-semibold', item.ok ? 'bg-ok-d text-ok' : 'bg-bad-d text-bad')}>
            权限
          </span>
          <span className="min-w-0 truncate">{item.text}</span>
          {item.summary !== undefined && <span className="truncate text-mut2">{item.summary}</span>}
        </div>
      )
    case 'context':
      return (
        <div className="flex items-baseline gap-2 px-3.5 py-1 text-xs text-accent">
          <span>✂</span>
          <span>{item.text}</span>
          {item.summary !== undefined && <span className="text-mut2">{item.summary}</span>}
        </div>
      )
    default:
      return (
        <div
          className={cn(
            'flex items-baseline gap-2 px-3.5 py-1 text-xs',
            item.ok === false ? 'text-bad' : item.ok ? 'text-ok' : 'text-info',
          )}
        >
          <span>▸</span>
          <span className="whitespace-pre-wrap">{item.text}</span>
          {item.summary !== undefined && <span className="text-mut2">{item.summary}</span>}
        </div>
      )
  }
}

export function Transcript({
  items,
  onBranch,
  onQuote,
}: {
  items: readonly TranscriptItem[]
  /** 不给就不画分支按钮（只读视图） */
  onBranch?: (seq: number) => void
  /** 「引用这一轮」，画在每一轮的用户输入上。不给就不画 */
  onQuote?: (q: QuoteRequest) => void
}) {
  if (items.length === 0) return <p className="py-10 text-center text-[13px] text-mut">还没有事件。</p>
  const turns = new Map(turnRanges(items).map((t) => [t.seq, t]))
  return (
    <ol className="flex flex-col gap-1" data-list="transcript">
      {groupRows(items).map((row) =>
        row.kind === 'tool' ? (
          <li
            key={row.call.seq}
            className="group relative overflow-hidden rounded-md border border-border2"
            data-row="tool"
            data-seq={row.call.seq}
          >
            <details className="group/tool">
              <summary className="flex cursor-pointer list-none items-center gap-2 bg-panel px-3 py-1.5 text-[13px] hover:bg-panel-h [&::-webkit-details-marker]:hidden">
                <code className="text-[12.5px] font-medium">{row.call.text}</code>
                <ToolStatus result={row.result} />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-mut2">{row.call.summary}</span>
              </summary>
              <pre className="max-h-[260px] overflow-y-auto border-t border-border2 bg-code px-3 py-2 text-xs break-all whitespace-pre-wrap">
                {row.call.summary}
              </pre>
              {row.result !== null && (
                <pre className="max-h-[260px] overflow-y-auto border-t border-border2 bg-code px-3 py-2 text-xs break-all whitespace-pre-wrap text-ink2">
                  {row.result.summary ?? row.result.text}
                </pre>
              )}
            </details>
            {onBranch !== undefined && (
              <RowActions>
                <BranchButton seq={(row.result ?? row.call).seq} onBranch={onBranch} />
              </RowActions>
            )}
          </li>
        ) : (
          <li key={row.item.seq} className="group relative" data-row={row.item.kind} data-seq={row.item.seq}>
            <ItemBody item={row.item} />
            {(onBranch !== undefined || (onQuote !== undefined && row.item.kind === 'user')) && (
              <RowActions>
                {onQuote !== undefined && row.item.kind === 'user' && (
                  <button
                    type="button"
                    className={ACTION_BTN}
                    data-action="quote"
                    title="在别的会话里引用这一轮"
                    onClick={() => {
                      const t = turns.get(row.item.seq)
                      if (t) onQuote({ fromSeq: t.fromSeq, toSeq: t.toSeq, label: row.item.text.slice(0, 40) })
                    }}
                  >
                    <IconQuote size={11} />
                    引用这一轮
                  </button>
                )}
                {onBranch !== undefined && <BranchButton seq={row.item.seq} onBranch={onBranch} />}
              </RowActions>
            )}
          </li>
        ),
      )}
    </ol>
  )
}
