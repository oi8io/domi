/**
 * `domi review` —— PRD-M7-010
 *
 * 在 domid 里派一个只读的审阅会话，等它交出结构化发现，按文件打印。
 */
import { createSessionStore, type DomiClient, type ReviewFindingSnapshot } from '@domi/client-core'

export const REVIEW_USAGE = `用法：
  domi review [--base <提交>] [--spec <需求文档>]...
    审阅当前目录相对 base（默认 HEAD，含未提交与未跟踪的改动）的 diff。
    审阅者是一个只读的新会话：看得到需求文档与 diff，看不到任何对话历史。`

const SEVERITY: Record<string, string> = { high: '高', medium: '中', low: '低' }

export function formatFindings(findings: readonly ReviewFindingSnapshot[]): string {
  if (findings.length === 0) return '没有发现问题。'
  const byFile = new Map<string, ReviewFindingSnapshot[]>()
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f])
  const lines: string[] = [`发现 ${findings.length} 个问题：`]
  for (const [file, list] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push('', file)
    for (const f of list.sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      lines.push(
        `  [${SEVERITY[f.severity] ?? f.severity}] ${f.line ? `第 ${f.line} 行：` : ''}${f.problem}`,
        `      依据：${f.basis}`,
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
      io.out(REVIEW_USAGE)
      return 0
    } else {
      io.err(REVIEW_USAGE)
      return 2
    }
  }
  const id = await client.startReview({ cwd, specs, ...(base === undefined ? {} : { base }) })
  io.out(`审阅会话 ${id} 开始了（只读，Web / TUI 里都能看过程）……`)
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
    io.err(`审阅者没有交出结构化发现就结束了。${last ? `\n最后一段：${last.text.slice(0, 500)}` : ''}`)
    return 1
  }
  io.out(formatFindings(findings ?? []))
  return (findings ?? []).some((f) => f.severity === 'high') ? 1 : 0
}
