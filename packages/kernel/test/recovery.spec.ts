/**
 * PRD-M3-002 AC-3 · TASK-M3-010：进程中途退出后，把会话恢复到最后一个一致点
 *
 * 「一致」指的是：每个 tool.call 都有对应的 tool.result，且这一轮有明确的结束标记。
 * 不一致的事件流喂给模型会被拒（tool_use 没有 tool_result），所以恢复不是锦上添花。
 */
import { describe, expect, test } from 'bun:test'
import type { DomiEvent, EventEnvelope } from '@domi/protocol'
import { buildContext, recoveryEvents, turnState } from '../src/index.ts'

function envs(evs: DomiEvent[]): EventEnvelope[] {
  return evs.map((ev, i) => ({
    seq: i + 1,
    sessionId: 's',
    parentSeq: i === 0 ? null : i,
    ts: 0,
    schemaVersion: 2,
    ev,
  }))
}

const input: DomiEvent = { t: 'user.input', text: '列一下文件' }
const request: DomiEvent = { t: 'model.request', provider: 'stub', model: 'm', tokensIn: 1 }
const call = (id: string): DomiEvent => ({ t: 'tool.call', id, name: 'shell.exec', args: { cmd: 'ls' } })
const result = (id: string): DomiEvent => ({ t: 'tool.result', id, ok: true, payload: 'a b', ms: 1 })

describe('turnState · 这一轮结束了没有', () => {
  test('空会话、正常答完、流中断停下：都是一致的', () => {
    expect(turnState(envs([]))).toEqual({ open: false, danglingCalls: [] })
    expect(turnState(envs([input, request, { t: 'model.delta', text: '好' }]))).toEqual({
      open: false,
      danglingCalls: [],
    })
    expect(
      turnState(envs([input, request, { t: 'error', scope: 'loop', message: '模型流中断', recoverable: true }])),
    ).toEqual({ open: false, danglingCalls: [] })
  })

  test('模型还没回话就断了：这一轮没结束', () => {
    expect(turnState(envs([input]))).toEqual({ open: true, danglingCalls: [] })
  })

  test('工具在跑时断了：调用悬空', () => {
    const s = turnState(envs([input, request, call('c1'), call('c2'), result('c1')]))
    expect(s.open).toBe(true)
    expect(s.danglingCalls).toEqual([{ id: 'c2', name: 'shell.exec' }])
  })

  test('工具都跑完了、下一次模型请求还没发出去就断了：没结束，但没有悬空调用', () => {
    expect(turnState(envs([input, request, call('c1'), result('c1')]))).toEqual({ open: true, danglingCalls: [] })
  })

  test('重复的调用 id 按次数配对', () => {
    const s = turnState(envs([input, request, call('c'), result('c'), request, call('c')]))
    expect(s.danglingCalls).toEqual([{ id: 'c', name: 'shell.exec' }])
  })

  test('轨迹事件（压缩失败、切模型、MCP 提示）不算结束', () => {
    const noise: DomiEvent[] = [
      { t: 'error', scope: 'compact', message: 'x', recoverable: true },
      { t: 'model.switch', from: 'a', to: 'b' },
      { t: 'error', scope: 'mcp', message: 'y', recoverable: true },
    ]
    expect(turnState(envs([input, ...noise])).open).toBe(true)
  })
})

describe('recoveryEvents · 补到一致点', () => {
  test('一致的会话什么都不补', () => {
    expect(recoveryEvents(envs([input, request, { t: 'model.delta', text: '好' }]))).toEqual([])
  })

  test('悬空调用补一条「中断」结果，再补一条 recovery 结束标记；补完就一致了', () => {
    const before = envs([input, request, call('c1')])
    const fix = recoveryEvents(before)
    expect(fix[0]).toMatchObject({ t: 'tool.result', id: 'c1', ok: false, reason: 'interrupted', ms: 0 })
    expect(fix.at(-1)).toMatchObject({ t: 'error', scope: 'recovery', recoverable: true })
    // 结果里要告诉模型：这个命令**可能已经执行了一部分**——不然它会放心地再跑一遍
    expect(JSON.stringify(fix[0])).toContain('可能')
    const after = envs([input, request, call('c1'), ...fix])
    expect(turnState(after)).toEqual({ open: false, danglingCalls: [] })
    expect(recoveryEvents(after)).toEqual([])
    // 喂给模型的上下文里，每个工具调用都配上了结果
    const msgs = buildContext(after, { maxTokens: 100_000, includeReasoning: false })
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
  })

  test('没有悬空调用的未结束轮只补结束标记', () => {
    const fix = recoveryEvents(envs([input]))
    expect(fix).toHaveLength(1)
    expect(fix[0]).toMatchObject({ t: 'error', scope: 'recovery' })
  })
})
