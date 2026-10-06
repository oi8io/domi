/**
 * M14 改动 tab 投影 —— PRD-M14-005（SPEC-M14-005）
 *
 * 全部纯函数（INV-04）：范围换算、降级回退、选中保持、实时标记、词级 diff、patch 统计、折叠规则。
 * Web 与 TUI（009）共用这一份；组件层不做任何计算。
 */
import type { EventEnvelope } from '@domi/protocol'
import { isKnownEvent } from '@domi/protocol'

export type ChangesRange = 'turn' | 'session' | 'baseline' | { step: string }

/** checkpoint.diff RPC 结果（与 worktree.diff 同形） */
export interface CheckpointDiffFile {
  path: string
  status: string
  patch: string
  truncated?: boolean | undefined
}
export interface CheckpointDiffResult {
  available: boolean
  reason?: string | undefined
  files: CheckpointDiffFile[]
}

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

/** 端上文件视图：patch 之外带上 +N −M（patchStats 算好，渲染层不数） */
export interface ChangeFileView {
  path: string
  status: ChangeStatus
  patch: string
  truncated?: boolean | undefined
  added: number
  removed: number
}

export interface ChangesView {
  available: boolean
  reason?: string | undefined
  files: ChangeFileView[]
  /** 降级回退：该范围内 fs.snapshot 出现过的文件名（无 diff 内容，SPEC-M14-005 取舍-1） */
  fallbackNames: string[]
}

/** 步区间（TASK-M14-004 的 planView 提供；004 之前端上不产生 {step} 范围） */
export interface StepIntervals {
  [stepId: string]: { startSeq: number; endSeq: number }
}

/** 最后一个 ≤ atSeq 的 user.input 的 seq；没有 → null */
export function lastUserInputSeq(events: readonly EventEnvelope[], atSeq: number): number | null {
  let out: number | null = null
  for (const e of events) {
    if (e.seq > atSeq) break
    if (isKnownEvent(e.ev) && e.ev.t === 'user.input') out = e.seq
  }
  return out
}

/**
 * 范围 → checkpoint.diff 的 fromSeq/toSeq（SPEC-M14-003 取舍-6 的范围换算）。
 * baseline 由 worktree.diff 提供 → null。{step} 需要步区间表，缺失 → null（等 004 填）。
 */
export function changesRangeSeq(
  events: readonly EventEnvelope[],
  range: ChangesRange,
  head: number,
  steps?: StepIntervals,
): { fromSeq: number; toSeq: number } | null {
  if (range === 'baseline') return null
  if (range === 'turn') return { fromSeq: lastUserInputSeq(events, head) ?? 1, toSeq: head }
  if (range === 'session') return { fromSeq: 1, toSeq: head }
  const iv = steps?.[range.step]
  return iv === undefined ? null : { fromSeq: iv.startSeq, toSeq: iv.endSeq }
}

/** 该范围内 fs.snapshot 出现过的路径（去重，按出现顺序） */
export function fsSnapshotNames(events: readonly EventEnvelope[], fromSeq: number, toSeq: number): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of events) {
    if (e.seq < fromSeq || e.seq > toSeq) continue
    if (!isKnownEvent(e.ev) || e.ev.t !== 'fs.snapshot') continue
    if (seen.has(e.ev.path)) continue
    seen.add(e.ev.path)
    out.push(e.ev.path)
  }
  return out
}

const STATUS: Record<string, ChangeStatus> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
}

export function toFileViews(files: readonly CheckpointDiffFile[]): ChangeFileView[] {
  return files.map((f) => {
    const { added, removed } = patchStats(f.patch)
    return {
      path: f.path,
      status: STATUS[f.status] ?? 'modified',
      patch: f.patch,
      ...(f.truncated ? { truncated: true } : {}),
      added,
      removed,
    }
  })
}

/**
 * 改动 tab 的数据视图：available 用 checkpoint.diff 的文件列表；降级 / 无数据回退列 fs.snapshot 文件名。
 * head 是该会话当前事件流头部 seq（端上 = 已加载窗口的尾部；老 daemon 没有 checkpoint 时 diff 传 null）。
 */
export function changesView(
  events: readonly EventEnvelope[],
  diff: CheckpointDiffResult | null,
  range: ChangesRange,
  head: number,
  steps?: StepIntervals,
): ChangesView {
  if (diff?.available === true) {
    return { available: true, files: toFileViews(diff.files), fallbackNames: [] }
  }
  const r = changesRangeSeq(events, range, head, steps)
  const fallbackNames = r === null ? [] : fsSnapshotNames(events, r.fromSeq, r.toSeq)
  const reason = diff?.reason
  return { available: false, ...(reason === undefined ? {} : { reason }), files: [], fallbackNames }
}

/**
 * 切换范围不丢选中（AC-1）：新范围还有该文件 → 保持；没有 → null（回列表）。
 */
export function keepSelection(
  _prev: readonly CheckpointDiffFile[] | readonly ChangeFileView[],
  next: readonly CheckpointDiffFile[] | readonly ChangeFileView[],
  selected: string | null,
): string | null {
  if (selected === null) return null
  return next.some((f) => f.path === selected) ? selected : null
}

/**
 * 实时更新（AC-6）：正在看的文件有新改动 → 标「有新改动 · 刷新」，不自动替换。
 * 比较依据 = patch / status / truncated（daemon 重算后的内容变了才算 stale）。
 */
