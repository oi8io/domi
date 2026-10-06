/**
 * M14 双向联动投影 —— PRD-M14-002（SPEC-M14-002）
 *
 * 纯函数（INV-04）：右侧栏条目（计划步骤 / 改动文件 / 产物 / 压缩点 / 读过的文件）在事件流里的
 * 位置 → 对话里的定位（loaded / needOlder）。
 * Web 层拿到 needOlder 就循环补拉 session.history，再滚动 + flash。
 * 文件 → 首个 fs.snapshot seq 的映射在 changes.ts（changeFileSeq），此处不重复。
 */
import type { SessionStore } from './store.ts'

export type LocateResult = { kind: 'loaded'; itemIndex: number } | { kind: 'needOlder' } | { kind: 'missing' }

/**
 * 定位：该 seq 在已加载窗口内 → 它在 $items 里的下标；窗口更早 → needOlder（补拉条件）；
 * 超过头部 → missing。
 * tool.result 之类不产生独立条目的 seq 就近定位到最后一个 ≤ seq 的条目（工具组已合并）。
 */
export function locateInTranscript(store: SessionStore, seq: number): LocateResult {
  const items = store.$items.get()
  if (items.length === 0) {
    return store.$hasOlder.get() ? { kind: 'needOlder' } : { kind: 'missing' }
  }
  const first = items[0]?.seq ?? 0
  const last = items[items.length - 1]?.seq ?? 0
  if (seq < first) return { kind: 'needOlder' }
  if (seq > last) return { kind: 'missing' }
  let found = -1
  for (let i = 0; i < items.length; i++) {
    const s = items[i]?.seq ?? 0
    if (s === seq) return { kind: 'loaded', itemIndex: i }
    if (s < seq) found = i
  }
  return { kind: 'loaded', itemIndex: Math.max(0, found) }
}
