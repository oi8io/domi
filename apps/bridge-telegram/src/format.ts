/**
 * 出站消息 —— PRD-M5-007 AC-2 / AC-5 · INV-11
 *
 * **桥接发出去的每一个字都从这里来。** 只允许：步骤标题、状态、耗时、会话 id 与 seq、diff 行数统计。
 * 工具参数、工具结果、文件内容、命令原文、节点输出一律不发——哪怕它们就在手边的 TranscriptItem.summary 里。
 * `scripts/check-bridge-payload.ts` 拿带内容的事件喂这里，断言输出里没有那些内容。
 */
import type { AskSnapshot, TranscriptItem } from '@domi/client-core'

/** 节点进展。只转 task 类条目的标题行（不带 summary：那里是节点输出） */
export function formatProgress(sessionId: string, item: TranscriptItem): string | null {
  if (item.kind !== 'task') return null
  const mark = item.ok === undefined ? '▸' : item.ok ? '✅' : '❌'
  return `${mark} ${item.text}\n${sessionId} · #${item.seq}`
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] ?? p
}

/**
 * 审批请求。detail 是完整的工具参数（给本机确认框看的），这里只取统计：
 * 文件只报文件名与行数，命令只报程序名，其余一概不报
 */
export function formatAsk(sessionId: string, ask: AskSnapshot): string {
  const lines = [`⏸ 需要确认：${ask.capabilityId}`, sessionId]
  let args: Record<string, unknown> | null = null
  try {
    const parsed = JSON.parse(ask.detail) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
  } catch {
    args = null
  }
  if (args) {
    if (typeof args.path === 'string') lines.push(`文件：${basename(args.path)}`)
    if (typeof args.content === 'string') lines.push(`写入 ${args.content.split('\n').length} 行`)
    if (typeof args.cmd === 'string') lines.push(`程序：${args.cmd.trim().split(/\s+/)[0] ?? ''}`)
  }
  if (ask.form) lines.push('（这是一个要填表的询问，Telegram 里只能拒绝；要填请去 TUI / Web）')
  lines.push('完整内容请在 TUI 或 Web 里看')
  return lines.join('\n')
}
