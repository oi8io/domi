/**
 * StubProvider —— 后续所有测试的模型替身。
 *
 * INV-08「真实 LLM 调用不进 CI 门禁」不是靠自觉，是靠**每个测试都有替身可用**。
 * 替身难用，人就会去调真接口。所以这里刻意做得好用：
 * 给一个"每轮吐什么"的脚本，它按轮次消费。
 */
import type { ModelCapabilities } from './capability.ts'
import type { ModelEvent, ModelProvider, ModelRequest } from './provider.ts'

/** 一轮的脚本：要么是事件序列，要么是一个函数（可以读到本轮的 request） */
export type StubTurn = ModelEvent[] | ((req: ModelRequest, turn: number) => ModelEvent[])

export interface StubProviderOptions {
  id?: string
  /** 替身默认什么都支持——测试要验能力拒绝时显式调低 */
  capabilities?: Partial<ModelCapabilities>
  /** 轮次用尽后的行为：'repeat-last' 便于压测循环，'throw' 便于暴露"多跑了一轮" */
  onExhausted?: 'repeat-last' | 'throw'
  /**
   * 标题生成请求（PRD-M10-001）的独立剧本，**不占对话轮次**。
   * 语义与 script 相同：数组按标题请求轮次消费（越界回退到最后一轮），元素是单轮剧本（事件数组或函数）。
   * 自动标题是运行时附属行为：不给剧本时替身返回固定 JSON 标题，
   * 免得它插队打乱多轮测试的 turn 序列（verify-gate / plan-mode 曾因此错位）。
   * 要断言标题内容 / 降级时显式传剧本（如 title-gen.spec.ts）。
   */
  titleScript?: StubTurn[]
}

const ALL_CAPABLE: ModelCapabilities = {
  toolCall: true,
  vision: true,
  reasoning: true,
  promptCache: true,
  structuredOutput: true,
}

export class StubProvider implements ModelProvider {
  readonly id: string
  readonly capabilities: ModelCapabilities
  /** 每次 generate 的入参都记下来，测试据此断言 providerOptions 等是否原样传到位 */
  readonly calls: ModelRequest[] = []
  private turn = 0
  private titleTurn = 0
  private readonly onExhausted: 'repeat-last' | 'throw'
  private readonly titleScript: StubTurn[] | undefined

  constructor(
    private readonly script: StubTurn[],
    opts: StubProviderOptions = {},
  ) {
    this.id = opts.id ?? 'stub'
    this.capabilities = { ...ALL_CAPABLE, ...opts.capabilities }
    this.onExhausted = opts.onExhausted ?? 'throw'
    this.titleScript = opts.titleScript
  }

  async *generate(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    this.calls.push(req)
    if (isTitleRequest(req)) {
      yield* this.titleEvents(req, signal)
      return
    }
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

  /** 标题生成：独立消费 titleScript（不占对话轮次）；没给剧本就回固定 JSON 标题 */
  private async *titleEvents(req: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    const t = this.titleTurn++
    let turn: ModelEvent[]
    if (this.titleScript !== undefined) {
      // 数组按轮取，越界回退到最后一轮；单轮剧本可以是事件数组或函数
      const raw = this.titleScript[t] ?? this.titleScript[this.titleScript.length - 1] ?? []
      turn = typeof raw === 'function' ? raw(req, t) : raw
    } else {
      turn = [{ type: 'delta', text: '{"title":"自动标题"}' }]
    }
    for (const ev of turn) {
      if (signal.aborted) return
      yield ev
    }
  }
}

/** 是否标题生成请求（generateTitle 的提示词特征）。给 StubProvider 分流，也给测试过滤 calls 用 */
export function isTitleRequest(req: ModelRequest): boolean {
  return req.messages.some((m) => m.role === 'user' && String(m.content).includes('起一个不超过 20 字的标题'))
}
