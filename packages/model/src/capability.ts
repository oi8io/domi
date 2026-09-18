/**
 * 能力矩阵 —— PRD-M1-001 AC-2/AC-3 · SPEC-M1-001
 *
 * **静态声明而不是运行时探测**，理由就一条：AC-3 要求"在发出 HTTP 请求之前"抛错，
 * 而探测本身就是一个请求。
 *
 * 代价是声明会过时。缓解办法是把矩阵放在**紧挨 provider 构造的地方**——
 * 改 provider 的人一眼就能看到它，而不是散在另一个文件里等着被遗忘。
 */
import { VENDORS, type VendorId } from '@domi/config'

export interface ModelCapabilities {
  toolCall: boolean
  vision: boolean
  reasoning: boolean
  promptCache: boolean
  structuredOutput: boolean
}

/**
 * 各厂商的默认矩阵在 `@domi/config` 的厂商模板里（PRD-M9-002 AC-2）；这里只剩类型与判断。
 * 自定义厂商全部声明 false 是**有意的保守**：它后面可能是 llama.cpp、vLLM、Ollama 或任何网关，我们无从知道。
 * 声明 false 的后果是"想用得显式打开"，声明 true 的后果是"运行时才炸"。fail-closed 在这里和 INV-03 是同一个立场。
 */
export function vendorCapabilities(vendor: VendorId): ModelCapabilities {
  return { ...VENDORS[vendor].capabilities }
}

export class UnsupportedCapabilityError extends Error {
  readonly messageKey = 'error.unsupported_capability'
  constructor(
    readonly provider: string,
    readonly capability: keyof ModelCapabilities,
  ) {
    super(
      `error.unsupported_capability: provider "${provider}" 未声明支持 ${capability}。\n` +
        `若它其实支持（常见于自定义网关），在「设置 › 模型供应商」里打开，或在 ~/.domi/config.yaml 的 providers.${provider}.capabilities 里显式打开（例如 toolCall: true）。`,
    )
    this.name = 'UnsupportedCapabilityError'
  }
}

export function assertCapability(provider: string, caps: ModelCapabilities, capability: keyof ModelCapabilities): void {
  if (!caps[capability]) throw new UnsupportedCapabilityError(provider, capability)
}

/** 能力差集：切换到更弱的模型时要列给用户看（PRD-M1-002 AC-2） */
export function lostCapabilities(from: ModelCapabilities, to: ModelCapabilities): Array<keyof ModelCapabilities> {
  return (Object.keys(from) as Array<keyof ModelCapabilities>).filter((k) => from[k] && !to[k])
}
