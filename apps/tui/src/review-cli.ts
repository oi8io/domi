/**
 * `domi review` —— PRD-M7-010
 *
 * 在 domid 里派一个只读的审阅会话，等它交出结构化发现，按文件打印。
 */

import { createSessionStore, type DomiClient, type ReviewFindingSnapshot } from '@domi/client-core'
import { tr } from '@domi/i18n'

export const REVIEW_USAGE = () => tr('tui.review.usage')

const SEVERITY = (): Record<string, string> => ({
  high: tr('common.severity.high'),
  medium: tr('common.severity.medium'),
  low: tr('common.severity.low'),
})

export function formatFindings(findings: readonly ReviewFindingSnapshot[]): string {
  if (findings.length === 0) return tr('tui.review.none')
  const byFile = new Map<string, ReviewFindingSnapshot[]>()
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f])
  const lines: string[] = [tr('tui.review.found', { length: findings.length })]
  for (const [file, list] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push('', file)
    for (const f of list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      lines.push(
        `  [${SEVERITY()[f.severity] ?? f.severity}] ${f.line ? tr('tui.review.line', { line: f.line }) : ''}${f.problem}`,
        tr('tui.review.basis', { basis: f.basis }),
      )
    }
  }
  return lines.join('\n')
}

export async function runReviewCommand(
  args: readonly string[],
  io: { out(s: string): void; err(s: string): void },
  client: DomiClient,
  cwd: string,
): Promise<number> {
  const specs: string[] = []
  let base: string | undefined
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--spec' && args[i + 1]) specs.push(args[++i] as string)
    else if (a === '--base' && args[i + 1]) base = args[++i]
    else if (a === '--help' || a === '-h') {
      io.out(REVIEW_USAGE())
      return 0
    } else {
      io.err(REVIEW_USAGE())
      return 2
    }
  }
  const id = await client.startReview({ cwd, specs, ...(base === undefined ? {} : { base }) })
  io.out(tr('tui.review.started', { id }))
  const store = createSessionStore()
  await client.watch(id, store)
  // 等到交出发现、或者这一轮结束
  const done = await new Promise<'findings' | 'ended'>((resolve) => {
    let sawBusy = false
    const check = (): void => {
      if (store.$review.get() !== null) resolve('findings')
      const busy = store.$status.get().busy
      if (busy) sawBusy = true
      else if (sawBusy) resolve('ended')
    }
    store.$review.listen(check)
    store.$status.listen(check)
    check()
  })
  client.unwatch(id)
  const findings = store.$review.get()
  if (done === 'ended' && findings === null) {
    const last = store.$items
      .get()
      .filter((i) => i.kind === 'error' || i.kind === 'assistant')
      .at(-1)
    io.err(
      tr('tui.review.noFindings', { v: last ? tr('tui.review.lastPart', { slice: last.text.slice(0, 500) }) : '' }),
    )
    return 1
  }
  io.out(formatFindings(findings ?? []))
  return (findings ?? []).some((f) => f.severity === 'high') ? 1 : 0
}
