/**
 * `domi doctor --context` —— SPEC-M15-001（尺子 · PRD-M15-001 AC-5）
 *
 * 只读扫 `~/.domi/events.db`，输出 RECON-CONTEXT 的 R0 基线表：
 * 命中率 / 输入输出比 / 提示词分布 / 步数分布 / 工具结果占比 / 可避免损失与断裂归因 / 记忆成功率。
 *
 * 纪律：不联网、不改库（打开 SQLite 只读、不写任何表）；
 * 记忆成功率在 TASK-M15-007 接线前为「—」。
 */

import { VENDORS } from '@domi/config'
import { tr } from '@domi/i18n'
import { aggregate } from '@domi/kernel'
import { type EventEnvelope, estimateTextTokens, isKnownEvent } from '@domi/protocol'
import { MEMORY_SESSION_ID, SqliteEventLog } from '@domi/store'
import { type CapabilityReportInput, capabilityLines } from './doctor-capabilities.ts'
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
  /** 有用户事件但还没迁移的内部会话（PRD-M15-008 AC-2） */
  leakedInternalSessions: string[]
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

    // PRD-M15-008 AC-6：记忆成功率 = 抽取段数 /（抽取段数 + 抽取失败次数），
    // 真相在 _memory 会话：memory.write{op:'extracted'} 是成功段，error{scope:'memory'} 是失败段
    let extracted = 0
    let extractFails = 0
    const memEvents = await log.read(MEMORY_SESSION_ID).catch(() => [])
    for (const { ev } of memEvents) {
      if (!isKnownEvent(ev)) continue
      if (ev.t === 'memory.write' && ev.op === 'extracted') extracted++
      else if (ev.t === 'error' && ev.scope === 'memory') extractFails++
    }
    const memorySuccessRate =
      extracted + extractFails === 0 ? null : Math.round((extracted / (extracted + extractFails)) * 100) / 100

    // PRD-M15-008 AC-2：检测到未迁移的内部会话（有用户事件）→ 提示跑 domi migrate-m15
    const leaked: string[] = []
    for (const row of log.sessions.list({ includeDeleted: true, includeSpawned: true, idPrefix: '_' })) {
      const evs = await log.read(row.id).catch(() => [])
      // 用户产生的事件 = user.input / user.note（SPEC-M15-008 取舍-21 的起算点；
      // tool.* / model.delta 链都跟着它们走，不该把它们算进来）
      const hasUser = evs.some(({ ev }) => isKnownEvent(ev) && (ev.t === 'user.input' || ev.t === 'user.note'))
      if (hasUser) leaked.push(row.id)
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
        memorySuccessRate,
      },
      leakedInternalSessions: leaked,
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

export function formatContextReport(r: ContextReport, vendorCfg?: CapabilityReportInput): string {
  const t = r.totals
  const lines: string[] = []
  lines.push(tr('cli.doctor.ctxTitle'))
  if (vendorCfg) {
    // SPEC-M15-006 AC-6：这家支持什么、开了什么
    lines.push(...capabilityLines(vendorCfg, VENDORS[vendorCfg.provider as keyof typeof VENDORS]))
  }
  lines.push('─'.repeat(64))
  const hitPct = pct(
    r.sessions.reduce((a, s) => a + (s.cacheHitPercent ?? 0), 0) /
      Math.max(1, r.sessions.filter((s) => s.cacheHitPercent !== null).length),
    100,
  )
  const ioRatio = t.output > 0 ? `1:${(t.input / t.output).toFixed(1)}` : '—'
  lines.push(
    tr('cli.doctor.ctxSessions', {
      sessions: String(t.sessions),
      events: String(t.events),
      hit: hitPct,
      input: String(t.input),
      output: String(t.output),
      ratio: ioRatio,
    }),
  )
  lines.push(
    tr('cli.doctor.ctxToolShare', {
      pct: pct(t.toolResultTokens, t.input),
      loss: String(t.avoidableLoss),
      breaks: String(t.breakCount),
    }),
  )
  const causes = Object.entries(t.breakdown).sort((a, b) => b[1] - a[1])
  lines.push(
    causes.length > 0
      ? tr('cli.doctor.ctxCauses', { causes: causes.map(([c, n]) => `${c} ×${n}`).join(' · ') })
      : tr('cli.doctor.ctxCausesNone'),
  )
  // PRD-M15-008 AC-6：记忆成功率（null = 还没有任何抽取记录）
  const rate = r.totals.memorySuccessRate === null ? '—' : `${Math.round(r.totals.memorySuccessRate * 100)}%`
  lines.push(tr('cli.doctor.ctxMemory', { rate }))
  for (const id of r.leakedInternalSessions) {
    lines.push(tr('cli.doctor.ctxMigrateHint', { sessionId: id }))
  }
  lines.push('─'.repeat(64))
  lines.push(tr('cli.doctor.ctxHeader'))
  for (const s of r.sessions.slice(0, 15)) {
    lines.push(
      tr('cli.doctor.ctxRow', {
        id: s.sessionId.slice(0, 8),
        steps: String(s.steps),
        hit: s.cacheHitPercent === null ? '—' : `${s.cacheHitPercent}%`,
        input: String(s.input),
        tool: pct(s.toolResultTokens, s.input),
        loss: String(s.avoidableLoss),
        layers: String(s.promptLayersTokens),
        tools: String(s.promptToolsTokens),
        history: String(s.promptHistoryTokens),
      }),
    )
  }
  return lines.join('\n')
}

export async function runContextDoctor(dbPath: string, io: Io, vendorCfg?: CapabilityReportInput): Promise<number> {
  const report = await scanContext(dbPath)
  io.out(formatContextReport(report, vendorCfg))
  return 0
}
