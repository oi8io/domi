/**
 * `domi trace` —— PRD-M2-005
 *
 * 和 `domi eval` 一样住在自己包里，`packages/cli` 只做一次动态 import：
 * AC-4 要求 `packages/trace` 可以被整个删掉，静态 import 会让删除把整个 `domi` 打死。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { SqliteEventLog } from '@domi/store'
import { exportHtml } from './html.ts'
import { buildTrace, childSessionIds } from './model.ts'
import { renderText } from './text.ts'

export interface Io {
  out(s: string): void
  err(s: string): void
}

export const TRACE_HELP = `domi trace —— 看清每一步在想什么

  domi trace <sessionId>              在终端打印轨迹树
  domi trace <sessionId> --html <路径>  导出单文件 HTML（无外部请求，可离线打开）

会话 id 用 \`domi session list\` 看。轨迹完全由事件流渲染，没有独立埋点。`

/**
 * 价目表。没有的模型显示 `—` 而不是 0 —— 显示 0 会让人以为免费，
 * 比显示「不知道」更糟（与状态栏同一条口径）。
 */
const PRICING = {
  'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3 },
  'claude-opus-4-1': { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5 },
  'claude-haiku-4-5': { inputPer1M: 1, outputPer1M: 5, cacheReadPer1M: 0.1 },
}

export async function runTrace(sessionId: string | undefined, htmlOut: string | undefined, io: Io): Promise<number> {
  if (!sessionId || sessionId === 'help') {
    io.out(TRACE_HELP)
    return sessionId ? 0 : 2
  }

  const log = new SqliteEventLog({ path: join(homedir(), '.domi', 'events.db') })
  try {
    const events = await log.read(sessionId)
    if (events.length === 0) {
      io.err(`会话 ${sessionId} 没有任何事件。用 \`domi session list\` 确认 id。`)
      return 1
    }
    // 子 agent 与编排节点的会话一起读出来，嵌在树里（PRD-M5-001 AC-4）。最多三层
    const children = new Map<string, Awaited<ReturnType<typeof log.read>>>()
    let frontier = childSessionIds(events)
    for (let depth = 0; depth < 3 && frontier.length > 0; depth++) {
      const next: string[] = []
      for (const id of frontier) {
        if (children.has(id)) continue
        const sub = await log.read(id)
        children.set(id, sub)
        next.push(...childSessionIds(sub))
      }
      frontier = next
    }
    const tree = buildTrace(events, { pricing: PRICING, children })

    if (htmlOut !== undefined) {
      if (htmlOut === '') {
        io.err('--html 后面要跟一个文件路径')
        return 2
      }
      mkdirSync(dirname(htmlOut), { recursive: true })
      writeFileSync(htmlOut, exportHtml(tree), 'utf8')
      io.out(`已导出 ${htmlOut}（${events.length} 条事件；这个文件不发出任何网络请求，可以直接双击打开）`)
      return 0
    }

    io.out(renderText(tree))
    return 0
  } finally {
    log.close()
  }
}
