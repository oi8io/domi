/**
 * StubProvider —— 后续所有测试的模型替身。
 *
 * INV-08「真实 LLM 调用不进 CI 门禁」不是靠自觉，是靠**每个测试都有替身可用**。
 * 替身难用，人就会去调真接口。所以这里刻意做得好用：
 * 给一个"每轮吐什么"的脚本，它按轮次消费。
 */
import type { ModelEvent, ModelProvider, ModelRequest } from './provider.ts'

/** 一轮的脚本：要么是事件序列，要么是一个函数（可以读到本轮的 request） */
export type StubTurn = ModelEvent[] | ((req: ModelRequest, turn: number) => ModelEvent[])

export interface StubProviderOptions {
  id?: string
  /** 轮次用尽后的行为：'repeat-last' 便于压测循环，'throw' 便于暴露"多跑了一轮" */
  onExhausted?: 'repeat-last' | 'throw'
}

export class StubProvider implements ModelProvider {
  readonly id: string
  /** 每次 generate 的入参都记下来，测试据此断言 providerOptions 等是否原样传到位 */
  readonly calls: ModelRequest[] = []
  private turn = 0
  private readonly onExhausted: 'repeat-last' | 'throw'

  constructor(
    private readonly script: StubTurn[],
    opts: StubProviderOptions = {},
  ) {
    this.id = opts.id ?? 'stub'
    this.onExhausted = opts.onExhausted ?? 'throw'
  }

  async *generate(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.calls.push(req)
    const i = this.turn++
    let turn = this.script[i]
    if (turn === undefined) {
      if (this.onExhausted === 'throw') {
        throw new Error(`StubProvider 脚本只有 ${this.script.length} 轮，第 ${i + 1} 轮没有剧本`)
      }
      turn = this.script[this.script.length - 1] ?? []
    }
    const events = typeof turn === 'function' ? turn(req, i) : turn
    for (const ev of events) {
      if (signal.aborted) return
      yield ev
    }
  }
}
