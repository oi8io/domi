/**
 * Chat 流 —— PRD-M8-008 AC-1（样式按原型 docs/ui-redesign/index.html 的 .chat-view）。
 * 数据是 client-core 投影好的 TranscriptItem，这里只决定长什么样。
 *
 * 工具调用与它的结果配成一组，用原生 <details> 折叠——和 `domi trace --html` 同一个做法：
 * 折叠是展示状态，不是业务状态，不值得进 store。
 */

import { formatElapsed, summarizeReason, type TranscriptItem } from '@domi/client-core'
import { tr } from '@domi/i18n'
import type { ReactNode } from 'react'
import { IconBranch, IconQuote } from './icons.tsx'
import { cn } from './lib/cn.ts'
import { MarkdownView } from './session/MarkdownView.tsx'

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
  // 运行中补充（PRD-M13-001 AC-4）不是轮边界
  const users = items.filter((i) => i.kind === 'user' && i.note !== true)
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
      title={tr('web.transcript.branchFrom', { seq })}
      onClick={() => onBranch(seq)}
    >
      <IconBranch size={11} />
      {tr('web.transcript.branch')}
    </button>
  )
}

const ROLE = 'mb-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em]'
const TEXT = 'whitespace-pre-wrap break-words text-sm leading-[1.65]'

function ToolStatus({ result }: { result: TranscriptItem | null }) {
  const [label, cls] =
    result === null
      ? [tr('common.running'), 'bg-accent-d text-accent']
      : result.ok
        ? [tr('common.succeeded'), 'bg-ok-d text-ok']
        : [tr('common.failed'), 'bg-bad-d text-bad']
  return (
    <span className={cn('rounded-[10px] px-[7px] py-px text-[10.5px] font-semibold', cls)} data-status>
      {label}
    </span>
  )
}

const PLAN_MARK = { done: '✓', in_progress: '▸', skipped: '–', pending: '○' } as const

function ItemBody({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="rounded-md border border-accent-b bg-accent-d px-3.5 py-2.5">
          <div className={cn(ROLE, 'text-accent')}>
            {tr('web.transcript.you')}
            {item.note === true && (
              <span className="ml-1.5 rounded-sm border border-accent-b px-1 text-[10px] font-normal" data-note="">
                {tr('web.transcript.note')}
              </span>
            )}
          </div>
          <div className={TEXT}>{item.text}</div>
        </div>
      )
    case 'assistant':
      // PRD-M11-003：assistant 文本走 Markdown（reason/user/error 保持纯文本）
      return (
        <div className="px-3.5 py-2.5">
          <div className={cn(ROLE, 'text-ok')}>domi</div>
          <MarkdownView>{item.text}</MarkdownView>
        </div>
      )
    case 'reason':
      // PRD-M10-005 AC-1：默认折叠为单行「思考 · 前 N 字…」，点击展开/收起全文。
      // 折叠是展示状态，用原生 <details>；摘要截断口径 = summarizeReason（client-core 定死，渲染层不二次截断）
      return (
        <details className="group/thought my-0.5 ml-2 border-l-2 border-border px-3.5 py-1.5">
          <summary className="cursor-pointer list-none text-xs text-mut2 select-none [&::-webkit-details-marker]:hidden">
            <span className="group-open/thought:hidden">
              ▸ {tr('web.transcript.thinking')} · {summarizeReason(item.text)}
            </span>
            <span className="hidden group-open/thought:inline">▾ {tr('web.transcript.thinking')}</span>
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
            {tr('web.transcript.permission')}
          </span>
          <span className="min-w-0 truncate">{item.text}</span>
          {item.summary !== undefined && <span className="truncate text-mut2">{item.summary}</span>}
        </div>
      )
    case 'plan':
      // 计划卡片（PRD-M12-004 AC-8）：每步一行，状态用勾 / 箭头 / 划线
      return (
        <div className="my-1 rounded-md border border-border2 px-3.5 py-2 text-[13px]" data-part="plan">
          <div className={cn(ROLE, 'text-info')}>{item.text}</div>
          <ol className="grid gap-0.5">
            {(item.plan ?? []).map((s, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: 计划步骤按位置展示，整份替换
                key={i}
                data-status={s.status}
                className={cn(
                  'flex gap-2',
                  s.status === 'done' && 'text-mut line-through',
                  s.status === 'skipped' && 'text-mut2 line-through',
                  s.status === 'in_progress' && 'font-medium text-accent',
                )}
              >
                <span className="font-mono">{PLAN_MARK[s.status]}</span>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          {item.summary !== undefined && <div className="mt-1 text-xs text-mut">{item.summary}</div>}
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
  if (items.length === 0)
    return <p className="py-10 text-center text-[13px] text-mut">{tr('web.transcript.noEvents')}</p>
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
                {row.result?.ms !== undefined && (
                  <span className="shrink-0 font-mono text-[11px] text-mut2">{formatElapsed(row.result.ms)}</span>
                )}
              </summary>
              <pre className="max-h-[260px] overflow-y-auto border-t border-border2 bg-code px-3 py-2 text-xs break-all whitespace-pre-wrap">
                {row.call.detail ?? row.call.summary}
              </pre>
              {row.result !== null && (
                <pre className="max-h-[260px] overflow-y-auto border-t border-border2 bg-code px-3 py-2 text-xs break-all whitespace-pre-wrap text-ink2">
                  {row.result.detail ?? row.result.summary ?? row.result.text}
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
            {(onBranch !== undefined || (onQuote !== undefined && row.item.kind === 'user')) &&
              row.item.note !== true && (
                <RowActions>
                  {onQuote !== undefined && row.item.kind === 'user' && (
                    <button
                      type="button"
                      className={ACTION_BTN}
                      data-action="quote"
                      title={tr('web.transcript.quoteTurnHint')}
                      onClick={() => {
                        const t = turns.get(row.item.seq)
                        if (t) onQuote({ fromSeq: t.fromSeq, toSeq: t.toSeq, label: row.item.text.slice(0, 40) })
                      }}
                    >
                      <IconQuote size={11} />
                      {tr('web.transcript.quoteTurn')}
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
