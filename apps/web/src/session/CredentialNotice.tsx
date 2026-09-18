/**
 * 缺模型凭据时的提示（OPT-M8-001）：一句话 + 去设置页的链接。
 * 首页（提前知道缺）与 Composer（提交被拒）共用这一段文案
 */
import { tr } from '@domi/i18n'
import { formatRoute } from '../router.ts'

export function CredentialNotice({ provider }: { provider: string }) {
  return (
    <span data-part="missing-credential">
      {tr('web.credential.missing', { v: provider === '' ? tr('web.credential.theModel') : ` ${provider} ` })}
      <a className="font-medium text-accent underline" href={formatRoute({ view: 'settings', tab: 'models' })}>
        {tr('web.credential.goSettings')}
      </a>
      {tr('web.credential.noRestart')}
    </span>
  )
}
