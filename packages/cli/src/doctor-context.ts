/**
 * `domi doctor --context` —— SPEC-M15-001（尺子 · PRD-M15-001 AC-5）
 *
 * 只读扫 `~/.domi/events.db`，输出 RECON-CONTEXT 的 R0 基线表：
 * 命中率 / 输入输出比 / 提示词分布 / 步数分布 / 工具结果占比 / 可避免损失与断裂归因 / 记忆成功率。
 *
 * 纪律：不联网、不改库（打开 SQLite 只读、不写任何表）；
 * 记忆成功率在 TASK-M15-007 接线前为「—」。
 */

import { aggregate } from '@domi/kernel'
import { type EventEnvelope, estimateTextTokens, isKnownEvent } from '@domi/protocol'
import { SqliteEventLog } from '@domi/store'
import type { Io } from './io.ts'

export interface ContextSessionRow {
  sessionId: string
  title: string
  steps: number
  turns: number
  cacheHitPercent: number | null
  input: number
  output: number
  toolResultTokens: number
  avoidableLoss: number
  breakCount: number
  breakdown: Record<string, number>
  promptLayersTokens: number
  promptToolsTokens: number
  promptHistoryTokens: number
}

export interface ContextReport {
  sessions: ContextSessionRow[]
  totals: {
    sessions: number
    events: number
    input: number
    output: number
    toolResultTokens: number
    avoidableLoss: number
    breakCount: number
    breakdown: Record<string, number>
    memorySuccessRate: number | null
  }
}

export async function scanContext(dbPath: string, limit = 20): Promise<ContextReport> {
  const log = new SqliteEventLog({ path: dbPath })
  try {
    const sessions = log.sessions.list({ includeSpawned: true })
    const rows: ContextSessionRow[] = []
    let events = 0
    let input = 0
    let output = 0
    let toolResultTokens = 0
    let avoidableLoss = 0
    let breakCount = 0
    const breakdown: Record<string, number> = {}

    for (const s of sessions.slice(0, limit)) {
      const evs = await log.read(s.id)
      events += evs.length
      const m = aggregate(evs)
      let rowTool = 0
      for (const { ev } of evs) {
        if (!isKnownEvent(ev)) continue
        if (ev.t === 'tool.result' && ev.ok === true && ev.payload !== undefined) {
          rowTool += estimateTextTokens(JSON.stringify(ev.payload))
        }
        if (ev.t === 'ctx.prefix.break') {
          breakdown[ev.cause] = (breakdown[ev.cause] ?? 0) + 1
        }
      }
      input += m.tokens.input + m.tokens.cacheRead
      output += m.tokens.output
      toolResultTokens += rowTool
      avoidableLoss += m.avoidableLoss
      breakCount += m.breakCount
      const ctx = lastRequestCtx(evs)
      rows.push({
        sessionId: s.id,
        title: s.title ?? '',
        steps: m.steps,
        turns: m.turns,
        cacheHitPercent: m.cacheHitPercent,
        input: m.tokens.input + m.tokens.cacheRead,
        output: m.tokens.output,
        toolResultTokens: rowTool,
        avoidableLoss: m.avoidableLoss,
        breakCount: m.breakCount,
        breakdown: {},
        promptLayersTokens: ctx?.layers.reduce((a, l) => a + (l.approxTokens ?? 0), 0) ?? 0,
        promptToolsTokens: ctx?.tools ?? 0,
        promptHistoryTokens: ctx?.history ?? 0,
      })
    }

    return {
      sessions: rows,
      totals: {
        sessions: rows.length,
        events,
        input,
        output,
        toolResultTokens,
        avoidableLoss,
        breakCount,
        breakdown,
        memorySuccessRate: null,
      },
    }
  } finally {
    log.close()
  }
}

function lastRequestCtx(evs: readonly EventEnvelope[]): {
  layers: Array<{ approxTokens?: number }>
  tools?: number
  history?: number
} | null {
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i]
    if (e === undefined) continue
    const { ev } = e
    if (!isKnownEvent(ev) || ev.t !== 'model.request' || ev.ctx === undefined) continue
    return ev.ctx
  }
  return null
}

function pct(a: number, b: number): string {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : '—'
}

export function formatContextReport(r: ContextReport): string {
  const t = r.totals
  const lines: string[] = []
  lines.push('上下文诊断（R0 基线 · SPEC-M15-001）')
  lines.push('─'.repeat(64))
  lines.push(
    `会话 ${t.sessions} 个 · 事件 ${t.events} 条 · 命中率 ${pct(r.sessions.reduce((a, s) => a + (s.cacheHitPercent ?? 0), 0) / Math.max(1, r.sessions.filter((s) => s.cacheHitPercent !== null).length), 100)} · 输入 ${t.input} · 输出 ${t.output}（1:${t.output > 0 ? (t.input / t.output).toFixed(1) : '—'}）`,
  )
  lines.push(
    `工具结果占比 ${pct(t.toolResultTokens, t.input)} · 可避免损失 ${t.avoidableLoss} token · 前缀断裂 ${t.breakCount} 次`,
  )
  const causes = Object.entries(t.breakdown).sort((a, b) => b[1] - a[1])
  lines.push(
    causes.length > 0
      ? `断裂归因：${causes.map(([c, n]) => `${c} ×${n}`).join(' · ')}`
      : '断裂归因：无（前缀稳定或尚未产生观测）',
  )
  lines.push('记忆成功率：—（M15-007 接线后显示）')
  lines.push('─'.repeat(64))
  lines.push('最近会话（步骤 / 命中% / 输入 / 工具结果% / 可避免损失 / 提示词≈层+工具+历史）')
  for (const s of r.sessions.slice(0, 15)) {
    lines.push(
      `${s.sessionId.slice(0, 8)} · ${s.steps} 步 · ${s.cacheHitPercent === null ? '—' : `${s.cacheHitPercent}%`} · ${s.input} in · ${pct(s.toolResultTokens, s.input)} 工具 · 损失 ${s.avoidableLoss} · ≈${s.promptLayersTokens}+${s.promptToolsTokens}+${s.promptHistoryTokens} token`,
    )
  }
  return lines.join('\n')
}

export async function runContextDoctor(dbPath: string, io: Io): Promise<number> {
  const report = await scanContext(dbPath)
  io.out(formatContextReport(report))
  return 0
}
