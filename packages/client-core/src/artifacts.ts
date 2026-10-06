/**
 * M14 产物 tab 投影 —— PRD-M14-007（SPEC-M14-007）
 *
 * 纯函数（INV-04）：checkpoint.diff（整会话，net diff）+ fs.snapshot / user.input.uploads 事件
 * → 新建产物（含 renamed 新路径）与「你给的」附件；无快照降级为 fs.snapshot 推断。
 */
import type { EventEnvelope } from '@domi/protocol'
import { isKnownEvent } from '@domi/protocol'
import type { CheckpointDiffResult } from './changes.ts'

/** 产物条目：文件 / 附件共用（附件 path = 原名） */
export interface ArtifactItem {
  path: string
  size: number | null
  /** 产生于哪一步（首次 fs.snapshot after 的 seq；兜底 = 最近一次 user.input 的 seq） */
  seq: number
  /** 兜底推断 → 端上标「约」 */
  approx: boolean
}

export interface ArtifactsView {
  /** 无 checkpoint.diff → 用 fs.snapshot 推断（SPEC 取舍-1 降级） */
  degraded: boolean
  degradedReason?: string | undefined
  files: ArtifactItem[]
  uploads: ArtifactItem[]
}

const NEW_STATUS = new Set(['added', 'renamed'])

/**
 * 该路径最近一次 fs.snapshot{after, sha≠null} 的 bytes；无 → null
 */
function lastBytes(events: readonly EventEnvelope[], path: string): number | null {
  let out: number | null = null
  for (const e of events) {
    if (!isKnownEvent(e.ev) || e.ev.t !== 'fs.snapshot') continue
    if (e.ev.path === path && e.ev.phase === 'after' && e.ev.sha256 !== null) out = e.ev.bytes
  }
  return out
}

/** 最后一条 ≤ atSeq 的 user.input 的 seq；没有 → 1 */
function lastUserSeq(events: readonly EventEnvelope[], atSeq: number): number {
  let out = 1
  for (const e of events) {
    if (e.seq > atSeq) break
    if (isKnownEvent(e.ev) && e.ev.t === 'user.input') out = e.seq
  }
  return out
}

/** 该路径首次 fs.snapshot{after, sha≠null} 的 seq；没有（shell 创建）→ null */
function firstAfterSeq(events: readonly EventEnvelope[], path: string): number | null {
  for (const e of events) {
    if (!isKnownEvent(e.ev) || e.ev.t !== 'fs.snapshot') continue
    if (e.ev.path === path && e.ev.phase === 'after' && e.ev.sha256 !== null) return e.seq
  }
  return null
}

export function artifactsView(events: readonly EventEnvelope[], diff: CheckpointDiffResult | null): ArtifactsView {
  let degraded = false
  let degradedReason: string | undefined
  let names: string[] = []
  if (diff?.available === true) {
    names = diff.files.filter((f) => NEW_STATUS.has(f.status)).map((f) => f.path)
    degradedReason = diff.reason
  } else {
    // 降级：fs.snapshot{after, sha≠null} 出现过的路径（SPEC 取舍-1）
    degraded = true
    const seen = new Set<string>()
    for (const e of events) {
      if (!isKnownEvent(e.ev) || e.ev.t !== 'fs.snapshot') continue
      if (e.ev.phase === 'after' && e.ev.sha256 !== null && !seen.has(e.ev.path)) {
        seen.add(e.ev.path)
        names.push(e.ev.path)
      }
    }
    if (diff?.reason !== undefined) degradedReason = diff.reason
  }

  const head = events.length > 0 ? events[events.length - 1]!.seq : 1
  const files: ArtifactItem[] = names.map((path) => {
    const first = firstAfterSeq(events, path)
    const seq = first ?? lastUserSeq(events, head)
    return {
      path,
      size: lastBytes(events, path),
      seq,
      approx: first === null,
    }
  })

  const uploads: ArtifactItem[] = []
  for (const e of events) {
    if (!isKnownEvent(e.ev) || e.ev.t !== 'user.input') continue
    for (const u of e.ev.uploads ?? []) {
      uploads.push({ path: u.name, size: u.size, seq: e.seq, approx: false })
    }
  }

  return {
    degraded,
    ...(degradedReason === undefined ? {} : { degradedReason }),
    files,
    uploads,
  }
}
