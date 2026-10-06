/**
 * 步级快照接线 —— SPEC-M14-003 · PRD-M14-003（接手 PRD-M1-011 AC-1 的 daemon 路径）
 *
 * 快照触发点放在 runtime（INV-02：kernel 零 IO）：DomiSession 在 submit() 开头 resetTurn()，
 * LoopDeps.tools 外包一层——每一轮第一个会改文件的工具（fs.write / fs.edit / shell.exec）执行前取基线，
 * 之后每次成功返回后取一次；fs.checkpoint 事件并入工具 outcome.events，由 kernel 统一按因果顺序落盘
 * （与权限事件同一位置：tool.call 与 tool.result 之间）。
 *
 * 降级（git 没装 / 快照失败 / 超时）不阻断工具与本轮，落一条 ok:false 的可见记录（AC-4）。
 * 无变化跳过：工作树与上一快照一致时复用上一快照 id，不产生空提交（SPEC 取舍-3）。
 */
import { GitUnavailableError, type ShadowRepo } from '@domi/checkpoint'
import { KeyedError, type MessageKey, type Params } from '@domi/i18n'
import { type DomiEvent, type EventEnvelope, isKnownEvent } from '@domi/protocol'

/** 会改文件的工具（PRD-M14-003 AC-1 原文）。其余工具不触发任何快照 */
export const FILE_MODIFY_TOOLS = new Set(['fs.write', 'fs.edit', 'shell.exec'])

/** 单次快照的超时（SPEC 取舍-4）。慢机器 / 超大仓库不该拖住工具执行太久 */
export const SNAPSHOT_TIMEOUT_MS = 5000

/** 快照相关的可预期失败（→ INVALID_PARAMS 之类）。与 RefError 同一纪律 */
export class CheckpointError extends KeyedError {
  constructor(key: MessageKey, params?: Params) {
    super(key, params)
    this.name = 'CheckpointError'
  }
}

export interface SnapshotTaken {
  id: string
  files: number
}

/**
 * 快照控制器：轮内状态（基线已取、降级闩） + 两条触发点。
 * repo 持有完整 ShadowRepo：控制器自己只用 clean / snapshot，
 * 会话的 checkpoint.diff / discard RPC 还要用它的 diffFiles / restorePath
 */
export class CheckpointController {
  /** 上一份快照的 id / 文件数：无变化跳过时复用 */
  private last: SnapshotTaken | null = null
  private baselineTaken = false
  /** 本轮的降级闩：一次失败后本轮不再尝试（git 装不上不会一轮里变好） */
  private degraded = false

  constructor(
    readonly repo: ShadowRepo,
    /** 单次快照的超时上限。测试注入更小的值，生产用 SPEC 的 5s */
    readonly timeoutMs: number = SNAPSHOT_TIMEOUT_MS,
  ) {}

  /** 每一轮（user.input）开头调用。基线与降级闩只活在一轮内 */
  resetTurn(): void {
    this.baselineTaken = false
    this.degraded = false
  }

  /** 工具执行前：该轮第一个改文件工具 → 基线快照 */
  async beforeTool(call: { id: string; name: string }): Promise<DomiEvent[]> {
    if (!FILE_MODIFY_TOOLS.has(call.name) || this.baselineTaken || this.degraded) return []
    this.baselineTaken = true
    return [await this.checkpoint('baseline', call.id)]
  }

  /** 工具执行后：成功返回 → 快照；失败 / 被拒不取（没有改动） */
  async afterTool(call: { id: string; name: string }, ok: boolean): Promise<DomiEvent[]> {
    if (!FILE_MODIFY_TOOLS.has(call.name) || !ok || this.degraded) return []
    return [await this.checkpoint('after', call.id)]
  }

  private async checkpoint(phase: 'baseline' | 'after', toolCallId: string): Promise<DomiEvent> {
    try {
      const taken = await withTimeout(this.snapshotMaybe(), this.timeoutMs)
      if (taken !== null) this.last = taken
      return {
        t: 'fs.checkpoint',
        phase,
        toolCallId,
        id: this.last?.id ?? null,
        files: this.last?.files ?? 0,
        ok: true,
      }
    } catch (e) {
      this.degraded = true
      return {
        t: 'fs.checkpoint',
        phase,
        toolCallId,
        id: null,
        files: 0,
        ok: false,
        message: messageOf(e),
      }
    }
  }

