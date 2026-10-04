/**
 * BUG-M13-004 · model.request 的 ts 要是「请求发出」那一刻（PRD-M8-008 AC-2 的 tok/s 靠它）
 *
 * 原来一步的事件（request / delta / usage / tool.call）攒到流结束才一起落盘，
 * 同一批共用一个 ts——request 的时间其实是这一步结束的时间，生成用了多久从事件流里量不出来。
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteEventLog } from '@domi/store'
import { type Clock, type ProviderLike, runTurn } from '../src/index.ts'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

test('请求先落盘再开流：request.ts 早于 usage.ts，差值就是这一步的生成耗时', async () => {
  const d = mkdtempSync(join(tmpdir(), 'domi-timing-'))
  dirs.push(d)
  // 落盘时间由这个钟给；provider 生成时把它往前拨 2 秒，模拟模型在吐字
  const clock: Clock & { t: number } = { t: 1_000_000, now: () => clock.t }
  const sink = new SqliteEventLog({ path: join(d, 'e.db'), clock })
  const provider: ProviderLike = {
    id: 'stub',
    async *generate() {
      clock.t += 2_000
      yield { type: 'delta', text: '好' }
      yield { type: 'usage', raw: { input_tokens: 10, output_tokens: 200 } }
    },
  }
  await runTurn(
    {
      sink,
      clock,
      provider,
      tools: { schemas: () => [], run: async () => ({ ok: true, payload: {} }) },
      policy: { maxTokens: 1_000_000, includeReasoning: false },
      model: 'm',
    },
    's',
    '你好',
  )
  const evs = await sink.read('s')
  const reqTs = evs.find((e) => e.ev.t === 'model.request')!.ts
  const usageTs = evs.find((e) => e.ev.t === 'model.usage')!.ts
  expect(usageTs - reqTs).toBe(2_000)
  sink.close()
})
