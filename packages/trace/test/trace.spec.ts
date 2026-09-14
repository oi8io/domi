/**
 * PRD-M2-005 · 轨迹显示（AC-1 / AC-2 / AC-3 / AC-5）
 *
 * 轨迹是**信任的来源**：一个你看不见内部的 agent，人只会拿它做无关紧要的事。
 * 所以这里的断言不是「渲染没崩」，而是「该看见的东西确实在」。
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { buildTrace, COLLAPSE_BYTES, exportHtml, findBySeq, PREVIEW_CHARS, renderText } from '../src/index.ts'

let seq = 0
function env(ev: DomiEvent): EventEnvelope {
  seq++
  return {
    seq,
    sessionId: 's1',
    parentSeq: seq > 1 ? seq - 1 : null,
    ts: 1_700_000_000_000 + seq,
    schemaVersion: 4,
    ev,
  }
}

const PRICING = { 'claude-sonnet-4-5': { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3 } }

function session(): EventEnvelope[] {
  seq = 0
  return [
    env({ t: 'user.input', text: '把 sum.js 的减号改成加号' }),
    env({ t: 'model.request', provider: 'anthropic', model: 'claude-sonnet-4-5', tokensIn: 3 }),
    env({ t: 'model.reason', text: '先读文件' }),
    env({ t: 'model.delta', text: '我先' }),
    env({ t: 'model.delta', text: '看看。' }),
    env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'sum.js' } }),
    env({ t: 'permission', capabilityId: 'fs.read', decision: 'allow', source: 'config', matchedRule: 'allow-read' }),
    env({ t: 'tool.result', id: 'c1', ok: true, payload: 'a - b', ms: 4 }),
    env({ t: 'model.usage', raw: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 500 } }),
    env({ t: 'error', scope: 'tool', message: '第一次写失败', recoverable: true }),
    env({
      t: 'ctx.cleanup',
      fromSeq: 1,
      toSeq: 9,
      tokensBefore: 900,
      tokensAfter: 400,
      saved: { dedupe: 300, verbose: 100, resolvedError: 80, stack: 20 },
      preserved: [8],
    }),
  ]
}

describe('AC-1 · 树形展示每一步', () => {
  test('思考 / 工具调用 / 权限决策 / 压缩 / 错误 都有自己的节点', () => {
    const t = buildTrace(session(), { pricing: PRICING })
    const kinds = t.nodes.map((n) => n.kind)
    expect(kinds).toContain('input')
    expect(kinds).toContain('think')
    expect(kinds).toContain('tool')
    expect(kinds).toContain('error')
    expect(kinds).toContain('cleanup')
    // 权限挂在工具调用下面，不是平铺 —— 「这次操作是谁批准的」要一眼看清
    const tool = t.nodes.find((n) => n.kind === 'tool')
    expect(tool?.children.map((c) => c.kind)).toEqual(['permission', 'tool'])
  })

  test('连续的 delta 合成一个回答节点，不被几百个碎片淹掉', () => {
    const t = buildTrace(session())
    const answers = t.nodes.filter((n) => n.kind === 'answer')
    expect(answers).toHaveLength(1)
    expect(answers[0]?.detail).toBe('我先看看。')
  })

  test('工具节点带参数与耗时', () => {
    const t = buildTrace(session())
    const tool = t.nodes.find((n) => n.kind === 'tool')
    expect(tool?.title).toBe('fs.read')
    expect(tool?.detail).toContain('sum.js')
    expect(tool?.ms).toBe(4)
  })

  test('未知事件也显示，不静默吞掉（INV-01）', () => {
    const t = buildTrace([
      {
        seq: 1,
        sessionId: 's',
        parentSeq: null,
        ts: 1,
        schemaVersion: 9,
        ev: { t: 'future.thing', __unparsed: { a: 1 }, __schemaVersion: 9 },
      },
    ])
    expect(t.nodes[0]?.kind).toBe('other')
    expect(t.nodes[0]?.title).toContain('future.thing')
    expect(t.nodes[0]?.detail).toContain('"a"')
  })
})

describe('AC-2 · 折叠', () => {
  const big = 'x'.repeat(COLLAPSE_BYTES + 100)

  test('> 2KB 的结果默认折叠', () => {
    seq = 0
    const t = buildTrace([
      env({ t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: 'ls' } }),
      env({ t: 'tool.result', id: 'c1', ok: true, payload: big, ms: 1 }),
    ])
    const result = t.nodes[0]?.children[0]
    expect(result?.collapsed).toBe(true)
  })

  test('≤ 2KB 的不折叠 —— 边界两侧都测', () => {
    seq = 0
    const t = buildTrace([
      env({ t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: 'ls' } }),
      env({ t: 'tool.result', id: 'c1', ok: true, payload: 'x'.repeat(COLLAPSE_BYTES - 2), ms: 1 }),
    ])
    expect(t.nodes[0]?.children[0]?.collapsed).toBe(false)
  })

  test('折叠态给前 200 字符 + 总字节数 —— 只说「已折叠」等于逼人全部展开一遍', () => {
    seq = 0
    const t = buildTrace([
      env({ t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: 'ls' } }),
      env({ t: 'tool.result', id: 'c1', ok: true, payload: big, ms: 1 }),
    ])
    const r = t.nodes[0]?.children[0]
    expect([...(r?.preview ?? '')]).toHaveLength(PREVIEW_CHARS + 1) // 200 字符 + 省略号
    expect(r?.bytes).toBe(COLLAPSE_BYTES + 100)
    expect(renderText(t)).toContain(`共 ${COLLAPSE_BYTES + 100} 字节`)
  })

  test('中文按字符数截，不按字节数 —— 否则会把一个字劈成两半', () => {
    seq = 0
    const t = buildTrace([
      env({ t: 'tool.call', id: 'c1', name: 'fs.read', args: { path: 'a' } }),
      env({ t: 'tool.result', id: 'c1', ok: true, payload: '中'.repeat(1000), ms: 1 }),
    ])
    const r = t.nodes[0]?.children[0]
    expect(r?.collapsed).toBe(true)
    expect(r?.preview.startsWith('中')).toBe(true)
    expect(r?.preview).not.toContain('�')
  })
})

describe('AC-3 · 每步显示 token 消耗与累计花费', () => {
  test('用量挂在它描述的那一步上，并给累计花费', () => {
    const t = buildTrace(session(), { pricing: PRICING })
    const withTokens = t.nodes.find((n) => n.tokens !== null)
    expect(withTokens?.tokens).toEqual({ input: 1000, output: 100, cacheRead: 500 })
    // 1000*3 + 100*15 + 500*0.3 = 4650 / 1e6
    expect(withTokens?.costUsdCumulative).toBeCloseTo(0.00465, 8)
    // 不写死第四位小数：0.00465 落在 toFixed 的边界上，断言那一位是在测浮点实现
    expect(renderText(t)).toMatch(/累计 \$0\.004[67]/)
  })

  test('价目表里没有的模型显示 — 而不是 0 —— 显示 0 会让人以为免费', () => {
    const t = buildTrace(session()) // 不给 pricing
    expect(t.totalCostUsd).toBeNull()
    expect(t.unpricedModels).toEqual(['claude-sonnet-4-5'])
    expect(renderText(t)).toContain('总花费：—')
    expect(renderText(t)).toContain('不参与累计')
  })
})

describe('PRD-M2-008 AC-4 的另一半 · 差异报告能跳到对应节点', () => {
  test('按 seq 能找到节点，含挂在子层的', () => {
    const t = buildTrace(session())
    expect(findBySeq(t, 1)?.kind).toBe('input')
    expect(findBySeq(t, 7)?.kind).toBe('permission') // 子节点
    expect(findBySeq(t, 999)).toBeNull()
  })

  test('HTML 里每个节点都有 seq 锚点，可以直接 #seq-N 跳过去', () => {
    const html = exportHtml(buildTrace(session()))
    expect(html).toContain('id="seq-1"')
    expect(html).toContain('id="seq-7"')
  })
})

describe('终端渲染额外的行数上限（比 AC-2 更严，不更松）', () => {
  test('120 行的结果只有 1.8KB，够不着 2KB 阈值，但终端里要截', () => {
    seq = 0
    const many = Array.from({ length: 120 }, (_, i) => `(pass) case ${i + 1}`).join('\n')
    const t = buildTrace([
      env({ t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: 'bun test' } }),
      env({ t: 'tool.result', id: 'c1', ok: true, payload: many, ms: 1 }),
    ])
    // 先确认它确实没被 AC-2 的字节阈值折叠 —— 否则这条测试测的是另一件事
    expect(t.nodes[0]?.children[0]?.collapsed).toBe(false)
    const text = renderText(t)
    expect(text).toContain('case 40')
    expect(text).not.toContain('case 41')
    expect(text).toContain('还有 80 行')
  })

  test('HTML 导出不受行数上限影响 —— 全文照样在文件里', () => {
    seq = 0
    const many = Array.from({ length: 120 }, (_, i) => `(pass) case ${i + 1}`).join('\n')
    const t = buildTrace([
      env({ t: 'tool.call', id: 'c1', name: 'shell.exec', args: { cmd: 'bun test' } }),
      env({ t: 'tool.result', id: 'c1', ok: true, payload: many, ms: 1 }),
    ])
    expect(exportHtml(t)).toContain('case 120')
  })
})
