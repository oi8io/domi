/**
 * L2 跨会话内容检索 —— PRD-M2-004
 *
 * 「上次我们怎么解决那个 CORS 问题的」——这个问题只有事件流能回答，
 * 因为答案不在任何一个文件里，它在**当时那段对话**里。
 *
 * 与 M1 的会话列表过滤是两回事：那个按标题匹配当前列表，这个按**内容**检索全部历史。
 *
 * AC-3 是这里最该说清楚的一条：**相关度不够就明说没有，不返回 top-k。**
 * 返回一堆不相关的结果，模型会拿它们当真——
 * 「我什么都没找到」是一个有用的答案，「这是三条最不离谱的」不是。
 */
import type { SearchHit, SearchRepo } from '@domi/store'

export interface EpisodeResult {
  found: true
  hits: Array<{ sessionId: string; seq: number; type: string; text: string; score: number }>
}
export interface EpisodeMiss {
  found: false
  reason: string
}
export type EpisodeAnswer = EpisodeResult | EpisodeMiss

/**
 * 相关度门槛。bm25 在 SQLite 里**越小越相关**（返回负数），
 * 所以"低于阈值"在这里是"分数大于 MAX_SCORE"。
 * 这个数字是拍的，但它的**作用**不是：没有门槛就只能返回 top-k，
 * 而 top-k 在无关查询上返回的永远是噪音。
 */
export const MAX_SCORE = -0.0000001

export interface SearchOpts {
  limit?: number
  sessionId?: string
  /** 摘要截断长度。命中的是长文本时，返回全文会把上下文撑爆 */
  snippetChars?: number
}

export const SNIPPET_CHARS = 300

export function searchEpisodes(repo: SearchRepo, query: string, opts: SearchOpts = {}): EpisodeAnswer {
  const q = query.trim()
  if (q === '') return { found: false, reason: '查询为空' }

  const raw: SearchHit[] = repo.search(q, {
    limit: opts.limit ?? 10,
    ...(opts.sessionId === undefined ? {} : { sessionId: opts.sessionId }),
  })
  // 短查询走的是 LIKE 降级路径，分数恒为 0，不参与门槛判断（它本来就是精确子串匹配）
  const isFallback = [...q].length < 3
  const kept = isFallback ? raw : raw.filter((h) => h.score <= MAX_SCORE)

  if (kept.length === 0) {
    return {
      found: false,
      reason: `没有与「${q}」相关的历史。不返回勉强沾边的结果——那会被当成真的。`,
    }
  }

  const n = opts.snippetChars ?? SNIPPET_CHARS
  return {
    found: true,
    hits: kept.map((h) => ({
      sessionId: h.sessionId,
      seq: h.seq,
      type: h.type,
      text: [...h.body].length > n ? `${[...h.body].slice(0, n).join('')}…` : h.body,
      score: h.score,
    })),
  }
}

/** 给模型看的渲染。每条都带 sessionId + seq —— 搜到了要能跳回原始轨迹（AC-1） */
export function formatEpisodes(a: EpisodeAnswer): string {
  if (!a.found) return a.reason
  return a.hits.map((h) => `[${h.sessionId} · seq ${h.seq} · ${h.type}] ${h.text}`).join('\n')
}
