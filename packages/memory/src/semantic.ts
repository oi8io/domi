/**
 * L3 语义记忆：抽取与检索 —— PRD-M4-001 · docs/adr/018
 *
 * 这里只有逻辑，没有 IO：模型调用、embedding、落库都由调用方注入（packages/memory 不依赖 @domi/model）。
 */
import { type EventEnvelope, isKnownEvent, type SemanticItem } from '@domi/protocol'
import type { SemanticRepo, StoredItem } from '@domi/store'
import { type Extraction, ExtractionSchema, extractPrompt } from './extract-prompt.ts'

export { EXTRACT_KINDS, type Extraction, ExtractionSchema, extractPrompt } from './extract-prompt.ts'

/** 一段对话渲染成带编号的记录，模型引用编号作为来源（AC-2） */
export function transcriptOf(events: readonly EventEnvelope[], maxChars = 24_000): string {
  const lines: string[] = []
  let pending: { seq: number; text: string } | null = null
  const flush = (): void => {
    if (pending && pending.text.trim() !== '') lines.push(`[${pending.seq}] 助手：${pending.text.trim()}`)
    pending = null
  }
  for (const e of events) {
    const ev = e.ev
    if (!isKnownEvent(ev)) continue
    if (ev.t === 'model.delta') {
      pending = pending ? { seq: pending.seq, text: pending.text + ev.text } : { seq: e.seq, text: ev.text }
      continue
    }
    flush()
    if (ev.t === 'user.input') lines.push(`[${e.seq}] 用户：${ev.text}`)
    else if (ev.t === 'tool.call') lines.push(`[${e.seq}] 调用 ${ev.name}`)
  }
  flush()
  const text = lines.join('\n')
  // 太长就留后面：越近的越可能还有用
  return text.length > maxChars ? `…（前面省略）\n${text.slice(-maxChars)}` : text
}

/** 比较用的归一化：去掉空白与标点、统一大小写。否决与去重都用它 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** 稳定的条目 id：同一类、同一句话永远得到同一个 id，天然去重 */
export function itemId(kind: string, text: string): string {
  let h = 0x811c9dc5
  for (const ch of `${kind}:${normalizeText(text)}`) {
    h ^= ch.codePointAt(0) as number
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `m-${h.toString(36)}`
}

export type Extractor = (prompt: string) => Promise<Extraction>

export interface ExtractInput {
  sessionId: string
  /** 这次要抽的那一段（视图编号） */
  events: readonly EventEnvelope[]
  known: readonly StoredItem[]
  rejected: readonly string[]
  extract: Extractor
}

/** 抽取一段，返回**新**条目：来源编号不在这一段里的丢掉，已知的、被否决过的丢掉 */
export async function extractItems(input: ExtractInput): Promise<SemanticItem[]> {
  if (!input.events.some((e) => e.ev.t === 'user.input')) return []
  const seqs = new Set(input.events.map((e) => e.seq))
  const prompt = extractPrompt(
    transcriptOf(input.events),
    input.known.map((k) => k.text),
    input.rejected,
  )
  const raw = ExtractionSchema.parse(await input.extract(prompt))
  const knownIds = new Set(input.known.map((k) => k.id))
  const rejected = new Set(input.rejected.map(normalizeText))
  const out: SemanticItem[] = []
  for (const it of raw.items) {
    const refs = it.seqs.filter((s) => seqs.has(s)).map((seq) => ({ sessionId: input.sessionId, seq }))
    // 没有可溯源的来源就不收：AC-2 要求每条都能追回原始事件
    if (refs.length === 0) continue
    const id = itemId(it.kind, it.text)
    if (knownIds.has(id) || rejected.has(normalizeText(it.text))) continue
    knownIds.add(id)
    out.push({ id, kind: it.kind, text: it.text.trim(), sourceRefs: refs })
  }
  return out
}

export type Embedder = (texts: readonly string[]) => Promise<Float32Array[]>

export interface SemanticSearchResult {
  items: Array<StoredItem & { score: number }>
  /** 实际用了哪种检索。没配 embedding 时是 keyword，调用方要把这一点告诉用户 */
  mode: 'semantic+keyword' | 'keyword'
}

/** 关键词 + 语义合并。语义相似度低于门槛的不要——和 L2 一样，没有就说没有 */
export async function searchSemantic(
  repo: SemanticRepo,
  query: string,
  opts: { limit?: number; embed?: { model: string; embedder: Embedder } } = {},
): Promise<SemanticSearchResult> {
  const limit = opts.limit ?? 10
  const keyword = repo.searchText(query, limit)
  if (!opts.embed) return { items: keyword, mode: 'keyword' }
  const [vec] = await opts.embed.embedder([query])
  const semantic = vec ? repo.searchVector(vec, opts.embed.model, limit).filter((r) => r.score >= 0.5) : []
  const seen = new Set<string>()
  const merged: Array<StoredItem & { score: number }> = []
  for (const r of [...semantic, ...keyword]) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    merged.push(r)
  }
  return { items: merged.slice(0, limit), mode: 'semantic+keyword' }
}

/** memory.write 的给人看的 diff 行 */
export function itemDiff(op: '+' | '-', item: { kind: string; text: string }): string {
  return `${op} [${item.kind}] ${item.text}`
}