  /** 无变化跳过：与 HEAD 一致时复用上一快照 id（null = 复用，不产生新提交） */
  private async snapshotMaybe(): Promise<SnapshotTaken | null> {
    if (this.last !== null && (await this.repo.clean())) return null
    const s = await this.repo.snapshot('domi 步级快照')
    return { id: s.id, files: s.files }
  }
}

function messageOf(e: unknown): string {
  if (e instanceof GitUnavailableError) return '系统没有可用的 git，步级快照已关闭'
  if (e instanceof Error) return e.message
  return String(e)
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`步级快照超时（${ms}ms）`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

// ── 快照 ↔ 事件流的投影与区间规则（纯函数，不碰 IO）──────────────────────────

export interface CheckpointRow {
  seq: number
  id: string
  phase: 'baseline' | 'after'
}

/** 从事件流投影出所有快照（id 非空），按 seq 排序 */
export function checkpointIndex(events: readonly EventEnvelope[]): CheckpointRow[] {
  const out: CheckpointRow[] = []
  for (const env of events) {
    const ev = env.ev
    if (!isKnownEvent(ev)) continue
    if (ev.t === 'fs.checkpoint' && ev.id !== null) {
      out.push({ seq: env.seq, id: ev.id, phase: ev.phase })
    }
  }
  return out
}

/** 最后一个 user.input 的 seq（≤ fromSeq）；没有 → 0 */
export function lastUserInputSeq(events: readonly EventEnvelope[], fromSeq: number): number {
  let out = 0
  for (const env of events) {
    if (env.seq > fromSeq) break
    if (env.ev.t === 'user.input') out = env.seq
  }
  return out
}

/** 最后一个 seq ≤ 上限且 ≥ 下限的 checkpoint；没有 → undefined */
function lastAtOrBefore(index: readonly CheckpointRow[], seq: number, floor: number): CheckpointRow | undefined {
  for (let i = index.length - 1; i >= 0; i--) {
    const r = index[i]
    if (r === undefined) continue
    if (r.seq <= seq && r.seq >= floor) return r
  }
  return undefined
}

/**
 * 该步起点的 from 快照（SPEC-M14-010 取舍-1：回到这一步之前 = 步起点状态）。
 * 步起点 = 该轮第一个 checkpoint（改文件工具执行前）。没有快照 → null。
 */
export function stepStartSnapshot(events: readonly EventEnvelope[], toSeq: number): string | null {
  const index = checkpointIndex(events)
  if (index.length === 0) return null
  const turnStart = lastUserInputSeq(events, toSeq)
  const baseline = index.find((r) => r.seq >= turnStart) ?? index[0]
  return baseline?.id ?? null
}

export interface SnapshotRange {
  from: string
  to: string
}

/**
 * 区间规则（SPEC-M14-003 取舍-6）：给定事件区间 [fromSeq, toSeq]，选出起止快照。
 *   turnStart = 最后一个 ≤ fromSeq 的 user.input
 *   baseline  = 该轮内第一个 checkpoint（seq ≥ turnStart）
 *   from      = 最后一个 ≤ fromSeq 且 ≥ baseline.seq 的 checkpoint；区间内没有 → baseline
 *   to        = 最后一个 ≤ toSeq 且 ≥ from.seq 的 checkpoint
 * 没有快照、或 from 与 to 相同（这段区间没产生新快照）→ null
 */
export function resolveSnapshots(
  events: readonly EventEnvelope[],
  fromSeq: number,
  toSeq: number,
): SnapshotRange | null {
  const index = checkpointIndex(events)
  if (index.length === 0) return null
  const turnStart = lastUserInputSeq(events, fromSeq)
  const baseline = index.find((r) => r.seq >= turnStart) ?? index[0]
  if (baseline === undefined) return null
  const from = lastAtOrBefore(index, fromSeq, baseline.seq) ?? baseline
  const to = lastAtOrBefore(index, toSeq, from.seq)
  if (to === undefined || to.id === from.id) return null
  return { from: from.id, to: to.id }
}
