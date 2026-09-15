/**
 * 事件流与轨迹。数据是 client-core 投影好的 TranscriptItem，这里只决定长什么样。
 *
 * 工具调用与它的结果配成一组，用原生 <details> 折叠——和 `domi trace --html` 同一个做法：
 * 折叠是展示状态，不是业务状态，不值得进 store。
 */
import type { TranscriptItem } from '@domi/client-core'

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

const LABEL: Record<TranscriptItem['kind'], string> = {
  user: '你',
  assistant: 'domi',
  reason: '思考',
  'tool-call': '工具',
  'tool-result': '结果',
  permission: '权限',
  error: '错误',
  context: '上下文',
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

/** 「从这里分支」。分支点是这一行最后一条事件：工具行带上结果，免得分出去的会话里有调用没结果 */
function BranchButton({ seq, onBranch }: { seq: number; onBranch: (seq: number) => void }) {
  return (
    <button type="button" className="branch" title={`从第 ${seq} 条分支出一个新会话`} onClick={() => onBranch(seq)}>
      分支
    </button>
  )
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
  if (items.length === 0) return <p className="empty">还没有事件。</p>
  const turns = new Map(turnRanges(items).map((t) => [t.seq, t]))
  return (
    <ol className="transcript">
      {groupRows(items).map((row) =>
        row.kind === 'tool' ? (
          <li key={row.call.seq} className="row tool" data-seq={row.call.seq}>
            <details>
              <summary>
                <span className="label">{LABEL['tool-call']}</span>
                <code>{row.call.text}</code>
                {row.result === null ? (
                  <span className="pending">运行中…</span>
                ) : (
                  <span className={row.result.ok ? 'ok' : 'failed'}>{row.result.ok ? '成功' : '失败'}</span>
                )}
              </summary>
              <pre className="args">{row.call.summary}</pre>
              {row.result !== null && <pre className="result">{row.result.summary ?? row.result.text}</pre>}
            </details>
            {onBranch !== undefined && <BranchButton seq={(row.result ?? row.call).seq} onBranch={onBranch} />}
          </li>
        ) : (
          <li key={row.item.seq} className={`row ${row.item.kind}`} data-seq={row.item.seq}>
            <span className="label">{LABEL[row.item.kind]}</span>
            <div className="text">{row.item.text}</div>
            {row.item.summary !== undefined && <div className="summary">{row.item.summary}</div>}
            {onBranch !== undefined && <BranchButton seq={row.item.seq} onBranch={onBranch} />}
            {onQuote !== undefined && row.item.kind === 'user' && (
              <button
                type="button"
                className="quote"
                title="在别的会话里引用这一轮"
                onClick={() => {
                  const t = turns.get(row.item.seq)
                  if (t) onQuote({ fromSeq: t.fromSeq, toSeq: t.toSeq, label: row.item.text.slice(0, 40) })
                }}
              >
                引用这一轮
              </button>
            )}
          </li>
        ),
      )}
    </ol>
  )
}
