/**
 * 归一化 —— PRD-M2-008 AC-6
 *
 * 回放要「同一 fixture 连跑 10 次结果完全一致」，所以每一处**非确定性**都必须被抹平：
 * 时间戳、随机 id、绝对路径、耗时。
 *
 * 抹平的方式是**替换成占位符而不是删掉**——删掉的话，
 * 「本来有个路径，现在没有了」这种变化就看不出来了。
 */
// 临时目录里不确定的是**根 + 紧跟的那一段**（mkdtemp 生成的随机名），
// 再往后的相对结构是语义的一部分，要留着：/tmp/domi-a1/sum.js → <TMP>/sum.js
const TMP_DIR = /\/(?:private\/)?(?:var\/folders\/[^/\s]+\/[^/\s]+\/T|tmp)(?:\/[A-Za-z0-9._-]+)?/g
const HOME_DIR = /\/(?:home|Users)\/[A-Za-z0-9._-]+/g
const ISO_TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const SHA = /\b[0-9a-f]{40,64}\b/gi
const EPOCH_MS = /\b1[6-9]\d{11}\b/g

export function normalizeText(s: string): string {
  return s
    .replace(TMP_DIR, '<TMP>')
    .replace(HOME_DIR, '<HOME>')
    .replace(ISO_TS, '<TS>')
    .replace(UUID, '<UUID>')
    .replace(SHA, '<SHA>')
    .replace(EPOCH_MS, '<EPOCH>')
}

/** 深度归一化任意值。保持结构，只换叶子上的字符串与可疑数字 */
export function normalize(value: unknown): unknown {
  if (typeof value === 'string') return normalizeText(value)
  if (typeof value === 'number') {
    // 毫秒级耗时与时间戳都不确定；小整数（次数、行号）保留
    return Number.isInteger(value) && Math.abs(value) > 1e11 ? '<EPOCH>' : value
  }
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      // ms / 耗时这类字段整体抹掉：它们每次都不一样，且不影响语义
      out[k] = k === 'ms' || k === 'elapsedMs' || k === 'createdAt' ? '<DURATION>' : normalize(v)
    }
    return out
  }
  return value
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value))
}
