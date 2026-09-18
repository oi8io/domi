/**
 * 缺模型凭据时的引导（OPT-M8-001）。domid 允许无 key 启动，缺 key 留到提交时报；
 * 端上只负责「认出来 + 指路去设置页」，判断本身是 daemon 做的（INV-02）。
 */
import type { ResultOf } from '@domi/protocol'
import { DomiRpcError } from './client.ts'

/** 提交被拒是因为缺凭据：返回缺的是哪一家；不是这类错误 → null */
export function missingCredentialOf(e: unknown): string | null {
  if (!(e instanceof DomiRpcError) || e.data?.reason !== 'MISSING_CREDENTIAL') return null
  return typeof e.data.provider === 'string' ? e.data.provider : ''
}

/**
 * 默认模型那一家还没有 key：返回那一家（首页提前引导）。
 * 不在设置页可编辑清单里的 provider 看不出有没有 key，按「不缺」处理——真缺的话提交时 daemon 会说
 */
export function defaultProviderMissingKey(s: ResultOf<'config.get'>): string | null {
  const provider = s.values['model.provider']
  if (typeof provider !== 'string') return null
  const sec = s.secrets[provider]
  return sec !== undefined && !sec.set ? provider : null
}
