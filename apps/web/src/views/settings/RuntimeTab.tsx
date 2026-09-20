/**
 * 运行时（PRD-M10-003）：loop 护栏可配置。
 * 三个数字走 config.set 白名单（loop.maxToolCalls / loop.maxArgParseRetries / loop.maxWallClockMs），
 * 缺省与 kernel 的 DEFAULT_LIMITS 一致；改完下一轮生效（runtime 从 config 读、传进 runTurn 的 limits）。
 *
 * PRD-M11-005：permissions.review 三档审核模式（on-demand/always-ask/allow-all）。
 */

import { tr } from '@domi/i18n'
import { useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { Field, Saved } from './fields.tsx'
import { str, type useSettings } from './useSettings.ts'

const LOOP_FIELDS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'loop.maxToolCalls', label: tr('web.settings.maxToolCalls'), hint: tr('web.settings.maxToolCallsHint') },
  {
    key: 'loop.maxArgParseRetries',
    label: tr('web.settings.maxArgParseRetries'),
    hint: tr('web.settings.maxArgParseRetriesHint'),
  },
  { key: 'loop.maxWallClockMs', label: tr('web.settings.maxWallClockMs'), hint: tr('web.settings.maxWallClockMsHint') },
]

const REVIEW_KEY = 'permissions.review'
const REVIEW_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'on-demand', label: tr('web.settings.reviewOnDemand') },
  { value: 'always-ask', label: tr('web.settings.reviewAlways') },
  { value: 'allow-all', label: tr('web.settings.reviewAllowAll') },
]

export function RuntimeTab({ s }: { s: ReturnType<typeof useSettings> }) {
  const d = s.data
  const [draft, setDraft] = useState<Record<string, string>>({})
  if (d === null) return <Saved error={s.error} saved={null} />
  const val = (k: string): string => draft[k] ?? str(d.values[k])
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const patch: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(draft)) {
          patch[k] = k === REVIEW_KEY ? v : Number(v)
        }
        void s.save(patch).then((ok) => ok && setDraft({}))
      }}
    >
      <Saved error={s.error} saved={s.saved} />
      <Field label={tr('web.settings.review')} hint={tr('web.settings.reviewHint')}>
        <select
          className="field-input"
          aria-label={tr('web.settings.review')}
          value={val(REVIEW_KEY) || 'on-demand'}
          onChange={(e) => setDraft({ ...draft, [REVIEW_KEY]: e.target.value })}
        >
          {REVIEW_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {LOOP_FIELDS.map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint}>
          <input
            className="field-input"
            type="number"
            aria-label={f.label}
            value={val(f.key)}
            onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
          />
        </Field>
      ))}
      <Button type="submit" variant="primary" disabled={Object.keys(draft).length === 0}>
        {tr('common.save')}
      </Button>
    </form>
  )
}
