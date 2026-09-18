/**
 * 缺模型凭据时的提示（OPT-M8-001）：一句话 + 去设置页的链接。
 * 首页（提前知道缺）与 Composer（提交被拒）共用这一段文案
 */
import { formatRoute } from '../router.ts'

export function CredentialNotice({ provider }: { provider: string }) {
  return (
    <span data-part="missing-credential">
      还没有配置{provider === '' ? '模型' : ` ${provider} `}的 API key。
      <a className="font-medium text-accent underline" href={formatRoute({ view: 'settings', tab: 'models' })}>
        去「设置 › 模型供应商」填写
      </a>
      ，保存后立即生效，不用重启。
    </span>
  )
}