export function staleFiles(
  prev: readonly CheckpointDiffFile[] | readonly ChangeFileView[],
  next: readonly CheckpointDiffFile[] | readonly ChangeFileView[],
  selected: string | null,
): string[] {
  if (selected === null) return []
  const before = prev.find((f) => f.path === selected)
  const after = next.find((f) => f.path === selected)
  if (before === undefined || after === undefined) return []
  const same =
    before.status === after.status &&
    before.patch === after.patch &&
    (before.truncated ?? false) === (after.truncated ?? false)
  return same ? [] : [selected]
}

/** patch 里 +N −M：数内容行（+/- 开头、非 +++ / --- 头） */
export function patchStats(patch: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
  }
  return { added, removed }
}

// ── 词级 diff（AC-2）───────────────────────────────────────────────────────

export type WordSpanKind = 'same' | 'del' | 'add'
export interface WordSpan {
  text: string
  kind: WordSpanKind
}

/** 切成 token：连续 ASCII 词、空白、标点、中文单字各自成 token */
function tokenize(s: string): string[] {
  const out: string[] = []
  const push = (t: string): void => {
    if (t !== '') out.push(t)
  }
  let i = 0
  const isWord = (c: string): boolean => /[A-Za-z0-9_]/.test(c)
  const isCjk = (c: string): boolean => /[\u3400-\u9fff\uf900-\ufaff]/.test(c)
  while (i < s.length) {
    const c = s[i] as string
    if (isWord(c)) {
      let j = i
      while (j < s.length && isWord(s[j] as string)) j += 1
      push(s.slice(i, j))
      i = j
    } else if (isCjk(c)) {
      push(c)
      i += 1
    } else if (/\s/.test(c)) {
      let j = i
      while (j < s.length && /\s/.test(s[j] as string)) j += 1
      push(s.slice(i, j))
      i = j
    } else {
      push(c)
      i += 1
    }
  }
  return out
}

/** LCS 求共同 token 的索引集合（O(n·m)，diff 行都短，够用） */
function lcsCommon(a: readonly string[], b: readonly string[]): Set<number> {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? (dp[i + 1]?.[j + 1] ?? 0) + 1 : Math.max(dp[i + 1]?.[j] ?? 0, dp[i]?.[j + 1] ?? 0)
    }
  }
  const common = new Set<number>()
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      common.add(i)
      i += 1
      j += 1
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) i += 1
    else j += 1
  }
  return common
}

function spans(tokens: readonly string[], common: Set<number>, kind: WordSpanKind): WordSpan[] {
  const out: WordSpan[] = []
  let cur: WordSpan | null = null
  for (let i = 0; i < tokens.length; i++) {
    const k: WordSpanKind = common.has(i) ? 'same' : kind
    if (cur !== null && cur.kind === k) cur.text += tokens[i]
    else {
      cur = { text: tokens[i] as string, kind: k }
      out.push(cur)
    }
  }
  return out
}

/**
 * 两行文本的词级 diff：返回 old 行（del = 被删的词）与 new 行（add = 新增的词）。
 * 相同 token 保持 same——词级而非整行高亮。
 */
export function wordDiff(oldText: string, newText: string): { old: WordSpan[]; add: WordSpan[] } {
  const a = tokenize(oldText)
  const b = tokenize(newText)
  const common = lcsCommon(a, b)
  return { old: spans(a, common, 'del'), add: spans(b, common, 'add') }
}

// ── 折叠规则（AC-5）────────────────────────────────────────────────────────

const GENERATED: ReadonlyArray<{ re?: RegExp; names?: string[] }> = [
  { names: ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lock', 'bun.lockb'] },
  { re: /^dist\// },
  { re: /^build\// },
  { re: /\.min\.js$/ },
]
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|heic)$/i
export const FOLD_MAX_PATCH_BYTES = 100_000

/** 锁文件 / 生成文件（pnpm-lock、package-lock、yarn.lock、bun.lock*、dist/、build/、*.min.js） */
export function isGeneratedPath(path: string): boolean {
  return GENERATED.some((g) => (g.names?.includes(path) ?? false) || (g.re?.test(path) ?? false))
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.test(path)
}

/**
 * 默认折叠：生成文件 / patch > 100KB / 二进制（patch 空且非图片）。
 * 图片不折叠（前后对照渲染）；大文件（contentNotSnapshotted，patch 空 + truncated）也折叠。
 */
export function shouldFold(
  file: Pick<CheckpointDiffFile, 'path' | 'patch' | 'truncated'>,
  sizeBytes?: number,
): boolean {
  if (isImagePath(file.path)) return false
  if (isGeneratedPath(file.path)) return true
  if (file.patch === '') return true // 二进制 / 未快照的大文件
  if (sizeBytes !== undefined && sizeBytes > 5 * 1024 * 1024) return true
  return file.patch.length > FOLD_MAX_PATCH_BYTES
}

/** 该范围内某文件第一次出现在 fs.snapshot 的 seq（改动条目 → 对话定位，SPEC-M14-002 取舍-1）；没出现 → null */
export function changeFileSeq(
  events: readonly EventEnvelope[],
  path: string,
  fromSeq: number,
  toSeq: number,
): number | null {
  for (const e of events) {
    if (e.seq < fromSeq || e.seq > toSeq) continue
    if (!isKnownEvent(e.ev) || e.ev.t !== 'fs.snapshot') continue
    if (e.ev.path === path) return e.seq
  }
  return null
}
