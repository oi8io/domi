/**
 * bench-reason-merge —— TASK-M15-008（SPEC-M15-012-AC1 取舍-26）行数下降验证
 *
 * 场景：真实流式输出按 chunk 到达（AI SDK 文本流粒度通常是句子/词，几十字符一条）。
 * 旧行为每个 chunk 落一条 model.delta / model.reason；新行为按段合并（≥2048 切条，
 * 流式段边界 flush）。本脚本量化两条路径的事件条数差，断言 ≥10×（一个数量级以上）。
 *
 * 用法：bun run scripts/bench-reason-merge.ts
 * 判据：打印 ratio，ratio < 10 时 exit 1。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_LIMITS, runTurn } from '@domi/kernel'
import { StubProvider, type StubTurn } from '@domi/model'
import { SqliteEventLog } from '@domi/store'

const DELTA_CHUNKS = 100 // 100 条正文 chunk × 20 字符 = 2000 字符 → 1 段
const REASON_CHUNKS = 30 // 30 条推理 chunk × 40 字符 = 1200 字符 → 1 段

const dir = mkdtempSync(join(tmpdir(), 'domi-bench-'))
const sink = new SqliteEventLog({ path: join(dir, 'e.db') })

const chunk = (n: number, size: number): string => `${String(n).padStart(3, '0')}-${'x'.repeat(size)}`

const turn: StubTurn = [
  ...Array.from({ length: REASON_CHUNKS }, (_, i) => ({ type: 'reason' as const, text: chunk(i, 40) })),
  ...Array.from({ length: DELTA_CHUNKS }, (_, i) => ({ type: 'delta' as const, text: chunk(i, 20) })),
]

const provider = new StubProvider([turn])

const deps = {
  sink,
  provider,
  tools: {
    schemas: () => [],
    run: async () => ({ ok: true as const, payload: null }),
  },
  clock: {
    now: () => 1_756_000_000_000,
  },
  policy: { maxTokens: 1_000_000, includeReasoning: false },
  model: 'stub-1',
  limits: DEFAULT_LIMITS,
}

const r = await runTurn(deps, 'bench', '跑一段流式输出')
const events = await sink.read('bench')
const deltaEvents = events.filter((e) => e.ev.t === 'model.delta').length
const reasonEvents = events.filter((e) => e.ev.t === 'model.reason').length
const textChunks = DELTA_CHUNKS + REASON_CHUNKS
const mergedEvents = deltaEvents + reasonEvents
const ratio = textChunks / mergedEvents

process.stdout.write(`chunk 总数（旧行为事件条数）: ${textChunks}\n`)
process.stdout.write(`合并后事件条数: model.delta=${deltaEvents} + model.reason=${reasonEvents} = ${mergedEvents}\n`)
process.stdout.write(`行数下降比: ${ratio.toFixed(1)}×  stopReason=${r.stopReason}\n`)

rmSync(dir, { recursive: true, force: true })

if (mergedEvents === 0) {
  process.stderr.write('[bench-reason-merge] 没有产出任何 model.delta / model.reason 事件\n')
  process.exit(1)
}
if (ratio < 10) {
  process.stderr.write(`[bench-reason-merge] FAIL —— 行数下降 ${ratio.toFixed(1)}× < 10×，未达到一个数量级\n`)
  process.exit(1)
}
process.stdout.write(`[bench-reason-merge] OK —— ${ratio.toFixed(1)}× ≥ 10×\n`)
