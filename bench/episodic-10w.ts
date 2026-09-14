/**
 * 10 万条事件规模下的检索性能 —— PRD-M2-004 AC-4（P95 < 300ms）
 *
 * **合成数据，不联网，可以进 CI。** 这正是它和 `scripts/measure-cache.ts` 的区别：
 * 那个要真实模型调用所以只能手动跑，这个纯本地，所以必须常跑——
 * 性能回归是那种"每次只慢一点点"的问题，只有基线一直在跑才看得见。
 *
 * 用法：bun run bench/episodic-10w.ts [事件条数]
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { searchEpisodes } from '../packages/memory/src/index.ts'
import type { DomiEvent } from '../packages/protocol/src/index.ts'
import { SqliteEventLog } from '../packages/store/src/index.ts'

export const TARGET_P95_MS = 300
const DEFAULT_N = 100_000
const BATCH = 2_000

/** 确定性语料：没有随机数，跑一百次结果同一个形状 */
const TOPICS = [
  'CORS 预检失败，缺少 Access-Control-Allow-Origin',
  '数据库迁移中途失败，已从备份回滚',
  '把 sum.js 的减号改成加号并跑测试',
  'prompt cache 命中率偏低，前缀被动态内容污染了',
  '影子仓库放在工作区外面，回滚不碰用户的 git',
  'shell 超时后要杀掉整个进程组，否则留下孤儿进程',
  '事件流是 append-only，删除是软删除',
  '权限默认拒绝，没配规则就是不许',
]

function eventsFor(i: number): DomiEvent[] {
  const topic = TOPICS[i % TOPICS.length] as string
  return [
    { t: 'user.input', text: `第 ${i} 次：${topic}` },
    { t: 'model.reason', text: `先确认 ${topic.slice(0, 8)} 的现状` },
    { t: 'tool.call', id: `c${i}`, name: 'fs.read', args: { path: `src/mod-${i % 500}.ts` } },
    { t: 'tool.result', id: `c${i}`, ok: true, payload: `模块 ${i % 500} 的内容：${topic}`, ms: 3 },
    { t: 'model.delta', text: `处理完了：${topic}` },
  ]
}

function p95(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0
}

export async function run(n = DEFAULT_N): Promise<{ p95: number; median: number; indexed: number; writeMs: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'domi-bench-'))
  const log = new SqliteEventLog({ path: join(dir, 'events.db') })
  try {
    const t0 = Date.now()
    let written = 0
    let session = 0
    while (written < n) {
      const batch: DomiEvent[] = []
      while (batch.length < BATCH && written < n) {
        batch.push(...eventsFor(written))
        written += 5
      }
      await log.append(`s-${session++}`, batch)
    }
    const writeMs = Date.now() - t0

    // 混合查询：命中多的 / 命中少的 / 完全打不中的 —— 只测前者会把最慢的路径漏掉
    const queries = [
      'Access-Control-Allow-Origin',
      '从备份回滚',
      '减号改成加号',
      '孤儿进程',
      '量子纠缠与超导磁悬浮',
      '模块 137 的内容',
      'prompt cache 命中率',
      'append-only',
    ]
    const samples: number[] = []
    for (let round = 0; round < 5; round++) {
      for (const q of queries) {
        const t = Bun.nanoseconds()
        searchEpisodes(log.search, q, { limit: 10 })
        samples.push((Bun.nanoseconds() - t) / 1e6)
      }
    }

    const sorted = [...samples].sort((a, b) => a - b)
    return {
      p95: p95(samples),
      median: sorted[Math.floor(sorted.length / 2)] ?? 0,
      indexed: written,
      writeMs,
    }
  } finally {
    log.close()
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 挂载没有删除权限时不该让 bench 报错
    }
  }
}

if (import.meta.main) {
  const n = Number(process.argv[2] ?? DEFAULT_N)
  const r = await run(n)
  console.log(`[episodic-10w] ${r.indexed} 条事件 · 写入+建索引 ${r.writeMs}ms`)
  console.log(`  检索 P95 ${r.p95.toFixed(1)}ms · 中位 ${r.median.toFixed(1)}ms · 门槛 ${TARGET_P95_MS}ms`)
  if (r.p95 >= TARGET_P95_MS) {
    console.error(`\n✗ P95 超过 ${TARGET_P95_MS}ms（PRD-M2-004 AC-4）`)
    process.exit(1)
  }
  console.log('  ✓ 达标')
}
