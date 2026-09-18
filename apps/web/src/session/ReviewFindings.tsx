/**
 * 审阅发现（PRD-M7-010 AC-2）：审阅会话交出的结构化发现，按文件分组展示。
 * 数据来自 client-core 的 `$review` 投影（review.findings 事件），这里只排版。
 */

import type { ReviewFindingSnapshot } from '@domi/client-core'
import { tr } from '@domi/i18n'
import { cn } from '../lib/cn.ts'

const SEVERITY = (): Record<ReviewFindingSnapshot['severity'], [string, string]> => ({
  high: [tr('common.severity.high'), 'bg-bad-d text-bad'],
  medium: [tr('common.severity.medium'), 'bg-warn-d text-warn'],
  low: [tr('common.severity.low'), 'bg-border2 text-mut'],
})

export function groupFindings(findings: readonly ReviewFindingSnapshot[]): Array<[string, ReviewFindingSnapshot[]]> {
  const byFile = new Map<string, ReviewFindingSnapshot[]>()
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f])
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, list]) => [file, [...list].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))])
}

export function ReviewFindings({ findings }: { findings: readonly ReviewFindingSnapshot[] }) {
  return (
    <section className="my-3 overflow-hidden rounded-md border border-border2" data-part="review-findings">
      <header className="flex items-center gap-2 bg-panel px-3.5 py-2 text-[13px] font-semibold">
        {tr('web.review.title')}
        <span className="font-normal text-mut">
          {findings.length === 0 ? tr('web.review.none') : tr('web.review.count', { length: findings.length })}
        </span>
      </header>
      {groupFindings(findings).map(([file, list]) => (
        <div key={file} className="border-t border-border2 px-3.5 py-2" data-file={file}>
          <div className="mb-1 font-mono text-xs text-ink2">{file}</div>
          <ul className="flex flex-col gap-1.5">
            {list.map((f) => (
              <li key={`${f.line ?? 0}-${f.problem}`} className="flex items-baseline gap-2 text-[13px]">
                <span
                  className={cn('shrink-0 rounded px-1.5 text-[10.5px] font-semibold', SEVERITY()[f.severity][1])}
                  data-severity={f.severity}
                >
                  {SEVERITY()[f.severity][0]}
                </span>
                <span className="min-w-0">
                  {f.line !== undefined && <span className="mr-1 font-mono text-xs text-mut">L{f.line}</span>}
                  {f.problem}
                  <span className="block text-xs text-mut">{tr('web.review.basis', { basis: f.basis })}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
